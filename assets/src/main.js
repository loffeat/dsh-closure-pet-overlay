// dsh-closure-pet — 前端组合根
//
// 行为约定（沿用鲸鱼挂件）：
//   · 位移² < 9（<3px）= 点击，否则 = 拖拽
//   · 拖拽 1:1 跟手，松手 settle() 滑向吸附位（横/纵轴各按 1/4 区独立判定）
//   · 按下桌宠到松手之间「冻结」页面交互：不选区、不拖图、不悬停高亮、不点穿
//   · 一律 left/top 像素定位；位置存 localStorage['dshcl-pos']
//
// 设置项：见 core/settings.js（右键桌宠打开面板）
//
// 动画：透明视频片段 + A/B 双缓冲交叉淡化（render/video-player.js），
//   分层与播完接续在 anim/director.js；本文件只做 DOM、位置、交互与装配。
//
// 模块划分：
//   core/env.js          常量 / 日志
//   core/settings.js     设置读写与持久化
//   render/hit-test.js   静态命中区（图元 → 128×108 掩码）
//   render/video-player.js 双缓冲视频播放（交叉淡化）
//   anim/library.js      片段表（路径 / 时长 / 循环 / 节奏参数）
//   anim/director.js     动画导演（分层状态机）
//   audio.js             音效（工厂）
//   ui/layout.js         位置 / 吸附 / 翻转（工厂）
//   main.js              组合根：DOM、状态机、交互、面板、轮询、开屏

import {
  PREFIX, CANVAS_W, FRAME, DRAG_THRESHOLD_SQ, SIZE_MIN, SIZE_MAX, BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX, SNAP_STRENGTH_MIN, SNAP_STRENGTH_MAX,
  INTERACT_SPLIT, STARTUP_DELAY, log, warn,
} from './core/env.js'
import { settings, saveSettings } from './core/settings.js'
import { HIT_MASK_W, HIT_MASK_H, HIT_GROW, HIT_FORMS, buildHitMask, maskHit } from './render/hit-test.js'
import { ANIMATION_NAMES, CLIPS } from './anim/library.js'
import { createAudio } from './audio.js'
import { createLayout } from './ui/layout.js'
import { createPanel } from './ui/panel.js'
import { createBubble } from './ui/bubble.js'
import { createSticker } from './ui/sticker.js'
import { createDrag } from './input/drag.js'
import { createDirector } from './anim/director.js'
import { createVideoPlayer } from './render/video-player.js'
import { createState } from './io/state.js'

export function startPet(mountContainer) {
  if (window.__dshClosurePet) {
    // 热启用/重复挂载：先把上一实例收干净，避免旧实例挡住新实例。
    try { if (typeof window.__dshClosurePet.dispose === 'function') window.__dshClosurePet.dispose() } catch (err) {}
    try { delete window.__dshClosurePet } catch (err) { window.__dshClosurePet = undefined }
  }
  window.__dshClosurePet = { phase: 'boot' }

  // ————————————————————— 设置 —————————————————————
  // settings / loadSettings / saveSettings 见 core/settings.js（加载时已合并 localStorage）

  // ————————————————————— DOM —————————————————————
  var host = document.createElement('div')
  host.id = 'dsh-closure-pet'
  host.style.cssText = [
    'position:fixed', 'left:0', 'top:0',
    'z-index:2147482000', 'pointer-events:none',
    'user-select:none', 'opacity:0', 'will-change:transform',
    'transition:opacity .35s ease',
  ].join(';')

  // 舞台：固定尺寸由 layout() 写到 host 上；两路视频由播放器塞进来。
  var stage = document.createElement('div')
  stage.id = 'dsh-closure-pet-stage'
  host.appendChild(stage)

  var note = document.createElement('div')
  note.style.cssText = 'display:none;font:11px/1.4 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;color:#ff8f8f;text-align:center;max-width:280px'
  host.appendChild(note)

  function mount() {
    if (!document.body || document.getElementById('dsh-closure-pet')) return
    var mountPoint = window.__dshClosurePetMount
    var parent = mountContainer || (mountPoint && mountPoint.container) || document.body
    parent.appendChild(host)
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })

  function fail(text) {
    window.__dshClosurePet.phase = 'failed'
    window.__dshClosurePet.error = text
    note.textContent = text
    note.style.display = 'block'
    host.style.opacity = '1'
    warn(text)
  }

  var pet = {
    current: null, segment: null, afterOverlay: null, think: null,
    interactDuration: 5.933,
    flipped: false,
    pos: null, anchor: null,
  }

  // ————————————————————— 视频播放器 —————————————————————
  var player = createVideoPlayer({
    stage: stage,
    baseUrl: PREFIX + '/assets/video/',
    log: log,
  })

  // ————————————————————— 尺寸 —————————————————————
  function layout() {
    var cssW = Math.round(CANVAS_W * settings.size)
    var cssH = Math.round(cssW * (FRAME.h / FRAME.w))
    host.style.width = cssW + 'px'
    host.style.height = cssH + 'px'
    applyPosition()
  }

  // ————————————————————— 位置 / 吸附 / 翻转 —————————————————————
  // 实现在 ui/layout.js（工厂）；这里解构出来，保持调用点不变。
  // 翻转与透明度作用在 stage 上：视频节点在 stage 内，一并镜像。
  var layoutUi = createLayout({ host: host, canvas: stage, settings: settings, pet: pet })
  var size = layoutUi.size
  var clampPos = layoutUi.clampPos
  var applyPosition = layoutUi.applyPosition
  var setFlipped = layoutUi.setFlipped
  var applyOpacity = layoutUi.applyOpacity
  var resolveFlip = layoutUi.resolveFlip
  var defaultPos = layoutUi.defaultPos
  var loadPos = layoutUi.loadPos
  var savePos = layoutUi.savePos
  var placeFromStorage = layoutUi.placeFromStorage
  var repositionForAnchor = layoutUi.repositionForAnchor
  var settle = layoutUi.settle

  // ————————————————————— 命中测试（静态命中区）—————————————————————
  // 图元定义与栅格化在 render/hit-test.js；这里只做屏幕坐标 → 归一化 → 镜像 → 查表。
  var hitMask = null

  function hitTest(clientX, clientY) {
    if (!hitMask) hitMask = buildHitMask()
    var rect = stage.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    var nx = (clientX - rect.left) / rect.width
    var ny = (clientY - rect.top) / rect.height
    if (pet.flipped) nx = 1 - nx
    return maskHit(hitMask, nx, ny)
  }

  // ————————————————————— 播放（分层）—————————————————————
  // 状态机在 anim/director.js；这里创建实例并保持调用点不变。
  var director = createDirector({
    pet: pet, player: player, log: log,
    // audio 别名在下面音效分节才赋值，用 getter 惰性取（否则 playSegment 会拿到 undefined）
    getAudioEnsure: function () { return audioEnsure },
    getPlaySound: function () { return playSound },
    getStartupHold: function () { return startupHold },
    setStartupHold: function (v) { startupHold = v },
  })
  var layers = director.layers
  var desiredName = director.desiredName
  var playLoop = director.playLoop
  var startAnimation = director.startAnimation
  var syncAnimation = director.syncAnimation
  var segmentRange = director.segmentRange
  var playSegment = director.playSegment
  var playOverlay = director.playOverlay
  var playSad = director.playSad
  var endSegment = director.endSegment

  function start() {
    host.style.opacity = '1'
    window.__dshClosurePet.phase = 'running'
  }

  function stop() {
    player.pause()
  }

  function resumeAnimation() {
    player.resume()
  }

  // 页面卸载 / 客户端插件销毁时调用：撤掉监听、定时器与 DOM，可重复调用。
  function dispose() {
    try { stop() } catch (err) {}
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = 0 }
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0 }
    try { if (stateApi) stateApi.dispose() } catch (err) {}
    try { if (dragApi) dragApi.dispose() } catch (err) {}
    try { if (bubbleApi) bubbleApi.dispose() } catch (err) {}
    try { if (stickerApi) stickerApi.dispose() } catch (err) {}
    try { if (panelUi) panelUi.dispose() } catch (err) {}
    try { director.dispose() } catch (err) {}
    try { player.dispose() } catch (err) {}
    try { window.removeEventListener('resize', onResize) } catch (err) {}
    try { document.removeEventListener('visibilitychange', onVisibility) } catch (err) {}
    if (host && host.parentNode) host.parentNode.removeChild(host)
    hitMask = null
    window.__dshClosurePet.phase = 'disposed'
  }

  // ————————————————————— 设置面板 —————————————————————
  // 实现在 ui/panel.js；实例在模块末尾（组合阶段）创建，这里先放薄委托。
  var panelUi = null
  function openPanel() { if (panelUi) panelUi.open() }
  function closePanel() { if (panelUi) panelUi.close() }
  function panelIsOpen() { return panelUi ? panelUi.isOpen() : false }
  function insidePanel(target) { return panelUi ? panelUi.contains(target) : false }

  // ————————————————————— 交互：点击 / 拖拽 / 右键 —————————————————————
  // 实现在 input/drag.js；监听在组合阶段注册。
  var dragApi = null

  // ————————————————————— 视口变化 —————————————————————
  var resizeTimer = 0
  function onResize() {
    if (window.__dshClosurePet.phase !== 'running') return
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(function () { layout(); repositionForAnchor() }, 200)
  }
  window.addEventListener('resize', onResize)

  function onVisibility() {
    if (window.__dshClosurePet.phase !== 'running') return
    if (document.hidden) {
      if (dragApi) dragApi.cancelDrag() // 切后台时可能收不到 pointerup，先把挡板和拦截器撤掉
      stop()
      setPollInterval(5000) // 后台没必要 1s 拉一次状态
    } else {
      resumeAnimation()
      setPollInterval(1000)
      pollState()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  function resetPosition() {
    pet.pos = defaultPos()
    pet.anchor = { h: 'right', v: 'bottom' }
    host.style.transition = 'left .22s ease, top .22s ease, opacity .35s ease'
    resolveFlip()
    applyPosition()
    savePos()
  }

  // ————————————————————— 音效 —————————————————————
  // 实现在 audio.js（工厂）；解构方法，保持调用点不变。
  var audio = createAudio(function () { return settings })
  var audioEnsure = audio.ensure
  var loadSounds = audio.loadSounds
  var playSound = audio.playSound

  // ————————————————————— 气泡（像素风）—————————————————————
  // 实现在 ui/bubble.js；实例在组合阶段创建。
  var bubbleApi = null
  function showBubble(eventText, eventMs) { if (bubbleApi) bubbleApi.show(eventText, eventMs) }
  function refreshBubble() { if (bubbleApi) bubbleApi.refresh() }
  function followBubble() { if (bubbleApi) bubbleApi.follow() }
  function hideBubble() { if (bubbleApi) bubbleApi.hide() }

  // ————————————————————— 谷价贴画（−50% 扫描线）—————————————————————
  // 实现在 ui/sticker.js；实例在组合阶段创建。
  var stickerApi = null
  function showValleySticker() { if (stickerApi) stickerApi.show() }

  // ————————————————————— P4：宿主状态轮询 —————————————————————
  // 实现在 io/state.js；实例在组合阶段创建。
  var stateApi = null
  function applyState(s) { if (stateApi) stateApi.applyState(s) }
  function pollState() { if (stateApi) stateApi.pollState() }
  function startPolling() { if (stateApi) stateApi.startPolling() }
  function setPollInterval(ms) { if (stateApi) stateApi.setPollInterval(ms) }
  function loadHostConfig() { if (stateApi) stateApi.loadHostConfig() }

  // ————————————————————— 开屏时序 —————————————————————
  // 常量（STARTUP_DELAY / STARTUP_GAP）定义在文件顶部的可调参数区。
  //
  // 语义：延迟到点后**强制插播**——不管当下是否在思考/输出、是否有覆盖动画，
  // 都先演一遍开屏（峰谷 → 可选余额），演完再回到原本的工作层/基础层。
  var startupTimer = 0
  var startupPending = null
  var startupHold = false // 开屏两段之间的空档：暂停状态驱动的动画切换

  function scheduleStartup(peak, low) {
    startupPending = { peak: !!peak, low: !!low }
    clearTimeout(startupTimer)
    startupTimer = setTimeout(runStartup, STARTUP_DELAY)
  }

  function cancelStartup() {
    if (startupTimer) clearTimeout(startupTimer)
    startupTimer = 0
    startupPending = null
  }

  function runStartup() {
    startupTimer = 0
    var p = startupPending
    startupPending = null
    if (!p || !player) return
    // 强制插播：清掉 Talk 锁与挂起的覆盖动画，立刻把开屏演出来
    director.resetLocks()
    var opening = p.peak ? playSad : function (after) { return playOverlay('Special_A', after) }
    opening(function () {
      // 开屏第一段结束后必须明确接续，不依赖下一次轮询或下一段覆盖动画。
      startupHold = false
      if (!p.low) { syncAnimation(true); return }
      // 低余额开屏：第一段结束立即接第二段，不再停留 2 秒等定时器。
      playSad()
      showBubble('博士！预算快见底了\n该批经费啦！')
      playSound('fail')
    })
    showBubble(p.peak ? '开始按原价收费了哦博士~' : '可露希尔大减价时间到~\n冲啊博士！')
  }

  // ————————————————————— 组合：创建 UI 实例 —————————————————————
  // 此时函数声明已提升、var 别名都已赋值，依赖全部就绪。
  panelUi = createPanel({
    settings: settings, saveSettings: saveSettings, resolveFlip: resolveFlip,
    layout: layout, repositionForAnchor: repositionForAnchor, applyOpacity: applyOpacity,
    hideBubble: hideBubble, refreshBubble: refreshBubble, audioEnsure: audioEnsure, loadSounds: loadSounds, playSound: playSound,
    size: size, pet: pet, resetPosition: resetPosition,
  })
  bubbleApi = createBubble({
    getState: function () { return stateApi ? stateApi.getState() : null }, pet: pet, size: size, settings: settings,
  })
  stickerApi = createSticker({
    getState: function () { return stateApi ? stateApi.getState() : null }, pet: pet, size: size, settings: settings,
  })
  stateApi = createState({
    layers: layers, playOverlay: playOverlay, playSad: playSad, syncAnimation: syncAnimation,
    showBubble: showBubble, refreshBubble: refreshBubble, playSound: playSound,
    scheduleStartup: scheduleStartup,
    settings: settings, saveSettings: saveSettings,
    layout: layout, repositionForAnchor: repositionForAnchor,
    resolveFlip: resolveFlip, applyOpacity: applyOpacity,
    isBubbleShown: function () { return !!(bubbleApi && bubbleApi.isShown()) },
  })
  dragApi = createDrag({
    hitTest: hitTest, pet: pet, host: host, clampPos: clampPos, applyPosition: applyPosition,
    settle: settle, refreshBubble: refreshBubble, followBubble: followBubble, playSegment: playSegment,
    showBubble: showBubble, showValleySticker: showValleySticker,
    openPanel: openPanel, closePanel: closePanel, panelIsOpen: panelIsOpen, insidePanel: insidePanel,
  })

  function boot() {
    try {
      layout()
      hitMask = buildHitMask()
      placeFromStorage()
      applyOpacity()
      playLoop('Idle', true)
      start()
      startPolling()
      loadHostConfig()
      loadSounds()
      log('启动完成', ANIMATION_NAMES.length, 'animations · size', settings.size, '· mirror', settings.mirror)

      window.__dshClosurePet = {
        phase: 'running',
        animations: ANIMATION_NAMES,
        play: function (name, loop) {
          layers.overlay = null   // 手动播放视为最高优先级，先清掉覆盖层
          pet.segment = null
          loop ? playLoop(name, true) : playSegment2(name)
        },
        segments: function () { return [segmentRange(0), segmentRange(1)] },
        openPanel: openPanel,
        closePanel: closePanel,
        get settings() { return { mirror: settings.mirror, size: settings.size, bubble: settings.bubble, bubbleScale: settings.bubbleScale, bubbleTiers: settings.bubbleTiers, snapStrength: settings.snapStrength, opacity: settings.opacity, sound: settings.sound, volume: settings.volume } },
        get split() { return INTERACT_SPLIT },
        setSettings: function (patch) {
          if (patch) {
            if (patch.mirror) settings.mirror = patch.mirror
            if (patch.size) settings.size = Number(patch.size)
            if (typeof patch.bubble === 'boolean') settings.bubble = patch.bubble
            if (patch.bubbleScale !== undefined) {
              var bs = Number(patch.bubbleScale)
              settings.bubbleScale = isFinite(bs) ? Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, bs)) : 100
            }
            if (typeof patch.bubbleTiers === 'boolean') settings.bubbleTiers = patch.bubbleTiers
            if (patch.snapStrength !== undefined) {
              var ss = Number(patch.snapStrength)
              settings.snapStrength = isFinite(ss) ? Math.min(SNAP_STRENGTH_MAX, Math.max(SNAP_STRENGTH_MIN, ss)) : SNAP_STRENGTH_MAX
            }
            if (patch.opacity) settings.opacity = Number(patch.opacity)
            if (typeof patch.sound === 'boolean') settings.sound = patch.sound
            if (patch.volume !== undefined) settings.volume = Number(patch.volume)
          }
          saveSettings(true); layout(); repositionForAnchor(); resolveFlip(); applyOpacity()
          if (bubbleApi && bubbleApi.isShown()) refreshBubble()
          if (!settings.bubble) hideBubble()
        },
        resetPosition: resetPosition,
        hitTest: hitTest,
        applyState: applyState, // 调试用：手动灌一份 /state 数据
        showBubble: showBubble,
        showValleySticker: showValleySticker,
        hideBubble: hideBubble,
        get layers() { return { base: layers.base, work: layers.work, overlay: layers.overlay } },
        get sounds() { return audio.getState() },
        playSound: playSound,
        runStartup: runStartup,
        cancelStartup: cancelStartup,
        get startup() { return { pending: !!startupPending, delay: STARTUP_DELAY, gap: STARTUP_GAP } },
        get trackTime() { return player.currentTime() },
        get animation() { return player.current() },
        get segmentInfo() { return pet.segment ? { to: pet.segment.to, index: pet.segment.index } : null },
        get position() { return pet.pos && { x: pet.pos.x, y: pet.pos.y, flipped: pet.flipped } },
        get debug() {
          return {
            mode: 'video',
            dpr: Math.min(window.devicePixelRatio || 1, 2),
            cssW: host.offsetWidth, cssH: host.offsetHeight,
            current: player.current(),
            paused: player.isPaused(),
            hitMask: { w: HIT_MASK_W, h: HIT_MASK_H, ready: !!hitMask, grow: HIT_GROW, forms: HIT_FORMS.length },
            settings: { mirror: settings.mirror, size: settings.size },
            clips: Object.keys(CLIPS).length,
          }
        },
        dispose: dispose,
        resume: function () { resumeAnimation() },
        get lastState() { return stateApi ? stateApi.getState() : null },
      }
    } catch (err) {
      fail('桌宠加载失败：' + String((err && err.message) || err))
    }
  }
  boot()
  return dispose

  // 调试用：按名字播一段单次动画（Interact 走分段逻辑）
  function playSegment2(name) {
    if (name === 'Interact') return playSegment()
    return playOverlay(name)
  }
}
