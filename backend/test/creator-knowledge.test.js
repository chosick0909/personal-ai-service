import test from 'node:test'
import assert from 'node:assert/strict'
import { groundedTerms, buildFieldKnowledge, fieldsToStudy, studyOnce, fieldKnowledge, knowledgePrompt } from '../src/creator-tools/studio/knowledge.js'
import { generateStage } from '../src/creator-tools/studio/engine.js'
import { HOOKAI_SYSTEM } from '../src/creator-tools/studio/persona.js'

const literal = v => v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v
function fakeDb(tables) {
  return { tables, from(table) {
    const rows = () => [...(tables[table] ||= new Map()).values()]
    const filters = []; let action = 'select', payload, single = false
    const api = {
      select() { return api }, order() { return api }, limit() { return api },
      eq(k, v) { filters.push(r => r[k] === v); return api },
      neq(k, v) { filters.push(r => r[k] !== v); return api },
      not(k, op, v) { filters.push(r => !(op === 'is' && (r[k] ?? null) === v)); return api },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return api },
      or(expr) { const parts = expr.split(',').map(p => p.split('.')); filters.push(r => parts.some(([k, , v]) => (r[k] ?? null) === literal(v))); return api },
      maybeSingle() { single = true; return api }, single() { single = true; return api },
      insert(p) { action = 'insert'; payload = p; return api }, update(p) { action = 'update'; payload = p; return api }, upsert(p) { action = 'upsert'; payload = p; return api },
      then(resolve) {
        const map = tables[table]
        if (action === 'insert') { const row = { id: `r${map.size + 1}`, ...payload }; map.set(row.id, row); return resolve({ data: row, error: null }) }
        if (action === 'upsert') { const key = payload.category ?? payload.shortcode ?? payload.id ?? payload.key; map.set(key, { ...(map.get(key) || {}), ...payload }); return resolve({ data: null, error: null }) }
        const found = rows().filter(r => filters.every(f => f(r)))
        if (action === 'update') { found.forEach(r => Object.assign(r, payload)); return resolve({ data: null, error: null }) }
        resolve({ data: single ? found[0] ?? null : found, error: null })
      } }
    return api } }
}
const analyzedReel = (shortcode, category, script, at = '2026-10-26T00:00:00Z') => [shortcode, { shortcode, category, visible: true, reference_fit: true, analysis_status: 'ready', analysis_updated_at: at, views: 600000, caption: '', username: 'a',
  analysis: { overview: { topic: 't' }, hook: { category: '경고', formula: 'f', analysis: 'w' }, structure: { category: '리뷰·후기', steps: [{ role: 'hook', purpose: 'p' }], analysis: 'w' }, transcript: { korean: script } } }]

test('field terms are kept only when the studied reels actually used them', () => {
  const terms = groundedTerms([{ word: '백탁', meaning: '하얗게 뜨는 것', use: 'u' }, { word: '지어낸말', meaning: 'm', use: 'u' }, { word: '백탁', meaning: 'dup', use: 'u' }, { word: '예전용어', meaning: 'm', use: 'u' }],
    '이 선크림은 백 탁이 없어요', [{ word: '예전용어' }])
  assert.deepEqual(terms.map(t => t.word), ['백탁', '예전용어'], 'spacing is ignored; words an earlier study verified stay')
})

test('a field is studied once it has enough analyzed reels, and only words from its reels become terms', async () => {
  const db = fakeDb({ creator_success_reels: new Map([analyzedReel('A1', '피부', '백탁 없는 선크림'), analyzedReel('A2', '피부', '끈적임 테스트')]), creator_field_knowledge: new Map() })
  let calls = 0, input = null
  const deps = { db, makeProviders: () => ({ json: async (op, _i, context) => { calls += 1; input = context; assert.equal(op, 'studio-knowledge')
    return { audience: '피부가 예민한 사람', topics: [{ topic: '직접 써본 제품 비교', why: 'w' }], terms: [{ word: '백탁', meaning: '바른 뒤 하얗게 뜨는 것', use: '선크림 비교' }, { word: '없는말', meaning: 'x', use: 'x' }], cautions: ['효능 단정'] } } }) }
  assert.equal(await buildFieldKnowledge(deps, '피부'), null, 'two analyzed reels are not enough')
  assert.equal(calls, 0)
  db.tables.creator_success_reels.set(...analyzedReel('A3', '피부', '흡수력 비교'))
  const knowledge = await buildFieldKnowledge(deps, '피부')
  assert.deepEqual(knowledge.terms.map(t => t.word), ['백탁'])
  assert.equal(knowledge.version, 2)
  assert.deepEqual(knowledge.topics, [{ topic: '직접 써본 제품 비교', why: 'w' }])
  assert.ok(!('hook' in input.reels[0]) && !('structure' in input.reels[0]), 'first lines and structures are learned in common, not per field')
  assert.equal(db.tables.creator_field_knowledge.get('피부').reel_count, 3)
  assert.equal((await fieldKnowledge(db, '피부')).terms[0].word, '백탁')
  // Principles, not patches: the study prompt carries no field-specific words.
  for (const word of ['백탁', '선크림', '약사']) assert.ok(!knowledgePrompt.includes(word), word)
})

test('only fields whose analyzed reels changed since the last study are studied again', async () => {
  const db = fakeDb({ creator_success_reels: new Map([analyzedReel('A1', '피부', 's'), analyzedReel('A2', '피부', 's'), analyzedReel('A3', '피부', 's'),
    analyzedReel('B1', '요리', 's', '2026-10-20T00:00:00Z'), analyzedReel('B2', '요리', 's', '2026-10-20T00:00:00Z'), analyzedReel('B3', '요리', 's', '2026-10-20T00:00:00Z'),
    analyzedReel('C1', '육아', 's')]),
  creator_field_knowledge: new Map([['요리', { category: '요리', built_at: '2026-10-21T00:00:00Z', knowledge: { version: 2 } }], ['피부', { category: '피부', built_at: '2026-10-21T00:00:00Z', knowledge: { version: 2 } }]]) })
  assert.deepEqual(await fieldsToStudy(db), ['피부'])
  db.tables.creator_field_knowledge.get('요리').knowledge = { version: 1 }
  assert.deepEqual((await fieldsToStudy(db)).sort(), ['요리', '피부'], 'a field studied in an older shape is studied again')
})

test('a study run is logged with what it learned', async () => {
  const db = fakeDb({ creator_success_reels: new Map([analyzedReel('A1', '피부', '백탁'), analyzedReel('A2', '피부', '백탁'), analyzedReel('A3', '피부', '백탁')]), creator_field_knowledge: new Map(), creator_study_runs: new Map() })
  const deps = { db, makeProviders: () => ({ json: async op => op === 'studio-library-match' ? { reels: [] } : ({ audience: 'a', topics: [], terms: [{ word: '백탁', meaning: 'm', use: 'u' }], cautions: [] }) }) }
  const stats = await studyOnce(deps, { limit: 0 })
  assert.deepEqual(stats, { analyzed: 0, failed: 0, formulas: { checked: 3, matched: 0 }, newFormulas: { hooks: [], structures: [] }, cover: false, fields: ['피부'] })
  const run = [...db.tables.creator_study_runs.values()][0]
  assert.ok(run.finished_at && run.error === null)
})

test('planning stages read what 훅ai learned about the field', async () => {
  const db = fakeDb({ creator_field_knowledge: new Map([['건강', { category: '건강', knowledge: { version: 2, audience: 'a', topics: [], terms: [{ word: '공복혈당', meaning: 'm', use: 'u' }], cautions: [] } }]]) })
  let input = null
  const deps = { db, makeProviders: () => ({ json: async (_op, _i, context) => { input = context; return { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, options: [{ spoken: '첫 문장', onScreen: 'x', type: '경고', why: 'w' }], placeholders: [] } } }) }
  await generateStage(deps, { id: 's1', user_id: 'u1', mode: 'single', sources: {}, brief: 'b', topic: { title: 't', facts: [], category: '건강' }, placeholders: [] }, 'hook')
  assert.equal(input.fieldKnowledge.terms[0].word, '공복혈당')
  assert.match(HOOKAI_SYSTEM, /fieldKnowledge/)
})

test('the study picks unanalyzed reels, retries failures after a week and restarts analyses cut off by a restart', async () => {
  const { studyBacklog } = await import('../src/creator-tools/studio/knowledge.js')
  const now = Date.parse('2026-10-26T12:00:00Z')
  const reel = (shortcode, status, at, extra = {}) => [shortcode, { shortcode, visible: true, reference_fit: true, username: 'a', analysis_status: status, analysis_updated_at: at, ...extra }]
  const db = fakeDb({ creator_success_reels: new Map([reel('N1', 'none', null), reel('R1', 'running', '2026-10-26T11:00:00Z'), reel('R2', 'running', '2026-10-26T11:50:00Z'),
    reel('F1', 'failed', '2026-10-10T00:00:00Z'), reel('F2', 'failed', '2026-10-25T00:00:00Z'), reel('D1', 'ready', '2026-10-01T00:00:00Z'), reel('P1', 'none', null, { username: 'recommended' }), reel('H1', 'none', null, { reference_fit: false })]) })
  assert.deepEqual((await studyBacklog(db, 10, now)).sort(), ['F1', 'N1', 'R1'])
})

test('reels whose video link is still cached are studied first, and only a few that need an Instagram page', async () => {
  const { studyBacklog } = await import('../src/creator-tools/studio/knowledge.js')
  const reel = (shortcode, views) => [shortcode, { shortcode, visible: true, reference_fit: true, username: 'a', analysis_status: 'none', analysis_updated_at: null, views }]
  const db = fakeDb({ creator_success_reels: new Map([reel('U1', 900), reel('U2', 800), reel('U3', 700), reel('C1', 600), reel('C2', 500)]) })
  const redis = { get: async key => /:C\d$/.test(key) ? 'https://cdn/v.mp4' : null }
  assert.deepEqual(await studyBacklog(db, 10, Date.now(), { redis, lookups: 2 }), ['C1', 'C2', 'U1', 'U2'])
  assert.deepEqual(await studyBacklog(db, 3, Date.now(), { redis, lookups: 2 }), ['C1', 'C2', 'U1'])
})

test('analyzed reels are filed under the 공식 사전 entry whose mechanism they use', async () => {
  const { matchFormulas } = await import('../src/creator-tools/studio/formula-study.js')
  const db = fakeDb({ creator_success_reels: new Map([analyzedReel('A1', '피부', 's'), analyzedReel('A2', '요리', 's')]), creator_reel_formulas: new Map() })
  let input = null, calls = 0
  const deps = { db, makeProviders: () => ({ json: async (op, _i, context) => { calls += 1; input = context; assert.equal(op, 'studio-library-match')
    return { reels: [{ id: 'A1', hook: 'verdict', structure: 'nope' }, { id: 'A2', hook: '', structure: 'list' }] } } }) }
  assert.deepEqual(await matchFormulas(deps), { checked: 2, matched: 2 })
  assert.ok(input.library.hooks.some(h => h.id === 'verdict') && input.library.structures.some(s => s.id === 'list'))
  assert.deepEqual(db.tables.creator_reel_formulas.get('A1'), { shortcode: 'A1', hook_id: 'verdict', structure_id: null, checked_at: db.tables.creator_reel_formulas.get('A1').checked_at }, 'an id outside the library is dropped')
  assert.equal(db.tables.creator_reel_formulas.get('A2').structure_id, 'list')
  assert.deepEqual(await matchFormulas(deps), { checked: 0, matched: 0 }, 'filed reels are not filed again')
  assert.equal(calls, 1)
})

test('a mechanism the library lacks becomes a new entry only when reels from several accounts share it', async () => {
  const { discoverFormulas, libraryEntries, acceptedMembers } = await import('../src/creator-tools/studio/formula-study.js')
  const reel = (id, username) => { const [k, v] = analyzedReel(id, '살림', 's'); return [k, { ...v, username }] }
  const db = fakeDb({ creator_success_reels: new Map([reel('U1', 'a'), reel('U2', 'b'), reel('U3', 'a'), reel('U4', 'c'), reel('S1', 'x'), reel('S2', 'x'), reel('S3', 'x')]),
    creator_reel_formulas: new Map(['U1', 'U2', 'U3', 'U4', 'S1', 'S2', 'S3'].map(id => [id, { shortcode: id, hook_id: null, structure_id: 'list' }])), creator_learned_formulas: new Map() })
  const deps = { db, makeProviders: () => ({ json: async op => { assert.equal(op, 'studio-library-discover'); return { structures: [], hooks: [
    { type: '호기심', title: '반전 고백', formula: '[대상]인 줄 알았는데 [반전]', when: 'w', members: ['U1', 'U2', 'U3', 'GHOST'] },
    { type: '경고', title: '한 계정 버릇', formula: '[x]', when: 'w', members: ['S1', 'S2', 'S3'] },
    { type: '순위·평가', title: '판정', formula: '[x]', when: 'w', members: ['U1', 'U2', 'U4'] }] } } }) }
  assert.deepEqual(await discoverFormulas(deps), { hooks: ['반전 고백'], structures: [] })
  const learned = [...db.tables.creator_learned_formulas.values()]
  assert.equal(learned.length, 1)
  assert.deepEqual(['U1', 'U2', 'U3'].map(id => db.tables.creator_reel_formulas.get(id).hook_id), [learned[0].id, learned[0].id, learned[0].id])
  assert.equal(db.tables.creator_reel_formulas.get('U4').hook_id, null)
  const library = await libraryEntries(db)
  assert.equal(library.hooks.at(-1).title, '반전 고백', 'the new entry joins the same 공식 사전 list')
  assert.equal(acceptedMembers(['U1', 'U1', 'U2'], [{ shortcode: 'U1', username: 'a' }, { shortcode: 'U2', username: 'b' }]), null, 'duplicates do not count twice')
})

test('cover copy is learned across fields and reaches the thumbnail stage', async () => {
  const { buildCoverKnowledge, discoverPrompt, matchPrompt, coverPrompt } = await import('../src/creator-tools/studio/formula-study.js')
  const cover = (id, category, title) => [id, { shortcode: id, category, visible: true, reference_fit: true, views: 900000, cover_title: title }]
  const db = fakeDb({ creator_success_reels: new Map([cover('C1', '요리', '5분 저녁 끝'), cover('C2', '건강', '공복에 이것부터'), cover('C3', '육아', '아이가 먼저 찾아요')]), creator_common_knowledge: new Map() })
  let calls = 0, input = null
  const deps = { db, makeProviders: () => ({ json: async (op, _i, context) => { calls += 1; input = context; assert.equal(op, 'studio-cover-study'); return { lessons: [{ principle: '결과 약속', how: '끝난 상태를 먼저', why: 'w' }], form: ['짧다'] } } }) }
  const lessons = await buildCoverKnowledge(deps)
  assert.deepEqual(input.covers.map(c => c.category).sort(), ['건강', '요리', '육아'], 'covers from every field are studied together')
  assert.equal(lessons.lessons[0].principle, '결과 약속')
  assert.equal(await buildCoverKnowledge(deps), null, 'nothing new, no new study')
  assert.equal(calls, 1)
  let thumbInput = null
  const stageDeps = { db, makeProviders: () => ({ json: async (_op, _i, context) => { thumbInput = context; return { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, plan: { terms: [], purpose: '', reader: '', promise: '', quotes: [] }, options: [{ label: '결과 약속', text: 'a', why: 'w' }], placeholders: [] } } }) }
  await generateStage(stageDeps, { id: 's', user_id: 'u', mode: 'single', sources: {}, brief: 'b', topic: { title: 't', facts: [], category: '요리' }, placeholders: [] }, 'thumbnail')
  assert.equal(thumbInput.coverLessons.lessons[0].how, '끝난 상태를 먼저')
  for (const prompt of [discoverPrompt, matchPrompt, coverPrompt]) for (const word of ['백탁', '선크림', '냉동만두']) assert.ok(!prompt.includes(word), word)
})

test('only billable Bright Data requests count toward the daily budget', async () => {
  const { createProviders } = await import('../src/creator-tools/providers.js')
  const store = new Map()
  const redis = { get: async k => store.get(k) ?? null, incr: async k => { store.set(k, (store.get(k) || 0) + 1); return store.get(k) }, expire: async () => 1, del: async k => store.delete(k) }
  const db = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) }
  const before = process.env.CREATOR_PROVIDER_DAILY_CALLS
  process.env.CREATOR_PROVIDER_DAILY_CALLS = '2'
  try {
    const p = createProviders({ db, redis, job: { id: null }, signal: new AbortController().signal })
    for (let i = 0; i < 6; i++) await p.call('brightdata', i % 2 ? 'progress' : 'account-reels-download', async () => 'ok')
    await p.call('brightdata', 'trigger', async () => 'ok')
    await p.call('brightdata', 'profiles-trigger', async () => 'ok')
    await assert.rejects(p.call('brightdata', 'trigger', async () => 'ok'), /외부 조회 한도/)
  } finally { if (before === undefined) delete process.env.CREATOR_PROVIDER_DAILY_CALLS; else process.env.CREATOR_PROVIDER_DAILY_CALLS = before }
})

test('with the Mac mini off the study analyzes nothing today and still files what it has', async () => {
  const db = fakeDb({ creator_success_reels: new Map([['N1', { shortcode: 'N1', visible: true, reference_fit: true, username: 'a', analysis_status: 'none' }]]), creator_study_runs: new Map() })
  const redis = { get: async () => null }
  const stats = await studyOnce({ db, redis, makeProviders: () => ({ json: async () => ({ reels: [] }) }) }, { limit: 5 })
  assert.equal(stats.stopped, 'offline')
  assert.equal(db.tables.creator_success_reels.get('N1').analysis_status, 'none', 'nothing was started')
})

test('CREATOR_STUDIO_MODEL moves only 훅ai (studio) calls, and a Claude model needs its key', async () => {
  const { operationModel } = await import('../src/creator-tools/operation-model.js')
  const env = { CREATOR_STUDIO_MODEL: 'claude-opus-5-5', ANTHROPIC_API_KEY: 'k' }
  assert.equal(operationModel('studio-script', 'gpt-a', env, 'gpt-premium'), 'claude-opus-5-5')
  assert.equal(operationModel('studio-revise', 'gpt-a', env, 'gpt-premium'), 'claude-opus-5-5')
  assert.equal(operationModel('success-reel-analysis', 'gpt-a', env, 'gpt-premium'), 'gpt-premium', 'other features keep their model')
  assert.equal(operationModel('reference-analysis', 'gpt-a', env, 'gpt-premium'), 'gpt-a')
  assert.equal(operationModel('studio-script', 'gpt-a', { CREATOR_STUDIO_MODEL: 'claude-opus-5-5' }, 'gpt-premium'), 'gpt-premium', 'no key, no switch')
  assert.equal(operationModel('studio-script', 'gpt-a', { ...env, CREATOR_MODEL_STUDIO_SCRIPT: 'gpt-x' }, 'gpt-premium'), 'gpt-x', 'a per-stage override still wins')
})

test('a long study leaves a reel that was analyzed or started since its list was made', async () => {
  const db = fakeDb({ creator_success_reels: new Map([
    ['N1', { shortcode: 'N1', visible: true, reference_fit: true, username: 'a', analysis_status: 'none', views: 2 }],
    ['N2', { shortcode: 'N2', visible: true, reference_fit: true, username: 'a', analysis_status: 'ready', views: 1 }]]), creator_study_runs: new Map() })
  // The Mac mini is online. After the list is made, a student starts N1 and N2 is already analyzed.
  const redis = { get: async key => {
    if (key !== 'hookai:collector:seen') return null
    Object.assign(db.tables.creator_success_reels.get('N1'), { analysis_status: 'running', analysis_updated_at: new Date().toISOString() })
    return String(Date.now())
  } }
  const stats = await studyOnce({ db, redis, makeProviders: () => ({ json: async () => ({}) }) }, { limit: 5, lookups: 5 })
  assert.equal(db.tables.creator_success_reels.get('N1').analysis_status, 'running', "left to the student's analysis")
  assert.equal(stats.analyzed + stats.failed, 0)
})

test('when Instagram is limiting the Mac mini the study stops and the reel waits for the next one, not a week', async () => {
  const { BLOCKED_MESSAGE } = await import('../src/creator-tools/instagram-lookup.js')
  const db = fakeDb({ creator_success_reels: new Map([
    ['N1', { shortcode: 'N1', visible: true, reference_fit: true, username: 'a', analysis_status: 'none', views: 2 }],
    ['N2', { shortcode: 'N2', visible: true, reference_fit: true, username: 'a', analysis_status: 'none', views: 1 }]]), creator_study_runs: new Map() })
  const redis = { get: async key => key === 'hookai:collector:seen' ? String(Date.now()) : null, set: async () => {} }
  const blocked = Object.assign(new Error(BLOCKED_MESSAGE), { code: 'LOOKUP_BLOCKED', exposeMessage: true, statusCode: 503 })
  const makeProviders = () => ({ instagramReel: async () => { throw blocked }, json: async () => ({}) })
  const stats = await studyOnce({ db, redis, makeProviders }, { limit: 5, lookups: 5 })
  assert.equal(stats.stopped, 'unavailable')
  assert.equal(db.tables.creator_success_reels.get('N1').analysis_status, 'none')
  assert.equal(db.tables.creator_success_reels.get('N2').analysis_status, 'none', 'the rest are not marked failed')
})
