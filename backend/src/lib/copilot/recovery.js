export function createQaRecoveryPlanner({
  SECTION_KEYS,
  COPILOT_OPERATION_TYPES,
  cleanRequestedPhrase,
  uniqueCompactList,
  classifyCandidateMeaning,
  isInvalidNewSubjectCandidate,
  extractFramingRewriteHint,
  buildEditPlanFromInstruction,
  parseRegexSignals,
} = {}) {
  const triggerIssues = new Set([
    'instruction_leakage',
    'forbidden_phrase_leakage',
    'mixed_subject_contamination',
    'reference_contamination',
    'edit_plan_not_followed',
    'operation_not_applied',
  ])

  return function buildQaFailureRecoveryEditPlan({
    userRequest = '',
    currentSections = {},
    intentResult = {},
    editTarget = '',
    copilotMemory = {},
    targetDurationSeconds = null,
    previousAdvice = null,
    editPlan = null,
    qaResult = null,
    ruleCheck = null,
  } = {}) {
    if (!editPlan || editPlan.operationType !== COPILOT_OPERATION_TYPES.TOPIC_REFRAME) {
      return null
    }

    const issueTypes = uniqueCompactList(
      [
        ...(Array.isArray(qaResult?.issueTypes) ? qaResult.issueTypes : []),
        ...(Array.isArray(qaResult?.issues) ? qaResult.issues.map((issue) => issue?.type).filter(Boolean) : []),
        ...(Array.isArray(ruleCheck?.issueTypes) ? ruleCheck.issueTypes : []),
        ...(Array.isArray(ruleCheck?.issues) ? ruleCheck.issues.map((issue) => issue?.type).filter(Boolean) : []),
      ],
      16,
    )
    const candidate = cleanRequestedPhrase(
      editPlan.newSubject ||
        editPlan.structuredEditInstruction?.newSubject ||
        editPlan.semanticInstruction?.topicChange?.newSubject ||
        '',
    )
    const candidateMeaning = classifyCandidateMeaning(candidate)
    const topicConfidence = Number(
      editPlan.semanticInstruction?.topicChange?.confidence || editPlan.structuredEditInstruction?.confidence || 0,
    )
    const hasRecoveryIssue = issueTypes.some((type) => triggerIssues.has(type))
    const looksLikeInstruction =
      !candidate ||
      isInvalidNewSubjectCandidate(candidate) ||
      ['framing', 'tone', 'format', 'question', 'section_name'].includes(candidateMeaning)
    const lowConfidenceInstruction = topicConfidence > 0 && topicConfidence < 0.62 && hasRecoveryIssue

    if (!looksLikeInstruction && !lowConfidenceInstruction) {
      return null
    }

    const fallbackType =
      candidateMeaning === 'tone'
        ? COPILOT_OPERATION_TYPES.TONE_ADJUST
        : candidateMeaning === 'format'
          ? COPILOT_OPERATION_TYPES.FORMAT_APPLY
          : COPILOT_OPERATION_TYPES.FRAMING_REWRITE
    const targetSections = Array.isArray(editPlan.targetSections) && editPlan.targetSections.length
      ? editPlan.targetSections.filter((section) => SECTION_KEYS.includes(section))
      : SECTION_KEYS
    const operationTarget = targetSections.length === 1 ? targetSections[0] : 'all'
    const hint =
      candidate ||
      editPlan.toneHint ||
      extractFramingRewriteHint(userRequest) ||
      '사용자 요청의 흐름과 표현 방향'
    const locks = uniqueCompactList(editPlan.preserveSections || [], 3)
      .filter((section) => SECTION_KEYS.includes(section))
      .map((target) => ({
        target,
        lockType: 'do_not_touch',
        evidence: '기존 editPlan preserveSections',
      }))
    const semanticInstruction = {
      intent: 'edit_script',
      confidence: 0.76,
      topicChange: {
        requested: false,
        oldSubject: null,
        oldSubjects: [],
        newSubject: null,
        confidence: 0,
        evidence: null,
      },
      operations: [
        {
          type: fallbackType,
          target: operationTarget,
          goal:
            fallbackType === COPILOT_OPERATION_TYPES.TONE_ADJUST
              ? `${hint} 말투로 조정`
              : fallbackType === COPILOT_OPERATION_TYPES.FORMAT_APPLY
                ? `${hint} 포맷을 현재 대본에 자연스럽게 적용`
                : `주제/상품은 유지하고 ${hint} 방향으로 전개를 다시 정리`,
          styleTarget:
            fallbackType === COPILOT_OPERATION_TYPES.TONE_ADJUST ||
            fallbackType === COPILOT_OPERATION_TYPES.FORMAT_APPLY
              ? hint
              : '',
          evidence: userRequest,
          confidence: 0.76,
        },
      ],
      locks,
      replyReference: editPlan.semanticInstruction?.replyReference || { hasReplyTarget: false },
      userFacingNeed: 'modify_script',
      clarificationQuestion: null,
      legacyInstruction: {
        operationType: fallbackType,
        newSubject: '',
        requestedMaterials: [],
        toneHint: hint,
        explicitKeep: editPlan.preserveSections || [],
      },
      regexSignals: editPlan.semanticInstruction?.regexSignals || parseRegexSignals(userRequest),
    }

    const recoveryPlan = buildEditPlanFromInstruction({
      userRequest,
      currentSections,
      intentResult: {
        ...intentResult,
        operationType: fallbackType,
        newSubject: '',
        requestedMaterials: [],
        semanticInstruction,
      },
      editTarget: editTarget || editPlan.editTarget || '',
      copilotMemory,
      targetDurationSeconds,
      previousAdvice,
      semanticInstruction,
    })

    return {
      ...recoveryPlan,
      recovery: {
        downgradedFrom: COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
        downgradedTo: fallbackType,
        reason: looksLikeInstruction
          ? 'newSubject 후보가 상품/소재가 아니라 전개/톤 지시로 판단됨'
          : '저신뢰 주제 변경이 QA 실패와 함께 감지됨',
        originalNewSubject: candidate,
        issueTypes,
      },
    }
  }
}
