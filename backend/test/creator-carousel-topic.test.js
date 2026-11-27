import test from 'node:test'
import assert from 'node:assert/strict'
import { chat, openerMessage, generateStage, startStage, cancelStage, stageOrder, nextStageOf, formatOf } from '../src/creator-tools/studio/engine.js'
import { CAROUSEL_STAGES, CAROUSEL_OPENERS } from '../src/creator-tools/studio/carousel.js'
import { topicPatch } from '../src/creator-tools/studio/routes.js'

const BRIEF = '퇴근 후 2시간으로 구움과자 주문 제작을 시작한 이야기. 집 오븐으로 시작했다.'
const RESEARCH = { subject: '구움과자 주문 제작', facts: ['구움과자는 오븐에 굽는 과자다'], viewerQuestions: [], avoid: [], brief: BRIEF }
const TOPIC = { title: '집 오븐 부업', angle: '장비 없이', promise: '시작 비용 줄이기', facts: ['작년 3월 시작'], audience: '직장인', category: '부업', categoryChecked: true, answers: [{ q: '첫 주문은요?', a: '지인 10명' }], brief: BRIEF, research: RESEARCH }
// A carousel plan is a studio session whose format is 'carousel': the tables the shared engine reads, and the model's answers by operation.
function setup({ row = {}, answers = {}, reels = [] } = {}) {
  const session = { id: 's1', user_id: 'u1', format: 'carousel', mode: 'topic', stage: 'topic', brief: BRIEF, sources: {}, attachments: [], topic: { research: RESEARCH }, cover: null, body: null, slides: null, design: null, caption: null, placeholders: [], ask: null, style_snapshot: null, job_status: 'idle', job_stage: null, ...row }
  const calls = [], reads = []
  const db = { from: table => { const filters = []; let patch = null
    const api = { select: () => api, eq: (k, v) => { filters.push([k, v]); return api }, neq: () => api, is: () => api, in: () => api, order: () => api, limit: () => api, single: () => api, maybeSingle: () => api, update: p => { patch = p; return api },
      then: resolve => { reads.push({ table, filters }); if (table === 'studio_sessions' && patch) Object.assign(session, patch)
        resolve({ data: table === 'creator_success_reels' ? reels : table === 'studio_sessions' ? session : table === 'studio_topics' ? [{ topic: '지난 주제', category: '부업' }] : null, error: null }) } }
    return api } }
  const makeProviders = () => ({ json: async (operation, prompt, input) => { calls.push({ operation, prompt, input }); const answer = answers[operation]; return typeof answer === 'function' ? answer(input, calls.filter(c => c.operation === operation).length) : answer } })
  return { session, calls, reads, deps: { db, makeProviders, schedule: () => {}, isScheduled: () => true } }
}
const topicAnswer = { reply: '이런 주제는 어때요?', chips: ['첫 주문 받은 날 이야기', 'x'.repeat(200)],
  proposals: [{ title: '집 오븐으로 시작한 구움과자 주문 제작', angle: '장비 없이 시작', promise: '시작 비용을 줄이는 법', why: '부업 캐러셀이 저장을 많이 받아요', category: '부업' }],
  topic: { ready: false, title: '', angle: '', promise: '', facts: [], audience: '', category: '' } }
const coverAnswer = { questions: [], plan: { terms: [{ word: '구움과자', meaning: '오븐에 구워 만드는 과자' }], purpose: '시작한 경험을 나눈다', quotes: ['집 오븐으로 시작했다'], reader: '직장인', promise: '집에 있는 것으로 시작하는 법' },
  options: [{ label: '결과 약속', kicker: '', text: '집 오븐으로 시작한 주문 제작', why: '장벽이 낮아 보여서' }], check: { unprovidedFacts: [] }, placeholders: [] }

test('a carousel is a plan format: its own stages after the topic, the same engine before them', () => {
  const { session } = setup()
  assert.equal(formatOf(session).what, '캐러셀')
  assert.equal(formatOf({ format: 'reel' }), null)
  assert.equal(formatOf({}), null, 'a plan saved before formats existed is a reel')
  assert.deepEqual(stageOrder(session), CAROUSEL_STAGES)
  assert.deepEqual(stageOrder({}), ['topic', 'thumbnail', 'script', 'filming', 'caption', 'done'])
  assert.equal(nextStageOf({ ...session, stage: 'topic' }), 'cover')
  assert.equal(nextStageOf({ ...session, stage: 'slides' }), 'design')
  assert.equal(nextStageOf({ stage: 'thumbnail' }), 'script')
})

test('주제 정하기: the shared topic conversation talks about a carousel and looks at carousels doing well', async () => {
  const reels = [{ username: 'baker', views: 900000, category: '부업', analysis: { kind: 'carousel', overview: { topic: '홈베이킹 부업', uniqueAngle: '첫 달 매출 공개' }, cover: { title: '첫 달 매출', formula: '숫자 공개' }, structure: { category: '리스트형' } } }]
  const { deps, calls, reads, session } = setup({ answers: { 'studio-topic': topicAnswer }, reels })
  const talk = [{ role: 'hookai', stage: 'topic', content: '어떤 이야기예요?' }, { role: 'user', stage: 'topic', content: '부업 이야기요' }]
  const out = await chat(deps, session, talk, '주제 제안해줘')
  assert.equal(calls.length, 1, 'research already done for this brief is not repeated')
  assert.match(calls[0].prompt, /이번 캐러셀의 주제를 확정합니다/)
  assert.match(calls[0].prompt, /영상이 아니라 인스타그램 캐러셀/, 'the carousel persona speaks')
  assert.deepEqual(calls[0].input.trending, [{ account: '@baker', category: '부업', views: 900000, topic: '홈베이킹 부업', angle: '첫 달 매출 공개', cover: '첫 달 매출', coverFormula: '숫자 공개', format: '리스트형' }])
  assert.ok(reads.some(r => r.table === 'creator_success_reels' && r.filters.some(([k, v]) => k === 'analysis->>kind' && v === 'carousel')), 'carousels, not reels')
  assert.deepEqual(calls[0].input.recentTopics, ['지난 주제'])
  assert.equal(calls[0].input.brief, BRIEF)
  assert.ok(!('script' in calls[0].input), 'a carousel\'s own context, not a reel\'s')
  assert.deepEqual(out.meta.chips, ['첫 주문 받은 날 이야기'])
  assert.equal(out.meta.proposals[0].category, '부업')
})

test('a carousel started with nothing written greets without calling the model', async () => {
  const { deps, calls, session } = setup({ row: { brief: '', topic: null } })
  const hello = await openerMessage(deps, session)
  assert.match(hello.content, /어떤 캐러셀을 만들어볼까요/)
  assert.equal(calls.length, 0)
})

test('쓰기 전 질문: the cover may ask once, as a reel plan does, and reads the answers and attachments afterwards', async () => {
  const asks = { ...coverAnswer, questions: [{ key: '첫 주문', question: '첫 주문은 몇 건이었어요?', chips: ['3건', '10건'] }], options: [] }
  const first = setup({ row: { topic: { ...TOPIC, answers: [] }, attachments: [{ name: '메모.txt', content: '지인 10명에게 팔았다' }] }, answers: { 'studio-carousel-cover': asks } })
  const out = await generateStage(first.deps, first.session, 'cover')
  assert.deepEqual(out.questions, [{ key: '첫 주문', question: '첫 주문은 몇 건이었어요?', chips: ['3건', '10건', '알아서 해주세요'] }])
  assert.match(first.calls[0].prompt, /질문 규칙/)
  assert.deepEqual(first.calls[0].input.attachments, [{ name: '메모.txt', content: '지인 10명에게 팔았다' }])
  // Asked already: it drafts with what it has, and a draft that asks anyway is written once more.
  const later = setup({ row: { topic: { ...TOPIC, askedStages: ['cover'] } }, answers: { 'studio-carousel-cover': (_input, n) => n === 1 ? asks : coverAnswer } })
  const made = await generateStage(later.deps, later.session, 'cover')
  assert.equal(later.calls.length, 2)
  assert.match(later.calls[0].prompt, /이번에는 질문하지 않습니다/)
  assert.equal(made.value.options[0].text, '집 오븐으로 시작한 주문 제작')
  assert.deepEqual(later.calls[0].input.answers, TOPIC.answers)
  assert.deepEqual(later.calls[0].input.topic, { title: '집 오븐 부업', category: '부업', angle: '장비 없이', promise: '시작 비용 줄이기', audience: '직장인', facts: ['작년 3월 시작'] })
})

test('a changed topic clears the carousel stages written for the old one; 디자인 opens at once without a job', async () => {
  const slides = { items: [{ id: 'aaa', role: 'cover', heading: '표지', text: '' }, { id: 'bbb', role: 'body', heading: '', text: '하나' }, { id: 'ccc', role: 'last', heading: '', text: '끝' }], template: 'note' }
  const row = { format: 'carousel', title: '집 오븐 부업', topic: TOPIC, cover: { options: [] }, body: { options: [] }, slides, design: null, caption: { options: [] }, ask: { stage: 'body' } }
  const patch = topicPatch(row, { ...TOPIC, title: '새 주제' })
  assert.deepEqual([patch.title, patch.body, patch.slides, patch.caption, patch.ask], ['새 주제', null, null, null, null])
  assert.ok(!('cover' in patch), 'the cover is written again on the spot')
  assert.deepEqual(Object.keys(topicPatch({ title: 'x', topic: TOPIC, script: { options: [] }, cover: { options: [] } }, { ...TOPIC, title: '새 주제' })).sort(), ['script', 'title', 'topic'], 'a reel clears its own stages')
  const { deps, session, calls } = setup({ row: { stage: 'slides', topic: TOPIC, cover: { options: [{ text: '표지' }], chosen: 0 }, slides } })
  const opened = await startStage(deps, session, 'design')
  assert.equal(opened.stage, 'design')
  assert.equal(opened.design.template, 'note')
  assert.ok(!opened.job_status || opened.job_status === 'idle')
  assert.equal(calls.length, 0)
  await assert.rejects(startStage(deps, session, 'script'), { code: 'STAGE_UNKNOWN' })
  // Cancelling a stage being written for the first time goes back to the last carousel stage that was made.
  const back = await cancelStage(deps, { ...session, job_status: 'running', job_stage: 'caption', caption: null })
  assert.equal(back.stage, 'design')
  assert.ok(CAROUSEL_OPENERS.cover)
})
