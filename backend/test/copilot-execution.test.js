import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { withCopilotExecution, scopedCopilotClient, copilotHandler } from '../src/lib/copilot/execution.js'

test('all model stages share one budget; implicit SDK retries are disabled', async () => {
  let clock = 10, calls = []
  const raw = { chat: { completions: { async create(body, options) { calls.push({body, options}); return body } } } }
  await withCopilotExecution(async () => {
    await scopedCopilotClient(raw).chat.completions.create({ stage: 'write' })
    clock += 600
    await scopedCopilotClient(raw).chat.completions.create({ stage: 'review' })
    clock += 400
    assert.throws(() => scopedCopilotClient(raw).chat.completions.create({ stage: 'late' }), {code:'COPILOT_GENERATION_INCOMPLETE'})
  }, { budgetMs: 1000, now: () => clock })
  assert.deepEqual(calls.map(call => call.options.timeout), [1000, 400])
  assert.ok(calls.every(call => call.options.maxRetries === 0))
  assert.equal(scopedCopilotClient(raw), raw, 'unrelated routes must keep their existing client settings')
})

test('simultaneous requests keep independent cancellation and budgets', async () => {
  const first = new AbortController(), second = new AbortController()
  const raw = {chat:{completions:{async create(_body, options){return options}}}}
  const results = await Promise.all([first, second].map((controller, i) => withCopilotExecution(async () => {
    await Promise.resolve()
    if (!i) controller.abort()
    if (!i) return assert.throws(() => scopedCopilotClient(raw).chat.completions.create({}), {code:'COPILOT_GENERATION_INCOMPLETE'})
    return scopedCopilotClient(raw).chat.completions.create({})
  }, {signal:controller.signal, budgetMs:1000+i*100})))
  assert.equal(results[1].signal.aborted, false)
  assert.ok(results[1].timeout > 0 && results[1].timeout <= 1100)
})

test('closing an unfinished HTTP response aborts outstanding model work, with listener cleanup', async () => {
  const res = Object.assign(new EventEmitter(), {writableEnded:false})
  const raw = {chat:{completions:{async create(_body, options){return options}}}}
  let signal
  await copilotHandler(async () => {
    signal = (await scopedCopilotClient(raw).chat.completions.create({})).signal
    res.emit('close')
    assert.equal(signal.aborted, true)
  })({}, res)
  assert.equal(res.listenerCount('close'), 0)
})

test('optional memory enrichment gets a short sub-budget without losing the shared deadline', async () => {
 const raw={chat:{completions:{async create(_body,options){return options}}}}
 await withCopilotExecution(async()=>{
  const memory=await scopedCopilotClient(raw,{callBudgetMs:3000}).chat.completions.create({})
  assert.equal(memory.timeout,3000)
  const writing=await scopedCopilotClient(raw).chat.completions.create({})
  assert.ok(writing.timeout>3000)
 },{budgetMs:10000})
})
