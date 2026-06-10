export function createStrictSemanticParser({
  SECTION_KEYS,
  COPILOT_OPERATION_TYPES,
  cleanRequestedPhrase,
  uniqueCompactList,
  normalizeSemanticOperation,
  normalizeSemanticLock,
  classifyCandidateMeaning,
} = {}) {
  const allowedIntents = new Set(['edit_script', 'apply_feedback', 'ask_advice', 'unknown'])
  const allowedUserFacingNeeds = new Set(['modify_script', 'answer_question', 'clarify'])

  function clampConfidence(value, fallback = 0) {
    const number = Number(value)
    if (!Number.isFinite(number)) {
      return fallback
    }
    return Math.max(0, Math.min(1, number))
  }

  function normalizeIntent(value = 'unknown') {
    const normalized = String(value || '').trim()
    return allowedIntents.has(normalized) ? normalized : 'unknown'
  }

  function normalizeUserFacingNeed(value = 'modify_script') {
    const normalized = String(value || '').trim()
    return allowedUserFacingNeeds.has(normalized) ? normalized : 'modify_script'
  }

  function normalizeTopicChange(topicChange = {}) {
    const requested = Boolean(topicChange?.requested)
    const newSubject = cleanRequestedPhrase(topicChange?.newSubject || '') || null
    const oldSubject = cleanRequestedPhrase(topicChange?.oldSubject || '') || null
    const oldSubjects = uniqueCompactList(
      [
        ...(Array.isArray(topicChange?.oldSubjects) ? topicChange.oldSubjects : []),
        oldSubject || '',
      ],
      8,
    )
    const candidateMeaning = newSubject ? classifyCandidateMeaning(newSubject) : 'unknown'
    const subjectLooksValid = !newSubject || candidateMeaning === 'product_or_subject'

    return {
      requested: requested && Boolean(newSubject) && subjectLooksValid,
      oldSubject,
      oldSubjects,
      newSubject: subjectLooksValid ? newSubject : null,
      confidence: requested && subjectLooksValid ? clampConfidence(topicChange?.confidence, 0.7) : 0,
      evidence: subjectLooksValid ? cleanRequestedPhrase(topicChange?.evidence || '') || null : null,
      rejectedCandidate: subjectLooksValid ? null : newSubject,
      rejectedCandidateMeaning: subjectLooksValid ? '' : candidateMeaning,
    }
  }

  function normalizeOperations(operations = []) {
    const normalized = Array.isArray(operations)
      ? operations.map(normalizeSemanticOperation).filter(Boolean)
      : []
    return normalized
      .filter((operation) => operation.type !== COPILOT_OPERATION_TYPES.UNKNOWN)
      .slice(0, 8)
  }

  function normalizeLocks(locks = []) {
    return Array.isArray(locks)
      ? locks.map(normalizeSemanticLock).filter(Boolean).slice(0, 5)
      : []
  }

  function normalizeReplyReference(replyReference = {}, resolvedPreviousAdvice = null, resolvedReplyContext = null) {
    const sourceMessageId =
      cleanRequestedPhrase(
        replyReference?.sourceMessageId ||
          resolvedReplyContext?.sourceMessageId ||
          resolvedReplyContext?.source_message_id ||
          resolvedPreviousAdvice?.sourceMessageId ||
          '',
      ) || ''
    const sourceDraftId =
      cleanRequestedPhrase(
        replyReference?.sourceDraftId ||
          resolvedReplyContext?.sourceDraftId ||
          resolvedReplyContext?.source_draft_id ||
          resolvedPreviousAdvice?.sourceDraftId ||
          '',
      ) || ''
    const inheritedOperations = Array.isArray(replyReference?.inheritedOperations)
      ? replyReference.inheritedOperations
      : Array.isArray(resolvedPreviousAdvice?.operations)
        ? resolvedPreviousAdvice.operations
        : []

    return {
      hasReplyTarget: Boolean(replyReference?.hasReplyTarget || sourceMessageId || inheritedOperations.length),
      sourceType:
        cleanRequestedPhrase(
          replyReference?.sourceType ||
            resolvedReplyContext?.sourceType ||
            resolvedReplyContext?.source_type ||
            resolvedPreviousAdvice?.sourceType ||
            '',
        ) || '',
      sourceMessageId,
      sourceDraftId,
      inheritedOperations,
    }
  }

  function normalizeStrictInstruction(candidate = {}, context = {}) {
    const topicChange = normalizeTopicChange(candidate.topicChange || {})
    let operations = normalizeOperations(candidate.operations || [])
    const locks = normalizeLocks(candidate.locks || [])
    const userFacingNeed = normalizeUserFacingNeed(candidate.userFacingNeed)
    let intent = normalizeIntent(candidate.intent)
    const hasExplicitTopicChangeSignal = Object.prototype.hasOwnProperty.call(
      candidate.regexSignals || {},
      'hasExplicitTopicChange',
    )
    const explicitTopicChange = hasExplicitTopicChangeSignal ? Boolean(candidate.regexSignals?.hasExplicitTopicChange) : true

    if (userFacingNeed === 'answer_question' || intent === 'ask_advice') {
      intent = 'ask_advice'
      operations = []
    }

    if (
      (topicChange.rejectedCandidate || (topicChange.requested && !explicitTopicChange)) &&
      operations.some((operation) => operation.type === COPILOT_OPERATION_TYPES.TOPIC_REFRAME)
    ) {
      const rejectedCandidate = topicChange.rejectedCandidate || topicChange.newSubject
      const rejectedCandidateMeaning =
        topicChange.rejectedCandidateMeaning ||
        (explicitTopicChange ? classifyCandidateMeaning(rejectedCandidate) : 'implicit_content_edit')
      const fallbackType =
        rejectedCandidateMeaning === 'tone'
          ? COPILOT_OPERATION_TYPES.TONE_ADJUST
          : rejectedCandidateMeaning === 'format'
            ? COPILOT_OPERATION_TYPES.FORMAT_APPLY
            : COPILOT_OPERATION_TYPES.PARTIAL_REWRITE
      operations = operations.map((operation, index) =>
        index === 0
          ? {
              ...operation,
              type: fallbackType,
              goal: operation.goal || rejectedCandidate || '선택 초안 내부 내용 수정',
              styleTarget:
                fallbackType === COPILOT_OPERATION_TYPES.TONE_ADJUST ||
                fallbackType === COPILOT_OPERATION_TYPES.FORMAT_APPLY
                  ? operation.styleTarget || rejectedCandidate || ''
                  : operation.styleTarget || '',
            }
          : operation,
      )
      topicChange.requested = false
      topicChange.newSubject = null
      topicChange.confidence = 0
      topicChange.evidence = null
      topicChange.rejectedCandidate = rejectedCandidate
      topicChange.rejectedCandidateMeaning = rejectedCandidateMeaning
    }

    if (!operations.length && intent === 'edit_script' && userFacingNeed === 'modify_script') {
      operations = [
        {
          type: COPILOT_OPERATION_TYPES.PARTIAL_REWRITE,
          target: 'all',
          goal: '요청 표현 수정',
          styleTarget: '',
          evidence: context.userMessage || '',
          confidence: 0.5,
        },
      ]
    }

    return {
      intent,
      confidence: clampConfidence(candidate.confidence, 0.72),
      topicChange: {
        requested: topicChange.requested,
        oldSubject: topicChange.oldSubject,
        oldSubjects: topicChange.oldSubjects,
        newSubject: topicChange.newSubject,
        confidence: topicChange.confidence,
        evidence: topicChange.evidence,
      },
      operations,
      locks,
      replyReference: normalizeReplyReference(
        candidate.replyReference || {},
        context.resolvedPreviousAdvice,
        context.resolvedReplyContext,
      ),
      userFacingNeed,
      clarificationQuestion: candidate.clarificationQuestion || null,
      legacyInstruction: candidate.legacyInstruction || {},
      regexSignals: candidate.regexSignals || {},
      allOperationsBlockedByLocks: Boolean(candidate.allOperationsBlockedByLocks),
      validation: {
        ...(candidate.validation || {}),
        strictSchemaApplied: true,
        parserSource: candidate.parserSource || 'strict_schema',
        rejectedNewSubjectCandidate: topicChange.rejectedCandidate || '',
        rejectedNewSubjectMeaning: topicChange.rejectedCandidateMeaning || '',
      },
      parserSource: candidate.parserSource || 'strict_schema',
    }
  }

  function fromLegacyInstruction({
    userMessage = '',
    regexSignals = {},
    legacyInstruction = {},
    candidateInstruction = {},
    resolvedPreviousAdvice = null,
    resolvedReplyContext = null,
  } = {}) {
    return normalizeStrictInstruction(
      {
        ...candidateInstruction,
        legacyInstruction,
        regexSignals,
        parserSource: 'strict_schema',
      },
      {
        userMessage,
        resolvedPreviousAdvice,
        resolvedReplyContext,
      },
    )
  }

  return {
    normalizeStrictInstruction,
    fromLegacyInstruction,
  }
}
