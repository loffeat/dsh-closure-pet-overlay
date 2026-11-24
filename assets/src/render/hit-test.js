// dsh-closure-pet — 静态命中区
//
// 不读 GPU 像素：命中区按 Idle 姿态拟合成 11 个图元，栅格化成 128×108 掩码，
// 按下时只做坐标换算 + 查表。掩码在 FRAME 坐标系里，与位置 / size / dpr / 镜像无关。
// 参数覆盖角色本体与 Idle 12 帧并集（recall 98% 以上）。

import { FRAME } from '../core/env.js'

export const HIT_MASK_W = 128
export const HIT_MASK_H = 108
export const HIT_GROW = 6          // 统一外扩（FRAME 单位），让轮廓更宽松、更好点
// 'e': 椭圆 [cx, cy, rx, ry]
// 'r': 圆角矩形 [x0, y0, x1, y1, r]
// 'c': 胶囊 [ax, ay, bx, by, r]
export const HIT_FORMS = [
  ['e', 13, 265, 78, 48],          // 头 / 头发
  ['e', -74.5, 232, 32, 23],       // 左双马尾
  ['e', 60, 264, 30, 42],          // 右双马尾
  ['e', -80, 123.5, 46, 50],       // 左袖
  ['e', 70, 143, 46.5, 74],        // 右袖
  ['r', -98, 71.5, 94, 318, 34],   // 躯干
  ['r', -53.5, 9.5, 46, 96, 19],   // 腿
  ['c', -38, 24, 15, 19.5, 30],    // 鞋
  ['e', -158, 222, 71, 74],        // 左小飞机（含蝙蝠）
  ['e', 141, 246, 67, 76],         // 右小飞机（含蝙蝠）
  ['e', 93, 40, 87, 48],           // 右下角游戏卡
]

export function hitFormIn(form, x, y) {
  var g = HIT_GROW
  if (form[0] === 'e') {
    var ex = (x - form[1]) / (form[3] + g)
    var ey = (y - form[2]) / (form[4] + g)
    return ex * ex + ey * ey <= 1
  }
  if (form[0] === 'r') {
    var x0 = form[1] - g
    var y0 = form[2] - g
    var x1 = form[3] + g
    var y1 = form[4] + g
    var rr = form[5] + g
    var cx = Math.min(Math.max(x, x0 + rr), x1 - rr)
    var cy = Math.min(Math.max(y, y0 + rr), y1 - rr)
    var dx = x - cx
    var dy = y - cy
    return dx * dx + dy * dy <= rr * rr
  }
  var ax = form[1], ay = form[2], bx = form[3], by = form[4]
  var rad = form[5] + g
  var vx = bx - ax, vy = by - ay
  var len2 = vx * vx + vy * vy
  var t = len2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / len2 : 0
  t = Math.min(Math.max(t, 0), 1)
  var px = ax + t * vx, py = ay + t * vy
  var ddx = x - px, ddy = y - py
  return ddx * ddx + ddy * ddy <= rad * rad
}

export function buildHitMask() {
  var m = new Uint8Array(HIT_MASK_W * HIT_MASK_H)
  for (var my = 0; my < HIT_MASK_H; my++) {
    // 掩码第 0 行是画面顶部；FRAME 的 y 轴向上，所以从 y+h 往下扫
    var wy = FRAME.y + FRAME.h - ((my + 0.5) / HIT_MASK_H) * FRAME.h
    for (var mx = 0; mx < HIT_MASK_W; mx++) {
      var wx = FRAME.x + ((mx + 0.5) / HIT_MASK_W) * FRAME.w
      for (var k = 0; k < HIT_FORMS.length; k++) {
        if (hitFormIn(HIT_FORMS[k], wx, wy)) { m[my * HIT_MASK_W + mx] = 1; break }
      }
    }
  }
  return m
}

/** 用归一化坐标（0..1，x 已按镜像处理）查表。 */
export function maskHit(mask, nx, ny) {
  if (!(nx >= 0 && nx < 1 && ny >= 0 && ny < 1)) return false
  var mx = Math.floor(nx * HIT_MASK_W)
  var my = Math.floor(ny * HIT_MASK_H)
  if (mx >= HIT_MASK_W) mx = HIT_MASK_W - 1
  if (my >= HIT_MASK_H) my = HIT_MASK_H - 1
  return mask[my * HIT_MASK_W + mx] === 1
}
