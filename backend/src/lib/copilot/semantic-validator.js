export function createSemanticValidator({
  SECTION_KEYS,
  COPILOT_OPERATION_TYPES,
  STYLE_KEYWORD_PATTERN,
  FRAMING_REWRITE_PATTERN,
  NON_SUBJECT_CANDIDATE_PATTERN,
  FORMAT_CANDIDATE_PATTERN,
  cleanRequestedPhrase,
  uniqueCompactList,
  normalizeSemanticOperation,
  normalizeSemanticLock,
} = {}) {
  function classifyCandidateMeaning(value = '') {
    const candidate = cleanRequestedPhrase(value)
    if (!candidate) {
      return 'unknown'
    }
    if (STYLE_KEYWORD_PATTERN.test(candidate)) {
      return 'tone'
    }
    if (FORMAT_CANDIDATE_PATTERN.test(candidate)) {
      return 'format'
    }
    if (FRAMING_REWRITE_PATTERN.test(candidate) || NON_SUBJECT_CANDIDATE_PATTERN.test(candidate)) {
      return 'framing'
    }
    if (/^(?:HOOK|훅|BODY|바디|본문|CTA|씨티에이|마무리)$/i.test(candidate)) {
      return 'section_name'
    }
    if (/(어떻게|왜|질문\s*(?:방법|키포인트|포인트)|알려|궁금)/i.test(candidate)) {
      return 'question'
    }
    return 'product_or_subject'
  }

  function isInvalidNewSubjectCandidate(value = '') {
    const subject = cleanRequestedPhrase(value)
    if (!subject) {
      return false
    }
    return (
      STYLE_KEYWORD_PATTERN.test(subject) ||
      FRAMING_REWRITE_PATTERN.test(subject) ||
      NON_SUBJECT_CANDIDATE_PATTERN.test(subject)
    )
  }

  function downgradeInvalidTopicInstruction(instruction = {}, candidate = '') {
    const meaning = classifyCandidateMeaning(candidate)
    const nextType =
      meaning === 'tone'
        ? COPILOT_OPERATION_TYPES.TONE_ADJUST
        : meaning === 'format'
          ? COPILOT_OPERATION_TYPES.FORMAT_APPLY
          : meaning === 'question'
            ? COPILOT_OPERATION_TYPES.PARTIAL_REWRITE
            : COPILOT_OPERATION_TYPES.FRAMING_REWRITE
    const nextGoal =
      nextType === COPILOT_OPERATION_TYPES.TONE_ADJUST
        ? cleanRequestedPhrase(candidate) || '말투 조정'
        : nextType === COPILOT_OPERATION_TYPES.FORMAT_APPLY
          ? cleanRequestedPhrase(candidate) || '예시 포맷 적용'
          : cleanRequestedPhrase(candidate) || '전개 방식 조정'

    return {
      ...instruction,
      validation: {
        ...(instruction.validation || {}),
        downgraded: true,
        downgradedFrom: COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
        downgradedTo: nextType,
        invalidNewSubjectCandidate: cleanRequestedPhrase(candidate) || '',
        candidateMeaning: meaning,
        reason: 'newSubject 후보가 상품/소재가 아니라 톤/포맷/전개 지시로 판단됨',
      },
      topicChange: {
        ...(instruction.topicChange || {}),
        requested: false,
        newSubject: null,
        confidence: 0,
        evidence: null,
      },
      operations: (instruction.operations?.length ? instruction.operations : [{}]).map((operation, index) =>
        index === 0
          ? {
              ...operation,
              type: nextType,
              goal: operation.goal || nextGoal,
              styleTarget:
                nextType === COPILOT_OPERATION_TYPES.TONE_ADJUST ||
                nextType === COPILOT_OPERATION_TYPES.FORMAT_APPLY
                  ? nextGoal
                  : operation.styleTarget || '',
            }
          : operation,
      ),
    }
  }

  function validateSemanticEditInstruction(instruction = {}) {
    const normalized = instruction && typeof instruction === 'object' ? instruction : {}
    let next = {
      intent: ['edit_script', 'apply_feedback', 'ask_advice', 'unknown'].includes(normalized.intent)
        ? normalized.intent
        : 'unknown',
      confidence: Math.max(0, Math.min(1, Number(normalized.confidence || 0))),
      topicChange: {
        requested: Boolean(normalized.topicChange?.requested),
        oldSubject: cleanRequestedPhrase(normalized.topicChange?.oldSubject || '') || null,
        oldSubjects: uniqueCompactList(normalized.topicChange?.oldSubjects || [], 8),
        newSubject: cleanRequestedPhrase(normalized.topicChange?.newSubject || '') || null,
        confidence: Math.max(0, Math.min(1, Number(normalized.topicChange?.confidence || 0))),
        evidence: cleanRequestedPhrase(normalized.topicChange?.evidence || '') || null,
      },
      operations: Array.isArray(normalized.operations)
        ? normalized.operations.map(normalizeSemanticOperation).filter(Boolean).slice(0, 8)
        : [],
      locks: Array.isArray(normalized.locks)
        ? normalized.locks.map(normalizeSemanticLock).filter(Boolean).slice(0, 5)
        : [],
      replyReference: normalized.replyReference || { hasReplyTarget: false },
      userFacingNeed: ['modify_script', 'answer_question', 'clarify'].includes(normalized.userFacingNeed)
        ? normalized.userFacingNeed
        : 'modify_script',
      clarificationQuestion: normalized.clarificationQuestion || null,
      legacyInstruction: normalized.legacyInstruction || {},
      regexSignals: normalized.regexSignals || {},
      allOperationsBlockedByLocks: Boolean(normalized.allOperationsBlockedByLocks),
      validation: normalized.validation || {},
      parserSource: normalized.parserSource || normalized.validation?.parserSource || '',
    }

    if (next.intent === 'ask_advice' || next.userFacingNeed === 'answer_question') {
      return {
        ...next,
        intent: 'ask_advice',
        topicChange: {
          requested: false,
          oldSubject: null,
          oldSubjects: [],
          newSubject: null,
          confidence: 0,
          evidence: null,
        },
        operations: [],
        allOperationsBlockedByLocks: false,
      }
    }

    const candidate = next.topicChange.newSubject || ''
    if (next.topicChange.requested && (!candidate || isInvalidNewSubjectCandidate(candidate))) {
      next = downgradeInvalidTopicInstruction(next, candidate)
    }

    const hasTopicOperation = next.operations.some((operation) => operation.type === COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
    if (hasTopicOperation && (!next.topicChange.requested || !next.topicChange.newSubject)) {
      next = downgradeInvalidTopicInstruction(next, candidate)
    }

    if (next.operations.length) {
      next.operations = next.operations.map((operation) => {
        if (operation.type === COPILOT_OPERATION_TYPES.TOPIC_REFRAME && isInvalidNewSubjectCandidate(next.topicChange.newSubject || '')) {
          const meaning = classifyCandidateMeaning(next.topicChange.newSubject || operation.goal || '')
          if (meaning === 'format') {
            return {
              ...operation,
              type: COPILOT_OPERATION_TYPES.FORMAT_APPLY,
              goal: operation.goal || '예시 포맷 적용',
              styleTarget: operation.styleTarget || operation.goal || '',
            }
          }
          return {
            ...operation,
            type: COPILOT_OPERATION_TYPES.FRAMING_REWRITE,
            goal: operation.goal || '전개 방식 조정',
          }
        }
        return operation
      })
    }

    if (!next.operations.length && next.userFacingNeed === 'modify_script' && !next.allOperationsBlockedByLocks) {
      next.operations = [
        {
          type: COPILOT_OPERATION_TYPES.PARTIAL_REWRITE,
          target: 'all',
          goal: '요청 표현 수정',
          styleTarget: '',
          evidence: '',
          confidence: 0.5,
        },
      ]
    }

    return next
  }

  function resolveSemanticInstructionConflicts(instruction = {}) {
    const normalized = validateSemanticEditInstruction(instruction)
    const lockedTargets = new Set(
      normalized.locks
        .filter((lock) => lock.lockType === 'do_not_touch' || lock.lockType === 'keep_exact')
        .map((lock) => lock.target),
    )

    if (!lockedTargets.size) {
      return normalized
    }

    const operations = normalized.operations.filter((operation) => {
      if (operation.target === 'all') {
        return !lockedTargets.has('all')
      }
      return !lockedTargets.has(operation.target) && !lockedTargets.has('all')
    })

    return {
      ...normalized,
      operations,
      allOperationsBlockedByLocks: !operations.length && normalized.operations.length > 0,
      validation: {
        ...(normalized.validation || {}),
        lockConflictResolved: operations.length !== normalized.operations.length,
        removedOperationCount: Math.max(0, normalized.operations.length - operations.length),
        lockedTargets: [...lockedTargets],
      },
    }
  }

  return {
    classifyCandidateMeaning,
    isInvalidNewSubjectCandidate,
    validateSemanticEditInstruction,
    resolveSemanticInstructionConflicts,
  }
}
