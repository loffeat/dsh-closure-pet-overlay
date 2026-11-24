// dsh-closure-pet — 谷价贴画（工厂）
//
// 只在谷价时段、点击桌宠时弹一下：像素风绿底 + 横向扫描线 + 像素字体。
// 依赖注入：getState() 读 /state、settings、size()、pet。

export function createSticker(deps) {
  var getState = deps.getState
  var settings = deps.settings
  var size = deps.size
  var pet = deps.pet

  // ————————————————————— 谷价贴画（−50% 扫描线）—————————————————————
  // 只在谷价时段、点击桌宠时弹一下：像素风绿底 + 横向扫描线 + 像素字体。
  // 画布按 6× 绘制（40×24 逻辑像素 → 240×144 设备像素），保证像素边缘锐利。
  var STICKER_BASE_W = 40
  var STICKER_H = 24           // 逻辑像素高
  var STICKER_SCALE = 3        // 逻辑 → CSS（3×），设备像素再 ×DPR
  var stickerEl = null
  var stickerCanvas = null
  var stickerReady = false
  var stickerW = 120           // 动态计算后的 CSS 尺寸
  var stickerH = 72

  function drawSticker() {
    var LOG_H = STICKER_H
    // 跟着桌宠尺寸缩放：size=1 时保持原来的 120×72 观感，size=0.6 时同步缩小
    var k = Number(settings.size)
    if (!isFinite(k) || k <= 0) k = 1
    k = Math.min(2, Math.max(0.4, k))
    var cssScale = STICKER_SCALE * k
    var S = STICKER_SCALE * 2 // 设备像素 / 逻辑像素（2× DPR）
    var cv = stickerCanvas
    var ctx = cv.getContext('2d')

    // 先按 12px 量一次文字宽度，再决定逻辑宽度（左右各留 7px）
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.font = '12px ArkPixel12, monospace'
    var tw = 0
    try { tw = ctx.measureText('-99%').width } catch (err) { tw = 30 }
    var LOG_W = Math.max(STICKER_BASE_W, Math.ceil(tw) + 14)

    stickerW = Math.max(24, Math.round(LOG_W * cssScale))
    stickerH = Math.max(16, Math.round(LOG_H * cssScale))
    cv.width = LOG_W * S
    cv.height = LOG_H * S
    cv.style.width = stickerW + 'px'
    cv.style.height = stickerH + 'px'
    if (stickerEl) {
      stickerEl.style.width = stickerW + 'px'
      stickerEl.style.height = stickerH + 'px'
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.scale(S, S)
    ctx.imageSmoothingEnabled = false

    // 底：橄榄绿
    ctx.fillStyle = '#3f6a12'
    ctx.fillRect(0, 0, LOG_W, LOG_H)
    // 横向扫描线（每 2 个逻辑像素一条）
    ctx.fillStyle = 'rgba(0,0,0,.22)'
    for (var y = 0; y < LOG_H; y += 2) ctx.fillRect(0, y, LOG_W, 1)
    // 顶部一道高光
    ctx.fillStyle = 'rgba(255,255,255,.10)'
    ctx.fillRect(0, 0, LOG_W, 1)
    // 双层描边
    ctx.strokeStyle = '#2a4506'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, LOG_W - 1, LOG_H - 1)
    ctx.strokeStyle = 'rgba(182,242,74,.28)'
    ctx.strokeRect(1.5, 1.5, LOG_W - 3, LOG_H - 3)

    // 文字 −99%
    ctx.fillStyle = '#b6f24a'
    ctx.font = '12px ArkPixel12, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('-99%', LOG_W / 2, LOG_H / 2 + 0.5)

    // 底部一条亮线（扫描线残留感）
    ctx.fillStyle = 'rgba(182,242,74,.5)'
    ctx.fillRect(6, LOG_H - 4, LOG_W - 12, 1)
  }

  function ensureSticker() {
    if (stickerEl) return
    stickerCanvas = document.createElement('canvas')
    stickerEl = document.createElement('div')
    stickerEl.id = 'dsh-closure-pet-sticker'
    // z-index 与桌宠同级但后插入 → 盖在桌宠身上（"贴"上去）
    stickerEl.style.cssText = [
      'position:fixed', 'z-index:2147482000', 'pointer-events:none',
      'display:none', 'will-change:transform,opacity',
      'image-rendering:pixelated',
    ].join(';')
    stickerCanvas.style.cssText = 'display:block;image-rendering:pixelated'
    stickerEl.appendChild(stickerCanvas)
    document.body.appendChild(stickerEl)
  }

  function showValleySticker() {
    var s = getState()
    if (!s || s.period !== 'valley') return // 只在谷价弹
    if (!settings.bubble) return             // 跟气泡同一个"减少干扰"开关
    ensureSticker()
    // 每次弹出都按当前桌宠尺寸重画（尺寸在设置里可随时改）
    drawSticker()
    stickerReady = true
    try {
      document.fonts.load('12px ArkPixel12').then(function () { if (stickerReady) drawSticker() }).catch(function () {})
    } catch (err) { /* ignore */ }

    var petSize = size()
    var cx = pet.pos.x + petSize.w / 2
    // 贴着角色本体（而不是画布边缘）：右侧时贴左半身，左侧时贴右半身
    var leftOfPet = cx > window.innerWidth / 2
    var left = leftOfPet ? Math.round(cx - stickerW - 8) : Math.round(cx + 8)
    left = Math.min(Math.max(8, left), window.innerWidth - stickerW - 8)
    var top = Math.round(pet.pos.y + petSize.h * 0.18)
    top = Math.min(Math.max(8, top), window.innerHeight - stickerH - 8)
    stickerEl.style.left = left + 'px'
    stickerEl.style.top = top + 'px'
    stickerEl.style.display = 'block'

    try {
      stickerEl.getAnimations().forEach(function (a) { a.cancel() })
      // 从下往上"飘"出来：一条连续的贝塞尔上升曲线，没有中途停顿
      //   · transform 全程单调上浮（26px → -40px），用 ease-out 贝塞尔收尾
      //   · 透明度只在前 18% 淡入，后 45% 开始随上浮一起淡出
      stickerEl.animate([
        { opacity: 0, transform: 'translateY(26px) scale(.94)', easing: 'cubic-bezier(.18,.89,.32,1)' },
        { opacity: 1, transform: 'translateY(6px) scale(1)', offset: 0.18, easing: 'cubic-bezier(.25,.8,.35,1)' },
        { opacity: 1, transform: 'translateY(-14px) scale(1.02)', offset: 0.52, easing: 'cubic-bezier(.4,0,.7,.5)' },
        { opacity: 0, transform: 'translateY(-42px) scale(1.04)', offset: 1 },
      ], { duration: 1000, easing: 'linear', fill: 'forwards' }).onfinish = function () {
        if (stickerEl) stickerEl.style.display = 'none'
      }
    } catch (err) {
      // 老内核没有 WAAPI：退化成直接显示 1s
      stickerEl.style.opacity = '1'
      setTimeout(function () { if (stickerEl) stickerEl.style.display = 'none' }, 1000)
    }
  }

  function dispose() {
    if (stickerEl && stickerEl.parentNode) stickerEl.parentNode.removeChild(stickerEl)
    stickerEl = null
    stickerCanvas = null
    stickerReady = false
  }

  return { show: showValleySticker, dispose: dispose }
}
