import test from 'node:test'
import { COVER_PRINCIPLE_NAMES } from '../src/creator-tools/studio/copy-principles.js'
import { ungroundedQuotes } from '../src/creator-tools/studio/engine.js'
import { sessionHistory } from '../src/creator-tools/studio/routes.js'
import { formulaFromReel } from '../src/creator-tools/studio/engine.js'
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
    const api = { select() { return api }, eq(k, v) { filters.push(r => r[k] === v); return api }, not(k, op, v) { filters.push(r => !(op === 'is' && (r[k] ?? null) === v)); return api }, order() { return api }, limit() { return api },
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
  assert.equal(resolved.filming.excerpt.filming.shotType, '정면')
  assert.equal(resolved.filming.excerpt.editing.subtitleStyle, '상단 판정판', 'older analyses map textOverlay to editing')
  assert.equal(resolved.caption.excerpt.type, '경고')
  await assert.rejects(resolveSources(db, 'u2', { hook: { kind: 'formula', id: 'f1' } }), /저장한 공식/)
  await assert.rejects(resolveSources(db, 'u1', { hook: { kind: 'reel', id: 'Nope' } }), /찾을 수 없어요/)
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
  assert.deepEqual(value.options[0].lines.map(l => [l.part, l.seconds]), [['hook', 3], ['body', 2]], 'seconds come from the words, not the model guess')
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
  db.tables.studio_sessions.set('s1', { id: 's1', user_id: 'u1', mode: 'topic', sources: {}, stage: 'script', topic: { title: '선크림 3개 판정', facts: [], research: { subject: '', facts: [], viewerQuestions: [], avoid: [], sources: [] }, categoryChecked: true }, hook: { options: [{ spoken: 'x' }], chosen: 0 }, job_status: 'idle', placeholders: [], ask: null })
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
  assert.deepEqual(done.topic.askedStages, ['script'])
  // A later stage never asks again, even if 훅ai tries: the open points become its own call and it drafts.
  let later = 0
  const stubborn = { ...deps, makeProviders: () => ({ json: async (_op, instructions) => { later += 1
    assert.ok(instructions.includes('이번에는 질문하지 않습니다'), 'the second round is told not to ask')
    return later === 1 ? { questions: [{ key: 'audience', question: '누구에게 보여줄 영상인가요?', chips: [] }], options: [], placeholders: [] }
      : { questions: [], options: [{ text: '캡션', hashtags: ['a'], why: 'w' }], placeholders: [] } } }) }
  await startStage(stubborn, db.tables.studio_sessions.get('s1'), 'caption', { force: true }); await Promise.all(jobs)
  const captioned = db.tables.studio_sessions.get('s1')
  assert.equal(captioned.ask, null); assert.equal(later, 2); assert.equal(captioned.caption.options[0].text, '캡션')
})

test('"알아서 해주세요" ends the questions and 훅ai drafts with what it has', async () => {
  const db = fakeDb()
  db.tables.studio_sessions.set('s2', { id: 's2', user_id: 'u1', mode: 'topic', sources: {}, stage: 'script', topic: { title: '선크림 3개 판정', facts: [], askedStages: ['script'] }, hook: { options: [{ spoken: 'x' }], chosen: 0 }, job_status: 'idle', placeholders: [],
    ask: { stage: 'script', index: 0, questions: [{ key: 'products', question: '제품명은요?', chips: ['알아서 해주세요'] }, { key: 'best', question: '제일 좋았던 건요?', chips: [] }] } })
  const jobs = []
  const deps = { db, schedule: (_k, task) => { const p = task(); jobs.push(p); return p }, makeProviders: () => ({ json: async (_op, instructions) => {
    assert.ok(instructions.includes('이번에는 질문하지 않습니다'))
    return { questions: [], options: [{ label: '판정', why: 'w', lines: [{ part: 'hook', spoken: '안 사요.', onScreen: '', seconds: 3 }, { part: 'body', spoken: '첫 번째 제품? 사요.', onScreen: '', seconds: 5 }] }], placeholders: [] } } }) }
  const reply = await answerAsk(deps, db.tables.studio_sessions.get('s2'), '그냥 알아서 해줘'); await Promise.all(jobs)
  assert.equal(reply.resumed, true, 'the second question is skipped')
  const done = db.tables.studio_sessions.get('s2')
  assert.equal(done.topic.delegated, true); assert.equal(done.ask, null)
  assert.deepEqual(done.topic.facts, ['products: 훅ai 재량(수강생이 맡김) — 그냥 알아서 해줘', 'best: 훅ai 재량(수강생이 맡김)'])
  assert.equal(done.script.options[0].lines[1].spoken, '첫 번째 제품? 사요.')
})

test('switching or restoring a script keeps the replaced version in a short history', () => {
  const { remember, currentScript, currentCaption, optionName } = sessionHistory
  const script = { chosen: 1, options: [{ lines: [{ spoken: 'A' }] }, { lines: [{ spoken: 'B' }] }], history: [] }
  assert.deepEqual(currentScript(script), [{ spoken: 'B' }])
  assert.deepEqual(currentScript({ ...script, edited: [{ spoken: 'B2' }] }), [{ spoken: 'B2' }])
  const history = remember(script, currentScript(script), optionName(1))
  assert.equal(history.length, 1); assert.equal(history[0].note, 'B안'); assert.deepEqual(history[0].value, [{ spoken: 'B' }])
  assert.equal(remember({ history: Array.from({ length: 10 }, (_, i) => ({ note: String(i) })) }, [{ spoken: 'x' }], 'n').length, 10, 'ten deep')
  assert.deepEqual(remember(script, null, 'n'), [], 'nothing to keep when there is no current value')
  assert.deepEqual(currentCaption({ chosen: 0, options: [{ text: 'c', hashtags: ['a'] }] }), { text: 'c', hashtags: ['a'] })
  assert.equal(optionName(2), 'C안'); assert.equal(optionName(3), '4안')
})

test('a reel analysis saves as 내 공식 in the same shapes a plan produces', () => {
  const reel = { shortcode: 'Aaaaa1', username: 'yaksa', caption: '안 사요 사요\n#약국', analysis }
  const hook = formulaFromReel(reel, 'hook')
  assert.equal(hook.spec.formula, analysis.hook.formula); assert.deepEqual(hook.source, { shortcode: 'Aaaaa1', username: 'yaksa' })
  assert.ok(formulaFromReel(reel, 'structure').spec.segments.length >= 1)
  assert.equal(formulaFromReel(reel, 'caption').title.startsWith('캡션: 안 사요 사요'), true)
  assert.equal(formulaFromReel({ shortcode: 'x', analysis: null }, 'hook'), null)
})

test('a student\'s own uploaded reel is a valid source once analyzed; unanalyzed reels are refused', async () => {
  const db = fakeDb()
  db.tables.creator_success_reels.set('Mine01', { shortcode: 'Mine01', username: 'up_u1', caption: '', views: 0, analysis, analysis_status: 'ready', category: '기타', visible: false, owner_user_id: 'u1' })
  db.tables.creator_success_reels.set('Wait01', { shortcode: 'Wait01', username: 'x', caption: '', views: 1, analysis: null, analysis_status: 'running', category: '기타', visible: true })
  const resolved = await resolveSources(db, 'u1', { hook: { kind: 'reel', id: 'Mine01' } })
  assert.equal(resolved.hook.label, '@up_u1')
  await assert.rejects(resolveSources(db, 'u2', { hook: { kind: 'reel', id: 'Mine01' } }), /찾을 수 없어요/)
  await assert.rejects(resolveSources(db, 'u1', { hook: { kind: 'reel', id: 'Wait01' } }), /분석이 끝나지/)
})

test('thumbnail copies are 훅ai\'s own copywriting from the topic: no reference is sent, each option names its principle', async () => {
  const db = fakeDb()
  const session = { id: 's9', user_id: 'u1', mode: 'single', sources: { hook: { kind: 'reel', id: 'Aaaaa1' } }, brief: '쿠팡 냉동만두', topic: { title: '쿠팡 냉동만두', facts: [], category: '요리' }, placeholders: [] }
  let seen = '', input = null
  const deps = { db, makeProviders: () => ({ json: async (_op, instructions, context) => { seen = instructions; input = context
    return { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, plan: { reader: '퇴근 후 저녁이 급한 사람', promise: '5분 저녁 해결' }, options: [{ label: '내 얘기 장면', text: 'a', why: 'w' }, { label: '결과 약속', text: 'b', why: 'w' }, { label: '없는 원칙', text: 'c', why: 'w' }], placeholders: [] } } }) }
  db.tables.creator_success_reels.set('C1', { shortcode: 'C1', recommended: true, cover_title: '다른 분야 커버', category: '살림' })
  db.tables.creator_success_reels.set('C2', { shortcode: 'C2', recommended: true, cover_title: '같은 분야 커버', category: '요리' })
  db.tables.creator_success_reels.set('C3', { shortcode: 'C3', recommended: false, cover_title: '추천 아님', category: '요리' })
  const { value } = await generateStage(deps, session, 'thumbnail')
  assert.deepEqual(input.sources, {}, 'the reference is not sent to the thumbnail stage')
  assert.deepEqual(input.successCovers, ['같은 분야 커버', '다른 분야 커버'], 'proven 추천 covers go along as examples, same field first')
  for (const name of COVER_PRINCIPLE_NAMES) assert.ok(seen.includes(name), name)
  // Principles, not patches: no topic-specific wording or sample sentences in the shared prompts.
  for (const word of ['냉동만두', '방송사고', '쇼호스트', '완판', '선크림']) assert.ok(!seen.includes(word), word)
  assert.deepEqual(value.options.map(o => o.label), ['내 얘기 장면', '결과 약속', ''])
  assert.ok(value.options[0].hint && value.options[2].hint === '')
  assert.deepEqual(value.plan, { terms: [], purpose: '', reader: '퇴근 후 저녁이 급한 사람', promise: '5분 저녁 해결' })
})

test('a draft whose self-check finds reference traces or unprovided facts is rewritten once', async () => {
  const db = fakeDb()
  const session = { id: 's10', user_id: 'u1', mode: 'single', sources: {}, brief: '소재', topic: { title: '소재', facts: [], category: '기타', research: { subject: '', facts: [], viewerQuestions: [], avoid: [], sources: [] }, categoryChecked: true }, placeholders: [] }
  const prompts = []
  const deps = { db, makeProviders: () => ({ json: async (_op, instructions) => { prompts.push(instructions)
    return prompts.length === 1
      ? { questions: [], check: { referenceTraces: ['레퍼런스 장면'], unprovidedFacts: ['지어낸 성과'] }, plan: { reader: 'r', promise: 'p' }, options: [{ label: '결과 약속', text: '첫 초안', why: 'w' }], placeholders: [] }
      : { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, plan: { reader: 'r', promise: 'p' }, options: [{ label: '결과 약속', text: '고친 안', why: 'w' }], placeholders: [] } } }) }
  const { value } = await generateStage(deps, session, 'thumbnail')
  assert.equal(prompts.length, 2); assert.ok(prompts[1].includes('레퍼런스 장면') && prompts[1].includes('지어낸 성과'))
  assert.equal(value.options[0].text, '고친 안')
})

test('a thumbnail draft that quotes words the student never wrote is rewritten from the original words', async () => {
  const db = fakeDb()
  const session = { id: 's11', user_id: 'u1', mode: 'single', sources: {}, brief: '쿠팡 냉동만두 세일즈', topic: { title: '쿠팡 냉동만두 세일즈', facts: ['세일 기간'], category: '요리' }, placeholders: [] }
  const prompts = []
  const deps = { db, makeProviders: () => ({ json: async (_op, instructions) => { prompts.push(instructions)
    return prompts.length === 1
      ? { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, plan: { terms: [{ word: '세일', meaning: '할인' }], purpose: 'x', reader: 'r', promise: 'p', quotes: ['쿠팡 냉동만두 세일즈'] }, options: [{ label: '결과 약속', text: '첫 초안', why: 'w' }], placeholders: [] }
      : { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, plan: { terms: [{ word: '세일즈', meaning: '파는 일' }], purpose: '냉동만두를 파는 영상', reader: 'r', promise: 'p', quotes: ['쿠팡 냉동만두 세일즈'] }, options: [{ label: '결과 약속', text: '고친 안', why: 'w' }], placeholders: [] } } }) }
  const { value } = await generateStage(deps, session, 'thumbnail')
  assert.equal(prompts.length, 2, 'the ungrounded quote triggers one rewrite')
  assert.ok(prompts[1].includes('"세일"'), 'a key word cut out of a longer word is flagged')
  assert.deepEqual(value.plan.terms, [{ word: '세일즈', meaning: '파는 일' }])
  assert.equal(value.options[0].text, '고친 안')
  assert.deepEqual(ungroundedQuotes(session, ['쿠팡 냉동만두 세일즈', '냉동 만두', '냉동만두 세일', '세일 기간']), ['냉동만두 세일', '세일 기간'], 'spacing is ignored; a quote that stops mid-word or comes from 훅ai\'s own facts is not the student\'s words')
  assert.deepEqual(ungroundedQuotes({ brief: '냉동만두를 팔아요' }, ['냉동만두']), [], 'a particle after the quote is fine')
})

test('a chat revision is written before it is described, and one that misses a student\'s condition is rewritten once', async () => {
  const db = fakeDb()
  const calls = []
  const draft = (text, met) => ({ proposal: { has: true, text, onScreen: '', lines: [], hashtags: [], requests: [{ condition: '단어는 한 번만', evidence: text, met }], summary: 's' }, reply: 'r', chips: [] })
  const makeProviders = () => ({ json: async (op, instructions, _input, _frames, schema) => { calls.push({ instructions, schema }); return calls.length === 1 ? draft('첫 결과', false) : draft('고친 결과', true) } })
  const session = { id: 's1', user_id: 'u1', mode: 'single', sources: {}, stage: 'thumbnail', brief: 'b', topic: { title: 't' }, thumbnail: { options: [{ text: 'a' }], chosen: 0 } }
  const revised = await chat({ db, makeProviders }, session, [], '그 단어는 한 번만 써줘')
  assert.equal(calls.length, 2)
  assert.match(calls[1].instructions, /단어는 한 번만/)
  assert.equal(revised.meta.proposal.text, '고친 결과')
  assert.deepEqual(Object.keys(calls[0].schema.properties), ['proposal', 'reply', 'chips'], 'the reply is written after the revision')
  const p = Object.keys(calls[0].schema.properties.proposal.properties)
  assert.ok(p.indexOf('requests') > p.indexOf('text') && p.indexOf('summary') > p.indexOf('requests'), 'the check reads the finished text')
})

test('first lines and scripts are written by the script principles, with the formulas success reels proved, and a line viewers would swipe on is rewritten', async () => {
  const { SCRIPT_PRINCIPLES, HOOK_PRINCIPLES } = await import('../src/creator-tools/studio/copy-principles.js')
  const db = fakeDb()
  const calls = []
  const line = (part, spoken) => ({ part, spoken, onScreen: '', seconds: 3 })
  const draft = risks => ({ questions: [], check: { referenceTraces: [], unprovidedFacts: [], swipeRisks: risks }, options: [{ label: 'a', why: 'w', lines: [line('hook', '첫 줄'), line('body', '둘째 줄'), line('cta', '끝')] }], placeholders: [] })
  const deps = { db, makeProviders: () => ({ json: async (_op, instructions, input) => { calls.push({ instructions, input }); return calls.length === 1 ? draft(['쓰는 모습 보여드릴게요: 예고만 함']) : draft([]) } }) }
  const session = { id: 's1', user_id: 'u1', mode: 'topic', sources: {}, brief: 'b', topic: { title: 't', facts: [], category: '피부' }, hook: { options: [{ spoken: '첫 줄' }], chosen: 0 }, placeholders: [] }
  const { value } = await generateStage(deps, session, 'script')
  for (const p of SCRIPT_PRINCIPLES) assert.ok(calls[0].instructions.includes(p.name), p.name)
  assert.ok(calls[0].input.provenFormulas.structures.length > 0, 'the 공식 사전 goes along even before reels are filed')
  assert.equal(calls.length, 2, 'a line left that viewers would swipe on triggers one rewrite')
  assert.match(calls[1].instructions, /예고만 함/)
  assert.equal(value.options.length, 1)
  for (const word of ['피지', '선크림', '냉동만두']) assert.ok(!calls[0].instructions.includes(word), word)
  assert.ok(HOOK_PRINCIPLES.length >= 4)
})

test('before the first draft 훅ai sets the field and looks the topic up once; later stages reuse it', async () => {
  const { prepareTopic, researchTopic } = await import('../src/creator-tools/studio/research.js')
  const db = fakeDb()
  db.tables.studio_sessions.set('s20', { id: 's20' })
  let searched = 0
  const client = () => ({ responses: { create: async ({ tools, input }) => { searched += 1; assert.equal(tools[0].type, 'web_search'); assert.match(input, /읽어 온 링크 내용/)
    return { output_text: '{"subject":"피지 연화 제품","facts":["피지를 불려 닦아내는 제품"],"viewerQuestions":["매일 써도 되나"],"avoid":["모공이 사라진다"]}', output: [{ content: [{ annotations: [{ url_citation: { url: 'https://example.com/a', title: 'A' } }] }] }] } } } })
  const providers = { call: (_p, _op, fn) => fn(), json: async () => ({ category: '피부' }) }
  const session = { id: 's20', brief: '내돈내산 피지템 https://shop.example.com/item?1', topic: { title: '피지템', facts: [], category: '기타' } }
  const research = await researchTopic(providers, session, { client, readPage: async () => '상품 상세 내용' })
  assert.deepEqual(research.facts, ['피지를 불려 닦아내는 제품'])
  assert.deepEqual(research.sources.map(s => s.url), ['https://example.com/a', 'https://shop.example.com/item?1'])
  assert.equal(searched, 1)
  const prepared = await prepareTopic({ db }, { ...session, topic: { ...session.topic, research } }, providers)
  assert.equal(prepared.topic.category, '피부', 'a topic taken from the brief gets its field')
  assert.equal(searched, 1, 'research already on the topic is not repeated')
  assert.equal(db.tables.studio_sessions.get('s20').topic.category, '피부')
})

test('a cover may quote what 훅ai researched as well as what the student wrote', () => {
  const session = { brief: '내돈내산 피지템', topic: { title: '피지템', research: { subject: '피지 연화 제품', facts: ['화장솜에 적셔 10분 올려 두는 제품'], viewerQuestions: [] } } }
  assert.deepEqual(ungroundedQuotes(session, ['10분 올려 두는', '내돈내산', '모공이 사라지는']), ['모공이 사라지는'])
})

test('the student\'s own words and the slang viewers really use are kept, only jargon is made plain', async () => {
  const { HOOKAI_SYSTEM } = await import('../src/creator-tools/studio/persona.js')
  assert.match(HOOKAI_SYSTEM, /실제로 즐겨 쓰는 말/)
  assert.match(HOOKAI_SYSTEM, /전문 용어뿐/)
  for (const word of ['내돈내산', '찐템', '찐꿀템']) assert.ok(!HOOKAI_SYSTEM.includes(word), word)
})

test('every finished line has to make sense on its own, even when it follows a formula', async () => {
  const { HOOKAI_SYSTEM } = await import('../src/creator-tools/studio/persona.js')
  const { HOOK_PRINCIPLES } = await import('../src/creator-tools/studio/copy-principles.js')
  assert.match(HOOKAI_SYSTEM, /따로 떼어 읽어도 말이 돼야/)
  assert.ok(HOOK_PRINCIPLES.some(p => /말이 돼야/.test(p)))
})
