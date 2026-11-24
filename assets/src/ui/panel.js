// dsh-closure-pet — 设置面板（工厂）
//
// 依赖注入：settings / saveSettings / resolveFlip / layout / repositionForAnchor /
// applyOpacity / hideBubble / audioEnsure / loadSounds / playSound / size / pet / resetPosition。
// 面板 DOM 懒创建（第一次 open 时），关闭只是 display:none。

import { SIZE_MIN, SIZE_MAX, BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX, SNAP_STRENGTH_MIN, SNAP_STRENGTH_MAX } from '../core/env.js'

export function createPanel(deps) {
  var settings = deps.settings
  var saveSettings = deps.saveSettings
  var resolveFlip = deps.resolveFlip
  var layout = deps.layout
  var repositionForAnchor = deps.repositionForAnchor
  var applyOpacity = deps.applyOpacity
  var hideBubble = deps.hideBubble
  var refreshBubble = deps.refreshBubble
  var audioEnsure = deps.audioEnsure
  var loadSounds = deps.loadSounds
  var playSound = deps.playSound
  var size = deps.size
  var pet = deps.pet
  var resetPosition = deps.resetPosition

  // ————————————————————— 设置面板 —————————————————————
  var panel = null
  function panelIsOpen() { return !!(panel && panel.style.display === 'block') }

  function buildPanel() {
    panel = document.createElement('div')
    panel.id = 'dsh-closure-pet-settings'
    panel.style.cssText = [
      'position:fixed', 'z-index:2147482001', 'display:none',
      'pointer-events:auto', 'min-width:196px', 'padding:10px 12px',
      'border-radius:10px', 'font:12px/1.6 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif',
      'background:rgba(26,28,36,.97)', 'color:#e7eaf3',
      'border:1px solid rgba(255,255,255,.14)',
      'box-shadow:0 10px 30px rgba(0,0,0,.45)',
    ].join(';')

    function row(label) {
      var el = document.createElement('div')
      el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0'
      var name = document.createElement('span')
      name.textContent = label
      name.style.cssText = 'color:#aab2c8'
      el.appendChild(name)
      panel.appendChild(el)
      return el
    }

    // 镜像
    var mirrorRow = row('镜像')
    var segBox = document.createElement('span')
    segBox.style.cssText = 'display:inline-flex;border:1px solid rgba(255,255,255,.18);border-radius:7px;overflow:hidden'
    var mirrorButtons = {}
    ;[['auto', '自动'], ['always', '始终'], ['never', '不镜像']].forEach(function (pair) {
      var btn = document.createElement('button')
      btn.textContent = pair[1]
      btn.dataset.value = pair[0]
      btn.style.cssText = 'padding:3px 9px;border:0;background:transparent;color:#cfd6e6;font:inherit;cursor:pointer'
      btn.addEventListener('click', function () {
        settings.mirror = pair[0]
        saveSettings()
        resolveFlip()
        syncMirrorButtons()
      })
      mirrorButtons[pair[0]] = btn
      segBox.appendChild(btn)
    })
    mirrorRow.appendChild(segBox)
    function syncMirrorButtons() {
      Object.keys(mirrorButtons).forEach(function (k) {
        var on = settings.mirror === k
        mirrorButtons[k].style.background = on ? 'rgba(125,134,255,.85)' : 'transparent'
        mirrorButtons[k].style.color = on ? '#fff' : '#cfd6e6'
      })
    }

    // 大小
    var sizeRow = row('大小')
    var sizeWrap = document.createElement('span')
    sizeWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(SIZE_MIN)
    slider.max = String(SIZE_MAX)
    slider.step = '0.05'
    slider.value = String(settings.size)
    slider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    var sizeText = document.createElement('span')
    sizeText.style.cssText = 'width:34px;text-align:right;color:#cfd6e6'
    sizeText.textContent = Math.round(settings.size * 100) + '%'
    var saveTimer = 0
    slider.addEventListener('input', function () {
      settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(slider.value) || 1))
      sizeText.textContent = Math.round(settings.size * 100) + '%'
      layout()
      repositionForAnchor()
      clearTimeout(saveTimer)
      saveTimer = setTimeout(saveSettings, 250)
    })
    sizeWrap.appendChild(slider)
    sizeWrap.appendChild(sizeText)
    sizeRow.appendChild(sizeWrap)

    // 边缘吸附强度（200% = 旧吸附范围，0% = 不吸附）
    var snapRow = row('吸附强度')
    var snapWrap = document.createElement('span')
    snapWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var snapSlider = document.createElement('input')
    snapSlider.type = 'range'
    snapSlider.min = String(SNAP_STRENGTH_MIN)
    snapSlider.max = String(SNAP_STRENGTH_MAX)
    snapSlider.step = '5'
    snapSlider.value = String(settings.snapStrength)
    snapSlider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    var snapText = document.createElement('span')
    snapText.style.cssText = 'width:38px;text-align:right;color:#cfd6e6'
    snapText.textContent = Math.round(settings.snapStrength) + '%'
    snapSlider.addEventListener('input', function () {
      settings.snapStrength = Math.min(SNAP_STRENGTH_MAX, Math.max(SNAP_STRENGTH_MIN, Number(snapSlider.value) || 0))
      snapText.textContent = Math.round(settings.snapStrength) + '%'
      saveSettings(false)
    })
    snapWrap.appendChild(snapSlider)
    snapWrap.appendChild(snapText)
    snapRow.appendChild(snapWrap)

    // 气泡大小（100% 为基准；50%–200%）
    var bubbleScaleRow = row('气泡大小')
    var bubbleScaleWrap = document.createElement('span')
    bubbleScaleWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var bubbleScaleSlider = document.createElement('input')
    bubbleScaleSlider.type = 'range'
    bubbleScaleSlider.min = String(BUBBLE_SCALE_MIN)
    bubbleScaleSlider.max = String(BUBBLE_SCALE_MAX)
    bubbleScaleSlider.step = '5'
    bubbleScaleSlider.value = String(settings.bubbleScale)
    bubbleScaleSlider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    var bubbleScaleText = document.createElement('span')
    bubbleScaleText.style.cssText = 'width:38px;text-align:right;color:#cfd6e6'
    bubbleScaleText.textContent = Math.round(settings.bubbleScale) + '%'
    bubbleScaleSlider.addEventListener('input', function () {
      settings.bubbleScale = Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, Number(bubbleScaleSlider.value) || 100))
      bubbleScaleText.textContent = Math.round(settings.bubbleScale) + '%'
      if (refreshBubble) refreshBubble()
      saveSettings(false)
    })
    bubbleScaleWrap.appendChild(bubbleScaleSlider)
    bubbleScaleWrap.appendChild(bubbleScaleText)
    bubbleScaleRow.appendChild(bubbleScaleWrap)

    // 分级排版开关：金额大、辅助信息小的多字号效果
    var tiersRow = row('更多层次的字体视觉效果')
    var tiersBtn = document.createElement('button')
    tiersBtn.style.cssText = 'padding:3px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
      'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
    function syncTiersBtn() {
      tiersBtn.textContent = settings.bubbleTiers ? '开' : '关'
      tiersBtn.style.background = settings.bubbleTiers ? 'rgba(125,134,255,.85)' : 'rgba(255,255,255,.06)'
      tiersBtn.style.color = settings.bubbleTiers ? '#fff' : '#dfe4f0'
    }
    tiersBtn.addEventListener('click', function () {
      settings.bubbleTiers = !settings.bubbleTiers
      syncTiersBtn()
      saveSettings(true)
      if (refreshBubble) refreshBubble()
    })
    syncTiersBtn()
    tiersRow.appendChild(tiersBtn)

    // 气泡开关
    var bubbleRow = row('气泡')
    var bubbleBtn = document.createElement('button')
    bubbleBtn.style.cssText = 'padding:3px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
      'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
    function syncBubbleBtn() {
      bubbleBtn.textContent = settings.bubble ? '开' : '关'
      bubbleBtn.style.background = settings.bubble ? 'rgba(125,134,255,.85)' : 'rgba(255,255,255,.06)'
      bubbleBtn.style.color = settings.bubble ? '#fff' : '#dfe4f0'
    }
    bubbleBtn.addEventListener('click', function () {
      settings.bubble = !settings.bubble
      syncBubbleBtn()
      saveSettings(true)
      if (!settings.bubble) hideBubble()
    })
    syncBubbleBtn()
    bubbleRow.appendChild(bubbleBtn)

    // 透明度
    var opaRow = row('透明度')
    var opaWrap = document.createElement('span')
    opaWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var opaSlider = document.createElement('input')
    opaSlider.type = 'range'
    opaSlider.min = '0.3'
    opaSlider.max = '1'
    opaSlider.step = '0.05'
    opaSlider.value = String(settings.opacity)
    opaSlider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    var opaText = document.createElement('span')
    opaText.style.cssText = 'width:38px;text-align:right;color:#cfd6e6'
    opaText.textContent = Math.round(settings.opacity * 100) + '%'
    opaSlider.addEventListener('input', function () {
      settings.opacity = Math.min(1, Math.max(0.3, Number(opaSlider.value) || 1))
      opaText.textContent = Math.round(settings.opacity * 100) + '%'
      applyOpacity()
      saveSettings(false)
    })
    opaWrap.appendChild(opaSlider)
    opaWrap.appendChild(opaText)
    opaRow.appendChild(opaWrap)

    // 音效：开关 + 音量
    var soundRow = row('音效')
    var soundWrap = document.createElement('span')
    soundWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var soundBtn = document.createElement('button')
    soundBtn.style.cssText = 'padding:3px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
      'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
    function syncSoundBtn() {
      soundBtn.textContent = settings.sound ? '开' : '关'
      soundBtn.style.background = settings.sound ? 'rgba(125,134,255,.85)' : 'rgba(255,255,255,.06)'
      soundBtn.style.color = settings.sound ? '#fff' : '#dfe4f0'
    }
    soundBtn.addEventListener('click', function () {
      settings.sound = !settings.sound
      syncSoundBtn()
      saveSettings(true)
      if (settings.sound) { audioEnsure(); loadSounds(); playSound('click') }
    })
    syncSoundBtn()
    var volSlider = document.createElement('input')
    volSlider.type = 'range'
    volSlider.min = '0'
    volSlider.max = '1'
    volSlider.step = '0.05'
    volSlider.value = String(settings.volume)
    volSlider.style.cssText = 'width:74px;accent-color:#7d86ff;cursor:pointer'
    var volText = document.createElement('span')
    volText.style.cssText = 'width:34px;text-align:right;color:#cfd6e6'
    volText.textContent = Math.round(settings.volume * 100) + '%'
    volSlider.addEventListener('input', function () {
      settings.volume = Math.min(1, Math.max(0, Number(volSlider.value) || 0))
      volText.textContent = Math.round(settings.volume * 100) + '%'
      saveSettings(false)
    })
    volSlider.addEventListener('change', function () { if (settings.sound) { audioEnsure(); playSound('click') } })
    soundWrap.appendChild(soundBtn)
    soundWrap.appendChild(volSlider)
    soundWrap.appendChild(volText)
    soundRow.appendChild(soundWrap)

    // 操作
    var actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;margin-top:9px'
    function action(label, fn) {
      var b = document.createElement('button')
      b.textContent = label
      b.style.cssText = 'flex:1;padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
        'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
      b.addEventListener('click', fn)
      actions.appendChild(b)
    }
    action('重置位置', function () { resetPosition() })
    action('完成', function () { closePanel() })
    panel.appendChild(actions)

    document.body.appendChild(panel)
    syncMirrorButtons()
    syncTiersBtn()
    return {
      syncMirrorButtons: syncMirrorButtons,
      syncTiersBtn: syncTiersBtn,
      slider: slider,
      sizeText: sizeText,
      snapSlider: snapSlider,
      snapText: snapText,
      bubbleScaleSlider: bubbleScaleSlider,
      bubbleScaleText: bubbleScaleText,
    }
  }

  var panelApi = null
  function openPanel() {
    if (!panel) panelApi = buildPanel()
    if (panelApi) {
      panelApi.slider.value = String(settings.size)
      panelApi.sizeText.textContent = Math.round(settings.size * 100) + '%'
      panelApi.snapSlider.value = String(settings.snapStrength)
      panelApi.snapText.textContent = Math.round(settings.snapStrength) + '%'
      panelApi.bubbleScaleSlider.value = String(settings.bubbleScale)
      panelApi.bubbleScaleText.textContent = Math.round(settings.bubbleScale) + '%'
      panelApi.syncTiersBtn()
      panelApi.syncMirrorButtons()
    }
    panel.style.display = 'block'
    // 放在桌宠上方；下方放不下就放下方
    var s = size()
    var pw = panel.offsetWidth
    var ph = panel.offsetHeight
    var left = Math.min(Math.max(8, pet.pos.x + s.w / 2 - pw / 2), window.innerWidth - pw - 8)
    var top = pet.pos.y - ph - 8
    if (top < 8) top = Math.min(window.innerHeight - ph - 8, pet.pos.y + s.h + 8)
    panel.style.left = Math.round(left) + 'px'
    panel.style.top = Math.round(top) + 'px'
  }

  function closePanel() {
    if (panel) panel.style.display = 'none'
  }

  function insidePanel(target) {
    return !!(panel && target && panel.contains(target))
  }

  function dispose() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    panel = null
    panelApi = null
  }

  return { open: openPanel, close: closePanel, isOpen: panelIsOpen, contains: insidePanel, dispose: dispose }
}
