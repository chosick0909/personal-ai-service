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
  buildNaturalResponseUserPrompt,
  createFallbackIntent,
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
  })

  assert.deepEqual(memory.preferredTone, ['자연스럽고 말하듯이 쓰는 톤'])
  assert.equal(memory.recentUserCorrections.length, 10)

  const context = formatCopilotMemoryForPrompt(memory)
  assert.match(context, /현재 코파일럿 세션에서 학습한 사용자 선호/)
  assert.match(context, /광고 같은 말투/)
  assert.match(context, /짧고 압축적으로/)
  assert.match(context, /섹션 잠금 규칙보다 우선하지 않는다/)
  assert.match(context, /BODY만 수정 요청이면 HOOK\/CTA는 절대 바꾸지 않는다/)
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
