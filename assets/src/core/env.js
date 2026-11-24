// dsh-closure-pet — 常量与日志
//
// 这里只放「无副作用的数据」：路径、取景框、交互阈值、可调参数。
// 注意 STARTUP_DELAY / STARTUP_GAP 在模块加载时读一次 localStorage（可用控制台覆盖）。

export const PREFIX = '/dsh-closure'
export const CANVAS_W = 300

// 取景框：所有动画真实顶点范围的并集（本地测量得到，固定不再变）。
// Happy 抬手时高度到 373.4，比角色通常占位高出一截，用固定取景会被裁掉。
export const FRAME = { x: -229.1, y: -10.6, w: 443.6, h: 373.4 }

export const FRAMING = 1.04
export const MARGIN = 12
export const POS_KEY = 'dshcl-pos'
export const SETTINGS_KEY = 'dshcl-settings'
export const DRAG_THRESHOLD_SQ = 9
// 尺寸范围与共享协议放一起，避免宿主/前端各写一套 clamp
import {
  SIZE_MIN, SIZE_MAX,
  BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX,
  SNAP_STRENGTH_MIN, SNAP_STRENGTH_MAX,
} from '../shared/protocol.js'
export {
  SIZE_MIN, SIZE_MAX,
  BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX,
  SNAP_STRENGTH_MIN, SNAP_STRENGTH_MAX,
}
export const BLEND_BACK = 0.35

// Interact 前后段的分界（秒）：2.10s = 30fps 第 63 帧，动作回正的中心点。
// 一次取点后固定下来，不再放进设置面板（要调就改这里，或用 tools/scrub-server.mjs 重新取点）。
export const INTERACT_SPLIT = 2.10
// 从 Interact 回到 Idle 的混合时长（秒）：短到看不出叠影，又能消掉硬切的顿感
export const INTERACT_MIX = 0.18

// 开屏演出：首屏 10s 后强制插播一遍「峰谷 → 余额」（localStorage 可覆盖等待与空档）
export function numOverride(key, fallback) {
  var raw
  try { raw = localStorage.getItem(key) } catch (e) { return fallback }
  if (raw === null || raw === '') return fallback
  var v = Number(raw)
  return isFinite(v) && v >= 0 ? v : fallback
}
export const STARTUP_DELAY = numOverride('dshcl-startup-delay', 5000)
export const STARTUP_GAP = numOverride('dshcl-startup-gap', 2000)

export const log = function () {
  try { console.info.apply(console, ['[closure-pet]'].concat([].slice.call(arguments))) } catch (e) {}
}
export const warn = function () {
  try { console.warn.apply(console, ['[closure-pet]'].concat([].slice.call(arguments))) } catch (e) {}
}

