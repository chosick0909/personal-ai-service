import assert from 'node:assert/strict'
import test from 'node:test'
import { __scriptAssistantTest } from '../src/lib/script-assistant.js'

const {
  buildDraftBlock,
  buildFeedbackUserPrompt,
  buildRefineUserPrompt,
  buildReferenceContaminationGuard,
  buildReferenceStructureContext,
  compactReferenceSignal,
  normalizeEditTarget,
  getTargetSections,
  inferRequestedSections,
  applyEditScope,
  buildEditOutputInstruction,
  extractProposedSections,
  createSectionDiff,
  validateScriptFlow,
  buildEditScopeInstruction,
  buildCopilotEvaluationRubric,
  buildCopilotMentorToneGuide,
  buildCopilotResponseModeRule,
  buildCopilotEditPlaybook,
  normalizeCopilotMemory,
  formatCopilotMemoryForPrompt,
  buildCopilotNarrativePatternContext,
  buildNarrativeSectioningInstruction,
  shouldUseNarrativePatternsForRefine,
  messageMentionsLockedSections,
  logPromptAssembly,
  classifyCopilotIntentByRule,
  parseEditInstruction,
  buildEditPlan,
  shouldUseHeavyQualityGateForCopilot,
  buildNaturalResponseUserPrompt,
  createFallbackIntent,
  runFeedbackFallbackRuleCheck,
  buildPartialSafeFeedbackApplyFallback,
  detectExplicitPreserveSections,
  sanitizeUserFacingCopilotMessage,
  COPILOT_OPERATION_TYPES,
  COPILOT_QA_MODES,
  extractTargetDurationSeconds,
  buildDurationCharRange,
} = __scriptAssistantTest

const currentDraft = {
  hook: '선크림 바르는데도 오후만 되면 얼굴이 칙칙해 보이면, 순서가 문제일 수 있습니다.',
  body: '기초를 다 바른 직후 바로 선크림을 올리면 밀림이 생기고, 양도 줄어듭니다. 흡수 시간을 짧게 두고 얇게 두 번 나누면 지속감이 달라집니다.',
  cta: '오늘 바르는 순서만 바꿔보세요. 오후 피부 톤이 훨씬 덜 무너질 수 있습니다.',
}

const reference = {
  title: '래미안 분양 투자 전략',
  topic: '선크림 바르는 순서',
  transcript:
    '래미안 아파트 분양권과 강남 재건축 투자 타이밍을 보려면 시행사, 청약 경쟁률, 전매 제한을 먼저 확인해야 합니다.',
  structure_analysis: '문제 제기 후 실수 원인을 짚고, 작은 행동 변화로 결론을 낸다.',
  hook_analysis: '첫 문장에서 손해 가능성을 짧게 제시한다.',
  psychology_analysis: '내가 놓친 작은 차이가 결과를 바꾼다는 긴장감을 만든다.',
  frame_notes: [
    {
      timestamp: 1,
      observation: '초반 자막이 짧게 들어감',
      hookReason: '처음 2초 안에 손해 프레임 제시',
    },
  ],
  ai_feedback: 'HOOK과 CTA 연결을 더 압축하면 좋다.',
}

const poisonTerms = ['래미안', '아파트', '분양권', '강남', '재건축', '시행사', '청약', '전매']

test('refine/feedback reference context excludes full transcript content', () => {
  const context = buildReferenceStructureContext(reference)

  assert.match(context, /레퍼런스 전사: 제외됨/)
  assert.doesNotMatch(context, /분양권과 강남 재건축 투자/)
  for (const term of poisonTerms) {
    assert.equal(context.includes(term), false, `context leaked transcript term: ${term}`)
  }
})

test('refine prompt orders rubric and playbook before current draft while keeping draft source of truth', () => {
  const context = buildReferenceStructureContext(reference)
  const prompt = buildRefineUserPrompt({
    sections: currentDraft,
    request: '조금 더 세련되고 강하게 바꿔줘',
    selectedLabel: 'A',
    referenceContext: context,
    guides: {
      insights: ['초반 손해 프레임을 유지한다.'],
      checkpoints: ['CTA는 행동 이유를 담는다.'],
    },
  })

  assert.equal(prompt.startsWith('코파일럿 평가 기준표'), true)
  assert.ok(prompt.indexOf('코파일럿 평가 기준표') < prompt.indexOf('COPILOT_EDIT_PLAYBOOK'))
  assert.ok(prompt.indexOf('COPILOT_EDIT_PLAYBOOK') < prompt.indexOf(buildDraftBlock(currentDraft)))
  assert.match(prompt, /source of truth - 이 텍스트만 편집 대상/)
  assert.match(prompt, /사용자 요청: 조금 더 세련되고 강하게 바꿔줘/)
})

test('feedback suggestedSections prompt uses current draft before reference structure', () => {
  const context = buildReferenceStructureContext(reference)
  const prompt = buildFeedbackUserPrompt({
    sections: currentDraft,
    selectedLabel: 'B',
    referenceContext: context,
    guides: {
      insights: ['초반 손해 프레임을 유지한다.'],
      checkpoints: ['CTA는 행동 이유를 담는다.'],
    },
  })

  assert.equal(prompt.startsWith(buildDraftBlock(currentDraft)), true)
  assert.equal(prompt.indexOf('현재 초안'), 0)
  assert.ok(prompt.indexOf('현재 초안') < prompt.indexOf('레퍼런스 구조 참고'))
  assert.match(prompt, /suggestedSections/)
  assert.match(prompt, /issues/)
  assert.match(prompt, /recommendations/)
  assert.doesNotMatch(prompt, /분양권과 강남 재건축 투자/)
})

test('five repeated prompt assemblies do not reintroduce reference transcript terms', () => {
  let draft = { ...currentDraft }

  for (let index = 0; index < 5; index += 1) {
    const context = buildReferenceStructureContext(reference)
    const refinePrompt = buildRefineUserPrompt({
      sections: draft,
      request: `반복 수정 ${index + 1}: 더 짧고 선명하게`,
      selectedLabel: 'A',
      referenceContext: context,
      guides: {
        insights: ['손해 프레임을 구조로만 참고한다.'],
        checkpoints: ['현재 초안의 뷰티 주제를 유지한다.'],
      },
    })
    const feedbackPrompt = buildFeedbackUserPrompt({
      sections: draft,
      selectedLabel: 'A',
      referenceContext: context,
      guides: {
        insights: ['손해 프레임을 구조로만 참고한다.'],
        checkpoints: ['현재 초안의 뷰티 주제를 유지한다.'],
      },
    })

    for (const term of poisonTerms) {
      assert.equal(refinePrompt.includes(term), false, `refine prompt leaked ${term}`)
      assert.equal(feedbackPrompt.includes(term), false, `feedback prompt leaked ${term}`)
    }

    draft = {
      hook: `${draft.hook} 조금 더 선명하게.`,
      body: `${draft.body} 핵심은 바르는 순서입니다.`,
      cta: `${draft.cta} 오늘 루틴에서 확인해보세요.`,
    }
  }
})

test('guard and debug metadata encode anti-contamination contract', () => {
  const guard = buildReferenceContaminationGuard()
  const metadata = logPromptAssembly({
    stage: 'script-refine',
    referenceId: 'ref-1',
    currentDraftId: 'script-1',
    currentVersionId: 'version-1',
    memoryIncluded: true,
    includedTranscript: false,
  })

  assert.match(guard, /편집 대상은 오직 현재 초안/)
  assert.match(guard, /레퍼런스 내용을 패러프레이즈하지 않는다/)
  assert.equal(metadata.includedTranscript, false)
  assert.deepEqual(metadata.promptContextOrder, [
    'currentDraft',
    'userRequest',
    'accountCharacterSettings',
    'existingFeedback',
    'referenceStructureInsights',
    'reference',
  ])
  assert.equal(metadata.memoryIncluded, true)
})

test('reference structure signal is compacted to at most 500 characters', () => {
  const compacted = compactReferenceSignal('가'.repeat(800), 500)

  assert.ok(compacted.length <= 503)
  assert.match(compacted, /\.\.\.$/)
})

test('body-only refine request locks hook and cta in prompt and post-processing', () => {
  const editTarget = normalizeEditTarget('body', 'BODY만 더 설득력 있게 수정해줘')
  const targetSections = getTargetSections(editTarget)
  const scoped = applyEditScope(
    currentDraft,
    extractProposedSections(
      {
        section: '흡수 시간을 두고 얇게 두 번 나누면 밀림과 칙칙함을 줄일 수 있습니다.',
        sections: {
          hook: '바뀌면 안 되는 새 훅',
          body: '무시되어야 하는 BODY',
          cta: '바뀌면 안 되는 새 CTA',
        },
      },
      targetSections,
    ),
    targetSections,
  )
  const prompt = buildRefineUserPrompt({
    sections: currentDraft,
    request: 'BODY만 더 설득력 있게 수정해줘',
    selectedLabel: 'A',
    referenceContext: buildReferenceStructureContext(reference),
    guides: {
      insights: [],
      checkpoints: [],
    },
    targetSections,
  })

  assert.deepEqual(targetSections, ['body'])
  assert.equal(scoped.hook, currentDraft.hook)
  assert.equal(scoped.body, '흡수 시간을 두고 얇게 두 번 나누면 밀림과 칙칙함을 줄일 수 있습니다.')
  assert.equal(scoped.cta, currentDraft.cta)
  assert.match(prompt, /수정 범위: BODY/)
  assert.match(prompt, /생성 대상: BODY 하나만 생성한다/)
  assert.match(prompt, /\{"message":"","section":""\}/)
  assert.doesNotMatch(prompt, /\{"message":"","sections":/)
  assert.match(prompt, /잠금 섹션: HOOK, CTA는 원문 그대로 반환한다/)
})

test('extract proposed sections strips visible section labels from model output', () => {
  const sections = extractProposedSections(
    {
      sections: {
        hook: 'HOOK: 블로그 처음인데, 뭐부터 써야 할지 막막하죠?',
        body: 'BODY: 하루 1시간만 있어도 첫 글은 시작할 수 있어요.',
        cta: 'CTA: 댓글에 루틴이라고 남겨주세요.',
      },
    },
    ['hook', 'body', 'cta'],
  )

  assert.equal(sections.hook, '블로그 처음인데, 뭐부터 써야 할지 막막하죠?')
  assert.equal(sections.body, '하루 1시간만 있어도 첫 글은 시작할 수 있어요.')
  assert.equal(sections.cta, '댓글에 루틴이라고 남겨주세요.')
})

test('single-section extraction strips visible section label from model output', () => {
  const sections = extractProposedSections(
    {
      section: 'BODY: 아이 등원 후 1시간이면 첫 문단부터 충분히 시작할 수 있어요.',
    },
    ['body'],
  )

  assert.equal(sections.body, '아이 등원 후 1시간이면 첫 문단부터 충분히 시작할 수 있어요.')
})

test('locked-section message is rejected for partial edits', () => {
  assert.equal(messageMentionsLockedSections('HOOK은 유지하고 BODY만 바꿨습니다.', ['body']), true)
  assert.equal(messageMentionsLockedSections('BODY는 근거를 더 선명하게 풀었습니다.', ['body']), false)
  assert.match(buildEditScopeInstruction(['hook', 'cta']), /잠금 섹션: BODY/)
})

test('explicit editTarget drives generation shape and fallback still parses Korean', () => {
  assert.equal(normalizeEditTarget('cta', '마무리를 더 강하게'), 'cta')
  assert.equal(normalizeEditTarget('', '본문만 자연스럽게'), 'body')
  assert.equal(normalizeEditTarget('all', '본문만 자연스럽게'), 'body')
  assert.equal(normalizeEditTarget('all', '전체적으로 더 좋게'), 'all')
  assert.equal(normalizeEditTarget('all', '스토리처럼 감정선 넣어서 바꿔줘'), 'all')
  assert.equal(normalizeEditTarget('all', '바디를 스토리처럼 바꿔줘'), 'body')
  assert.match(buildEditOutputInstruction(['cta']), /CTA 하나만 생성/)
  assert.match(buildEditOutputInstruction(['hook', 'body', 'cta']), /HOOK, BODY, CTA 전체/)
})

test('copilot intent classifier keeps advice requests out of edit flow', () => {
  const adviceRequests = [
    '이거 어때?',
    '좀 약한가?',
    '이대로 올려도 돼?',
    '뭐가 문제야?',
    '조언 좀 해줘',
    '너무 광고 같아',
    '이거 반응 올까?',
    '왜 안 끌리지?',
    '이대로 올려도 괜찮을까?',
  ]
  for (const request of adviceRequests) {
    const intent = classifyCopilotIntentByRule(request, 'all')
    assert.equal(intent.intent, 'advise_script')
    assert.equal(intent.shouldEdit, false)
    assert.equal(intent.editTarget, 'none')
  }
})

test('route-level fallback intent treats casual advice as advice, not feedback or edit', () => {
  const casualAdvice = [
    '이거 어때?',
    '조언 좀 해줘',
    '피드백 줘',
    '이대로 올려도 돼?',
    '뭐가 문제야?',
    '너무 광고 같아',
    '이거 반응 올까?',
    '왜 안 끌리지?',
  ]
  for (const request of casualAdvice) {
    const intent = createFallbackIntent(request, 'all')
    assert.equal(intent.intent, 'advise_script')
    assert.equal(intent.shouldModifyScript, false)
  }

  assert.equal(createFallbackIntent('점수 평가해줘', 'all').intent, 'feedback_request')
  assert.equal(createFallbackIntent('훅 더 강하게 고쳐줘', 'all').intent, 'edit_request')
  assert.equal(createFallbackIntent('조언해주고 전체적으로 자연스럽게 수정해줘', 'all').intent, 'edit_request')
})

test('copilot intent classifier still sends explicit edits through refine flow', () => {
  const editRequests = [
    ['훅 더 강하게 고쳐줘', 'hook'],
    ['BODY만 자연스럽게 수정해줘', 'body'],
    ['CTA 짧게 바꿔줘', 'cta'],
    ['조언해주고 전체적으로 자연스럽게 수정해줘', 'all'],
    ['광고 같지 않게 바꿔줘', 'all'],
    ['후킹감 있게 해줘', 'hook'],
  ]

  for (const [request, expectedTarget] of editRequests) {
    const intent = classifyCopilotIntentByRule(request, 'all')
    assert.equal(intent.intent, 'edit_script')
    assert.equal(intent.shouldEdit, true)
    assert.equal(intent.editTarget, expectedTarget)
  }

  assert.equal(classifyCopilotIntentByRule('문제점 보고 고쳐줘', 'all').responseMode, 'advice_then_edit')
  assert.equal(classifyCopilotIntentByRule('뭔가 별로야 고쳐줘', 'all').responseMode, 'advice_then_edit')
  assert.equal(classifyCopilotIntentByRule('살려줘', 'all').responseMode, 'advice_then_edit')
  assert.equal(classifyCopilotIntentByRule('더 좋게 바꿔줘', 'all').responseMode, 'advice_then_edit')
  assert.equal(classifyCopilotIntentByRule('훅만 고쳐줘', 'all').responseMode, 'edit_only')
})

test('natural response prompt explicitly forbids section rewrites', () => {
  const prompt = buildNaturalResponseUserPrompt({
    sections: currentDraft,
    request: '이대로 올려도 돼?',
    selectedLabel: 'A',
    referenceContext: buildReferenceStructureContext(reference),
    guides: {
      insights: ['초반 손해 프레임을 유지한다.'],
      checkpoints: ['CTA는 행동 이유를 담는다.'],
    },
    intent: 'advise_script',
  })

  assert.equal(prompt.startsWith(buildDraftBlock(currentDraft)), true)
  assert.match(prompt, /대본을 수정하지 않는다/)
  assert.match(prompt, /공감\/확인 → 핵심 진단 1개/)
  assert.match(prompt, /점수는 사용자가 명시적으로 점수나 몇 점인지 물었을 때만 말한다/)
  assert.match(prompt, /내부 용어와 평가 기준표 이름을 사용자에게 노출하지 않는다/)
  assert.match(prompt, /코파일럿 평가 기준표/)
  assert.match(prompt, /HOOK 흡입력/)
  assert.match(prompt, /무조건 칭찬하지 않는다/)
  assert.match(prompt, /HOOK\/BODY\/CTA 문장을 새로 쓰거나 출력하지 않는다/)
  assert.match(prompt, /\{"message":""\}/)
})

test('copilot rubric and response mode rules separate advice from edits', () => {
  const rubric = buildCopilotEvaluationRubric()
  const toneGuide = buildCopilotMentorToneGuide()
  assert.match(rubric, /100점 기준/)
  assert.match(rubric, /HOOK 흡입력 25점/)
  assert.match(rubric, /BODY 이해도 25점/)
  assert.match(rubric, /CTA 설득력 20점/)
  assert.match(rubric, /조언 요청이면 대본을 수정하지 않는다/)
  assert.match(toneGuide, /친절하지만 날카로운 대본 멘토/)
  assert.match(toneGuide, /내부 용어를 사용자에게 노출하지 않는다/)
  assert.match(toneGuide, /점수는 사용자가 명시적으로/)

  assert.match(buildCopilotResponseModeRule('advice_then_edit'), /공감\/확인 \+ 진단 \+ 수정/)
  assert.match(buildCopilotResponseModeRule('advice_then_edit'), /사용자 느낌 수용/)
  assert.match(buildCopilotResponseModeRule('edit_only'), /사용자 요청 해석/)
})

test('copilot memory prompt is session-scoped and below section locks', () => {
  const memory = normalizeCopilotMemory({
    preferredTone: ['자연스럽고 말하듯이 쓰는 톤', '자연스럽고 말하듯이 쓰는 톤'],
    dislikedTone: ['광고 같은 말투'],
    preferredHookStyle: ['긴장감은 유지하되 과한 후킹은 피함'],
    dislikedExpressions: ['역대급'],
    lengthPreference: '짧고 압축적으로',
    ctaPreference: '구매 압박보다 저장 이유 먼저',
    recentUserCorrections: Array.from({ length: 12 }, (_, index) => `교정 ${index + 1}`),
    lastAcceptedVersionSummary: 'B안처럼 말하듯이 푼 버전을 선호함',
    memoryEvents: [
      {
        type: 'constraint',
        value: 'HOOK은 유지',
        confidence: 0.95,
        source: 'section_lock_signal',
        scope: 'session',
      },
      {
        type: 'preference',
        value: '직전보다 이전 버전의 방향을 더 선호할 수 있음',
        confidence: 0.6,
        source: 'previous_version_signal',
        scope: 'session',
      },
      {
        type: 'topic_reframe',
        value: '기존 소재를 제거하고 새 소재 중심으로 재구성하는 요청',
        confidence: 0.9,
        source: 'topic_reframe_signal',
        oldSubjectToRemove: ['만두'],
        newSubject: '치킨너겟',
      },
      {
        type: 'unknown',
        value: '무시되어야 함',
        confidence: 1,
      },
    ],
  })

  assert.deepEqual(memory.preferredTone, ['자연스럽고 말하듯이 쓰는 톤'])
  assert.equal(memory.recentUserCorrections.length, 10)
  assert.equal(memory.memoryEvents.length, 3)
  assert.ok(memory.memoryEvents.some((event) => event.type === 'constraint' && event.confidence === 0.95))
  assert.ok(memory.memoryEvents.some((event) => event.type === 'topic_reframe' && event.newSubject === '치킨너겟'))

  const context = formatCopilotMemoryForPrompt(memory)
  assert.match(context, /현재 코파일럿 세션에서 학습한 사용자 선호/)
  assert.match(context, /광고 같은 말투/)
  assert.match(context, /짧고 압축적으로/)
  assert.match(context, /강한 세션 제약\/선호/)
  assert.match(context, /HOOK은 유지/)
  assert.match(context, /약한 참고 신호/)
  assert.match(context, /이전 버전/)
  assert.match(context, /섹션 잠금 규칙보다 우선하지 않는다/)
  assert.match(context, /BODY만 수정 요청이면 HOOK\/CTA는 절대 바꾸지 않는다/)
  assert.match(context, /confidence가 높은 constraint만 강하게 참고/)
})

test('copilot edit playbook separates fixed rules from hook template retrieval', () => {
  const hookPlaybook = buildCopilotEditPlaybook(['hook'])
  assert.match(hookPlaybook, /COPILOT_EDIT_PLAYBOOK/)
  assert.match(hookPlaybook, /hook_templates와 역할이 다르다/)
  assert.match(hookPlaybook, /HOOK 수정 원칙/)
  assert.match(hookPlaybook, /BODY와 CTA는 단어, 문장부호, 줄바꿈까지 그대로 유지/)
  assert.doesNotMatch(hookPlaybook, /BODY 수정 원칙/)
  assert.doesNotMatch(hookPlaybook, /CTA 수정 원칙/)

  const allPlaybook = buildCopilotEditPlaybook(['hook', 'body', 'cta'])
  assert.match(allPlaybook, /전체 수정은 새 대본 생성이 아니다/)
  assert.match(allPlaybook, /기존 초안의 주제, 상품, 타겟, 레퍼런스 구조, A\/B\/C 전략을 유지/)
  assert.match(allPlaybook, /HOOK→BODY→CTA 연결성과 표현만 개선/)
})

test('narrative patterns are only used for explicit story or emotion edit requests', () => {
  assert.equal(shouldUseNarrativePatternsForRefine('감정선 넣어서 바디 바꿔줘', ['body']), true)
  assert.equal(shouldUseNarrativePatternsForRefine('스토리처럼 전체 수정해줘', ['hook', 'body', 'cta']), true)
  assert.equal(shouldUseNarrativePatternsForRefine('고객 사례처럼 전개를 살려줘', ['body']), true)

  assert.equal(shouldUseNarrativePatternsForRefine('바디만 자연스럽게 수정해줘', ['body']), false)
  assert.equal(shouldUseNarrativePatternsForRefine('훅만 고쳐줘', ['hook']), false)
  assert.equal(shouldUseNarrativePatternsForRefine('CTA 감정선 넣어줘', ['cta']), false)
  assert.equal(shouldUseNarrativePatternsForRefine('이거 어때?', ['hook', 'body', 'cta']), false)
})

test('narrative pattern context prevents invented emotional facts', () => {
  const context = buildCopilotNarrativePatternContext([
    {
      narrative_code: 'NARRATIVE_18',
      title: '고객 사례 변화 증명형',
      narrative_family: 'client_case_transformation',
      emotional_arc: '힘든 고객 등장 → 목표 → 맞춤 솔루션 → 변화',
      body_flow_rule: '고객의 문제와 목표를 보여주고 맞춤 솔루션을 통해 변화를 증명한다.',
      rewrite_rule: '고객 사례가 실제일 때만 사용한다.',
      risk_note: '허위 고객, 수강생 성과, 합격, 건강 개선 사례 생성 금지.',
      use_intensity: 'medium_only_with_real_case',
      avoid_when: ['실제 고객 사례 없음', '공공 정보'],
      structure_steps: [{ step: 1, role: 'raw template should stay hidden' }],
    },
  ])

  assert.match(context, /명시 요청 시에만/)
  assert.match(context, /현재 초안에 이미 있는 사실/)
  assert.match(context, /실제로 없는 실패, 손실, 고객, 수강생, 매출/)
  assert.match(context, /허위 고객, 수강생 성과/)
  assert.doesNotMatch(context, /raw template should stay hidden/)
})

test('narrative full edits must keep hook body cta sectioning', () => {
  const narrativeContext = buildCopilotNarrativePatternContext([
    {
      narrative_code: 'NARRATIVE_06',
      title: '큰 손실 후 실행 전환형',
      narrative_family: 'loss_to_action',
      emotional_arc: '문제 경험 → 전환 → 해결 근거',
      body_flow_rule: '문제 경험을 보여준 뒤 해결 근거로 전환한다.',
      rewrite_rule: '없는 사건은 만들지 않는다.',
      risk_note: '허위 손실 생성 금지.',
      use_intensity: 'medium',
      avoid_when: ['정보형 튜토리얼'],
    },
  ])
  const sectioning = buildNarrativeSectioningInstruction({
    request: '스토리처럼 감정선 넣어서 전체 바꿔줘',
    targetSections: ['hook', 'body', 'cta'],
    narrativePatternContext: narrativeContext,
  })
  const prompt = buildRefineUserPrompt({
    sections: currentDraft,
    request: '스토리처럼 감정선 넣어서 전체 바꿔줘',
    selectedLabel: 'C',
    referenceContext: buildReferenceStructureContext(reference),
    guides: { insights: [], checkpoints: [] },
    narrativePatternContext: narrativeContext,
    targetSections: ['hook', 'body', 'cta'],
  })

  assert.match(sectioning, /반드시 HOOK\/BODY\/CTA로 나눈다/)
  assert.match(sectioning, /BODY 하나만 반환하지 말고/)
  assert.match(prompt, /생성 대상: HOOK, BODY, CTA 전체/)
  assert.match(prompt, /스토리\/감정선 전체 수정 분리 규칙/)
  assert.match(prompt, /BODY 하나만 반환하지 말고/)
  assert.ok(prompt.indexOf('생성 대상: HOOK, BODY, CTA 전체') < prompt.indexOf('스토리/감정선 전체 수정 분리 규칙'))
})

test('story and emotion requests are classified as edits when they ask for changes', () => {
  const intent = classifyCopilotIntentByRule('감정선 넣어서 전체 수정해줘', 'all')
  assert.equal(intent.intent, 'edit_script')
  assert.equal(intent.shouldEdit, true)
  assert.equal(intent.editTarget, 'all')

  const allStoryIntent = createFallbackIntent('스토리처럼 감정선 넣어줘', 'all')
  assert.equal(allStoryIntent.intent, 'edit_request')
  assert.equal(allStoryIntent.shouldModifyScript, true)
  assert.equal(allStoryIntent.editTarget, 'all')

  const storyIntent = createFallbackIntent('스토리처럼 바디에 사람 냄새 좀 넣어줘', 'all')
  assert.equal(storyIntent.intent, 'edit_request')
  assert.equal(storyIntent.shouldModifyScript, true)
  assert.equal(storyIntent.editTarget, 'body')
})

test('refine prompt tells model to diagnose before editing', () => {
  const prompt = buildRefineUserPrompt({
    sections: currentDraft,
    request: '문제점 보고 훅만 고쳐줘',
    selectedLabel: 'C',
    referenceContext: buildReferenceStructureContext(reference),
    guides: {
      insights: ['첫 문장에서 손해 가능성을 짧게 제시한다.'],
      checkpoints: ['선택 초안의 문장 역할 순서를 유지한다.'],
    },
    targetSections: ['hook'],
    responseMode: 'advice_then_edit',
  })

  assert.match(prompt, /코파일럿 평가 기준표/)
  assert.match(prompt, /COPILOT_EDIT_PLAYBOOK/)
  assert.match(prompt, /응답 모드: 공감\/확인 \+ 진단 \+ 수정/)
  assert.match(prompt, /사용자 느낌 수용/)
  assert.match(prompt, /HOOK 하나만 생성/)
  assert.ok(prompt.indexOf('코파일럿 평가 기준표') < prompt.indexOf('COPILOT_EDIT_PLAYBOOK'))
  assert.ok(prompt.indexOf('COPILOT_EDIT_PLAYBOOK') < prompt.indexOf('현재 초안'))
  assert.ok(prompt.indexOf('현재 초안') < prompt.indexOf('레퍼런스 구조 참고'))
  assert.ok(prompt.indexOf('레퍼런스 구조 참고') < prompt.indexOf('사용자 요청'))
})

test('partial edit diff and flow validation remain stable across repeated body edits', () => {
  let draft = { ...currentDraft }

  for (let index = 0; index < 5; index += 1) {
    const targetSections = getTargetSections(normalizeEditTarget('body', 'BODY 수정'))
    const next = applyEditScope(
      draft,
      extractProposedSections(
        {
          section: `${draft.body} 반복 ${index + 1}회차에서 근거를 더 선명하게 정리했습니다.`,
        },
        targetSections,
      ),
      targetSections,
    )
    const diff = createSectionDiff(draft, next)
    const flow = validateScriptFlow(next)

    assert.deepEqual(Object.keys(diff), ['body'])
    assert.equal(next.hook, draft.hook)
    assert.equal(next.cta, draft.cta)
    assert.equal(flow.ok, true)
    draft = next
  }
})

test('feedback fallback rule check blocks section lock violations', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      ...currentDraft,
      hook: '수정 대상이 아닌 훅을 바꿨습니다.',
      body: '기초를 올리는 순서를 더 자연스럽게 설명합니다.',
    },
    editTarget: 'body',
    feedback: {
      summary: 'BODY 연결이 약합니다.',
      detail: 'BODY 첫 문장을 더 자연스럽게 이어야 합니다.',
    },
    request: 'BODY만 자연스럽게 해줘',
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'section_lock_violation'))
})

test('feedback fallback rule check blocks unsupported numbers', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      ...currentDraft,
      body: `${currentDraft.body} 이 방법은 3일 만에 200% 좋아진다고 볼 수 있습니다.`,
    },
    editTarget: 'all',
    feedback: {
      summary: '과장 없이 자연스럽게 다듬어야 합니다.',
      detail: '근거 없는 성과 표현을 피해야 합니다.',
    },
    request: '피드백대로 수정해줘',
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'unsupported_number'))
})

test('partial safe feedback apply fallback applies only safe sections after unsafe candidate failure', () => {
  const result = buildPartialSafeFeedbackApplyFallback({
    originalSections: currentDraft,
    candidateSources: [
      {
        source: 'refine',
        sections: {
          hook: '이 방법은 3일 만에 200% 좋아집니다.',
          body: `${currentDraft.body} 원문 흐름을 유지합니다.`,
          cta: '댓글에 루틴이라고 남기면 부담 없이 확인할 체크리스트를 보내드릴게요.',
        },
      },
    ],
    editTarget: 'all',
    feedback: {
      summary: 'CTA를 더 자연스럽게 바꿔야 합니다.',
      detail: '판매 압박보다 저장/댓글 이유를 주는 CTA가 좋습니다.',
    },
    request: '피드백대로 적용해줘',
  })

  assert.equal(result.success, true)
  assert.deepEqual(result.changedSections, ['body', 'cta'])
  assert.equal(result.sections.hook, currentDraft.hook)
  assert.match(result.sections.cta, /체크리스트/)
})

test('partial safe feedback apply fallback respects edit target section locks', () => {
  const result = buildPartialSafeFeedbackApplyFallback({
    originalSections: currentDraft,
    candidateSources: [
      {
        source: 'refine',
        sections: {
          hook: '수정 대상이 아닌 훅입니다.',
          body: '수정 대상이 아닌 바디입니다.',
          cta: '댓글에 루틴이라고 남기면 오늘 바로 쓸 체크리스트를 보내드릴게요.',
        },
      },
    ],
    editTarget: 'cta',
    feedback: {
      summary: 'CTA가 약합니다.',
      detail: '댓글 행동 이유를 더 선명하게 주세요.',
    },
    request: 'CTA만 피드백대로 적용해줘',
  })

  assert.equal(result.success, true)
  assert.deepEqual(result.changedSections, ['cta'])
  assert.equal(result.sections.hook, currentDraft.hook)
  assert.equal(result.sections.body, currentDraft.body)
  assert.match(result.sections.cta, /체크리스트/)
})

test('partial safe feedback apply fallback keeps original when every candidate is unsafe', () => {
  const result = buildPartialSafeFeedbackApplyFallback({
    originalSections: currentDraft,
    candidateSources: [
      {
        source: 'suggestedSections',
        sections: {
          ...currentDraft,
          cta: '3일 만에 200% 좋아지는 방법을 바로 구매하세요.',
        },
      },
    ],
    editTarget: 'cta',
    feedback: {
      summary: 'CTA를 자연스럽게 바꿔야 합니다.',
      detail: '근거 없는 수치와 구매 압박은 피해야 합니다.',
    },
    request: 'CTA만 피드백대로 적용해줘',
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.changedSections, [])
  assert.deepEqual(result.sections, currentDraft)
  assert.ok(result.issueTypes.includes('unsupported_number'))
})

test('copilot edit plan translates naturalness requests into a concrete strategy', () => {
  const plan = buildEditPlan({
    userRequest: 'BODY만 자연스럽게 말 되게 바꿔줘',
    currentSections: currentDraft,
    editTarget: 'body',
    copilotMemory: {
      dislikedTone: ['광고 같거나 판매 압박이 강한 말투'],
      recentUserCorrections: ['HOOK은 유지하고 요청한 다른 섹션만 바꾸길 원함'],
    },
  })

  assert.equal(plan.editTarget, 'body')
  assert.deepEqual(plan.targetSections, ['body'])
  assert.match(plan.strategy, /구어체화/)
  assert.ok(plan.avoid.some((item) => item.includes('광고')))
  assert.ok(plan.avoid.some((item) => item.includes('HOOK은 유지')))
  assert.equal(plan.primaryGoal, '자연스러운 구어체로 정리')
  assert.equal(plan.revisionStyle, 'rewrite_light')
  assert.equal(plan.sectionInstructions.hook.action, 'keep')
  assert.equal(plan.sectionInstructions.body.action, 'revise')
  assert.equal(plan.sectionInstructions.cta.action, 'keep')
  assert.ok(plan.mustKeep.some((item) => item.includes('HOOK')))
  assert.ok(plan.mustChange.some((item) => item.includes('구어체')))
})

test('copilot edit plan classifies explicit topic reframe requests', () => {
  const intent = classifyCopilotIntentByRule('여름철 감염 예방법으로 바꿔줘', 'all')
  const plan = buildEditPlan({
    userRequest: '여름철 감염 예방법으로 바꿔줘',
    currentSections: currentDraft,
    intentResult: intent,
    editTarget: 'all',
  })

  assert.equal(intent.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(plan.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(plan.qaMode, COPILOT_QA_MODES.REFRAME_TOPIC)
  assert.equal(plan.newSubject, '여름철 감염 예방법')
  assert.deepEqual(plan.targetSections, ['hook', 'body', 'cta'])
  assert.match(plan.strategy, /새 주제/)
  assert.ok(plan.avoid.some((item) => item.includes('기존 주제')))
})

test('parse edit instruction separates old and new subjects from X 말고 Y requests', () => {
  const instruction = parseEditInstruction('주제를 만두말고 치킨너겟으로 바꿔줘')

  assert.equal(instruction.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(instruction.newSubject, '치킨너겟')
  assert.deepEqual(instruction.oldSubjectToRemove, ['만두'])
  assert.equal(instruction.allowComparisonWithOldSubject, false)
  assert.ok(instruction.forbiddenSurfacePhrases.includes('만두말고'))
  assert.ok(instruction.forbiddenSurfacePhrases.includes('만두 대신'))
})

test('parse edit instruction handles multiple old subjects and comparison exceptions', () => {
  const reframe = parseEditInstruction('만두랑 떡볶이는 빼고 치킨너겟으로 가자')
  assert.equal(reframe.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(reframe.newSubject, '치킨너겟')
  assert.deepEqual(reframe.oldSubjectToRemove, ['만두', '떡볶이'])
  assert.deepEqual(reframe.explicitRemove, ['만두', '떡볶이'])

  const comparison = parseEditInstruction('만두랑 치킨너겟 비교하는 느낌으로 써줘')
  assert.equal(comparison.allowComparisonWithOldSubject, true)
  assert.notEqual(comparison.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
})

test('copilot edit plan prioritizes structured instruction over raw request wording', () => {
  const request = '주제를 만두말고 치킨너겟으로 바꿔줘'
  const intent = classifyCopilotIntentByRule(request, 'all')
  const plan = buildEditPlan({
    userRequest: request,
    currentSections: currentDraft,
    intentResult: intent,
    editTarget: 'all',
  })

  assert.equal(plan.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(plan.newSubject, '치킨너겟')
  assert.deepEqual(plan.oldSubjectToRemove, ['만두'])
  assert.ok(plan.forbiddenSurfacePhrases.includes('만두말고'))
  assert.ok(plan.avoid.some((item) => item.includes('만두')))
  assert.equal(plan.primaryGoal, '새 주제 "치킨너겟" 중심 재구성')
  assert.equal(plan.revisionStyle, 'reframe_subject')
  assert.equal(plan.sectionInstructions.hook.action, 'replace')
  assert.ok(plan.mustChange.some((item) => item.includes('치킨너겟')))
  assert.ok(plan.mustAvoid.some((item) => item.includes('만두말고')))
})

test('copilot edit plan supports topic reframe with requested materials', () => {
  const request = '여름철 감염 예방법으로 손씻기, 물 자주 마시기 넣어줘'
  const intent = classifyCopilotIntentByRule(request, 'all')
  const plan = buildEditPlan({
    userRequest: request,
    currentSections: currentDraft,
    intentResult: intent,
    editTarget: 'all',
  })

  assert.equal(plan.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(plan.qaMode, COPILOT_QA_MODES.REFRAME_TOPIC)
  assert.equal(plan.newSubject, '여름철 감염 예방법')
  assert.deepEqual(plan.requestedMaterials, ['손씻기', '물 자주 마시기'])
})

test('copilot edit plan keeps locked sections for insert material requests', () => {
  const request = 'BODY에 손씻기랑 물 자주 마시기 넣어줘'
  const intent = classifyCopilotIntentByRule(request, 'all')
  const plan = buildEditPlan({
    userRequest: request,
    currentSections: currentDraft,
    intentResult: intent,
    editTarget: 'all',
  })

  assert.equal(plan.operationType, COPILOT_OPERATION_TYPES.INSERT_MATERIAL)
  assert.equal(plan.qaMode, COPILOT_QA_MODES.INSERT_MATERIAL)
  assert.deepEqual(plan.targetSections, ['body'])
  assert.deepEqual(plan.preserveSections, ['hook', 'cta'])
  assert.deepEqual(plan.requestedMaterials, ['손씻기', '물 자주 마시기'])
})

test('explicit preserve wording locks sections even during topic reframe', () => {
  const request = 'HOOK은 유지하고 여름철 감염 예방법으로 바꿔줘'
  const intent = classifyCopilotIntentByRule(request, 'all')
  const plan = buildEditPlan({
    userRequest: request,
    currentSections: currentDraft,
    intentResult: intent,
    editTarget: 'all',
  })

  assert.deepEqual(detectExplicitPreserveSections(request), ['hook'])
  assert.equal(plan.operationType, COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
  assert.equal(plan.newSubject, '여름철 감염 예방법')
  assert.deepEqual(plan.targetSections, ['body', 'cta'])
  assert.deepEqual(plan.preserveSections, ['hook'])
})

test('copilot user-facing message templates hide internal terms', () => {
  const message = sanitizeUserFacingCopilotMessage('QA에서 위험 요소가 감지되어 repair 했습니다.', {
    editPlan: {
      operationType: COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
      newSubject: '물광토너',
      targetSections: ['hook', 'body', 'cta'],
    },
    responseMode: 'edit_only',
    changedSections: ['hook', 'body', 'cta'],
  })

  assert.match(message, /물광토너/)
  assert.doesNotMatch(message, /QA|위험 요소|repair|내부|fallback|intent|qaMode|operationType/i)
})

test('insert material user-facing message names target section and preserves others', () => {
  const message = sanitizeUserFacingCopilotMessage('요청을 반영했습니다.', {
    editPlan: {
      operationType: COPILOT_OPERATION_TYPES.INSERT_MATERIAL,
      targetSections: ['body'],
    },
    responseMode: 'edit_only',
    changedSections: ['body'],
  })

  assert.match(message, /BODY/)
  assert.match(message, /다른 섹션/)
  assert.doesNotMatch(message, /요청을 반영/)
})

test('insert material QA requires requested material in target section only', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      ...currentDraft,
      body: '기초를 바르는 순서를 정리해보세요.',
    },
    editTarget: 'body',
    request: 'BODY에 손씻기랑 물 자주 마시기 넣어줘',
    qaMode: COPILOT_QA_MODES.INSERT_MATERIAL,
    requestedMaterials: ['손씻기', '물 자주 마시기'],
    targetSections: ['body'],
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'requested_material_missing'))
})

test('topic reframe QA does not fail only because old topic changed', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      hook: '여름철 감염은 작은 생활 습관에서 갈릴 수 있습니다.',
      body: '외출 후 손씻기와 물 자주 마시기를 챙기면 기본 관리 흐름이 훨씬 쉬워집니다.',
      cta: '오늘 외출 전후 루틴으로 저장해두고 체크해보세요.',
    },
    editTarget: 'all',
    request: '여름철 감염 예방법으로 손씻기, 물 자주 마시기 넣어줘',
    qaMode: COPILOT_QA_MODES.REFRAME_TOPIC,
    newSubject: '여름철 감염 예방법',
    requestedMaterials: ['손씻기', '물 자주 마시기'],
    targetSections: ['hook', 'body', 'cta'],
  })

  assert.equal(result.ok, true)
  assert.equal(result.shouldRepair, false)
})

test('topic reframe QA blocks old subject and forbidden instruction leakage', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      hook: '만두말고 치킨너겟으로 저녁 고민을 줄여보세요.',
      body: '만두 대신 치킨너겟을 에어프라이어에 넣으면 간식 준비가 쉬워집니다.',
      cta: '댓글에 너겟을 남겨주세요.',
    },
    editTarget: 'all',
    request: '주제를 만두말고 치킨너겟으로 바꿔줘',
    qaMode: COPILOT_QA_MODES.REFRAME_TOPIC,
    newSubject: '치킨너겟',
    oldSubjectToRemove: ['만두'],
    forbiddenSurfacePhrases: ['만두말고', '만두 대신'],
    allowComparisonWithOldSubject: false,
    targetSections: ['hook', 'body', 'cta'],
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'forbidden_phrase_leakage'))
  assert.ok(result.issues.some((issue) => issue.type === 'old_subject_leakage'))
})

test('topic reframe QA allows old subject only for explicit comparison requests', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      hook: '만두와 치킨너겟, 아이 간식으로 뭐가 더 편할까요?',
      body: '만두는 데우는 방식이 다양하고, 치킨너겟은 바삭한 식감이 장점이라 상황에 따라 다르게 고르면 됩니다.',
      cta: '댓글에 비교표라고 남기면 체크 기준을 보내드릴게요.',
    },
    editTarget: 'all',
    request: '만두랑 치킨너겟 비교하는 느낌으로 써줘',
    qaMode: COPILOT_QA_MODES.REFRAME_TOPIC,
    newSubject: '치킨너겟',
    oldSubjectToRemove: ['만두'],
    allowComparisonWithOldSubject: true,
    targetSections: ['hook', 'body', 'cta'],
  })

  assert.equal(result.ok, true)
  assert.equal(result.shouldRepair, false)
})

test('edit plan QA blocks keep section instruction violations', () => {
  const plan = buildEditPlan({
    userRequest: 'BODY만 자연스럽게 말 되게 바꿔줘',
    currentSections: currentDraft,
    editTarget: 'body',
  })
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      ...currentDraft,
      hook: '바뀌면 안 되는 훅입니다.',
      body: '기초 순서를 더 말하듯이 정리했습니다.',
    },
    editTarget: 'body',
    request: 'BODY만 자연스럽게 말 되게 바꿔줘',
    qaMode: plan.qaMode,
    targetSections: plan.targetSections,
    editPlan: plan,
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'section_instruction_violation'))
})

test('memory constraint QA blocks high confidence hook keep violations', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      ...currentDraft,
      hook: '세션 제약이 있는데 바뀐 훅입니다.',
      body: '기초 순서를 더 자연스럽게 이어서 설명합니다.',
    },
    editTarget: 'body',
    request: 'BODY만 자연스럽게 해줘',
    targetSections: ['body'],
    copilotMemory: {
      memoryEvents: [
        {
          type: 'constraint',
          value: 'HOOK은 유지',
          confidence: 0.95,
          source: 'section_lock_signal',
          scope: 'session',
        },
      ],
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'memory_constraint_violated'))
})

test('current explicit hook request overrides hook keep memory constraint', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: {
      ...currentDraft,
      hook: '이번 요청에서 명시적으로 바꾼 훅입니다.',
    },
    editTarget: 'hook',
    request: '훅만 더 세게 고쳐줘',
    targetSections: ['hook'],
    copilotMemory: {
      memoryEvents: [
        {
          type: 'constraint',
          value: 'HOOK은 유지',
          confidence: 0.95,
          source: 'section_lock_signal',
          scope: 'session',
        },
      ],
    },
  })

  assert.equal(result.issues.some((issue) => issue.type === 'memory_constraint_violated'), false)
})

test('duration compress intent extracts target seconds and builds char range', () => {
  const intent = classifyCopilotIntentByRule('45초 안에 말하게 해줘', 'all')
  const plan = buildEditPlan({
    userRequest: '45초 안에 말하게 해줘',
    currentSections: currentDraft,
    intentResult: intent,
    editTarget: 'all',
  })

  assert.equal(extractTargetDurationSeconds('45초 안에 말하게 해줘'), 45)
  assert.deepEqual(buildDurationCharRange(30), { min: 150, max: 195 })
  assert.equal(intent.operationType, COPILOT_OPERATION_TYPES.DURATION_COMPRESS)
  assert.equal(intent.targetDurationSeconds, 45)
  assert.equal(plan.operationType, COPILOT_OPERATION_TYPES.DURATION_COMPRESS)
  assert.equal(plan.qaMode, COPILOT_QA_MODES.DURATION_COMPRESS)
  assert.deepEqual(plan.targetCharRange, { min: 225, max: 293 })
})

test('duration compress QA flags overly long compressed drafts', () => {
  const result = runFeedbackFallbackRuleCheck({
    originalSections: currentDraft,
    candidateSections: currentDraft,
    editTarget: 'all',
    request: '10초로 압축해줘',
    qaMode: COPILOT_QA_MODES.DURATION_COMPRESS,
    targetSections: ['hook', 'body', 'cta'],
    targetDurationSeconds: 10,
    targetCharRange: buildDurationCharRange(10),
  })

  assert.equal(result.ok, false)
  assert.equal(result.shouldRepair, true)
  assert.ok(result.issues.some((issue) => issue.type === 'duration_range_miss'))
})

test('duration compress user-facing message hides internal terms', () => {
  const message = sanitizeUserFacingCopilotMessage('QA 이슈(근거 없는 수치 제거, 20초 분량 압축, CTA 초점 단일화)만 반영해 hook/body/cta 최소 수정했어요.', {
    editPlan: {
      operationType: COPILOT_OPERATION_TYPES.DURATION_COMPRESS,
      targetDurationSeconds: 30,
      targetSections: ['hook', 'body', 'cta'],
    },
    responseMode: 'edit_only',
    changedSections: ['hook', 'body', 'cta'],
  })

  assert.match(message, /30초/)
  assert.match(message, /압축/)
  assert.doesNotMatch(message, /QA|이슈|근거 없는 수치|최소 수정|hook\/body\/cta|issue|repair|fallback|intent|qaMode|operationType/i)
})

test('duration compress user-facing message does not say a problem was fixed', () => {
  const message = sanitizeUserFacingCopilotMessage('문제였던 부분만 다시 다듬었어요. 중복 문장을 덜고 40초 분량에 맞춰 더 짧게 압축했어요.', {
    editPlan: {
      operationType: COPILOT_OPERATION_TYPES.DURATION_COMPRESS,
      targetDurationSeconds: 40,
      targetSections: ['hook', 'body', 'cta'],
    },
    responseMode: 'edit_only',
    changedSections: ['hook', 'body', 'cta'],
  })

  assert.match(message, /40초/)
  assert.match(message, /압축/)
  assert.doesNotMatch(message, /문제였던|문제였던 부분|문제.*다시 다듬/)
})

test('repair-style QA issue messages are sanitized for users', () => {
  const message = sanitizeUserFacingCopilotMessage('QA 이슈(근거 없는 수치 삭제, ‘만두말고’ 대비/전환 명확화)만 최소 수정했어요.', {
    editPlan: {
      operationType: COPILOT_OPERATION_TYPES.EDIT_PARTIAL,
      targetSections: ['hook', 'body'],
    },
    responseMode: 'edit_only',
    changedSections: ['hook', 'body'],
  })

  assert.match(message, /좋아요|다듬/)
  assert.doesNotMatch(message, /QA|이슈|근거 없는 수치|최소 수정|삭제|명확화/i)
})

test('heavy copilot quality gate is reserved for broad or risky edit requests', () => {
  assert.equal(
    shouldUseHeavyQualityGateForCopilot({
      request: 'BODY만 자연스럽게 해줘',
      editTarget: 'body',
    }),
    true,
  )
  assert.equal(
    shouldUseHeavyQualityGateForCopilot({
      request: 'CTA에서 저장을 댓글로 바꿔줘',
      editTarget: 'cta',
      targetSections: ['cta'],
    }),
    false,
  )
})
