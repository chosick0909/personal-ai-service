import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReelAnalysis, validateReelPlan, copiedPhrases, requestReelAnalysis, requestReelPlan, reelAnalysisSchema, reelPlanSchema, reelVideoUrl } from '../src/creator-tools/success-reel-analysis.js'

const script = '종합비타민 약사추천 안사요 사요\n센트룸 안사요\n함량도 낮고 전부 비활성형이라 아쉽습니다\n쏜 리서치 베이직 사요'
const analysisRaw = {
  overview: { summary: '약사가 종합비타민 6개를 사요/안사요로 평가합니다.', topic: '종합비타민 선택', ideaSeed: '성분 기준으로 고르기', uniqueAngle: '전문가 판정',
    commonBelief: '다 비슷하다', contrarianReality: '함량과 형태가 다르다', evidence: ['활성형 여부', '함량', '', '속쓰림', '다섯번째'] },
  hook: { category: '순위·평가', formula: '[주제] [전문가]추천. 안사요 사요', spokenHook: '종합비타민 약사추천', visualHook: '안사요/사요 자막', analysis: '이분법으로 판정' },
  structure: { category: '비교·평가', description: '제품별 판정', analysis: '빠른 판정 리듬',
    steps: [{ role: 'hook', quote: '종합비타민 약사추천', purpose: '주제 제시' }, { role: 'evidence', quote: '지어낸 문장입니다', purpose: '근거' },
      { role: 'method', quote: '쏜 리서치 베이직 사요', purpose: '추천' }] },
  filming: { location: '약국 진열대 앞', shotType: '상반신 정면', onScreen: '약사 얼굴', textOverlay: '상단 큰 자막', editing: '빠른 컷', guide: ['진열대 앞에서 촬영'] },
}

test('analysis keeps only quotes that exist in the transcript', () => {
  const result = validateReelAnalysis(analysisRaw, script)
  assert.equal(result.hook.spokenHook, '종합비타민 약사추천')
  assert.deepEqual(result.structure.steps.map(s => s.quote), ['종합비타민 약사추천', '쏜 리서치 베이직 사요'])
  assert.deepEqual(result.overview.evidence, ['활성형 여부', '함량', '속쓰림', '다섯번째'])
  const invented = validateReelAnalysis({ ...analysisRaw, hook: { ...analysisRaw.hook, spokenHook: '없는 훅 문장' } }, script)
  assert.equal(invented.hook.spokenHook, '종합비타민 약사추천 안사요 사요', 'falls back to the first transcript line')
  assert.equal(validateReelAnalysis({ ...analysisRaw, overview: { ...analysisRaw.overview, summary: '' } }, script), null)
  assert.ok(reelAnalysisSchema.required.includes('filming') && reelPlanSchema.required.includes('storyboard'))
})

const planRaw = {
  title: '선크림 사요/안사요', thumbnailTitles: [{ text: '선크림 안사요 사요', why: '판정 기대' }, { text: '', why: '' }],
  hooks: [{ spoken: '선크림 피부과 실장 추천, 안사요 사요', onScreen: '안사요 vs 사요', why: '판정 기대' }, { spoken: '', onScreen: '', why: '' }],
  script: [{ part: 'hook', spoken: '선크림 피부과 실장 추천, 안사요 사요', onScreen: '안사요 vs 사요', seconds: 3 }, { part: 'body', spoken: '[제품명]은 안사요.', onScreen: '[제품명] ❌', seconds: 4.4 },
    { part: 'weird', spoken: '이건 사요.', onScreen: '', seconds: 999 }],
  storyboard: [{ scene: 7, seconds: 3, shot: '정면', action: '진열대 앞 인사', onScreen: '선크림', spoken: '...' }, { scene: 1, seconds: 4, shot: '제품 클로즈업', action: '제품 들기', onScreen: '', spoken: '' }],
  filming: { location: '화장대', props: ['선크림 3종'], camera: '정면 거치', lighting: '창가 자연광', editing: '2초 컷', checklist: ['제품 라벨 보이게'] },
  caption: { text: '선크림 아무거나 쓰세요?', hashtags: ['#선크림', '스킨 케어', '선크림추천'] }, placeholders: ['[제품명]'],
}

test('plan output is bounded and normalized', () => {
  const plan = validateReelPlan(planRaw)
  assert.equal(plan.hooks.length, 1)
  assert.deepEqual(plan.thumbnailTitles.map(t => t.text), ['선크림 안사요 사요'])
  assert.ok(reelPlanSchema.required.includes('thumbnailTitles'))
  assert.deepEqual(plan.script.map(s => [s.part, s.seconds]), [['hook', 3], ['body', 4], ['body', 180]])
  assert.deepEqual(plan.storyboard.map(s => s.scene), [1, 2])
  assert.deepEqual(plan.caption.hashtags, ['선크림', '스킨케어', '선크림추천'])
  assert.equal(validateReelPlan({ ...planRaw, script: [] }), null)
})

test('copied phrases from the source script are detected, short overlaps are not', () => {
  assert.deepEqual(copiedPhrases(['함량도 낮고 전부 비활성형이라 아쉽습니다'], script).length > 0, true)
  assert.deepEqual(copiedPhrases(['선크림 안사요 사요'], script), [])
})

function fakeDb(rows) {
  const tables = { creator_success_reels: new Map(rows.map(r => [r.shortcode, r])), creator_reel_plans: new Map() }
  const calls = []
  return { tables, calls, from(table) {
    const filters = []; let action = 'select', payload, single = false
    const api = {
      select() { return api }, eq(k, v) { filters.push(r => r[k] === v); return api }, gte(k, v) { filters.push(r => r[k] >= v); return api },
      limit() { return api }, maybeSingle() { single = true; return api }, single() { single = true; return api },
      update(p) { action = 'update'; payload = p; return api },
      insert(p) { action = 'insert'; payload = p; return api },
      then(resolve) {
        calls.push([table, action])
        if (action === 'insert') { const row = { id: `plan-${tables[table].size + 1}`, status: 'running', created_at: '2026-10-25T00:00:00Z', ...payload }; tables[table].set(row.id, row); return resolve({ data: row, error: null }) }
        const matched = [...tables[table].values()].filter(r => filters.every(f => f(r)))
        if (action === 'update') { matched.forEach(r => Object.assign(r, payload)); return resolve({ data: null, error: null }) }
        resolve({ data: single ? matched[0] ?? null : matched, error: null })
      },
    }
    return api
  } }
}

test('analysis is requested once per reel and shared afterwards', async () => {
  const now = Date.parse('2026-10-25T06:00:00Z')
  const db = fakeDb([{ shortcode: 'Aaaaa1', visible: true, analysis_status: 'none' }, { shortcode: 'Hidden1', visible: false, analysis_status: 'none' }])
  const scheduled = []
  const deps = { db, makeProviders: () => ({}), schedule: key => scheduled.push(key) }
  assert.deepEqual(await requestReelAnalysis(deps, 'Aaaaa1', now), { status: 'running' })
  assert.equal(db.tables.creator_success_reels.get('Aaaaa1').analysis_status, 'running')
  assert.deepEqual(scheduled, ['analysis:Aaaaa1'])
  db.tables.creator_success_reels.get('Aaaaa1').analysis_status = 'ready'
  assert.deepEqual(await requestReelAnalysis(deps, 'Aaaaa1', now), { status: 'ready' })
  assert.equal(scheduled.length, 1)
  await assert.rejects(requestReelAnalysis(deps, 'Hidden1', now), /확인할 수 없는/)
})

test('plans need an analyzed reel and a real brief', async () => {
  const db = fakeDb([{ shortcode: 'Aaaaa1', visible: true, analysis_status: 'ready' }, { shortcode: 'Bbbbb2', visible: true, analysis_status: 'none' }])
  const scheduled = []
  const deps = { db, makeProviders: () => ({}), schedule: key => scheduled.push(key) }
  await assert.rejects(requestReelPlan(deps, 'u1', 'Aaaaa1', '짧음'), /조금 더/)
  await assert.rejects(requestReelPlan(deps, 'u1', 'Bbbbb2', '선크림 리뷰를 하고 싶어요'), /먼저 릴스 분석/)
  const created = await requestReelPlan(deps, 'u1', 'Aaaaa1', '선크림 3종 직접 써본 후기 (30대 지성)')
  assert.equal(created.status, 'running')
  assert.deepEqual(scheduled, [`plan:${created.id}`])
  assert.equal(db.tables.creator_reel_plans.get(created.id).user_id, 'u1')
})

test('video links fall back to Bright Data and are cached until shortly before expiry', async () => {
  const now = Date.parse('2026-10-25T00:00:00Z')
  const store = new Map(), sets = []
  const redis = { get: async k => store.get(k) ?? null, set: async (k, v, _ex, ttl) => { store.set(k, v); sets.push(ttl) } }
  const oe = Math.floor(now / 1000 + 6 * 3600).toString(16).toUpperCase()
  const cdn = `https://scontent.cdninstagram.com/v/reel.mp4?oe=${oe}`
  let paid = 0
  const providers = { brightData: async () => { paid += 1; return { videoUrl: cdn } } }
  const playback = { resolve: async () => null }
  assert.equal(await reelVideoUrl({ providers, redis, playback }, 'Aaaaa1', now), cdn)
  assert.deepEqual(sets, [5 * 3600])
  assert.equal(await reelVideoUrl({ providers, redis, playback }, 'Aaaaa1', now), cdn)
  assert.equal(paid, 1)
  const free = { resolve: async () => ({ url: 'https://x.fbcdn.net/a.mp4' }) }
  assert.equal(await reelVideoUrl({ providers, redis, playback: free }, 'Bbbbb2', now), 'https://x.fbcdn.net/a.mp4')
  assert.equal(paid, 1)
  const bad = { brightData: async () => ({ videoUrl: 'https://evil.example/a.mp4' }) }
  await assert.rejects(reelVideoUrl({ providers: bad, redis, playback }, 'Ccccc3', now), /영상을 불러오지/)
})
