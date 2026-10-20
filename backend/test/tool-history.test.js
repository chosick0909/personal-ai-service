import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createToolHistoryRouter } from '../src/lib/tool-history.js'

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
// Query adapter applies actual route filters, including atomic version predicate.
function memoryDb() {
  const rows = []
  let fail = false
  return { rows, set fail(value) { fail = value }, from(table) {
    let operation = 'read', payload, filters = [], single = false
    const q = {
      select() { return q }, eq(key, value) { filters.push(row => row[key] === value); return q },
      order() { return q }, limit() { return q }, maybeSingle() { single = true; return q },
      upsert(value) { operation = 'insert'; payload = value; return q },
      update(value) { operation = 'update'; payload = value; return q },
      delete() { operation = 'delete'; return q },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (fail) return { error: new Error('database unavailable') }
          if (table === 'projects') return { data: null }
          if (operation === 'insert' && !rows.some(row => row.id === payload.id)) {
            rows.push({ ...structuredClone(payload), version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          }
          const matching = rows.filter(row => filters.every(match => match(row)))
          if (operation === 'update') matching.forEach(row => Object.assign(row, payload))
          if (operation === 'delete') matching.forEach(row => rows.splice(rows.indexOf(row), 1))
          return { data: structuredClone(single ? matching[0] || null : matching) }
        }).then(resolve, reject)
      },
    }
    return q
  } }
}

async function fixture(t) {
  const db = memoryDb()
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => { req.auth = { userId: req.headers['x-user'] || 'user-a' }; next() })
  app.use('/api', createToolHistoryRouter({ getDb: () => db,
    assertAccess: async ({ userId }) => { if (userId === 'expired') throw Object.assign(new Error('expired'), { statusCode: 403 }) },
    resolveAccount: async req => {
      const account = req.headers['x-account-id'] || 'account-a'
      if (account === 'not-owned') throw Object.assign(new Error('not owned'), { statusCode: 403 })
      return { id: account }
    },
  }))
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = async (method, path = '', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tool-history${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, ...await response.json() }
  }
  return { db, request }
}
const caption = (n = 1) => ({ id: id(n), kind: 'caption', input: { topic: '살림 팁', captionA: 'A', captionB: 'B' }, result: { caption: '완성된 캡션', hashtags: ['살림'] } })

test('caption and thumbnail persist inputs/results and list; deletion is scoped', async t => {
  const { request } = await fixture(t)
  assert.equal((await request('POST', '', caption())).status, 201)
  const thumbnail = { id: id(2), kind: 'thumbnail', input: { topic: '제목', imageAnalysis: { summary: '이미지 분석' } }, result: { recommendations: [{ title: '추천 제목' }] } }
  assert.equal((await request('POST', '', thumbnail)).status, 201)
  const list = await request('GET')
  assert.equal(list.items.length, 2)
  assert.deepEqual(list.items[1].input, thumbnail.input)
  assert.deepEqual(list.items[1].result, thumbnail.result)
  await request('DELETE', `/${id(2)}`)
  assert.equal((await request('GET')).items.length, 1)
})
test('same request replay preserves manual edit; JSON property order is immaterial', async t => {
  const { request } = await fixture(t)
  await request('POST', '', caption())
  const edited = await request('PATCH', `/${id(1)}`, { version: 1, editedCaption: '직접 고친 캡션' })
  assert.equal(edited.item.version, 2)
  const replay = caption(); replay.input = { captionB: 'B', captionA: 'A', topic: '살림 팁' }
  const response = await request('POST', '', replay)
  assert.equal(response.status, 200)
  assert.equal(response.item.edited_caption, '직접 고친 캡션')
  assert.equal(response.item.version, 2)
  replay.result.caption = '다른 결과'
  assert.equal((await request('POST', '', replay)).status, 409)
})
test('concurrent creation/replay does not duplicate, concurrent edits reject stale version', async t => {
  const { request } = await fixture(t)
  await Promise.all([request('POST', '', caption()), request('POST', '', caption())])
  assert.equal((await request('GET')).items.length, 1)
  const edits = await Promise.all(['수정1', '수정2'].map(editedCaption => request('PATCH', `/${id(1)}`, { version: 1, editedCaption })))
  assert.deepEqual(edits.map(x => x.status).sort(), [200, 409])
})
test('user/account isolation applies to list, edit, delete and insert replay', async t => {
  const { request } = await fixture(t)
  await request('POST', '', caption())
  for (const headers of [{ 'x-user': 'user-b' }, { 'x-account-id': 'account-b' }]) {
    assert.deepEqual((await request('GET', '', null, headers)).items, [])
    assert.equal((await request('PATCH', `/${id(1)}`, { version: 1, editedCaption: '공격' }, headers)).status, 409)
    assert.equal((await request('POST', '', caption(), headers)).status, 409)
    await request('DELETE', `/${id(1)}`, null, headers)
  }
  assert.equal((await request('GET')).items[0].edited_caption, '완성된 캡션')
})
test('invalid payload/project/access fail without writes; database error is explicit', async t => {
  const { request, db } = await fixture(t)
  assert.equal((await request('POST', '', { ...caption(), result: {} })).status, 400)
  assert.equal((await request('POST', '', { ...caption(), projectId: id(55) })).status, 404)
  assert.equal((await request('GET', '', null, { 'x-user': 'expired' })).status, 403)
  assert.equal((await request('POST', '', caption(), { 'x-account-id': 'not-owned' })).status, 403)
  assert.equal(db.rows.length, 0)
  db.fail = true
  assert.equal((await request('GET')).status, 503)
})
