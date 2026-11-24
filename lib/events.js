// dsh-closure-pet — 宿主：事件订阅
//
// 把 DSH 的事件流折叠成 runtime 里的「当前值 + 计数器」：
//   session/event          → turn/end、assistant/message（计费）
//   agent/assistant-stream → thinking / outputting
//   tools/result           → 工具成功/失败计数
//   agent/error            → 错误提示来源
//   agent/status           → agent 是否在跑

import { costOf, tokenCount } from './billing.js'

export function registerEvents(root, store) {
  const { runtime, bump, setWork, noteSpend } = store

  // 会话事件：assistant/message 带 usage → 计一笔花费；turn/end → 结束通知
  try {
    root.on('session/event', (session, event) => {
      try {
        if (!event) return
        if (event.type === 'turn/end') {
          const d = event.data || {}
          const reason = d.reason || {}
          runtime.turnEndSeq++
          runtime.turnEnd = {
            seq: runtime.turnEndSeq,
            kind: String(reason.kind || 'completed'),
            turn: typeof d.turn === 'number' ? d.turn : null,
            at: Date.now(),
          }
          bump()
          return
        }
        if (event.type !== 'assistant/message') return
        const d = event.data || {}
        const usage = d.usage
        if (!usage) return
        const model = d.message && d.message.source && d.message.source.model
        const provider = d.message && d.message.source && d.message.source.provider
        noteSpend(costOf(usage, model, event.time || Date.now()), tokenCount(usage), d.turn,
          { provider, model })
      } catch (err) { /* 计费失败不影响宿主 */ }
    })
  } catch (err) { console.warn('[closure-pet] 无法订阅 session/event：' + String((err && err.message) || err)) }

  // 模型流：start / reasoning-delta = 思考，text-delta = 输出，end = 收尾
  try {
    root.on('agent/assistant-stream', (payload) => {
      try {
        const frame = payload && payload.frame
        if (!frame) return
        if (frame.type === 'start') {
          runtime.agentRunning = true
          setWork('thinking')
          return
        }
        if (frame.type === 'end') {
          if (runtime.workMode === 'outputting') setWork('thinking')
          return
        }
        const chunk = frame.chunk
        if (!chunk) return
        if (chunk.type === 'text-delta') {
          runtime.outputUntil = Date.now() + 800
          setWork('outputting')
        } else if (chunk.type === 'reasoning-delta') {
          setWork('thinking')
        } else if (chunk.type === 'finish') {
          runtime.outputUntil = 0
        }
      } catch (err) { /* 事件处理失败不影响宿主 */ }
    })
  } catch (err) { console.warn('[closure-pet] 无法订阅 agent/assistant-stream：' + String(err && err.message || err)) }

  // 工具结果：成功/失败各自计数（前端做限流后播放 Happy / Sad_Begin）
  try {
    root.on('tools/result', (exec, result) => {
      try {
        if (result && result.isError) {
          runtime.tools.fail++
          runtime.tools.lastFailAt = Date.now()
          runtime.tools.lastFailName = String((exec && exec.name) || '')
          const failure = result.error || {}
          runtime.tools.lastFailMessage = String(failure.message || failure.info && failure.info.code || '').slice(0, 60)
        } else {
          runtime.tools.ok++
          runtime.tools.lastOkAt = Date.now()
        }
        bump()
      } catch (err) {}
    })
  } catch (err) { console.warn('[closure-pet] 无法订阅 tools/result：' + String(err && err.message || err)) }

  // 模型/轮次级错误：给气泡一个"出错"来源
  try {
    root.on('agent/error', (payload) => {
      try {
        const err0 = payload && payload.error
        let message = ''
        if (err0 && typeof err0 === 'object') message = String(err0.message || err0.code || '')
        else message = String(err0 || '')
        runtime.errors.count++
        runtime.errors.lastAt = Date.now()
        runtime.errors.message = message.slice(0, 60)
        bump()
      } catch (err) {}
    })
  } catch (err) { console.warn('[closure-pet] 无法订阅 agent/error：' + String(err && err.message || err)) }

  // agent 状态：idle 时收尾（切回基础层）
  try {
    root.on('agent/status', (payload) => {
      try {
        const running = payload && payload.status === 'running'
        runtime.agentRunning = !!running
        if (!running && runtime.workMode !== 'idle') setWork('idle')
        bump()
      } catch (err) {}
    })
  } catch (err) { console.warn('[closure-pet] 无法订阅 agent/status：' + String(err && err.message || err)) }
}
