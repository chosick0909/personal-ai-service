export function createReplyContextHelpers({
  SECTION_KEYS,
  SECTION_LABELS,
  normalizePreviousAdvice,
  normalizeFeedbackList,
  uniqueCompactList,
  normalizeEditTarget,
  getTargetSections,
  inferRequestedSections,
} = {}) {
  function detectFeedbackSection(text = '') {
    const value = String(text || '').replace(/\s+/g, ' ').trim()
    if (/(?:^|\b)(?:HOOK|훅|후킹)(?:\b|[:：])/i.test(value)) return 'hook'
    if (/(?:^|\b)(?:BODY|바디|본문)(?:\b|[:：])/i.test(value)) return 'body'
    if (/(?:^|\b)(?:CTA|씨티에이|마무리|콜투액션)(?:\b|[:：])/i.test(value)) return 'cta'
    if (/첫\s*문장|도입|시작|후킹|스크롤|멈추/i.test(value)) return 'hook'
    if (/본문|흐름|연결|근거|예시|설명|상황|공감/i.test(value)) return 'body'
    if (/댓글|저장|구매|신청|상담|링크|행동|마무리/i.test(value)) return 'cta'
    return 'all'
  }

  function inferFeedbackOperationType(text = '', section = 'all') {
    const value = String(text || '').replace(/\s+/g, ' ')
    if (/(?:행동\s*이유|왜\s*지금|댓글|저장|구매|신청|상담|링크|CTA|씨티에이)/i.test(value)) {
      return 'strengthen_action_reason'
    }
    if (/(?:연결|이어|받아|흐름|앞\s*문장|첫\s*문장)/i.test(value)) {
      return section === 'body' ? 'connect_hook_to_body' : 'partial_rewrite'
    }
    if (/(?:공감|상황|타겟|고민)/i.test(value)) {
      return 'empathy_rewrite'
    }
    if (/(?:광고|판매|구매\s*압박|상업)/i.test(value)) {
      return section === 'cta' ? 'cta_reframe' : 'partial_rewrite'
    }
    if (/(?:존댓말|반말|말투|어미|해요체|구어체|자연스럽)/i.test(value)) {
      return 'tone_adjust'
    }
    return section === 'cta' ? 'strengthen_action_reason' : 'partial_rewrite'
  }

  function feedbackSectionTargetToEditTarget(sections = []) {
    const uniqueSections = uniqueCompactList(sections.filter((section) => SECTION_KEYS.includes(section)), 3)
    if (uniqueSections.length === 1) return uniqueSections[0]
    if (uniqueSections.length === 2 && uniqueSections.includes('body') && uniqueSections.includes('cta')) {
      return 'body_cta'
    }
    return uniqueSections.length ? 'full' : 'all'
  }

  function feedbackToEditInstructions({ feedback = {}, sourceMessageId = '', editTarget = 'all' } = {}) {
    const issues = normalizeFeedbackList(feedback?.issues, 8)
    const recommendations = normalizeFeedbackList(feedback?.recommendations, 8)
    const verdict = feedback?.verdict && typeof feedback.verdict === 'object' ? feedback.verdict : {}
    const sourceTexts = [
      ...issues.map((text) => ({ kind: 'issue', text })),
      ...recommendations.map((text) => ({ kind: 'recommendation', text })),
    ]
    const operations = []

    for (const item of sourceTexts) {
      const section = detectFeedbackSection(item.text)
      const target = SECTION_KEYS.includes(section) ? section : normalizeEditTarget(editTarget || 'all')
      const normalizedTarget = SECTION_KEYS.includes(target) ? target : section
      const operationTarget = SECTION_KEYS.includes(normalizedTarget) ? normalizedTarget : 'all'
      const type = inferFeedbackOperationType(item.text, operationTarget)
      const isIssue = item.kind === 'issue'
      const relatedRecommendation =
        recommendations.find((recommendation) => {
          const recommendationSection = detectFeedbackSection(recommendation)
          return recommendationSection === operationTarget || recommendationSection === 'all'
        }) || ''
      const instruction = isIssue
        ? relatedRecommendation ||
          `${SECTION_LABELS[operationTarget] || '대본'}에서 피드백이 지적한 문제를 실제 문장 수정으로 해결한다.`
        : item.text

      operations.push({
        type,
        target: operationTarget,
        problem: isIssue ? item.text : '',
        instruction,
        preserve: ['기존 주제', '사용자 사실 정보', '기존 CTA 의도'].filter((value) =>
          operationTarget === 'cta' ? true : value !== '기존 CTA 의도',
        ),
        avoid: ['새 소재 생성', '허위 수치', '없는 혜택', '과장 후기'],
        priority: isIssue ? 'high' : 'medium',
      })
    }

    if (!operations.length && verdict.recommendedAction) {
      operations.push({
        type: 'partial_rewrite',
        target: normalizeEditTarget(editTarget || 'all'),
        problem: verdict.reason || feedback?.summary || '',
        instruction: verdict.recommendedAction,
        preserve: ['기존 주제', '사용자 사실 정보'],
        avoid: ['새 소재 생성', '허위 수치', '없는 혜택'],
        priority: 'medium',
      })
    }

    const operationTargets = operations.map((operation) => operation.target).filter((target) => SECTION_KEYS.includes(target))
    const feedbackEditTarget = feedbackSectionTargetToEditTarget(operationTargets)
    const effectiveEditTarget =
      editTarget && editTarget !== 'all' ? normalizeEditTarget(editTarget) : feedbackEditTarget
    const targetSections =
      effectiveEditTarget === 'body_cta'
        ? ['body', 'cta']
        : effectiveEditTarget === 'full'
          ? SECTION_KEYS
          : getTargetSections(normalizeEditTarget(effectiveEditTarget, ''))
    const preserveSections = SECTION_KEYS.filter((section) => !targetSections.includes(section))
    const diagnosis = [verdict.reason, feedback?.summary, feedback?.detail]
      .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')

    return normalizePreviousAdvice({
      sourceType: 'feedback',
      sourceMessageId,
      sourceDraftId: feedback?.sourceDraftId || feedback?.source_draft_id || '',
      priority: 'high',
      diagnosis: diagnosis || '직전 피드백에서 지적한 문제를 반영',
      editTarget: effectiveEditTarget,
      operations,
      instructions: uniqueCompactList(
        operations.map((operation) => operation.instruction || operation.problem),
        8,
      ),
      preserveSections,
      expectedOutcome:
        verdict.expectedOutcome ||
        '피드백에서 지적한 문제가 실제 대본에서 완화되고, 바로 사용할 수 있는 방향에 가까워진 수정본',
    })
  }

  function suggestionToEditInstructions({ replyContext = {}, userMessage = '', editTarget = 'all' } = {}) {
    const explicitSections = inferRequestedSections(userMessage)
    const target =
      explicitSections.length === 1
        ? explicitSections[0]
        : normalizeEditTarget(replyContext.editTarget || editTarget || 'all', userMessage)
    const targetSections = getTargetSections(target)
    const preserveSections = SECTION_KEYS.filter((section) => !targetSections.includes(section))

    return normalizePreviousAdvice({
      sourceType: 'suggestion',
      sourceMessageId: replyContext.sourceMessageId || '',
      sourceDraftId: replyContext.sourceDraftId || '',
      priority: 'high',
      diagnosis: '답장 대상 수정안을 기준으로 후속 요청을 반영',
      editTarget: target,
      operations: targetSections.map((section) => ({
        type: 'partial_rewrite',
        target: section,
        problem: '',
        instruction: `${SECTION_LABELS[section]}는 답장 대상 수정안의 방향을 기준으로 현재 사용자 후속 요청을 반영한다.`,
        preserve: ['기존 주제', '사용자 사실 정보'],
        avoid: ['새 소재 생성', '허위 수치', '없는 혜택', '사용자 지시문 복사'],
        priority: 'high',
      })),
      instructions: [
        '답장 대상 수정안을 기준으로 이어서 다듬는다.',
        '현재 사용자 메시지의 명시 지시는 답장 대상보다 우선한다.',
      ],
      preserveSections,
      expectedOutcome: '답장 대상 수정안의 방향을 유지하면서 현재 후속 요청이 반영된 수정본',
    })
  }

  function adviceToEditInstructions({ replyContext = {}, fallbackAdvice = null, editTarget = 'all', userMessage = '' } = {}) {
    const actionableAdvice = normalizePreviousAdvice(replyContext.actionableAdvice || fallbackAdvice)
    if (actionableAdvice) {
      return normalizePreviousAdvice({
        ...actionableAdvice,
        sourceType: actionableAdvice.sourceType || replyContext.sourceType || 'advice',
        sourceMessageId: actionableAdvice.sourceMessageId || replyContext.sourceMessageId || '',
        sourceDraftId: actionableAdvice.sourceDraftId || replyContext.sourceDraftId || '',
      })
    }

    const messageText = String(replyContext.messageText || '').replace(/\s+/g, ' ').trim()
    if (!messageText) {
      return null
    }

    const section = detectFeedbackSection(messageText)
    const explicitSections = inferRequestedSections(userMessage)
    const target =
      explicitSections.length === 1
        ? explicitSections[0]
        : SECTION_KEYS.includes(section)
          ? section
          : normalizeEditTarget(editTarget || 'all', '')
    const targetSections = getTargetSections(target)
    const preserveSections = SECTION_KEYS.filter((key) => !targetSections.includes(key))
    const operationTarget = targetSections.length === 1 ? targetSections[0] : 'all'

    return normalizePreviousAdvice({
      sourceType: replyContext.sourceType || 'advice',
      sourceMessageId: replyContext.sourceMessageId || '',
      sourceDraftId: replyContext.sourceDraftId || '',
      priority: 'medium',
      diagnosis: messageText.slice(0, 240),
      editTarget: target,
      operations: [
        {
          type: inferFeedbackOperationType(messageText, operationTarget),
          target: operationTarget,
          problem: messageText,
          instruction: '답장 대상 조언의 방향을 실행 가능한 문장 수정으로 반영한다.',
          preserve: ['기존 주제', '사용자 사실 정보'],
          avoid: ['새 소재 생성', '허위 수치', '없는 혜택', '사용자 지시문 복사'],
          priority: 'medium',
        },
      ],
      instructions: ['답장 대상 조언의 핵심 방향을 실제 대본 수정에 반영한다.'],
      preserveSections,
      expectedOutcome: '답장 대상 조언이 실제 문장 수정으로 반영된 대본',
    })
  }

  function replyContextToEditInstructions({ replyContext = null, userMessage = '', fallbackAdvice = null, editTarget = 'all' } = {}) {
    if (!replyContext || typeof replyContext !== 'object') {
      return normalizePreviousAdvice(fallbackAdvice)
    }

    const sourceType = String(replyContext.sourceType || replyContext.source_type || '').trim()
    const sourceMessageId = String(replyContext.sourceMessageId || replyContext.source_message_id || '').trim()
    const sourceDraftId = String(replyContext.sourceDraftId || replyContext.source_draft_id || '').trim()
    const normalizedContext = {
      ...replyContext,
      sourceType,
      sourceMessageId,
      sourceDraftId,
      messageText: String(replyContext.messageText || replyContext.message_text || '').trim(),
    }

    if (sourceType === 'feedback' && normalizedContext.feedback) {
      return feedbackToEditInstructions({
        feedback: {
          ...normalizedContext.feedback,
          sourceDraftId,
        },
        sourceMessageId,
        editTarget: normalizedContext.editTarget || editTarget,
      })
    }

    if (sourceType === 'suggestion' && normalizedContext.proposedSections) {
      return suggestionToEditInstructions({
        replyContext: normalizedContext,
        userMessage,
        editTarget,
      })
    }

    if (sourceType === 'advice' || normalizedContext.actionableAdvice || normalizedContext.messageText) {
      return adviceToEditInstructions({
        replyContext: normalizedContext,
        fallbackAdvice,
        editTarget,
        userMessage,
      })
    }

    return normalizePreviousAdvice(fallbackAdvice)
  }

  return {
    detectFeedbackSection,
    inferFeedbackOperationType,
    feedbackToEditInstructions,
    replyContextToEditInstructions,
  }
}
