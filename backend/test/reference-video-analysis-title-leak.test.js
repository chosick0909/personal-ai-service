import assert from 'node:assert/strict'
import test from 'node:test'
import { __referenceVideoAnalysisTest } from '../src/lib/reference-video-analysis.js'

const {
  buildAccountIdentityLeakGuardPrompt,
  buildTopicFocusPrompt,
  extractReferenceSurfaceTerms,
  findAccountIdentityLeakage,
  findReferenceSurfaceLeakage,
  hasSelfIntroductionBlueprint,
  normalizeGenerationTopic,
  normalizeReferenceTitle,
  validateVariationAlignment,
} = __referenceVideoAnalysisTest

test('empty reel topic never falls back to reference video title', () => {
  const referenceTitle = normalizeReferenceTitle({
    title: '레레퍼퍼',
    originalFilename: 'ScreenRecording_2026-05-07.mov',
  })
  const topic = normalizeGenerationTopic('', referenceTitle)

  assert.equal(referenceTitle, '레레퍼퍼')
  assert.equal(topic, '일반')
  assert.equal(buildTopicFocusPrompt(topic, referenceTitle), '')
})

test('reference video title is always treated as forbidden surface text', () => {
  const terms = extractReferenceSurfaceTerms({
    title: '레레퍼퍼',
    topic: '일반',
    transcript: '운동 루틴은 처음부터 너무 세게 잡으면 오래 못 갑니다.',
  })

  assert.ok(terms.includes('레레퍼퍼'))
  assert.equal(findReferenceSurfaceLeakage('레레퍼퍼 때문에 운동 4주를 날려요.', terms), '레레퍼퍼')
  assert.equal(findReferenceSurfaceLeakage('레 레퍼퍼 때문에 운동 4주를 날려요.', terms), '레레퍼퍼')
})

test('account instagram id is blocked as internal metadata, not script text', () => {
  const guard = {
    category: '뷰티',
    anchors: ['실루엣'],
    settingCues: ['퍼스널 인플루언싱'],
    hardSettingCues: [],
    instagramId: 'labdotory',
  }
  const variation = {
    hook: '오늘부터 7일, 얼굴이 작아 보이는 실루엣으로 바꿉니다. 저는 @labdotory예요.',
    body: '체형과 얼굴형을 보고 네크라인을 맞추면 인상이 달라집니다.',
    cta: '저장하고 내 옷장에서 바로 확인해보세요.',
  }

  const leak = findAccountIdentityLeakage([variation.hook, variation.body, variation.cta].join('\n'), guard, {})
  const alignment = validateVariationAlignment(variation, guard, {}, {})

  assert.match(leak, /인스타그램 ID 직접 노출/)
  assert.equal(alignment.ok, false)
  assert.match(alignment.reason, /인스타그램 ID 직접 노출|계정 내부 세팅값 누출/)
})

test('self intro is blocked unless reference blueprint explicitly contains intro role', () => {
  const guard = {
    category: '뷰티',
    anchors: ['실루엣'],
    settingCues: [],
    hardSettingCues: [],
    instagramId: '',
  }
  const variation = {
    hook: '딱 4단계로 얼굴형에 맞는 실루엣을 잡아드릴게요. 저는 스타일 코치입니다.',
    body: '먼저 목선과 어깨선을 보고 답답해 보이는 지점을 줄입니다.',
    cta: '저장하고 오늘 입을 상의부터 확인해보세요.',
  }
  const introBlueprint = {
    sentenceBlueprint: [{ role: '화자 자기소개', sentenceRole: 'account_intro' }],
  }

  assert.match(findAccountIdentityLeakage(variation.hook, guard, {}), /자기소개/)
  assert.equal(hasSelfIntroductionBlueprint(introBlueprint), true)
  assert.equal(findAccountIdentityLeakage(variation.hook, guard, introBlueprint), '')
})

test('identity leak guard prompt tells model not to treat personal influencer as self intro', () => {
  const prompt = buildAccountIdentityLeakGuardPrompt({ instagramId: 'labdotory' })

  assert.match(prompt, /@labdotory/)
  assert.match(prompt, /직접 쓰지 않는다/)
  assert.match(prompt, /personal-influencer/)
})
