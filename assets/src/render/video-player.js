// dsh-closure-pet — 透明视频播放器
//
// A/B 两个 <video> 交替当后台：新片段先加载到后台，能出画后再交换 is-front，
// 靠 0.18s 的 opacity 过渡完成交叉淡化，避免换动画时硬切。
// 只负责「播哪一段、什么时候交换」；选哪一段、分层与播完接什么由 anim/director.js 决定。

import { CLIP_FADE_MS, CLIPS } from '../anim/library.js'

const STYLE_ID = 'dsh-closure-video-style'
const CACHE_LIMIT = 8

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    '#dsh-closure-pet-stage{position:absolute;inset:0;overflow:hidden;pointer-events:none}',
    '.dsh-closure-video{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;opacity:0;',
    'transition:opacity var(--dsh-fade,' + CLIP_FADE_MS + 'ms) cubic-bezier(.4,0,.2,1);pointer-events:none;background:transparent}',
    '.dsh-closure-video.is-front{opacity:1}',
    '@media (prefers-reduced-motion: reduce){.dsh-closure-video{transition:none}}',
  ].join('')
  document.head.appendChild(style)
}

export function createVideoPlayer(deps) {
  var stage = deps.stage
  var baseUrl = deps.baseUrl || ''
  var log = deps.log || function () {}
  ensureStyle()

  var videos = []
  for (var i = 0; i < 2; i++) {
    var el = document.createElement('video')
    el.className = 'dsh-closure-video'
    el.muted = true
    el.defaultMuted = true
    el.playsInline = true
    el.autoplay = true
    el.preload = 'auto'
    el.setAttribute('muted', '')
    el.setAttribute('playsinline', '')
    stage.appendChild(el)
    videos.push(el)
  }
  videos[0].classList.add('is-front')

  var front = 0
  var gen = 0
  var currentName = null
  var currentEl = null
  var endedHandler = null
  var paused = false
  var cache = Object.create(null)
  var cacheOrder = []
  var inflight = Object.create(null)

  function remember(url, objectUrl) {
    cache[url] = objectUrl
    cacheOrder.push(url)
    while (cacheOrder.length > CACHE_LIMIT) {
      var oldest = cacheOrder.shift()
      if (oldest === url) continue
      var stale = cache[oldest]
      if (stale && stale !== currentElSrc()) {
        URL.revokeObjectURL(stale)
        delete cache[oldest]
      }
    }
  }

  function currentElSrc() {
    return currentEl && currentEl.src ? currentEl.src : ''
  }

  function loadClip(src) {
    var url = baseUrl + src
    if (cache[url]) return Promise.resolve(cache[url])
    if (inflight[url]) return inflight[url]
    var task = fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('video HTTP ' + r.status + ' ' + url)
        return r.blob()
      })
      .then(function (blob) {
        var objectUrl = URL.createObjectURL(blob)
        remember(url, objectUrl)
        return objectUrl
      })
      .finally(function () { delete inflight[url] })
    inflight[url] = task
    return task
  }

  function setFade(ms) {
    stage.style.setProperty('--dsh-fade', (ms === undefined ? CLIP_FADE_MS : ms) + 'ms')
  }

  function markReady(back, name, clip, token, onEnded) {
    if (token !== gen) return
    var old = videos[front]
    back.classList.add('is-front')
    if (old && old !== back) {
      old.classList.remove('is-front')
      old.onended = null
      old.pause()
    }
    front = front === 0 ? 1 : 0
    currentName = name
    currentEl = back
    endedHandler = typeof onEnded === 'function' ? onEnded : null
    back.onended = clip.loop
      ? function () {
          // 循环段正常不会 ended；真收到就从头续播，避免停在末帧。
          try { back.currentTime = 0; back.play() } catch (err) {}
        }
      : function () {
          var cb = endedHandler
          if (cb) cb(name)
        }
    paused = false
    back.play().catch(function (err) {
      log('视频播放被拒绝', name, err && err.message)
    })
  }

  function play(name, opts) {
    opts = opts || {}
    var clip = CLIPS[name]
    if (!clip) {
      log('未知动画片段', name)
      return false
    }
    if (currentName === name && !opts.restart) {
      if (typeof opts.onEnded === 'function') endedHandler = opts.onEnded
      if (currentEl && !paused) {
        // 同名动画已播完但还没换源（例如覆盖动画结束、开屏空档期）：
        // 不能只 play()，要从头重启，否则不会再有 ended 回调。
        if (currentEl.ended) currentEl.currentTime = 0
        if (currentEl.paused) currentEl.play().catch(function () {})
      }
      return true
    }

    var token = ++gen
    var back = videos[front === 0 ? 1 : 0]
    back.loop = !!clip.loop
    back.onended = null
    setFade(opts.fade)

    loadClip(clip.src).then(function (src) {
      if (token !== gen) return
      var onReady = function () {
        back.removeEventListener('loadeddata', onReady)
        if (token !== gen) return
        markReady(back, name, clip, token, opts.onEnded)
      }
      back.addEventListener('loadeddata', onReady)
      back.src = src
      back.load()
      if (back.readyState >= 2) onReady()
    }).catch(function (err) {
      if (token !== gen) return
      log('视频加载失败', name, err && err.message)
      if (typeof opts.onError === 'function') opts.onError(err)
    })
    return true
  }

  function replay() {
    if (!currentEl || !currentName) return false
    try {
      currentEl.currentTime = 0
      void currentEl.play()
      paused = false
      return true
    } catch (err) {
      return false
    }
  }

  function pause() {
    paused = true
    for (var i = 0; i < videos.length; i++) videos[i].pause()
  }

  function resume() {
    paused = false
    if (currentEl && currentEl.paused && currentName) {
      currentEl.play().catch(function () {})
    }
  }

  function stop() {
    gen++
    currentName = null
    endedHandler = null
    for (var i = 0; i < videos.length; i++) {
      videos[i].onended = null
      videos[i].pause()
    }
  }

  function dispose() {
    stop()
    for (var key in cache) {
      try { URL.revokeObjectURL(cache[key]) } catch (err) {}
    }
    cache = Object.create(null)
    for (var i = 0; i < videos.length; i++) {
      if (videos[i].parentNode) videos[i].parentNode.removeChild(videos[i])
    }
    videos = []
    currentEl = null
  }

  return {
    play: play,
    replay: replay,
    pause: pause,
    resume: resume,
    stop: stop,
    dispose: dispose,
    current: function () { return currentName },
    currentTime: function () { return currentEl ? currentEl.currentTime : 0 },
    isPaused: function () { return paused || !!(currentEl && currentEl.paused) },
    video: function () { return currentEl },
  }
}
