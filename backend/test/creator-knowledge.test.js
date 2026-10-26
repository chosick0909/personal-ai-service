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
      in(k, vs) { filters.push(r => vs.includes(r[k])); return api },
      or(expr) { const parts = expr.split(',').map(p => p.split('.')); filters.push(r => parts.some(([k, , v]) => (r[k] ?? null) === literal(v))); return api },
      maybeSingle() { single = true; return api }, single() { single = true; return api },
      insert(p) { action = 'insert'; payload = p; return api }, update(p) { action = 'update'; payload = p; return api }, upsert(p) { action = 'upsert'; payload = p; return api },
      then(resolve) {
        const map = tables[table]
        if (action === 'insert') { const row = { id: `r${map.size + 1}`, ...payload }; map.set(row.id, row); return resolve({ data: row, error: null }) }
        if (action === 'upsert') { map.set(payload.category, { ...payload }); return resolve({ data: null, error: null }) }
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
    return { audience: '피부가 예민한 사람', terms: [{ word: '백탁', meaning: '바른 뒤 하얗게 뜨는 것', use: '선크림 비교' }, { word: '없는말', meaning: 'x', use: 'x' }], hooks: [{ type: '경고', principle: '손해를 먼저', why: 'w' }], structures: [{ format: '리뷰·후기', flow: '판정 → 근거', why: 'w' }], captions: ['c'], cautions: ['효능 단정'] } } }) }
  assert.equal(await buildFieldKnowledge(deps, '피부'), null, 'two analyzed reels are not enough')
  assert.equal(calls, 0)
  db.tables.creator_success_reels.set(...analyzedReel('A3', '피부', '흡수력 비교'))
  const knowledge = await buildFieldKnowledge(deps, '피부')
  assert.deepEqual(knowledge.terms.map(t => t.word), ['백탁'])
  assert.deepEqual(input.counts, { hooks: { 경고: 3 }, structures: { '리뷰·후기': 3 } })
  assert.equal(db.tables.creator_field_knowledge.get('피부').reel_count, 3)
  assert.equal((await fieldKnowledge(db, '피부')).terms[0].word, '백탁')
  // Principles, not patches: the study prompt carries no field-specific words.
  for (const word of ['백탁', '선크림', '약사']) assert.ok(!knowledgePrompt.includes(word), word)
})

test('only fields whose analyzed reels changed since the last study are studied again', async () => {
  const db = fakeDb({ creator_success_reels: new Map([analyzedReel('A1', '피부', 's'), analyzedReel('A2', '피부', 's'), analyzedReel('A3', '피부', 's'),
    analyzedReel('B1', '요리', 's', '2026-10-20T00:00:00Z'), analyzedReel('B2', '요리', 's', '2026-10-20T00:00:00Z'), analyzedReel('B3', '요리', 's', '2026-10-20T00:00:00Z'),
    analyzedReel('C1', '육아', 's')]),
  creator_field_knowledge: new Map([['요리', { category: '요리', built_at: '2026-10-21T00:00:00Z' }], ['피부', { category: '피부', built_at: '2026-10-21T00:00:00Z' }]]) })
  assert.deepEqual(await fieldsToStudy(db), ['피부'])
})

test('a study run is logged with what it learned', async () => {
  const db = fakeDb({ creator_success_reels: new Map([analyzedReel('A1', '피부', '백탁'), analyzedReel('A2', '피부', '백탁'), analyzedReel('A3', '피부', '백탁')]), creator_field_knowledge: new Map(), creator_study_runs: new Map() })
  const deps = { db, makeProviders: () => ({ json: async () => ({ audience: 'a', terms: [{ word: '백탁', meaning: 'm', use: 'u' }], hooks: [], structures: [], captions: [], cautions: [] }) }) }
  const stats = await studyOnce(deps, { limit: 0 })
  assert.deepEqual(stats, { analyzed: 0, failed: 0, fields: ['피부'] })
  const run = [...db.tables.creator_study_runs.values()][0]
  assert.ok(run.finished_at && run.error === null)
})

test('planning stages read what 훅ai learned about the field', async () => {
  const db = fakeDb({ creator_field_knowledge: new Map([['건강', { category: '건강', knowledge: { audience: 'a', terms: [{ word: '공복혈당', meaning: 'm', use: 'u' }], hooks: [], structures: [], captions: [], cautions: [] } }]]) })
  let input = null
  const deps = { db, makeProviders: () => ({ json: async (_op, _i, context) => { input = context; return { questions: [], check: { referenceTraces: [], unprovidedFacts: [] }, options: [{ spoken: '첫 문장', onScreen: 'x', type: '경고', why: 'w' }], placeholders: [] } } }) }
  await generateStage(deps, { id: 's1', user_id: 'u1', mode: 'single', sources: {}, brief: 'b', topic: { title: 't', facts: [], category: '건강' }, placeholders: [] }, 'hook')
  assert.equal(input.fieldKnowledge.terms[0].word, '공복혈당')
  assert.match(HOOKAI_SYSTEM, /fieldKnowledge/)
})
