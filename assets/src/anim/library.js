// dsh-closure-pet — 动画数据表
//
// 每段动画对应一个透明视频片段：素材路径、时长与是否循环都写在这里。
// 需要改动画只改这张表；状态机在 anim/director.js，不在这里。

// 交互动画结束回状态层时的淡化时长（ms）；其余切换一律硬切。
export const CLIP_FADE_MS = 320
// 每次进入思考状态，播一遍完整思考动画的概率；没抽中就继续待机。
export const THINK_CHANCE = 0.5

// 思考期间两次掷骰的最小间隔；抽中后播完整段，播完再等一个间隔。
export const THINK_ROLL_MS = 10000

// 工具调用成功 → 播 Happy 的概率（失败仍然必播 Sad_Begin）
export const HAPPY_CHANCE = 0.25

// 「难过」类表演只认这一个入口：改动画只改这里。
export const SAD_ENTRY = 'Sad_Begin'

// 当前可用的交互动画：暂时只保留后半段，A 的素材保留但不出现在抽取池里。
export const INTERACT_ACTIONS = ['Interact_B']

// 片段表：src 相对 /assets/video/；duration 只用于调试与取整，播放以 video 元素为准。
export const CLIPS = {
  Idle: { src: 'idle.webm', duration: 1.467, loop: true },
  Sad_Idle: { src: 'sad_idle.webm', duration: 2.133, loop: true },
  Happy: { src: 'happy.webm', duration: 2.833 },
  Sad_Begin: { src: 'sad_begin.webm', duration: 2.567 },
  Special_A: { src: 'special_a.webm', duration: 2.0 },
  Special_B: { src: 'special_b.webm', duration: 2.667 },
  Talk: { src: 'talk.webm', duration: 5.0 },
  Interact_A: { src: 'interact_a.webm', duration: 2.1 },
  Interact_B: { src: 'interact_b.webm', duration: 3.833 },
}

// 可被调试接口 / 文档直接列出的动画名（Interact 的两段在内部合并展示）。
export const ANIMATION_NAMES = [
  'Idle', 'Sad_Idle', 'Happy', 'Sad_Begin', 'Special_A', 'Special_B', 'Talk', 'Interact',
]
