import test from 'node:test'
import assert from 'node:assert/strict'
import { featureEnabled, stableHash, normalizeInstagramUrl, validateManifest, keepRanges, retimeSubtitles, toSrt, safeCutCandidates, mediaUploadDisposition } from '../src/creator-tools/domain.js'
import { publicAddress, resolvePublicUrl } from '../src/creator-tools/network.js'
import { verifiedAccount, weightedScore, keywordResult } from '../src/creator-tools/discovery.js'
import { translateSegments, validateTranslation } from '../src/creator-tools/link-import.js'
import { publicJob } from '../src/creator-tools/store.js'
import { selectMetaConnection } from '../src/creator-tools/providers.js'

const uploadFile = { filename: 'qa.mp4', size: 1234, mimeType: 'video/mp4' }
const uploadRow = { original_name: 'qa.mp4', declared_size: '1234', mime_type: 'video/mp4', status: 'uploading', original_expires_at: '2099-01-01T00:00:00Z' }
test('lost upload response resumes an existing job instead of uploading or charging twice', () => {
  assert.equal(mediaUploadDisposition(uploadRow, uploadFile), 'upload')
  for (const status of ['uploading', 'analyzing', 'ready', 'completed', 'failed']) {
    assert.equal(mediaUploadDisposition({ ...uploadRow, status, job_id: 'existing-job' }, uploadFile), 'resume')
  }
})
test('upload replay refuses changed files, expired originals and invalid closed states', () => {
  for (const file of [{ ...uploadFile, size: 99 }, { ...uploadFile, filename: 'other.mp4' }, { ...uploadFile, mimeType: 'video/webm' }]) {
    assert.throws(() => mediaUploadDisposition(uploadRow, file), { code: 'IDEMPOTENCY_CONFLICT' })
  }
  for (const original_expires_at of ['2000-01-01', 'invalid']) {
    assert.throws(() => mediaUploadDisposition({ ...uploadRow, job_id: 'old-job', original_expires_at }, uploadFile), { code: 'MEDIA_EXPIRED' })
  }
  assert.throws(() => mediaUploadDisposition({ ...uploadRow, status: 'completed' }, uploadFile), { code: 'UPLOAD_CLOSED' })
})

test('rollout is off by default and stable per user, never activated by frontend', () => {
  assert.equal(featureEnabled('import-link','u', {}), false)
  const env = { CREATOR_TOOLS_ENABLED: 'true', CREATOR_TOOLS_FEATURES: 'import-link', CREATOR_TOOLS_ROLLOUT_PERCENT: '0', CREATOR_TOOLS_USER_IDS: 'internal' }
  assert.equal(featureEnabled('import-link','internal',env), true)
  assert.equal(featureEnabled('media-render','internal',env), false)
  assert.equal(featureEnabled('import-link','student',env), false)
  env.CREATOR_TOOLS_ROLLOUT_PERCENT = '100'
  assert.equal(featureEnabled('import-link','student',env), true)
})
test('Meta connection prefers a user token and otherwise uses the server-side preview connection', () => {
  const rows = [{ user_id:'service', encrypted_token:'shared' }, { user_id:'member', encrypted_token:'personal' }]
  assert.equal(selectMetaConnection(rows, 'member', 'service').encrypted_token, 'personal')
  assert.equal(selectMetaConnection(rows, 'other', 'service').encrypted_token, 'shared')
  assert.equal(selectMetaConnection([], 'other', 'service'), null)
})
test('canonical Instagram links reject credentials, ports, unsupported domains and profiles', () => {
  assert.equal(normalizeInstagramUrl('https://instagram.com/p/abcDEF12/?igsh=tracking'), 'https://www.instagram.com/reel/abcDEF12/')
  for (const url of ['http://instagram.com/p/abcDEF12/', 'https://instagram.com.evil.com/reel/abcDEF12/',
    'https://user:password@instagram.com/reel/abcDEF12/', 'https://www.instagram.com/profile', 'https://127.0.0.1/reel/abcDEF12/']) {
    assert.throws(() => normalizeInstagramUrl(url))
  }
})
test('idempotency fingerprints ignore property ordering but include context', () => {
  assert.equal(stableHash({ a:1,b:2 }), stableHash({ b:2,a:1 }))
  assert.notEqual(stableHash({ topic:'요리', accountId:'1' }), stableHash({ topic:'요리', accountId:'2' }))
})
test('SSRF excludes private, reserved, mapped IPv4 and mixed DNS responses', async () => {
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','100.64.0.1','::1','fc00::1','::ffff:127.0.0.1','0.0.0.0','224.0.0.1']) assert.equal(publicAddress(ip), false, ip)
  assert.equal(publicAddress('8.8.8.8'), true)
  await assert.rejects(resolvePublicUrl('https://example.com/video', async () => [{ address:'8.8.8.8',family:4 },{ address:'10.1.1.1',family:4 }]))
  await assert.rejects(resolvePublicUrl('https://user:secret@example.com/video'))
})
const original = { cuts: [{ id:'s1',start:2,end:4,enabled:false }], words:[{start:0,end:1.5},{start:4.3,end:6}], subtitles:[{id:'a',start:0,end:6,text:'첫 문장'}] }
test('only original safe cut candidates can be selected; words cannot be removed', () => {
  const valid = validateManifest({ cuts:[{id:'s1',enabled:true}],subtitles:original.subtitles }, original, 7)
  assert.deepEqual(keepRanges(7,valid.cuts), [{start:0,end:2},{start:4,end:7}])
  assert.throws(() => validateManifest({ cuts:[{id:'other',enabled:true}],subtitles:[] },original,7))
  const unsafe = { ...original,words:[{start:2.1,end:3.4}] }
  assert.throws(() => validateManifest({ cuts:[{id:'s1',enabled:true}],subtitles:[] },unsafe,7))
  assert.throws(() => validateManifest({ cuts:[],subtitles:[] },original,7))
})
test('subtitle time validation rejects NaN, overlaps and out-of-bounds', () => {
  for (const subtitles of [[{start:0,end:NaN,text:'a'}],[{start:0,end:3,text:'a'},{start:2,end:5,text:'b'}],[{start:0,end:8,text:'a'}]]) {
    assert.throws(() => validateManifest({ cuts:original.cuts,subtitles }, original,7))
  }
})
test('subtitles retime across cuts including silent spans and produce UTF-8 SRT', () => {
  const timed = retimeSubtitles([{start:0,end:6,text:'안녕하세요 한글'}, {start:6,end:7,text:'마무리'}],[{start:2,end:4,enabled:true}])
  assert.equal(timed[0].end, 4)
  assert.equal(timed[1].start, 4)
  assert.match(toSrt(timed), /00:00:04,000 --> 00:00:05,000\n마무리/)
  assert.match(toSrt(timed), /안녕하세요 한글/)
})
test('no timestamps means no automatic cut suggestions; suggestions start unselected', () => {
  assert.deepEqual(safeCutCandidates([{start:2,end:4}],[],7), [])
  const cuts = safeCutCandidates([{start:2,end:4}],original.words,7)
  assert.equal(cuts.length,1); assert.equal(cuts[0].enabled,false)
})
test('unverified keyword counts cannot earn a verified badge or synthetic trend score', () => {
  const result = keywordResult({keyword:'살림',postCount:9000},{status:'available',media:Array(25).fill({})},'2026-09-13')
  assert.equal(result.postCount,null); assert.equal(result.countStatus,'unavailable')
  assert.equal(result.trendScore,null); assert.equal(result.trendDirection,'unavailable')
})
test('stale, unverified and inactive accounts do not become recommendations', () => {
  const now = Date.now(), row = { active:true,professional:true,verified_at:new Date(now).toISOString(),last_active_at:new Date(now).toISOString() }
  assert.equal(verifiedAccount(row,now),false, 'legacy rows without quality evidence and operator review are not approved')
  assert.equal(verifiedAccount({...row,professional:false},now),false)
  assert.equal(verifiedAccount({...row,last_active_at:'2020-01-01'},now),false)
  assert.equal(weightedScore({topic:80,engagement:null},{topic:35,engagement:20}),80)
})
test('translation preserves segment count, identity, order and numeric claims', () => {
  const source = [{id:'a',start:0,end:1,text:'Use 3 items.'}]
  assert.equal(validateTranslation(source,[{id:'a',text:'3개를 사용하세요.'}])[0].text,'3개를 사용하세요.')
  assert.throws(() => validateTranslation(source,[{id:'a',text:'5개를 사용하세요.'}]))
  assert.throws(() => validateTranslation(source,[]))
})
test('translation retries once when the model changes a numeric claim', async () => {
  const calls = []
  const providers = { json: async (operation, _instruction, input) => {
    calls.push(operation)
    if (operation === 'verify-reference-numbers') return {segments:input.segments.map(s => ({id:s.id,verdict:'equivalent',sourceQuotes:[s.source],translatedQuotes:[s.translation],reason:'원문 수량 보존'}))}
    return { segments: [{ id: 'a', text: operation.endsWith('correction')
      ? `${input.segments[0].text.match(/__HOOKAINUM[A-Z]+__/)[0]}3개를 사용하세요.` : '5개를 사용하세요.' }] }
  } }
  const source = [{ id: 'a', start: 0, end: 1, text: 'Use 3 items.' }]
  const result = await translateSegments(providers, 'en', source)
  assert.equal(result[0].text, '3개를 사용하세요.')
  assert.deepEqual(calls, ['translate-reference', 'translate-reference-correction', 'verify-reference-numbers'])
})
test('public jobs never expose checkpoints or entitlement credentials', () => {
  const result = publicJob({ id:'a',input:{secret:'x'},checkpoint:{videoUrl:'private'},user_id:'x',status:'queued' })
  assert.equal('input' in result,false); assert.equal('checkpoint' in result,false); assert.equal('user_id' in result,false)
})

test('manual timelines allow reordering but reject forged sources, invalid bounds and excessive duration', () => {
  const clips = [{id:'last',start:5,end:7},{id:'first',start:0,end:2}]
  const manifest = validateManifest({...original,clips},original,7)
  assert.deepEqual(manifest.clips,clips)
  for (const bad of [[],[{id:'a',start:-1,end:2}],[{id:'a',start:0,end:8}],[{id:'a',start:1,end:1.01}],[{id:'a',start:NaN,end:2}],[{id:'a',start:0,end:2},{id:'a',start:3,end:4}],Array.from({length:51},(_,i)=>({id:String(i),start:0,end:7}))]) {
    assert.throws(()=>validateManifest({...original,clips:bad},original,7))
  }
  assert.equal('url' in validateManifest({...original,clips:[{id:'a',start:0,end:2,url:'http://127.0.0.1',assetId:'foreign'}]},original,7).clips[0],false)
})
test('reordered repeated clips carry only intersecting subtitle content in output order', async () => {
  const { projectSubtitles } = await import('../src/creator-tools/domain.js')
  const projected = projectSubtitles([{start:0,end:2,text:'처음'},{start:4,end:6,text:'마지막'}],[{start:4.5,end:6},{start:0,end:1},{start:4.5,end:5}])
  assert.deepEqual(projected,[{start:0,end:1.5,text:'마지막'},{start:1.5,end:2.5,text:'처음'},{start:2.5,end:3,text:'마지막'}])
})
test('feedback keeps valid findings and safely downgrades unreliable model timestamps', async () => {
  const { validateFeedback, FEEDBACK_AREAS } = await import('../src/creator-tools/feedback.js')
  const findings=FEEDBACK_AREAS.map(area=>({area,evidence:'unverified',start:null,end:null,problem:'확인되지 않음',reason:'표본 정보 부족',example:'전체 장면을 직접 확인하세요.'}))
  assert.equal(validateFeedback({findings},5,[0,2,4]).findings.length,5)
  const missing = validateFeedback({findings:findings.slice(1)},5,[0])
  assert.equal(missing.findings.length,5)
  assert.equal(missing.findings.find(item=>item.area==='hook').evidence,'unverified')
  const absentFrameTime = validateFeedback({findings:[{...findings[0],evidence:'frame'},...findings.slice(1)]},5,[0,2,4])
  assert.deepEqual(absentFrameTime.findings[0],{...findings[0],evidence:'unverified'})
  const fabricatedFrame = validateFeedback({findings:[{...findings[0],evidence:'frame',start:3,end:3.5},...findings.slice(1)]},5,[0,2,4])
  assert.equal(fabricatedFrame.findings[0].evidence,'unverified')
  assert.equal(fabricatedFrame.findings[0].start,null)
  const roundedBoundary = validateFeedback({findings:[{...findings[0],evidence:'transcript',start:45.2,end:50},...findings.slice(1)]},49.28,[0,12.32,24.64,36.96,48.294])
  assert.equal(roundedBoundary.findings[0].end,49.28)
  assert.throws(()=>validateFeedback({findings:[{...findings[0],evidence:'invented'},...findings.slice(1)]},5,[0]))
})
test('temporary media workspace is removed even on processing failure', async () => {
  const {workspace} = await import('../src/creator-tools/media.js')
  const {access,writeFile} = await import('node:fs/promises')
  let path
  await assert.rejects(workspace(async directory=>{path=directory;await writeFile(`${directory}/private.txt`,'test');throw new Error('intentional failure')}))
  await assert.rejects(access(path))
})
