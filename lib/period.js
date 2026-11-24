// dsh-closure-pet — 宿主：峰谷时段（纯函数，北京时间）
//
// 规则：工作日 09:00–12:00、14:00–18:00 为峰价；其余时间、周末、法定节假日全天谷价。
// 全部按北京时间判定，与本机时区无关。

export const PEAK_WINDOWS = [[9, 12], [14, 18]]

// 法定节假日（含调休，闭区间，北京时间日期）：节假日全天谷价。
// ⚠️ 官方每年 11 月左右公布下一年安排，公布后按新的调休日改这里的区间即可。
//    未列出的年份 = 只按"周末谷价"计算，不会算错价，只是少认出节假日。
export const HOLIDAY_RANGES = [
  // ——— 2026 ———
  ['2026-01-01', '2026-01-03'], // 元旦
  ['2026-02-15', '2026-02-22'], // 春节（除夕 02-16，初一 02-17）
  ['2026-04-04', '2026-04-06'], // 清明
  ['2026-05-01', '2026-05-05'], // 劳动节
  ['2026-06-19', '2026-06-21'], // 端午
  ['2026-09-25', '2026-09-27'], // 中秋
  ['2026-10-01', '2026-10-07'], // 国庆
  // ——— 2027（按农历节令推定，待官方调休公布后校准）———
  ['2027-01-01', '2027-01-03'], // 元旦
  ['2027-02-05', '2027-02-11'], // 春节（除夕 02-05，初一 02-06）
  ['2027-04-03', '2027-04-05'], // 清明（04-05）
  ['2027-05-01', '2027-05-05'], // 劳动节
  ['2027-06-09', '2027-06-11'], // 端午（06-09）
  ['2027-09-15', '2027-09-17'], // 中秋（09-15）
  ['2027-10-01', '2027-10-07'], // 国庆
]

export const HOLIDAY_VALLEY = Object.create(null)
for (const [from, to] of HOLIDAY_RANGES) {
  const start = Date.parse(from + 'T00:00:00Z')
  const end = Date.parse(to + 'T00:00:00Z')
  for (let t = start; t <= end; t += 86400000) {
    HOLIDAY_VALLEY[new Date(t).toISOString().slice(0, 10)] = 1
  }
}

export function bjDate(ts) {
  return new Date(ts + 8 * 3600 * 1000)
}

/** 北京时间的 YYYY-MM-DD（用于按天归零）。 */
export function bjDayKey(ts = Date.now()) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 当前是否存在超出已收录范围的年份（用于前端提示"节假日表需更新"）。 */
export function holidaysOutdated(ts = Date.now()) {
  const year = String(bjDate(ts).getUTCFullYear())
  return !HOLIDAY_RANGES.some(([from]) => from.startsWith(year))
}

export function computePeriod(ts = Date.now()) {
  const bj = bjDate(ts)
  const dow = bj.getUTCDay() // 0=周日
  if (dow === 0 || dow === 6) return 'valley'
  if (HOLIDAY_VALLEY[bj.toISOString().slice(0, 10)]) return 'valley'
  const hour = bj.getUTCHours() + bj.getUTCMinutes() / 60
  for (const [from, to] of PEAK_WINDOWS) {
    if (hour >= from && hour < to) return 'peak'
  }
  return 'valley'
}

/** 下一个峰谷切换时刻（epoch ms）；12 天内找不到就返回 null。 */
export function nextPeriodChangeAt(ts = Date.now()) {
  const cur = computePeriod(ts)
  const dayStart = Math.floor((ts + 8 * 3600 * 1000) / 86400000) * 86400000 - 8 * 3600 * 1000
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const cand = dayStart + d * 86400000 + edge * 3600 * 1000
      if (cand <= ts + 1000) continue
      if (computePeriod(cand) !== cur) return cand
    }
  }
  return null
}
