import test from 'node:test'
import assert from 'node:assert/strict'
import { ideaReply, ideaPrompt } from '../src/creator-tools/studio/ideas.js'

function fakeDb(tables) {
  return { tables, storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: `https://cdn.example.com/${p}` })), error: null }) }) },
    from(table) {
      const filters = []; let single = false, action = 'select', payload
      const api = { select() { return api }, order() { return api }, limit() { return api }, eq(k, v) { filters.push(r => r[k] === v); return api },
        maybeSingle() { single = true; return api }, update(p) { action = 'update'; payload = p; return api },
        then(resolve) {
          const rows = [...(tables[table] || [])].filter(r => filters.every(f => f(r)))
          if (action === 'update') { rows.forEach(r => Object.assign(r, payload)); return resolve({ data: null, error: null }) }
          resolve({ data: single ? rows[0] ?? null : rows, error: null })
        } }
      return api } }
}

test('topic cards are concrete, grounded and come with success reels from their field; a named subject is looked up first', async () => {
  const db = fakeDb({ creator_success_reels: [{ shortcode: 'Abcde1', username: 'a', views: 900000, thumbnail_path: 'a.jpg', category: '피부', visible: true, analysis_status: 'ready' }],
    studio_saved_topics: [{ user_id: 'u1', title: '이미 저장한 주제' }], studio_topics: [], studio_styles: [], studio_idea_threads: [{ id: 't1' }] })
  const calls = []
  const card = { title: '짜기 전에 10분 불리는 피지 관리', angle: '힘 대신 시간', promise: '자국 없이 정리', why: '후기에서 자국 걱정이 많다', evidence: ['구매자 후기'], materials: ['직접 써 본 순서'], category: '피부' }
  const makeProviders = () => ({ call: () => { throw new Error('no network in tests') }, json: async (op, instructions, input) => { calls.push({ op, input })
    return calls.length === 1 ? { lookup: '일소 피지연화제', category: '피부', cards: [], reply: '조사해 볼게요', chips: [] }
      : { lookup: '', category: '피부', cards: [card], reply: '이렇게 골라봤어요', chips: ['더 좁혀줘', '알아서 추천해주세요'] } } })
  const thread = { id: 't1', user_id: 'u1' }
  const reply = await ideaReply({ db, makeProviders }, thread, [{ role: 'user', content: '일소 피지연화제 소개하고 싶어' }], '일소 피지연화제 소개하고 싶어')
  assert.equal(calls.filter(c => c.op === 'studio-ideas').length, 2, 'a named subject is looked up, then 훅ai answers again')
  assert.deepEqual(calls[0].input.savedTopics, ['이미 저장한 주제'], 'saved topics go along so they are not proposed again')
  assert.equal(reply.meta.cards[0].title, card.title)
  assert.deepEqual(reply.meta.cards[0].reels.map(r => r.id), ['Abcde1'])
  assert.equal(reply.category, '피부')
  assert.match(ideaPrompt, /구체적인 주제란/)
  for (const word of ['피지', '선크림', '냉동만두']) assert.ok(!ideaPrompt.includes(word), word)
})
