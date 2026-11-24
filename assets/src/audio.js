// dsh-closure-pet — 音效
//
// 音频取自游戏内 autochess 皮肤的 UI 音效（无人声），转成 56k Opus。
// 浏览器自动播放策略：AudioContext 初始 suspended，首次点击时 resume。
// 依赖注入：getSettings() 返回 { sound, volume }，避免模块直接耦合设置对象。

import { PREFIX } from './core/env.js'

var SOUND_FILES = ['click', 'fail', 'coin', 'turnfail']

export function createAudio(getSettings) {
  var audioCtx = null
  var soundBuffers = {}
  var soundLoaded = false

  function audioEnsure() {
    if (!audioCtx) {
      try {
        var Ctor = window.AudioContext || window.webkitAudioContext
        if (Ctor) audioCtx = new Ctor()
      } catch (err) { audioCtx = null }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      try { audioCtx.resume().catch(function () {}) } catch (err) {}
    }
    return audioCtx
  }

  function loadSounds() {
    if (soundLoaded) return
    soundLoaded = true
    var ctx = audioEnsure()
    if (!ctx) return
    SOUND_FILES.forEach(function (name) {
      soundBuffers[name] = null // 占位：加载中
      fetch(PREFIX + '/assets/audio/' + name + '.ogg', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))) })
        .then(function (buf) { return ctx.decodeAudioData(buf) })
        .then(function (decoded) { soundBuffers[name] = decoded })
        .catch(function () { delete soundBuffers[name] })
    })
  }

  function playSound(name) {
    var s = getSettings()
    if (!s.sound) return
    if (s.volume <= 0.01) return
    var ctx = audioEnsure()
    if (!ctx) return
    var buf = soundBuffers[name]
    if (buf === undefined) { loadSounds(); return }
    if (!buf) return // 还在加载
    try {
      var src = ctx.createBufferSource()
      var gain = ctx.createGain()
      src.buffer = buf
      gain.gain.value = Math.min(1, Math.max(0, s.volume))
      src.connect(gain)
      gain.connect(ctx.destination)
      src.start(0)
    } catch (err) {}
  }

  /** 调试面用：报告已加载的音频与当前上下文状态。 */
  function getState() {
    var s = getSettings()
    var out = {}
    Object.keys(soundBuffers).forEach(function (k) { out[k] = !!soundBuffers[k] })
    return { loaded: out, ctx: audioCtx ? audioCtx.state : null, enabled: s.sound, volume: s.volume }
  }

  return { ensure: audioEnsure, loadSounds: loadSounds, playSound: playSound, getState: getState }
}
