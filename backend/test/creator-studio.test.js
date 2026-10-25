import test from 'node:test'
import assert from 'node:assert/strict'
import { studio2Enabled } from '../src/creator-tools/studio/access.js'
import { resolveSources, generateStage, formulaFromSession, chat, startStage, answerAsk } from '../src/creator-tools/studio/engine.js'
import { HOOK_LIBRARY, STRUCTURE_LIBRARY } from '../src/creator-tools/studio/library.js'
import { STORY_FORMATS } from '../src/creator-tools/success-reel-analysis.js'

const analysis = {
  overview: { summary: '약사가 연고를 판정', topic: '여드름 흉터 연고' },
  hook: { category: '순위·평가', formula: '[주제] [전문가]가 안 사요/사요로 판정', spokenHook: '안 사요. 너무 약해요.', visualHook: '안 사요 | 사요 판정판', analysis: '이분법 판정' },
  structure: { category: '비교·평가', description: '제품마다 판정', steps: [{ role: 'hook', quote: '안 사요', purpose: '판정 선언' }, { role: 'evidence', quote: '효과가 약해서', purpose: '근거' }], analysis: '리듬' },
  filming: { location: '약국', shotType: '정면', onScreen: '약사', textOverlay: '상단 판정판', editing: '점프컷', guide: ['정면'] },
  caption: null, durationSeconds: 38,
}
function fakeDb() {
  const tables = { creator_success_reels: new Map([['Aaaaa1', { shortcode: 'Aaaaa1', username: 'yaksa', caption: '', views: 100, analysis, analysis_status: 'ready', category: '피부', visible: true }]]),
    studio_formulas: new Map([['f1', { id: 'f1', user_id: 'u1', kind: 'hook', title: '내 훅', spec: { type: '경고', formula: '[대상]은 [행동] 하지 마세요' } }]]),
    studio_sessions: new Map(), studio_topics: new Map(), studio_messages: new Map() }
  const updates = []
  return { tables, updates, from(table) {
    const filters = []; let action = 'select', payload, single = false
    const api = { select() { return api }, eq(k, v) { filters.push(r => r[k] === v); return api }, order() { return api }, limit() { return api },
      maybeSingle() { single = true; return api }, single() { single = true; return api }, update(p) { action = 'update'; payload = p; return api }, insert(p) { action = 'insert'; payload = p; return api },
      then(resolve) {
        const rows = [...tables[table].values()].filter(r => filters.every(f => f(r)))
        if (action === 'insert') { const row = { id: `m${tables[table].size + 1}`, ...payload }; tables[table].set(row.id, row); return resolve({ data: row, error: null }) }
        if (action === 'update') { rows.forEach(r => Object.assign(r, payload)); updates.push([table, payload]); return resolve({ data: null, error: null }) }
        resolve({ data: single ? rows[0] ?? null : rows, error: null })
      } }
    return api } }
}

test('studio 2 is visible only to listed users', () => {
  assert.equal(studio2Enabled('15c6e788-7d77-4954-be5d-200c2c410dad', {}), true)
  assert.equal(studio2Enabled('someone-else', {}), false)
  assert.equal(studio2Enabled('someone-else', { CREATOR_STUDIO2_USER_IDS: 'someone-else' }), true)
  assert.equal(studio2Enabled('x', { CREATOR_STUDIO2_ENABLED: 'true' }), true)
})

test('slot sources resolve to excerpts from reels, formulas and the library', async () => {
  const db = fakeDb()
  const resolved = await resolveSources(db, 'u1', { hook: { kind: 'reel', id: 'Aaaaa1' }, structure: { kind: 'library', id: 'list' }, filming: { kind: 'reel', id: 'Aaaaa1' }, caption: { kind: 'formula', id: 'f1' } })
  assert.equal(resolved.hook.excerpt.formula, analysis.hook.formula)
  assert.equal(resolved.hook.label, '@yaksa')
  assert.deepEqual(resolved.structure.excerpt.format, '리스트')
  assert.equal(resolved.filming.excerpt.textOverlay, '상단 판정판')
  assert.equal(resolved.caption.excerpt.type, '경고')
  await assert.rejects(resolveSources(db, 'u2', { hook: { kind: 'formula', id: 'f1' } }), /저장한 공식/)
  await assert.rejects(resolveSources(db, 'u1', { hook: { kind: 'reel', id: 'Nope' } }), /분석이 끝나지/)
})

test('stage generation normalizes 훅ai output and keeps placeholders', async () => {
  const db = fakeDb()
  const calls = []
  const session = { id: 's1', user_id: 'u1', mode: 'single', brief: '선크림 3개 비교', sources: { hook: { kind: 'reel', id: 'Aaaaa1' }, structure: { kind: 'reel', id: 'Aaaaa1' } },
    topic: { title: '지성 피부 선크림 3개 판정', facts: ['백탁 없음'], category: '피부' }, thumbnail: { options: [{ text: '선크림 안 사요 사요' }], chosen: 0 }, hook: { options: [{ spoken: '안 사요. 번들거리면 끝.' }], chosen: 0 } }
  const makeProviders = () => ({ json: async (op, _i, input, _f, schema) => { calls.push({ op, input, schema })
    return { options: [{ label: '판정으로 설득', why: '빠름', lines: [{ part: 'hook', spoken: '안 사요. 번들거리면 끝.', onScreen: '안 사요', seconds: 3 }, { part: 'body', spoken: '[제품 A]? 안 사요.', onScreen: '', seconds: 500 }, { part: 'weird', spoken: '', onScreen: '', seconds: 2 }] }], placeholders: ['[제품 A]', ''] } } })
  const { value, placeholders } = await generateStage({ db, makeProviders }, session, 'script')
  assert.equal(calls[0].op, 'studio-script')
  assert.equal(calls[0].input.sources.hook.formula, analysis.hook.formula)
  assert.equal(calls[0].input.hook.spoken, '안 사요. 번들거리면 끝.')
  assert.deepEqual(value.options[0].lines.map(l => [l.part, l.seconds]), [['hook', 3], ['body', 180]])
  assert.deepEqual(placeholders, ['[제품 A]'])
  assert.ok(calls[0].schema.required.includes('options'))
})

test('startStage runs a background job once and records failures on the session', async () => {
  const db = fakeDb()
  db.tables.studio_sessions.set('s1', { id: 's1', user_id: 'u1', mode: 'topic', sources: {}, stage: 'topic', topic: { title: 't' }, job_status: 'idle', placeholders: [] })
  const ran = [], jobs = []
  const deps = { db, makeProviders: () => ({ json: async () => { throw Object.assign(new Error('모델 응답 없음'), { exposeMessage: true }) } }), schedule: (key, task) => { ran.push(key); const p = task(); jobs.push(p); return p } }
  const session = await startStage(deps, db.tables.studio_sessions.get('s1'), 'hook')
  await Promise.all(jobs)
  assert.equal(session.stage, 'hook')
  assert.deepEqual(ran, ['studio:s1:hook'])
  assert.equal(db.tables.studio_sessions.get('s1').job_status, 'failed')
  assert.equal(db.tables.studio_sessions.get('s1').job_error, '모델 응답 없음')
  await assert.rejects(startStage(deps, { ...session, topic: null }, 'hook'), /주제를 정해/)
})

test('topic chat returns chips, proposals and a ready topic; revise chat returns proposals', async () => {
  const db = fakeDb()
  const session = { id: 's1', user_id: 'u1', mode: 'topic', sources: {}, stage: 'topic', brief: '' }
  const makeProviders = () => ({ json: async (op, _i, input) => op === 'studio-topic'
    ? { reply: '어떤 분야를 다루고 싶으세요?', chips: ['피부', '먹방', '그냥 알아서 해주세요'], proposals: [{ title: '선크림 3개 판정', angle: '지성 기준', promise: '안 밀리는 선크림', why: '판정형이 터지는 중', category: '피부' }], topic: { ready: false, title: '', angle: '', promise: '', facts: [], audience: '', category: '' } }
    : { reply: '더 짧게 줄였어요.', chips: ['더 친근하게'], proposal: { has: true, summary: '두 줄 삭제', text: '', onScreen: '', lines: [{ part: 'hook', spoken: '안 사요.', onScreen: '', seconds: 2 }, { part: 'cta', spoken: '팔로우.', onScreen: '', seconds: 2 }], hashtags: [] } } })
  const reply = await chat({ db, makeProviders }, session, [], '주제 제안해줘')
  assert.equal(reply.meta.chips.at(-1), '그냥 알아서 해주세요')
  assert.equal(reply.meta.proposals[0].category, '피부')
  assert.equal(reply.meta.topic, null)
  const revised = await chat({ db, makeProviders }, { ...session, stage: 'script', topic: { title: 't' }, script: { options: [{ lines: [] }], chosen: 0 } }, [], '더 짧게')
  assert.equal(revised.meta.proposal.stage, 'script')
  assert.equal(revised.meta.proposal.lines.length, 2)
})

test('formulas are saved as structure, and the library matches analysis categories', () => {
  const session = { topic: { title: '선크림 판정' }, hook: { options: [{ spoken: '안 사요. 번들거리면 끝.', onScreen: '안 사요', type: '손실 회피' }], chosen: 0 },
    script: { options: [{ label: '판정으로 설득', lines: [{ part: 'hook', spoken: 'a', onScreen: 'x', seconds: 3 }, { part: 'body', spoken: 'b', onScreen: '', seconds: 5 }] }], chosen: 0, edited: null } }
  const hook = formulaFromSession(session, { hook: { excerpt: { type: '손실 회피', formula: '[주제] 판정' } } }, 'hook')
  assert.equal(hook.spec.formula, '[주제] 판정')
  assert.equal(formulaFromSession(session, { hook: { excerpt: { type: '질문형', formula: '[주제] 해본 적 있죠?' } } }, 'hook').spec.formula, '', 'a different hook device does not inherit the source formula')
  assert.equal(hook.spec.type, '손실 회피')
  const structure = formulaFromSession(session, {}, 'structure')
  assert.deepEqual(structure.spec.segments, [['첫 문장', '3초 · x'], ['본문', '5초 · 자막 없음']])
  assert.equal(structure.spec.totalSeconds, 8)
  assert.equal(formulaFromSession(session, {}, 'caption'), null)
  for (const s of STRUCTURE_LIBRARY) assert.ok(STORY_FORMATS.includes(s.format), s.format)
  assert.equal(new Set(HOOK_LIBRARY.map(h => h.id)).size, HOOK_LIBRARY.length)
})

test('a stage that needs facts asks first, then resumes with the answers as facts', async () => {
  const db = fakeDb()
  db.tables.studio_sessions.set('s1', { id: 's1', user_id: 'u1', mode: 'topic', sources: {}, stage: 'script', topic: { title: '선크림 3개 판정', facts: [] }, hook: { options: [{ spoken: 'x' }], chosen: 0 }, job_status: 'idle', placeholders: [], ask: null })
  let calls = 0
  const jobs = []
  const deps = { db, schedule: (_k, task) => { const p = task(); jobs.push(p); return p }, makeProviders: () => ({ json: async () => { calls += 1
    return calls === 1 ? { questions: [{ key: 'products', question: '비교할 선크림 3개의 제품명을 알려주세요.', chips: ['이름 없이 1·2·3번으로'] }, { key: 'best', question: '제일 좋았던 제품과 이유는요?', chips: [] }], options: [], placeholders: [] }
      : { questions: [], options: [{ label: '판정', why: 'w', lines: [{ part: 'hook', spoken: '안 사요.', onScreen: '', seconds: 3 }, { part: 'body', spoken: '라운드랩? 사요.', onScreen: '', seconds: 5 }] }], placeholders: [] } } }) }
  await startStage(deps, db.tables.studio_sessions.get('s1'), 'script', { force: true }); await Promise.all(jobs)
  const parked = db.tables.studio_sessions.get('s1')
  assert.equal(parked.job_status, 'idle'); assert.equal(parked.script, undefined)
  assert.equal(parked.ask.index, 0); assert.equal(parked.ask.questions.length, 2)
  assert.equal([...db.tables.studio_messages.values()][0].content, '비교할 선크림 3개의 제품명을 알려주세요.')
  const first = await answerAsk(deps, parked, '라운드랩, 비플레인, 닥터지')
  assert.equal(first.resumed, false); assert.equal(first.reply.content, '제일 좋았던 제품과 이유는요?')
  assert.deepEqual(db.tables.studio_sessions.get('s1').topic.facts, ['products: 라운드랩, 비플레인, 닥터지'])
  const second = await answerAsk(deps, db.tables.studio_sessions.get('s1'), '라운드랩, 백탁이 없어서'); await Promise.all(jobs)
  assert.equal(second.resumed, true)
  const done = db.tables.studio_sessions.get('s1')
  assert.equal(done.ask, null); assert.equal(done.script.options[0].lines[1].spoken, '라운드랩? 사요.')
  assert.equal(done.topic.facts.length, 2)
})
