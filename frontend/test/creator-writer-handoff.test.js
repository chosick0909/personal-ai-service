import test from 'node:test'
import assert from 'node:assert/strict'
import { stageStudioWriterHandoff, consumeStudioWriterHandoff, STUDIO_HANDOFF_PARAM } from '../src/lib/creatorWriterHandoff.js'
const payload = { text: '  한국어 대본입니다. 원래 문장을 그대로 전달해요.  ', userId: 'owner', accountId: 'account' }
function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
function stage(store) { return stageStudioWriterHandoff(payload, { storage: store, now: 1000, token: 'request-token' }) }
const identity = { token: 'request-token', userId: payload.userId, accountId: payload.accountId }

test('a new document can consume the exact transcript once, without placing it in the URL', () => {
  const store = storage(), url = new URL(stage(store), 'https://example.invalid')
  assert.equal(url.pathname, '/analyze')
  assert.equal(url.hash, '#upload')
  assert.equal(url.searchParams.get(STUDIO_HANDOFF_PARAM), identity.token)
  assert.equal(decodeURIComponent(url.href).includes('한국어'), false)
  assert.equal(consumeStudioWriterHandoff(identity, { storage: store, now: 1100 }), payload.text.trim())
  assert.equal(consumeStudioWriterHandoff(identity, { storage: store, now: 1200 }), null)
})

test('pending auth/account initialization and unrelated navigations cannot consume the handoff', () => {
  const store = storage(); stage(store)
  for (const patch of [{ userId: null }, { accountId: null }, { token: null }, { token: 'other' }, { userId: 'other' }, { accountId: 'other' }]) {
    assert.equal(consumeStudioWriterHandoff({ ...identity, ...patch }, { storage: store, now: 1100 }), null)
  }
  assert.equal(consumeStudioWriterHandoff(identity, { storage: store, now: 1100 }), payload.text.trim())
})

test('expired and future handoffs cannot restore stale drafts', () => {
  for (const now of [0, 1000 + 10 * 60 * 1000 + 1]) {
    const store = storage(); stage(store)
    assert.equal(consumeStudioWriterHandoff(identity, { storage: store, now }), null)
  }
})

test('blocked or non-persisting browser storage selects the existing in-memory fallback', () => {
  for (const store of [null, { setItem() { throw Error('blocked') } }, { setItem() {}, getItem() { return null } }]) {
    assert.equal(stage(store), null)
  }
  assert.equal(stageStudioWriterHandoff({ ...payload, text: {} }, { storage: storage(), token: 'x' }), null)
})

test('a newer handoff replaces the old one without mixing text or identities', () => {
  const store = storage(); stage(store)
  stageStudioWriterHandoff({ ...payload, text: '새로 선택한 대본' }, { storage: store, now: 1050, token: 'new' })
  assert.equal(consumeStudioWriterHandoff(identity, { storage: store, now: 1100 }), null)
  assert.equal(consumeStudioWriterHandoff({ ...identity, token: 'new' }, { storage: store, now: 1100 }), '새로 선택한 대본')
})
