import assert from 'node:assert/strict'
import test from 'node:test'
import { __referenceVideoAnalysisTest } from '../src/lib/reference-video-analysis.js'

const {
  buildAccountIdentityLeakGuardPrompt,
  buildTopicBrief,
  buildTopicFocusPrompt,
  extractReferenceSurfaceTerms,
  findAccountIdentityLeakage,
  findReferenceSurfaceLeakage,
  hasSelfIntroductionBlueprint,
  normalizeGenerationTopic,
  normalizeReferenceTitle,
  validateTopicBriefAlignment,
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

test('topic brief keeps raw topic unchanged while extracting generation hints', () => {
  const topic = '간편 냉동볶음밥으로 바꿔줘. 남편/아이들이 배고프다고 할 때 냉동실에서 꺼내서 전자레인지로 바로 줄 수 있는 느낌'
  const brief = buildTopicBrief(topic)

  assert.equal(brief.rawTopic, topic)
  assert.match(brief.subject, /냉동볶음밥|바로 줄 수 있는 느낌/)
  assert.ok(brief.targetAudience.includes('남편'))
  assert.ok(brief.targetAudience.includes('아이'))
  assert.ok(brief.targetSituation.some((item) => item.includes('배고프다고 할 때')))
  assert.ok(brief.usageContext.includes('냉동실'))
  assert.ok(brief.usageContext.includes('전자레인지'))
  assert.ok(brief.mustInclude.some((item) => item.includes('냉동')))
})

test('topic focus prompt includes structured brief without changing topic prompt contract', () => {
  const topic = '육아맘이 집에서 시작하는 블로그 재택부업 모집'
  const prompt = buildTopicFocusPrompt(topic, '레퍼런스 영상')

  assert.match(prompt, /이번 릴스 주제\(반드시 반영\): 육아맘이 집에서 시작하는 블로그 재택부업 모집/)
  assert.match(prompt, /이번 릴스 주제 구조화 brief/)
  assert.match(prompt, /중심 소재\/상품\/상황/)
  assert.match(prompt, /타겟\/대상: 육아맘/)
  assert.match(prompt, /원문 문장을 그대로 대본에 복사하지 말고 의미만 반영/)
})

test('topic brief alignment passes when generated draft reflects subject and situation', () => {
  const brief = buildTopicBrief(
    '간편 냉동볶음밥으로 바꿔줘. 남편/아이들이 배고프다고 할 때 냉동실에서 꺼내서 전자레인지로 바로 줄 수 있는 느낌',
  )
  const alignment = validateTopicBriefAlignment(
    {
      hook: '밥 먹고도 아이가 배고프다 하면 또 차리기 막막하죠?',
      body: '냉동실에 간편 냉동볶음밥 하나 두면 전자레인지에 바로 돌려 줄 수 있어요.',
      cta: '오늘 저녁 루틴으로 저장해두세요.',
    },
    brief,
    {},
  )

  assert.equal(alignment.ok, true)
  assert.equal(alignment.shouldRetry, false)
  assert.ok(alignment.matched.some((item) => item.includes('냉동볶음밥')))
})

test('topic brief alignment requests retry when subject is missing', () => {
  const brief = buildTopicBrief('물광토너 제품소개')
  const alignment = validateTopicBriefAlignment(
    {
      hook: '아침마다 피부가 답답해 보이면 루틴부터 바꿔보세요.',
      body: '세안 후 첫 단계에서 가볍게 정리하면 화장이 덜 밀려요.',
      cta: '댓글 남기시면 루틴표 보내드릴게요.',
    },
    brief,
    {},
  )

  assert.equal(alignment.ok, false)
  assert.equal(alignment.shouldRetry, true)
  assert.ok(alignment.issues.includes('subject_missing'))
})

test('topic brief alignment blocks raw topic copy and reference surface leakage', () => {
  const brief = buildTopicBrief('옷입을 때 활용하기 좋은 색조합 팁')
  const alignment = validateTopicBriefAlignment(
    {
      hook: '옷입을 때 활용하기 좋은 색조합 팁 그대로 알려드릴게요.',
      body: '레레퍼퍼에서 보던 방식처럼 색을 고르면 쉬워요.',
      cta: '저장하고 내일 입을 옷에 바로 써보세요.',
    },
    brief,
    { surfaceTerms: ['레레퍼퍼'] },
  )

  assert.equal(alignment.ok, false)
  assert.equal(alignment.shouldRetry, true)
  assert.ok(alignment.issues.includes('raw_topic_copied'))
  assert.ok(alignment.issues.includes('reference_surface_leakage'))
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

test('non-reference greeting openings are blocked from generated hooks', () => {
  const guard = {
    category: '생활',
    anchors: ['청소'],
    settingCues: [],
    hardSettingCues: [],
    instagramId: '',
  }
  const structureBlueprint = {
    sentenceBlueprint: [
      {
        section: 'hook',
        sourceSentence: '바닥 청소 오래 걸리나요?',
        role: '문제를 바로 찌르는 질문',
      },
    ],
  }
  const variation = {
    hook: '안녕하세요, 바닥 청소 오래 걸리나요?',
    body: '청소 순서만 바꿔도 시간이 줄어듭니다.',
    cta: '저장하고 오늘 청소할 때 바로 써보세요.',
  }

  const alignment = validateVariationAlignment(variation, guard, {}, structureBlueprint)

  assert.equal(alignment.ok, false)
  assert.match(alignment.reason, /레퍼런스에 없는 HOOK 말머리 삽입/)
})

test('greeting openings are allowed when reference hook starts with greeting', () => {
  const guard = {
    category: '생활',
    anchors: ['청소'],
    settingCues: [],
    hardSettingCues: [],
    instagramId: '',
  }
  const structureBlueprint = {
    sentenceBlueprint: [
      {
        section: 'hook',
        sourceSentence: '안녕하세요, 오늘은 청소 순서를 정리해볼게요.',
        role: '인사 후 주제 소개',
      },
    ],
  }
  const variation = {
    hook: '안녕하세요, 오늘은 바닥 청소 순서를 정리해볼게요.',
    body: '위에서 아래로 정리하면 같은 시간에도 덜 반복하게 됩니다.',
    cta: '저장하고 오늘 청소할 때 바로 써보세요.',
  }

  const alignment = validateVariationAlignment(variation, guard, {}, structureBlueprint)

  assert.equal(alignment.ok, true)
})

test('identity leak guard prompt tells model not to treat personal influencer as self intro', () => {
  const prompt = buildAccountIdentityLeakGuardPrompt({ instagramId: 'labdotory' })

  assert.match(prompt, /@labdotory/)
  assert.match(prompt, /직접 쓰지 않는다/)
  assert.match(prompt, /personal-influencer/)
})
