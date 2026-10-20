import { AsyncLocalStorage } from 'node:async_hooks'
import { AppError } from '../errors.js'

// One budget per editing request. SDK-level retries must not multiply the
// bounded write/review cycle or start a new timeout for every repair.
const execution = new AsyncLocalStorage()
export const COPILOT_EXECUTION_MS = 100_000
export function withCopilotExecution(run, { signal, budgetMs = COPILOT_EXECUTION_MS, now = Date.now } = {}) {
  return execution.run({ deadline: now() + budgetMs, signal, now }, run)
}
export function scopedCopilotClient(client, { callBudgetMs = Infinity } = {}) {
  const scope = execution.getStore()
  if (!scope || !client) return client
  return {
    ...client,
    chat: { ...client.chat, completions: {
      ...client.chat.completions,
      create(body, options = {}) {
        const remaining = scope.deadline - scope.now()
        if (scope.signal?.aborted || remaining <= 0) {
          throw new AppError('수정안 생성 연결을 완료하지 못했습니다.', {
            code: 'COPILOT_GENERATION_INCOMPLETE', statusCode: 503, exposeMessage: true,
          })
        }
        return client.chat.completions.create(body, {
          ...options, maxRetries: 0, timeout: Math.min(remaining, callBudgetMs),
          ...(scope.signal ? { signal: scope.signal } : {}),
        })
      },
    } },
  }
}
export function copilotHandler(handler) {
  return async (req, res, next) => {
    const controller = new AbortController()
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', disconnect)
    try {
      await withCopilotExecution(() => handler(req, res, next), { signal: controller.signal })
    } finally {
      res.removeListener('close', disconnect)
    }
  }
}
