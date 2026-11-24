// dsh-closure-pet — 宿主：运行时状态、花费累计、持久化、余额轮询
//
// 前端每秒拉 /state；这里用计数器（而不是布尔）让前端能识别"事件发生了几次"，
// 轮询丢一帧也不会漏。持久化写到 $DSH_HOME/.dshcl.json（node_modules 可能只读）。

import fs from 'node:fs/promises'
import path from 'node:path'

import { bjDayKey, computePeriod } from './period.js'
import { SCHEMA_VERSION, SETTINGS_DEFAULTS, normalizeSettings } from '../assets/src/shared/protocol.js'

export const LOW_THRESHOLD = 10   // 低于这个数（元）算"余额不足"
export const LOW_EXIT_RATIO = 1.2 // 退出阈值 = 10 * 1.2，带迟滞防抖
export const TOPUP_DELTA = 5      // 一次上涨超过 5 元 → 认为充值成功

export function createStore(opts) {
  const dshHome = opts.dshHome
  const configPath = path.join(dshHome, opts.configName || '.dshcl-overlay.json')

  const runtime = {
    seq: 0,
    period: computePeriod(),
    periodChangedAt: 0,
    periodSeq: 0,
    workMode: 'idle',      // idle | thinking | outputting
    workSince: Date.now(),
    outputUntil: 0,
    agentRunning: false,
    tools: { ok: 0, fail: 0, lastOkAt: 0, lastFailAt: 0, lastFailName: '', lastFailMessage: '' },
    errors: { count: 0, lastAt: 0, message: '' },
    turnEndSeq: 0,
    turnEnd: null,
    topUpSeq: 0,
    topUpAt: 0,
    balance: null,         // { ok, stale, low, total, recharge, bonus, currency, fetchedAt }
    balancePolls: 0,
    lowStreak: 0,
    lastLow: false,
    lastTotal: null,
    // —— 计费（当日花费 / 本轮花费）——
    spend: {
      day: bjDayKey(),
      today: 0,
      tokensToday: 0,
      turn: null,
      turnAmount: 0,
      turnTokens: 0,
      lastTurn: null,
      // 使用源拆分：key = provider + '\u0000' + model → { provider, model, cost, tokens }
      bySource: {},
    },
    // —— 持久化设置（前端可以改，宿主写 $DSH_HOME/.dshcl.json）——
    settings: { ...SETTINGS_DEFAULTS },
  }

  function bump() { runtime.seq = Date.now() }

  function setWork(mode) {
    if (runtime.workMode === mode) return
    runtime.workMode = mode
    runtime.workSince = Date.now()
    bump()
  }

  // ————————————————————— 计费 —————————————————————
  function noteSpend(cost, tokens, turn, source) {
    const sp = runtime.spend
    const day = bjDayKey()
    if (sp.day !== day) {
      sp.day = day
      sp.today = 0
      sp.tokensToday = 0
      sp.bySource = {}
    }
    if (typeof turn === 'number' && turn !== sp.turn) {
      if (sp.turn !== null) {
        sp.lastTurn = {
          turn: sp.turn,
          amount: Number(sp.turnAmount.toFixed(6)),
          tokens: sp.turnTokens,
        }
      }
      sp.turn = turn
      sp.turnAmount = 0
      sp.turnTokens = 0
    }
    sp.today += cost
    sp.tokensToday += tokens
    sp.turnAmount += cost
    sp.turnTokens += tokens
    // 使用源（provider + model）按当日累计，供气泡脚注显示
    try {
      const provider = String((source && source.provider) || '').trim() || '未知'
      const model = String((source && source.model) || '').trim() || '未知'
      if (!sp.bySource || typeof sp.bySource !== 'object') sp.bySource = {}
      const key = provider + '\u0000' + model
      let rec = sp.bySource[key]
      if (!rec) rec = sp.bySource[key] = { provider, model, cost: 0, tokens: 0 }
      rec.cost += cost
      rec.tokens += tokens
    } catch (err) { /* 使用源统计失败不影响总额 */ }
    bump()
    scheduleSave()
  }

  // ————————————————————— 配置持久化 —————————————————————
  let configSaveTimer = null
  let configSaving = false

  function configPayload() {
    return { version: SCHEMA_VERSION, settings: runtime.settings, spend: runtime.spend }
  }

  async function writeConfigNow() {
    if (configSaving) return
    configSaving = true
    try {
      await fs.mkdir(dshHome, { recursive: true })
      const tmp = configPath + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(configPayload(), null, 2), 'utf8')
      await fs.rename(tmp, configPath)
    } catch (err) {
      console.warn('[closure-pet] 写配置失败：' + String((err && err.message) || err))
    } finally {
      configSaving = false
    }
  }

  function scheduleSave() {
    if (configSaveTimer) return
    configSaveTimer = setTimeout(() => { configSaveTimer = null; writeConfigNow() }, 1500)
  }

  async function loadConfig() {
    try {
      const raw = await fs.readFile(configPath, 'utf8')
      const cfg = JSON.parse(raw)
      const s = cfg && cfg.settings
      if (s && typeof s === 'object') {
        Object.assign(runtime.settings, normalizeSettings(s, runtime.settings))
      }
      const sp = cfg && cfg.spend
      if (sp && sp.day === bjDayKey()) {
        runtime.spend.today = Number(sp.today) || 0
        runtime.spend.tokensToday = Number(sp.tokensToday) || 0
        if (sp.lastTurn) runtime.spend.lastTurn = sp.lastTurn
        if (sp.bySource && typeof sp.bySource === 'object') {
          const clean = {}
          for (const key of Object.keys(sp.bySource)) {
            const rec = sp.bySource[key]
            if (!rec || typeof rec !== 'object') continue
            clean[key] = {
              provider: String(rec.provider || '未知'),
              model: String(rec.model || '未知'),
              cost: Number(rec.cost) || 0,
              tokens: Number(rec.tokens) || 0,
            }
          }
          runtime.spend.bySource = clean
        }
      }
    } catch (err) { /* 首次启动 / 文件不存在 / 内容损坏：沿用默认值 */ }
  }

  // ————————————————————— 余额轮询 —————————————————————
  // 失败保留旧值并标 stale，绝不把失败当 0。
  const numOr = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  function walletSum(list, currency) {
    return list
      .filter((w) => w && String(w.currency || 'CNY') === currency && numOr(w.balance) !== null)
      .reduce((sum, w) => sum + Number(w.balance), 0)
  }

  async function pollBalance(account) {
    if (!account || typeof account.getBalance !== 'function') {
      runtime.balance = {
        ok: false, stale: true, low: false, total: null, recharge: null, bonus: null,
        currency: 'CNY', fetchedAt: Date.now(), reason: 'no-account-service',
      }
      return
    }
    let result = null
    try {
      result = await account.getBalance({
        version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
        locale: 'zh_CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
    } catch (err) {
      runtime.balance = {
        ...(runtime.balance || {}), ok: false, stale: true, fetchedAt: Date.now(),
        reason: 'getBalance error: ' + String((err && err.message) || err).slice(0, 120),
      }
      return
    }
    if (!result) {
      // 未登录：保留上一次的 low（不清零），只标记 signedOut
      runtime.balance = {
        ok: false, stale: false, low: !!runtime.lastLow, total: null, recharge: null, bonus: null,
        currency: 'CNY', fetchedAt: Date.now(), signedOut: true,
      }
      return
    }
    if (result.status !== 'ready') {
      runtime.balance = {
        ...(runtime.balance || {}), ok: false, stale: true, fetchedAt: Date.now(), reason: 'status=' + String(result.status),
      }
      return
    }

    const normal = Array.isArray(result.value) ? result.value : []
    const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
    const all = normal.concat(bonus).filter((w) => w && numOr(w.balance) !== null)
    if (all.length === 0) {
      runtime.balance = {
        ...(runtime.balance || {}), ok: false, stale: true, fetchedAt: Date.now(), reason: 'no-wallets',
      }
      return
    }
    const currency = String((all.find((w) => String(w.currency) === 'CNY') || all[0]).currency || 'CNY')
    const recharge = walletSum(normal, currency)
    const bonusSum = walletSum(bonus, currency)
    const total = Number((recharge + bonusSum).toFixed(6))

    runtime.balancePolls++
    // 低余额判定：进入用单次读数（`< T` 立即算低），退出用迟滞（`>= T*1.2`）。
    // ⚠️ 不能用"连续 2 次才算低"：插件重载后 streak 归零，第一次读数会被判成
    //    low=false，前端就会误弹一次"余额恢复"。
    const prevLow = !!runtime.lastLow
    const low = prevLow ? total < LOW_THRESHOLD * LOW_EXIT_RATIO : total < LOW_THRESHOLD
    runtime.lastLow = low

    // 充值成功：相对上次读数上涨超过阈值；或从"不足"恢复
    const recovered = runtime.lastTotal !== null && (total - runtime.lastTotal) >= TOPUP_DELTA
    const recoveredFromLow = prevLow && !low
    if (recovered || recoveredFromLow) {
      runtime.topUpSeq++
      runtime.topUpAt = Date.now()
      bump()
    }
    runtime.lastTotal = total

    runtime.balance = {
      ok: true, stale: false, low,
      total, recharge: Number(recharge.toFixed(6)), bonus: Number(bonusSum.toFixed(6)),
      currency, fetchedAt: Date.now(),
    }
    bump()
  }

  return {
    runtime,
    dshHome,
    configPath,
    bump,
    setWork,
    noteSpend,
    configPayload,
    writeConfigNow,
    scheduleSave,
    loadConfig,
    pollBalance,
  }
}
