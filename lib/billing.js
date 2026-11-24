// dsh-closure-pet — 宿主：计费（纯函数）
//
// 价目单位：元 / 百万 token；数组下标 0=谷价 1=峰价，与 DeepSeek 峰谷计费一致。
// 键是模型名子串，按长度降序匹配（避免 "pro" 误伤别的模型）。

import { computePeriod } from './period.js'

export const PRICES = {
  'deepseek-v4-pro': { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] },
  'deepseek-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-flash-vision-exp': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
}

export const DEFAULT_PRICE = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }

export function priceFor(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICES).sort((a, b) => b.length - a.length)) {
    if (m.indexOf(key) !== -1) return PRICES[key]
  }
  return DEFAULT_PRICE
}

/** 一条 assistant/message 的 token 总量（cache 计入输入侧）。 */
export function tokenCount(usage) {
  return (Number(usage.inputTokens) || 0)
    + (Number(usage.cacheReadTokens) || 0)
    + (Number(usage.outputTokens) || 0)
}

/** 一条 assistant/message 的花费（元）。价目按事件发生时刻的峰谷档取。 */
export function costOf(usage, model, ts) {
  const price = priceFor(model)
  const off = computePeriod(ts) === 'peak' ? 1 : 0
  const cache = Number(usage.cacheReadTokens) || 0
  const input = Number(usage.inputTokens) || 0
  const output = Number(usage.outputTokens) || 0
  return (cache / 1e6) * price.hit[off] + (input / 1e6) * price.miss[off] + (output / 1e6) * price.out[off]
}
