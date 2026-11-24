// dsh-closure-pet — 动画导演（分层状态机）
//
// overlay（一次性覆盖） > work（思考/输出） > base（Idle / Sad_Idle）。
// 负责：循环切换、Interact 分段、Talk 锁、一次性覆盖、思考循环的节奏。
// 播放细节（双缓冲、交叉淡化）在 render/video-player.js；本模块只决定播哪一段、播完接什么。
// 依赖注入：pet、player、log、audioEnsure、playSound、getStartupHold/setStartupHold。

import { INTERACT_SPLIT } from '../core/env.js'
import { CLIP_FADE_MS, INTERACT_ACTIONS, SAD_ENTRY, THINK_CHANCE, THINK_ROLL_MS } from './library.js'

export function createDirector(deps) {
  var pet = deps.pet
  var player = deps.player
  var log = deps.log
  // audio 别名在 main 的组合阶段才赋值（比导演创建晚），所以必须惰性取，不能在这里捕获
  var getAudioEnsure = deps.getAudioEnsure || function () { return deps.audioEnsure }
  var getPlaySound = deps.getPlaySound || function () { return deps.playSound }

  // ————————————————————— 播放（分层）—————————————————————
  var layers = { base: 'Idle', work: null, overlay: null }
  var talkLock = false      // Talk 播放中：状态切换被挂起，强制播完
  var pendingOverlay = null // Talk 期间被挂起的覆盖动画（只留最新一个）

  // 思考：按 THINK_ROLL_MS 间隔掷骰；mode='full' 表示完整思考动画正在播。
  var thinkToken = 0
  var thinkTimer = 0
  // 下一次换源要用的淡化时长；只有「交互动画结束」会写它，其余路径一律硬切。
  var pendingFade = null
  // 用户在说话中点了交互：这一轮 Talk 已被显式打断，交互结束后回基态，
  // 不再把同一轮 Talk 从头重播；等 work 变成别的状态/空闲后才解除。
  var suppressedTalk = false

  function desiredName() {
    // 被交互打断的那一轮输出不再恢复；基态优先，等 work 真正变化后再重新取 work。
    if (suppressedTalk && layers.work === 'Talk') return layers.overlay || layers.base
    return layers.overlay || layers.work || layers.base
  }

  function stopThinking() {
    thinkToken++
    if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = 0 }
    pet.think = null
  }

  function playLoop(name, force) {
    if (!player) return
    if (pet.current === name && !force) return
    if (name !== 'Talk') { talkLock = false; pendingOverlay = null }
    stopThinking()
    pet.enteringSad = false
    pet.afterOverlay = null
    pet.current = name
    pet.segment = null
    var fade = pendingFade === null ? 0 : pendingFade
    pendingFade = null
    player.play(name, { fade: fade })
  }

  function startAnimation(name) {
    if (name !== 'Special_B') stopThinking()
    if (name === 'Talk') return playTalkOnce()
    if (name === 'Special_B') return startThinking()
    return playLoop(name, true)
  }

  // 思考：每隔 THINK_ROLL_MS 掷一次骰（THINK_CHANCE）。
  // 抽中 → 播一遍完整思考动画，播完回待机，再等下一个间隔；
  // 没抽中 → 继续待机，等下一个间隔。播放期间不掷骰、不重触发。
  function startThinking() {
    if (!player) return
    stopThinking()
    pet.enteringSad = false
    var token = thinkToken
    layers.overlay = null
    pet.segment = null
    pet.interactDuration = pet.interactDuration || 5.933
    pet.think = { mode: 'idle' }
    var firstRoll = true // 进入思考后的第一次必定触发，之后按 THINK_CHANCE 掷骰

    function alive() {
      return token === thinkToken && layers.work === 'Special_B'
    }

    function backToBase() {
      pet.think.mode = 'idle'
      if (layers.base === 'Sad_Idle' && pet.current !== 'Sad_Idle' && pet.current !== SAD_ENTRY) {
        // 思考结束后落的仍是难过基态：必须经统一的 Sad_Begin 入场，且保留思考会话的定时器。
        playSadEntry(0, true)
        return
      }
      pet.current = layers.base
      player.play(layers.base, { fade: 0 })
    }

    function schedule() {
      if (thinkTimer) clearTimeout(thinkTimer)
      thinkTimer = setTimeout(function () {
        thinkTimer = 0
        if (!alive()) return
        roll()
      }, THINK_ROLL_MS)
    }

    function roll() {
      if (!alive() || pet.think.mode !== 'idle') return
      if (pet.enteringSad) { schedule(); return } // 正在补 Sad_Begin，等它播完再掷
      var hit = firstRoll || Math.random() < THINK_CHANCE
      firstRoll = false
      if (!hit) {
        log('think skip')
        backToBase()
        schedule()
        return
      }
      pet.think.mode = 'full'
      pet.current = 'Special_B'
      player.play('Special_B', {
        fade: 0,
        onEnded: function () {
          if (!alive()) return
          backToBase()
          schedule()
        },
        onError: function () {
          if (!alive()) return
          backToBase()
          schedule()
        },
      })
      log('think play', 'Special_B')
    }

    roll()
  }

  function syncAnimation(force) {
    if (!player) return
    if (deps.getStartupHold()) return // 开屏空档期：保持当前姿势
    if (suppressedTalk && layers.work !== 'Talk') suppressedTalk = false
    var want = desiredName()
    // 难过入场播到一半：等它播完；若期间来了更高优先级的层，直接作废本次入场。
    if (pet.enteringSad) {
      var thinkingIdle = layers.work === 'Special_B' && pet.think && pet.think.mode === 'idle'
      if (want === 'Sad_Idle' || (thinkingIdle && want === 'Special_B')) return
      pet.enteringSad = false
    }
    // Talk 期间**强制播完**：必须先挡住所有非 Talk 切换，连 Sad_Idle 入场也不能插队。
    if (talkLock && want !== 'Talk') return
    // 任何状态回到 Sad_Idle 之前，都先补一遍 Sad_Begin；已经在播或已经播过则不重复。
    if (want === 'Sad_Idle' && pet.current !== 'Sad_Idle' && pet.current !== SAD_ENTRY) {
      var fade = pendingFade === null ? 0 : pendingFade
      pendingFade = null
      playSadEntry(fade)
      return
    }
    // 思考这一轮已由间隔掷骰接管：任何状态刷新都不重触发。
    if (want === 'Special_B' && pet.think) return
    if (want !== 'Special_B') stopThinking()
    if (!force && pet.current === want) return
    startAnimation(want)
  }

  // 难过基态入场：先完整播 Sad_Begin，再按当前层级决定回 Sad_Idle 还是被更高层打断。
  // keepThinking=true 时保留思考会话（不递增 token、不清定时器），只换显示。
  function playSadEntry(fade, keepThinking) {
    if (!player) return
    if (!keepThinking) stopThinking()
    pet.enteringSad = true
    pet.afterOverlay = null
    pet.current = SAD_ENTRY
    pet.segment = null

    function finish() {
      if (!pet.enteringSad) return
      pet.enteringSad = false
      var thinkingIdle = layers.work === 'Special_B' && pet.think && pet.think.mode === 'idle'
      if (keepThinking && thinkingIdle) {
        // 思考会话还在：只把显示落到当前基态，不触发 syncAnimation（会被思考守卫拦住）。
        pet.current = layers.base
        player.play(layers.base, { fade: 0 })
        return
      }
      syncAnimation(true)
    }

    player.play(SAD_ENTRY, {
      fade: fade,
      onEnded: finish,
      onError: finish,
    })
  }

  // Talk 是"表演型"动画：播完一遍再从头播，不在最后一帧硬接第一帧。
  // 并且在播放期间锁住状态切换（talkLock），避免输出中断/工具事件把它掐断。
  function playTalkOnce() {
    if (!player) return null
    stopThinking()
    pet.enteringSad = false
    pet.current = 'Talk'
    pet.segment = null
    pet.afterOverlay = null
    talkLock = true
    player.play('Talk', {
      fade: 0,
      onEnded: function () {
        // 输出还在继续 → 完整再播一遍；否则兑现挂起的覆盖或回状态层。
        if (layers.work === 'Talk') { player.replay(); return }
        talkLock = false
        if (pendingOverlay) {
          var next = pendingOverlay
          pendingOverlay = null
          playOverlay(next)
          return
        }
        syncAnimation(true)
      },
    })
    return true
  }

  // Interact 前后两段：切点由常量 INTERACT_SPLIT 决定（2.10s = 第 63 帧，动作回正处）
  function segmentRange(index) {
    var d = pet.interactDuration || 5.933
    var cut = Math.min(Math.max(0.4, INTERACT_SPLIT), d - 0.4)
    if (index === 0) return { from: 0, to: cut }
    return { from: cut, to: d }
  }

  function playSegment() {
    if (!player) return null
    var ensureAudio = getAudioEnsure()
    if (ensureAudio) ensureAudio() // 用户手势里顺手解锁音频
    deps.setStartupHold(false) // 用户点击优先，解除开屏空档保持
    // 用户点击是显式意图：允许打断 Talk
    talkLock = false
    pendingOverlay = null
    // 说话期间被点击：这一轮 Talk 视为已被打断，交互结束回基态而不是从头重播。
    if (layers.work === 'Talk') suppressedTalk = true
    stopThinking()
    pet.enteringSad = false
    var play = getPlaySound()
    if (play) play('click')
    var name = INTERACT_ACTIONS[Math.floor(Math.random() * INTERACT_ACTIONS.length)]
    var index = name === 'Interact_A' ? 0 : 1
    var range = segmentRange(index)
    pet.current = 'Interact'
    pet.afterOverlay = null
    pet.segment = { index: index, to: range.to }
    layers.overlay = 'Interact'
    player.play(name, {
      fade: 0,
      onEnded: function () { endSegment() },
    })
    log('segment', index === 0 ? 'A' : 'B', range.from.toFixed(2) + '-' + range.to.toFixed(2) + 's')
    return true
  }

  // 一次性覆盖动画（Happy / Sad_Begin / Special_A …）
  var overlayTimer = 0
  var overlaySeq = 0
  // 覆盖动画的硬件/解码器偶发不派发 ended：用时长兜底，保证状态机一定继续。
  var OVERLAY_WATCHDOG_MS = 8000

  function playOverlay(name, after) {
    if (!player) return null
    deps.setStartupHold(false)
    pet.enteringSad = false
    // Talk 播放中：不打断，先把覆盖动画挂起（只留最新）
    if (talkLock) { pendingOverlay = name; log('overlay queued ->', name); return null }
    stopThinking()
    layers.overlay = name
    pet.current = name
    pet.afterOverlay = typeof after === 'function' ? after : null
    var fade = pendingFade === null ? 0 : pendingFade
    pendingFade = null
    var seq = ++overlaySeq
    function finish() {
      if (seq !== overlaySeq || layers.overlay !== name) return
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = 0 }
      layers.overlay = null
      var next = pet.afterOverlay
      pet.afterOverlay = null
      if (next) { next(); return }
      syncAnimation(true)
    }
    player.play(name, {
      fade: fade,
      onEnded: finish,
    })
    if (overlayTimer) clearTimeout(overlayTimer)
    overlayTimer = setTimeout(function () {
      overlayTimer = 0
      log('overlay watchdog ->', name)
      finish()
    }, OVERLAY_WATCHDOG_MS)
    log('overlay ->', name)
    return true
  }

  // 所有「难过」表演统一从这里走：只改 library 的 SAD_ENTRY，不散落在各个事件分支。
  function playSad(after) {
    return playOverlay(SAD_ENTRY, after)
  }

  function endSegment() {
    pet.segment = null
    if (layers.overlay === 'Interact') layers.overlay = null
    // 交互动画结束回状态层做一次淡化；低余额的 Sad_Begin 由 syncAnimation 的统一入口补。
    if (!layers.work) pendingFade = CLIP_FADE_MS
    syncAnimation(true)
    pendingFade = null
  }

  function isIdle() {
    return !layers.overlay && !layers.work && !talkLock && !pet.segment && !pet.think
  }

  // 开屏演出要强制插播：清掉 Talk 锁与挂起的覆盖动画
  function resetLocks() {
    talkLock = false
    pendingOverlay = null
    stopThinking()
  }

  return {
    layers: layers,
    desiredName: desiredName,
    playLoop: playLoop,
    startAnimation: startAnimation,
    startThinking: startThinking,
    syncAnimation: syncAnimation,
    playTalkOnce: playTalkOnce,
    segmentRange: segmentRange,
    playSegment: playSegment,
    playOverlay: playOverlay,
    playSad: playSad,
    endSegment: endSegment,
    isIdle: isIdle,
    resetLocks: resetLocks,
    dispose: function () {
      stopThinking()
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = 0 }
    },
  }
}
