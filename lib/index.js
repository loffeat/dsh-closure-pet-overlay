// dsh-closure-pet-overlay — 宿主：本地服务 + 拉起 Electron 桌面浮窗
//
// 与页面内版本 dsh-closure-pet 共用前端与 store，但客户端跑在独立透明置顶窗口里，
// 随 DSH 启动自动出现、随 DSH 退出自动关闭。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { createStore, LOW_THRESHOLD } from './store.js'
import { registerEvents } from './events.js'
import { computePeriod, nextPeriodChangeAt, holidaysOutdated, HOLIDAY_VALLEY } from './period.js'
import { SCHEMA_VERSION, URL_PREFIX, normalizeSettings } from '../assets/src/shared/protocol.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(HERE, '..')
const ASSET_ROOT = path.join(PACKAGE_ROOT, 'assets')
const HELPER_MAIN = path.join(HERE, 'helper', 'main.cjs')
const HELPER_HTML = path.join(HERE, 'helper', 'pet.html')

export const name = 'dsh-closure-pet-overlay'

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export function apply(root) {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const store = createStore({ dshHome, configName: '.dshcl-overlay.json' })
  store.loadConfig()
  registerEvents(root, store)
  const runtime = store.runtime

  let server = null
  let helper = null
  let helperPort = 0
  let disposed = false
  const timers = []

  // ————————————— 响应工具 —————————————
  function sendJson(res, body) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }

  async function sendFile(res, file) {
    try {
      const bytes = await fsp.readFile(file)
      res.statusCode = 200
      res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.end(bytes)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  }

  async function readBody(req, limit = 8192) {
    return await new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  function statePayload() {
    return {
      seq: runtime.seq,
      schemaVersion: SCHEMA_VERSION,
      ts: Date.now(),
      period: runtime.period,
      periodSeq: runtime.periodSeq,
      periodChangedAt: runtime.periodChangedAt,
      periodNextChangeAt: nextPeriodChangeAt(),
      periodHolidays: Object.keys(HOLIDAY_VALLEY),
      holidaysOutdated: holidaysOutdated(),
      work: { mode: runtime.workMode, since: runtime.workSince },
      tools: { ...runtime.tools },
      errors: { ...runtime.errors },
      turnEnd: { seq: runtime.turnEndSeq, ...(runtime.turnEnd || {}) },
      topUpSeq: runtime.topUpSeq,
      topUpAt: runtime.topUpAt,
      agentRunning: runtime.agentRunning,
      balance: runtime.balance,
      spend: {
        day: runtime.spend.day,
        today: Number(runtime.spend.today.toFixed(6)),
        tokensToday: runtime.spend.tokensToday,
        turn: runtime.spend.turn,
        turnAmount: Number(runtime.spend.turnAmount.toFixed(6)),
        turnTokens: runtime.spend.turnTokens,
        lastTurn: runtime.spend.lastTurn,
        sources: Object.keys(runtime.spend.bySource || {})
          .map((k) => {
            const r = runtime.spend.bySource[k] || {}
            return {
              provider: String(r.provider || '未知'),
              model: String(r.model || '未知'),
              cost: Number(Number(r.cost || 0).toFixed(6)),
              tokens: Number(r.tokens) || 0,
            }
          })
          .filter((r) => r.cost > 0)
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 8),
      },
      config: { lowThreshold: LOW_THRESHOLD },
    }
  }

  // ————————————— 本地 HTTP（只服务 127.0.0.1 上的桌宠窗口） —————————————
  async function handler(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const p = decodeURIComponent(url.pathname)
      res.setHeader('Cache-Control', 'no-store')

      if (p === '/' || p === '/pet.html') { await sendFile(res, HELPER_HTML); return }
      if (p === '/pet.js') { await sendFile(res, path.join(ASSET_ROOT, 'client.js')); return }
      if (p === URL_PREFIX + '/state') { sendJson(res, statePayload()); return }

      if (p === URL_PREFIX + '/config') {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          sendJson(res, { ok: true, version: SCHEMA_VERSION, settings: runtime.settings, spend: runtime.spend })
          return
        }
        if (method !== 'PUT' && method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return }
        let patch = null
        try { patch = JSON.parse(await readBody(req)) } catch { patch = null }
        if (!patch || typeof patch !== 'object') { res.statusCode = 400; res.end('bad json'); return }
        const s = patch.settings && typeof patch.settings === 'object' ? patch.settings : patch
        Object.assign(runtime.settings, normalizeSettings(s, runtime.settings))
        store.bump()
        store.writeConfigNow().catch(() => {})
        sendJson(res, { ok: true, version: SCHEMA_VERSION, settings: runtime.settings })
        return
      }

      if (p.startsWith(URL_PREFIX + '/assets/')) {
        const rel = p.slice((URL_PREFIX + '/assets/').length)
        const file = path.resolve(ASSET_ROOT, rel)
        if (file !== ASSET_ROOT && !file.startsWith(ASSET_ROOT + path.sep)) { res.statusCode = 403; res.end('forbidden'); return }
        await sendFile(res, file)
        return
      }

      res.statusCode = 404
      res.end('not found')
    } catch (err) {
      res.statusCode = 500
      res.end('error')
    }
  }

  // ————————————— Electron 浮窗进程 —————————————
  function electronExe() {
    const p = path.join(dshHome, 'electron', 'electron.exe')
    return fs.existsSync(p) ? p : null
  }

  function spawnHelper() {
    if (disposed) return
    const exe = electronExe()
    if (!exe) {
      console.warn('[closure-pet-overlay] 找不到 electron.exe：' + path.join(dshHome, 'electron', 'electron.exe'))
      return
    }
    const env = { ...process.env, PET_URL: `http://127.0.0.1:${helperPort}/`, PET_OVERLAY_HOME: dshHome }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      helper = spawn(exe, [HELPER_MAIN], { env, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: false })
      console.info('[closure-pet-overlay] 浮窗进程已启动 pid=' + helper.pid)
      helper.stdout?.on('data', (d) => { try { process.stdout.write(String(d)) } catch {} })
      helper.on('exit', (code, signal) => {
        console.info(`[closure-pet-overlay] 浮窗进程退出 code=${code} signal=${signal}`)
        helper = null
        if (!disposed) { const t = setTimeout(spawnHelper, 5000); timers.push(t) }
      })
      helper.on('error', (err) => {
        console.warn('[closure-pet-overlay] 浮窗进程启动失败：' + String((err && err.message) || err))
      })
    } catch (err) {
      console.warn('[closure-pet-overlay] spawn 失败：' + String((err && err.message) || err))
    }
  }

  // ————————————— 启动 —————————————
  server = http.createServer(handler)
  // 固定端口优先：前端把桌宠位置存在 localStorage（按 origin 分区），端口固定才能跨重启记住位置。
  const PREFERRED_PORT = Number(process.env.DSH_PET_OVERLAY_PORT) || 39143
  let portRetried = false
  server.on('error', (err) => {
    const code = err && err.code
    if (!portRetried && (code === 'EADDRINUSE' || code === 'EACCES')) {
      portRetried = true
      console.warn('[closure-pet-overlay] 端口 ' + PREFERRED_PORT + ' 不可用，改用随机端口')
      server.listen(0, '127.0.0.1', onListening)
      return
    }
    console.warn('[closure-pet-overlay] 本地服务错误：' + String((err && err.message) || err))
  })
  function onListening() {
    if (disposed) return
    helperPort = server.address().port
    console.info('[closure-pet-overlay] 本地服务 http://127.0.0.1:' + helperPort)
    spawnHelper()
  }
  server.listen(PREFERRED_PORT, '127.0.0.1', onListening)

  const periodTimer = setInterval(() => {
    try {
      const next = computePeriod()
      if (next === runtime.period) return
      runtime.period = next
      runtime.periodChangedAt = Date.now()
      runtime.periodSeq++
      store.bump()
    } catch {}
  }, 15000)
  timers.push(periodTimer)

  function pollBalanceTick() {
    let account = null
    try { account = typeof root.get === 'function' ? root.get('deepseekAccount') : null } catch { account = null }
    return store.pollBalance(account).catch(() => {})
  }
  const firstBalanceTimer = setTimeout(pollBalanceTick, 2500)
  const balanceTimer = setInterval(pollBalanceTick, 60000)
  timers.push(firstBalanceTimer, balanceTimer)

  root.effect(() => () => {
    disposed = true
    for (const t of timers) { try { clearTimeout(t); clearInterval(t) } catch {} }
    try { server?.close() } catch {}
    if (helper) {
      try { helper.stdin?.end() } catch {}
      try { helper.kill() } catch {}
      helper = null
    }
    console.info('[closure-pet-overlay] 已停止')
  })

  console.info('[closure-pet-overlay] 已加载（桌面浮窗模式）')
}


