import test from 'node:test'
import assert from 'node:assert/strict'
import { ideaReply, ideaPrompt, matchReels } from '../src/creator-tools/studio/ideas.js'

function fakeDb(tables) {
  return { tables, storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: `https://cdn.example.com/${p}` })), error: null }) }) },
    from(table) {
      const filters = []; let single = false, action = 'select', payload
      const api = { select() { return api }, order() { return api }, limit() { return api }, or() { return api }, eq(k, v) { filters.push(r => r[k] === v); return api }, neq(k, v) { filters.push(r => r[k] !== v); return api },
        maybeSingle() { single = true; return api }, update(p) { action = 'update'; payload = p; return api },
        then(resolve) {
          const rows = [...(tables[table] || [])].filter(r => filters.every(f => f(r)))
          if (action === 'update') { rows.forEach(r => Object.assign(r, payload)); return resolve({ data: null, error: null }) }
          resolve({ data: single ? rows[0] ?? null : rows, error: null })
        } }
      return api } }
}

test('topic cards are concrete, grounded and come with success reels on their subject; a named subject is looked up first', async () => {
  const reel = (shortcode, views, topic, caption = '') => ({ shortcode, username: 'a', views, thumbnail_path: `${shortcode}.jpg`, category: '피부', visible: true, analysis_status: 'ready', topic, caption })
  const db = fakeDb({ creator_success_reels: [reel('Top999', 5000000, '세안 후 보습 순서'), reel('Abcde1', 900000, '피지 연화제로 블랙헤드 녹이기', '#피지 #블랙헤드')],
    studio_saved_topics: [{ user_id: 'u1', title: '이미 저장한 주제' }], studio_topics: [], studio_styles: [], studio_idea_threads: [{ id: 't1' }] })
  const calls = []
  const card = { title: '짜기 전에 10분 불리는 피지 관리', angle: '힘 대신 시간', promise: '자국 없이 정리', why: '후기에서 자국 걱정이 많다', evidence: ['구매자 후기'], materials: ['직접 써 본 순서'], keywords: ['피지', '블랙헤드', '연화제'], category: '피부' }
  const makeProviders = () => ({ call: () => { throw new Error('no network in tests') }, json: async (op, instructions, input) => { calls.push({ op, input })
    return calls.length === 1 ? { lookup: '일소 피지연화제', category: '피부', cards: [], reply: '조사해 볼게요', chips: [] }
      : { lookup: '', category: '피부', cards: [card], reply: '이렇게 골라봤어요', chips: ['더 좁혀줘', '알아서 추천해주세요'] } } })
  const thread = { id: 't1', user_id: 'u1' }
  const reply = await ideaReply({ db, makeProviders }, thread, [{ role: 'user', content: '일소 피지연화제 소개하고 싶어' }], '일소 피지연화제 소개하고 싶어')
  assert.equal(calls.filter(c => c.op === 'studio-ideas').length, 2, 'a named subject is looked up, then 훅ai answers again')
  assert.deepEqual(calls[0].input.savedTopics, ['이미 저장한 주제'], 'saved topics go along so they are not proposed again')
  assert.equal(reply.meta.cards[0].title, card.title)
  assert.deepEqual(reply.meta.cards[0].reels.map(r => r.id), ['Abcde1'], 'the most viewed reel of the field is on another subject and is not shown')
  assert.equal(reply.category, '피부')
  assert.match(ideaPrompt, /구체적인 주제란/)
  for (const word of ['피지', '선크림', '냉동만두']) assert.ok(!ideaPrompt.includes(word), word)
})

test('reels match a card on at least two of its keywords, what they are about first, and never fall back to another subject', () => {
  const pool = [
    { shortcode: 'kitchen', views: 2000000, topic: '주방 조명·인덕션 교체', caption: '' },
    { shortcode: 'egg1', views: 4900000, topic: '다이어트 중 떡볶이 대체 계란볶이 레시피', caption: '' },
    { shortcode: 'egg2', views: 7000000, topic: '전자레인지 계란밥', caption: '#다이어트 #레시피' },
    { shortcode: 'egg3', views: 9000000, topic: '자취 요리 모음', caption: '계란 하나로' },
  ]
  assert.deepEqual(matchReels(pool, ['계란', '다이어트', '레시피']).map(r => r.shortcode), ['egg1', 'egg2'], 'more keywords in the topic rank first; one keyword is not enough')
  assert.deepEqual(matchReels(pool, ['촬영장비', '조명', '삼각대']), [], 'a single shared word does not make a reel about the subject')
  assert.equal(matchReels(pool, [], 5).length, 0)
})
