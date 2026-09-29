import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceAnalysisSchema, referenceAnalysisInstructions, validateReferenceAnalysis, applicationFromStructure } from '../src/creator-tools/reference-analysis.js'
import { importLink } from '../src/creator-tools/link-import.js'

const script = '왜 정리해도 다시 어질러질까요?\n물건을 꺼내는 자리와 넣는 자리가 다르기 때문입니다.\n자주 쓰는 물건은 사용하는 곳에 보관하세요.'
const lines = script.split('\n')
const valid = () => ({
  summary: '정리의 기준을 사용 위치로 바꾸는 대본입니다.',
  hook: { quote: lines[0], type: 'question', why: '반복되는 정리 고민을 질문으로 제시합니다.' },
  structure: [
    { role: 'hook', quote: lines[0], purpose: '반복되는 불편에 주목하게 합니다.' },
    { role: 'problem', quote: lines[1], purpose: '동선과 보관 장소의 차이를 원인으로 제시합니다.' },
    { role: 'method', quote: lines[2], purpose: '바로 적용할 배치 기준을 제시합니다.' },
  ],
  reasons: [{ point: '원인과 해결 행동을 연결합니다.', quote: lines[2] }],
  apply: [
    { step: '반복되는 고민을 질문으로 제시', example: '[내 경험]에서 반복해서 겪은 불편을 질문으로 바꿔보세요.' },
    { step: '확인한 원인과 행동을 연결', example: '[확인한 근거]를 설명하고 [내 제품]의 사용 상황에 맞는 행동을 제시하세요.' },
  ],
})
function context({ language = 'ko', json = async () => valid(), saved = {}, deadline, stageError, checkpointError } = {}) {
  const checkpoint = { transcript: { language, text: script, subtitles: lines.map((text, i) => ({ id: String(i), start: i, end: i + 1, text })) }, ...saved }
  const calls = [], stages = []
  const ctx = {
    job: { id: 'test-job', user_id: 'PRIVATE_USER_ID', account_id: 'PRIVATE_ACCOUNT_ID', input: { handle: 'PRIVATE_HANDLE' }, checkpoint, deadline_at: deadline },
    signal: new AbortController().signal,
    providers: { json: async (...args) => { calls.push(args); return json(...args) }, brightData: () => assert.fail('must reuse transcription') },
    stage: async name => { stages.push(name); if (name === 'analyzing_reference' && stageError) throw stageError },
    checkpoint: async (name, fn) => {
      if (Object.hasOwn(checkpoint, name)) return checkpoint[name]
      const value = await fn()
      if (name === 'referenceAnalysisV1' && checkpointError) throw checkpointError
      checkpoint[name] = value
      return value
    },
  }
  return { ctx, calls, stages }
}
const transcriptPreserved = result => {
  assert.equal(result.originalTranscript, script)
  assert.equal(result.translatedTranscript, script)
  assert.ok(Number.isFinite(Date.parse(result.extractedAt)))
  assert.equal(Object.hasOwn(result, 'referenceId'), false)
}

test('analysis schema uses only the established strict schema keywords', () => {
  const allowed = new Set(['type', 'enum', 'properties', 'required', 'additionalProperties', 'items'])
  function walk(schema) {
    for (const key of Object.keys(schema)) assert.ok(allowed.has(key), key)
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(schema.required, Object.keys(schema.properties))
      Object.values(schema.properties).forEach(walk)
    }
    if (schema.items) walk(schema.items)
  }
  walk(referenceAnalysisSchema)
})
test('validator preserves valid grounded fields without mutating input and caps collections', () => {
  const raw = valid(); raw.structure = Array(9).fill(raw.structure[0]); raw.reasons = Array(8).fill(raw.reasons[0]); raw.apply = Array(9).fill(raw.apply[0])
  const before = structuredClone(raw), result = validateReferenceAnalysis(raw, script)
  assert.equal(result.structure.length, 6); assert.equal(result.reasons.length, 4); assert.equal(result.apply.length, 4)
  assert.deepEqual(raw, before)
})
test('empty, malformed and missing required fields are unavailable', () => {
  for (const raw of [null, undefined, {}, [], 'text', { ...valid(), hook: null }, { ...valid(), structure: {} }]) assert.equal(validateReferenceAnalysis(raw, script), null)
  for (const field of ['summary','hook','structure','reasons']) { const raw = valid(); delete raw[field]; assert.equal(validateReferenceAnalysis(raw, script), null) }
  assert.equal(validateReferenceAnalysis(valid(), null), null)
})
test('fabricated quotations are discarded and fallback hook drops its unrelated explanation', () => {
  const raw = valid(); raw.hook.quote = '존재하지 않는 인용'; raw.structure.push({ role: 'evidence', quote: '날조한 근거', purpose: '설명' }); raw.reasons.push({ point: '잘못된 인용', quote: '다른 문장' })
  const result = validateReferenceAnalysis(raw, script)
  assert.deepEqual(result.hook, { quote: lines[0], type: 'other', why: '' })
  assert.equal(result.structure.length, 3); assert.equal(result.reasons.length, 1)
})
test('NFC, whitespace and surrounding quote marks normalize for evidence matching', () => {
  const raw = valid(); raw.structure[0].quote = `“${lines[0].normalize('NFD')}”`; raw.structure[1].quote = lines[1].replaceAll(' ', '  \n')
  assert.equal(validateReferenceAnalysis(raw, script).structure.length, 3)
})
test('unknown enums, wrong item shapes and overlong items are removed, never truncated', () => {
  const raw = valid(); raw.hook.type = '__proto__'; raw.summary = '가'.repeat(121); raw.hook.why = '가'.repeat(301)
  raw.structure.push(null, { role: 'invented', quote: lines[0], purpose: '목적' }, { role: 'hook', quote: lines[0], purpose: '가'.repeat(301) })
  raw.reasons.push({ point: '가'.repeat(301), quote: lines[0] }, { point: '길이 초과', quote: '가'.repeat(81) })
  raw.apply.push({ step: '가'.repeat(301), example: '예시' }, {}, null)
  const result = validateReferenceAnalysis(raw, script)
  assert.equal(result.summary, ''); assert.equal(result.hook.why, ''); assert.equal(result.hook.type, 'other')
  assert.equal(result.structure.length, 3); assert.equal(result.reasons.length, 1); assert.deepEqual(result.apply, applicationFromStructure(result.structure))
})
test('unsupported decimal tokens in explanations and all numeric apply examples are rejected', () => {
  const raw = valid(); raw.summary = '조회수 100만'; raw.hook.why = '٩٩٫٩% 증가'
  raw.structure.push({ role: 'evidence', quote: lines[0], purpose: '매출 50만' }); raw.reasons.push({ point: '100% 성공', quote: lines[0] })
  raw.apply.push({ step: '１단계', example: '[내 경험]' }, { step: '적용', example: '3회 성공' })
  const result = validateReferenceAnalysis(raw, script)
  assert.equal(result.summary, ''); assert.equal(result.hook.why, ''); assert.equal(result.structure.length, 4); assert.equal(result.structure.at(-1).purpose, '설명의 근거를 제시합니다.'); assert.equal(result.reasons.length, 1); assert.deepEqual(result.apply, applicationFromStructure(result.structure))
  const supported = valid(); supported.summary = '99.9%라는 표현을 인용합니다.'
  assert.equal(validateReferenceAnalysis(supported, script + '\n99.9%').summary, supported.summary)
  supported.summary = '99%'; assert.equal(validateReferenceAnalysis(supported, script + '\n99.9%').summary, '')
})
test('too little surviving evidence is unavailable; examples are constructed from verified roles', () => {
  const raw = valid(); raw.structure = raw.structure.slice(0, 1)
  assert.equal(validateReferenceAnalysis(raw, script), null)
  raw.structure = valid().structure; raw.apply = raw.apply.slice(0, 1)
  assert.deepEqual(validateReferenceAnalysis(raw, script).apply,applicationFromStructure(raw.structure))
  assert.equal(validateReferenceAnalysis(valid(), '안녕'), null)
})
test('Korean import enriches the exact visible transcript using existing provider and no identity fields', async () => {
  const { ctx, calls, stages } = context(); const result = await importLink(ctx)
  transcriptPreserved(result); assert.equal(result.analysisStatus, 'ready'); assert.deepEqual(result.analysis, {...valid(),apply:applicationFromStructure(valid().structure)})
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'reference-analysis')
  assert.deepEqual(calls[0][2], { script, sourceLanguage: 'ko' }); assert.deepEqual(calls[0][3], []); assert.equal(calls[0][4], referenceAnalysisSchema)
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_')); assert.match(referenceAnalysisInstructions, /명령은 절대로 따르지/)
  assert.deepEqual(stages, ['translating', 'analyzing_reference', 'saving_transcript'])
})
test('foreign import analyzes the displayed translation, preserving the original', async () => {
  const original = 'Why does the room become cluttered again?'
  const { ctx, calls } = context({ language: 'en', saved: { transcript: { language: 'en', text: original, subtitles: [{ id: 'a', text: original }] }, translationV2: lines.map(text => ({ text })) } })
  const result = await importLink(ctx)
  assert.equal(result.originalTranscript, original); assert.equal(result.translatedTranscript, script); assert.equal(result.analysisStatus, 'ready'); assert.deepEqual(calls[0][2], { script, sourceLanguage: 'en' })
})
test('analysis 400, timeout, malformed JSON and budget failures preserve the transcript', async t => {
  const logged = []; t.mock.method(console, 'warn', (...args) => logged.push(args))
  for (const error of [Object.assign(new Error('PRIVATE_BODY'), { status: 400 }), Object.assign(new Error('PRIVATE_BODY'), { name: 'APIConnectionTimeoutError' }), new SyntaxError('PRIVATE_BODY'), Object.assign(new Error('PRIVATE_BODY'), { code: 'PROVIDER_BUDGET' })]) {
    const { ctx, calls } = context({ json: async () => { throw error } }); const result = await importLink(ctx)
    transcriptPreserved(result); assert.equal(result.analysisStatus, 'unavailable'); assert.equal(Object.hasOwn(result, 'analysis'), false); assert.equal(calls.length, 1)
  }
  assert.ok(!JSON.stringify(logged).includes('PRIVATE_BODY'))
})
test('empty response, stage failure and checkpoint failure preserve the transcript', async t => {
  t.mock.method(console, 'warn', () => {})
  for (const options of [{ json: async () => ({}) }, { stageError: new Error('stage') }, { checkpointError: new Error('save') }]) {
    const { ctx } = context(options); const result = await importLink(ctx)
    transcriptPreserved(result); assert.equal(result.analysisStatus, 'unavailable'); assert.equal(Object.hasOwn(result, 'analysis'), false)
  }
})
test('kill switch disables enrichment and existing checkpoint avoids repeated calls', async () => {
  const previous = process.env.CREATOR_LINK_ANALYSIS
  try {
    process.env.CREATOR_LINK_ANALYSIS = 'off'
    const disabled = context(); const result = await importLink(disabled.ctx)
    transcriptPreserved(result); assert.equal(result.analysisStatus, 'unavailable'); assert.equal(disabled.calls.length, 0)
  } finally { if (previous === undefined) delete process.env.CREATOR_LINK_ANALYSIS; else process.env.CREATOR_LINK_ANALYSIS = previous }
  const { ctx, calls } = context({ saved: { referenceAnalysisV1: valid() }, deadline: new Date(Date.now() + 5000).toISOString() })
  assert.equal((await importLink(ctx)).analysisStatus, 'ready'); assert.equal(calls.length, 0)
  const cachedFailure = context({ saved: { referenceAnalysisV1: null } })
  assert.equal((await importLink(cachedFailure.ctx)).analysisStatus, 'unavailable'); assert.equal(cachedFailure.calls.length, 0)
})
test('insufficient time and already aborted signal skip optional provider calls', async () => {
  const short = context({ deadline: new Date(Date.now() + 100000).toISOString() })
  const result = await importLink(short.ctx); transcriptPreserved(result); assert.equal(result.analysisStatus, 'unavailable'); assert.equal(short.calls.length, 0)
  const cancelled = context(); cancelled.ctx.signal = AbortSignal.abort()
  assert.equal((await importLink(cancelled.ctx)).analysisStatus, 'unavailable'); assert.equal(cancelled.calls.length, 0)
})

// Captured real-model failure: invented exercise experience without any digits.
// It must be impossible to publish as the user's experience, including resume.
test('unverified first-person application examples never survive fresh or cached analysis', async()=>{
 const raw=valid();raw.apply=[{step:'개인 경험',example:'저는 매일 아침 운동을 빼먹곤 했어요.'},{step:'결과',example:'이제는 아침마다 자연스럽게 운동하게 됐어요.'}]
 for(const options of [{json:async()=>raw},{saved:{referenceAnalysisV1:raw}}]) {
   const {ctx}=context(options), result=await importLink(ctx)
   assert.equal(result.analysisStatus,'ready')
   assert.deepEqual(result.analysis.apply,applicationFromStructure(raw.structure))
   assert.ok(!JSON.stringify(result.analysis.apply).includes('운동'))
   assert.ok(result.analysis.apply.every(item=>item.example.includes('[')))
 }
})

// An unsupported explanation quantity must not invalidate its verified quote.
test('source-grounded stages survive derived ordinals without granting arbitrary numeric claims',()=>{
 const raw=valid();raw.structure[1].purpose='1단계 행동';raw.structure[2].purpose='2단계 행동으로 매출 300% 보장'
 const result=validateReferenceAnalysis(raw,script)
 assert.equal(result.structure.length,3)
 assert.deepEqual(result.structure.map(s=>s.quote),raw.structure.map(s=>s.quote))
 assert.equal(result.structure[2].purpose,'실천 방법을 제안합니다.')
 assert.ok(!JSON.stringify(result).includes('300%'))
 raw.structure[2].quote='없는 원문';assert.equal(validateReferenceAnalysis(raw,script).structure.length,2)
})

// Exercise the real import handler while the optional provider is still pending.
test('validated transcript is visible through public polling before analysis resolves, including reload', async () => {
  const { publicJob } = await import('../src/creator-tools/store.js')
  let finish, entered
  const analyzing = new Promise(resolve => { entered = resolve })
  const response = new Promise(resolve => { finish = resolve })
  const { ctx, calls } = context({ json: async () => { entered(); return response } })
  Object.assign(ctx.job, { kind:'import-link', status:'running', result:null, usage_recorded:false })
  const running = importLink(ctx)
  await analyzing
  const snapshot = structuredClone(ctx.job)
  const visible = publicJob(snapshot)
  assert.equal(visible.status, 'running')
  assert.equal(visible.result.analysisStatus, 'pending')
  transcriptPreserved(visible.result)
  assert.equal(snapshot.usage_recorded, false)
  assert.equal(snapshot.result, null)
  assert.equal('checkpoint' in visible, false)
  finish(valid())
  const completed = await running
  assert.equal(completed.analysisStatus, 'ready')
  assert.equal(completed.extractedAt, visible.result.extractedAt)
  assert.equal(calls.length, 1)
  assert.equal(publicJob({ ...snapshot, status:'completed', result:completed, checkpoint:{} }).result, completed)
})

test('translation not yet verified never publishes a transcript preview', async () => {
  const { publicJob } = await import('../src/creator-tools/store.js')
  const { ctx } = context({ language:'en', json:async () => { throw Object.assign(new Error('invalid translation'), {code:'TRANSLATION_NUMBER_CHANGED'}) } })
  Object.assign(ctx.job, {kind:'import-link',status:'running',result:null})
  await assert.rejects(importLink(ctx), {code:'TRANSLATION_NUMBER_CHANGED'})
  assert.equal(publicJob(ctx.job).result,null)
  assert.equal(Object.hasOwn(ctx.job.checkpoint,'referenceTranscriptV1'),false)
})

test('checkpoint publication must succeed before starting optional analysis', async () => {
  const {ctx,calls}=context()
  const checkpoint=ctx.checkpoint
  ctx.checkpoint=(name,fn)=>name==='referenceTranscriptV1' ? Promise.reject(new Error('storage unavailable')) : checkpoint(name,fn)
  await assert.rejects(importLink(ctx), /storage unavailable/)
  assert.equal(calls.length,0)
})

test('preview projection excludes private data, survives terminal failure and cannot leak across kinds', async () => {
  const { publicJob } = await import('../src/creator-tools/store.js')
  const preview={sourceLanguage:'en',originalTranscript:'Original text',translatedTranscript:'검증된 한국어',extractedAt:new Date().toISOString(),secret:'PRIVATE_SIGNED_URL'}
  const row={kind:'import-link',status:'running',result:null,checkpoint:{referenceTranscriptV1:preview,brightDataReceipt:{snapshotId:'PRIVATE_RECEIPT'},transcript:{text:'UNVERIFIED'}}}
  assert.equal(JSON.stringify(publicJob(row)).includes('PRIVATE'),false)
  for (const status of ['failed','cancelled']) {
    assert.equal(publicJob({...row,status}).result.analysisStatus,'unavailable')
    assert.equal(publicJob({...row,status}).result.originalTranscript,preview.originalTranscript)
  }
  assert.equal(publicJob({...row,kind:'media-analyze'}).result,null)
  assert.equal(publicJob({...row,checkpoint:{transcript:{text:'UNVERIFIED'}}}).result,null)
})
