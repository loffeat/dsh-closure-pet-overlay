// dsh-closure-pet — 宿主状态轮询与事件分发
//
// 每秒拉 /dsh-closure/state；用计数器（而非布尔）识别事件，轮询丢帧也不会漏。
// applyState 负责把状态映射成：动画层、气泡反馈、音效、开屏时序。
// 依赖注入：layers / playOverlay / syncAnimation / showBubble / refreshBubble / playSound /
// scheduleStartup / settings / saveSettings / layout / repositionForAnchor / resolveFlip /
// applyOpacity / isBubbleShown。

import { PREFIX, SIZE_MIN, SIZE_MAX, BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX, SNAP_STRENGTH_MIN, SNAP_STRENGTH_MAX } from '../core/env.js'
import { HAPPY_CHANCE } from '../anim/library.js'

export function createState(deps) {
  var layers = deps.layers
  var playOverlay = deps.playOverlay
  var playSad = deps.playSad
  var syncAnimation = deps.syncAnimation
  var showBubble = deps.showBubble
  var refreshBubble = deps.refreshBubble
  var playSound = deps.playSound
  var scheduleStartup = deps.scheduleStartup
  var settings = deps.settings
  var saveSettings = deps.saveSettings
  var layout = deps.layout
  var repositionForAnchor = deps.repositionForAnchor
  var resolveFlip = deps.resolveFlip
  var applyOpacity = deps.applyOpacity
  var isBubbleShown = deps.isBubbleShown

  // ————————————————————— P4：宿主状态轮询 —————————————————————
  // 每秒拉 /dsh-closure/state；用计数器增量识别事件（轮询丢帧也不会漏）。
  var pollTimer = 0
  var pollTimerMs = 0
  var lastState = null
  var toolPlayTimes = []
  var TOOL_MIN_GAP = 1200      // 同类事件最小间隔
  var TOOL_WINDOW = 10000      // 限流窗口
  var TOOL_WINDOW_MAX = 3      // 窗口内最多播几次
  var lowBalance = false

  /** token 数量缩写：1.2M / 856K / 123 */
  function fmtTokens(n) {
    var v = Number(n) || 0
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K'
    return String(Math.round(v))
  }

  // kind='happy' 是概率性庆祝；kind='sad' 必播，且统一走 playSad()。
  function toolOverlay(kind) {
    if (layers.overlay === 'Interact') return false // 用户点击优先
    if (kind === 'happy' && Math.random() > HAPPY_CHANCE) return false
    var now = Date.now()
    toolPlayTimes = toolPlayTimes.filter(function (t) { return now - t < TOOL_WINDOW })
    var last = toolPlayTimes.length ? toolPlayTimes[toolPlayTimes.length - 1] : 0
    if (now - last < TOOL_MIN_GAP) return false
    if (toolPlayTimes.length >= TOOL_WINDOW_MAX) return false
    toolPlayTimes.push(now)
    if (kind === 'happy') playOverlay('Happy')
    else playSad()
    return true
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return
    var prev = lastState
    lastState = s
    var first = !prev

    var mode = s.work && s.work.mode
    layers.work = mode === 'outputting' ? 'Talk' : (mode === 'thinking' ? 'Special_B' : null)

    // 运行中助手：AI 一开工就弹一句状态（思考/输出 + 时长 + 今日 token）
    var prevMode = prev && prev.work && prev.work.mode
    if (mode && mode !== 'idle' && mode !== prevMode) {
      var sp = s.spend || {}
      var label = mode === 'thinking' ? '可露希尔正在思考…' : '可露希尔正在输出…'
      var el = ''
      if (s.work && s.work.since) {
        var mins = Math.round((Date.now() - s.work.since) / 60000)
        if (mins >= 1) el = ' · 已 ' + mins + ' 分钟'
      }
      var lines = [label + el]
      if (Number(sp.tokensToday) > 0) lines.push('今日 ' + fmtTokens(sp.tokensToday) + ' tokens')
      showBubble(lines.join('\n'), 5000)
    }

    // 余额状态只在**读到真实数据**时切换；读取失败/未登录时保持原状态，
    // 否则一次失败读数会被误判成"余额恢复"。
    var balanceOk = !!(s.balance && s.balance.ok)
    var low = !!(s.balance && s.balance.low)
    if (first) {
      lowBalance = low
      layers.base = low ? 'Sad_Idle' : 'Idle'
      // 启动时序延迟播放：等客户端首屏稳定后再演（默认 10s，
      // localStorage 的 dshcl-startup-delay 可覆盖，方便调试）
      scheduleStartup(s.period === 'peak', low)
    } else if (balanceOk && low !== lowBalance) {
      lowBalance = low
      layers.base = low ? 'Sad_Idle' : 'Idle'
      // 变低 → 由导演在进入 Sad_Idle 前统一补 Sad_Begin；恢复 → 充值成功式（Special_A）
      if (!low) playOverlay('Special_A')
      // 若同一轮还带 topUpSeq，交给下面的"充值到账"分支报，避免两句话打架
      var sameTickTopUp = s.topUpSeq > ((prev && prev.topUpSeq) || 0)
      if (low || !sameTickTopUp) showBubble(low ? '博士！预算快见底了\n该批经费啦！' : '经费到账\n可露希尔继续为你效力~')
      playSound(low ? 'fail' : 'coin')
    }

    if (prev) {
      if (s.tools && prev.tools) {
        // 工具成功：只保留概率性的 Happy 动画，不出气泡、不播音效
        if (s.tools.ok > prev.tools.ok) toolOverlay('happy')
        if (s.tools.fail > prev.tools.fail && toolOverlay('sad')) {
          showBubble('工具调用失败' + (s.tools.lastFailName ? '：' + s.tools.lastFailName : ''))
          playSound('fail')
        }
      }
      // 模型/轮次级错误：只报反馈内容（气泡此时不显示余额/花费）
      var prevErrCount = (prev.errors && prev.errors.count) || 0
      var curErrCount = (s.errors && s.errors.count) || 0
      if (curErrCount > prevErrCount) {
        var errMsg = String((s.errors && s.errors.message) || '').slice(0, 40)
        playSad()
        showBubble('出错了' + (errMsg ? '：' + errMsg : ''), 4600)
        playSound('fail')
      }
      if (s.topUpSeq > prev.topUpSeq) {
        playOverlay('Special_A')
        showBubble('感谢惠顾~\n采购部随时欢迎下次光临！')
        playSound('coin')
      }
      // 本轮结束（turn/end）：完成 / 中断 / 出错各给一句反馈
      var prevTurnEnd = (prev.turnEnd && prev.turnEnd.seq) || 0
      var curTurnEnd = (s.turnEnd && s.turnEnd.seq) || 0
      if (curTurnEnd > prevTurnEnd) {
        var kind = (s.turnEnd && s.turnEnd.kind) || 'completed'
        if (kind === 'completed') {
          // 完成不播动画、不播音效，只把信息对话框叫出来（余额/今日/本轮/峰谷）
          showBubble()
        } else if (kind === 'error') {
          playSad()
          showBubble('啧，这次出错了博士……')
          playSound('turnfail')
        } else {
          playSad()
          showBubble('欸？怎么突然掐断了？')
          playSound('turnfail')
        }
      }
      if (s.periodSeq > prev.periodSeq) {
        if (s.period === 'peak') playSad()
        else playOverlay('Special_A') // 谷时用充值式，不用 Happy
        showBubble(s.period === 'peak' ? '开始按原价收费了哦博士~' : '可露希尔大减价时间到~\n冲啊博士！')
      }
    }
    // 气泡开着的时候顺带刷新数字（余额 / 倒计时）
    if (isBubbleShown()) refreshBubble()
    syncAnimation(false)
  }

  function pollState() {
    fetch(PREFIX + '/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (s) { try { applyState(s) } catch (err) {} })
      .catch(function () { /* 路由不可用就纯待机，不报错 */ })
  }

  function startPolling() {
    pollState()
    setPollInterval(1000)
  }

  // 前台 1s 轮询；后台降到 5s（省电，且后台本来就看不到）
  function setPollInterval(ms) {
    if (pollTimer && pollTimerMs === ms) return
    if (pollTimer) clearInterval(pollTimer)
    pollTimerMs = ms
    pollTimer = setInterval(pollState, ms)
  }

  // 宿主侧持久化设置（$DSH_HOME/.dshcl.json）优先于 localStorage
  function loadHostConfig() {
    fetch(PREFIX + '/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (cfg) {
        var s = cfg && cfg.settings
        if (!s) return
        if (s.mirror === 'auto' || s.mirror === 'always' || s.mirror === 'never') settings.mirror = s.mirror
        if (isFinite(Number(s.size))) settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(s.size)))
        if (typeof s.bubble === 'boolean') settings.bubble = s.bubble
        if (isFinite(Number(s.bubbleScale))) settings.bubbleScale = Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, Number(s.bubbleScale)))
        if (typeof s.bubbleTiers === 'boolean') settings.bubbleTiers = s.bubbleTiers
        if (isFinite(Number(s.snapStrength))) settings.snapStrength = Math.min(SNAP_STRENGTH_MAX, Math.max(SNAP_STRENGTH_MIN, Number(s.snapStrength)))
        if (isFinite(Number(s.opacity))) settings.opacity = Math.min(1, Math.max(0.3, Number(s.opacity)))
        if (typeof s.sound === 'boolean') settings.sound = s.sound
        if (isFinite(Number(s.volume))) settings.volume = Math.min(1, Math.max(0, Number(s.volume)))
        layout()
        repositionForAnchor()
        resolveFlip()
        applyOpacity()
        if (isBubbleShown()) refreshBubble()
        saveSettings(true)
      })
      .catch(function () { /* 宿主不可用就沿用 localStorage */ })
  }

  function dispose() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
    pollTimerMs = 0
  }

  return {
    applyState: applyState,
    pollState: pollState,
    startPolling: startPolling,
    setPollInterval: setPollInterval,
    loadHostConfig: loadHostConfig,
    getState: function () { return lastState },
    dispose: dispose,
  }
}
