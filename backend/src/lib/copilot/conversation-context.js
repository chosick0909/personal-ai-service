const REFERENCE_REQUEST_PATTERN =
  /(이대로|그대로|그렇게|저대로|저렇게|아까|방금|직전|피드백대로|조언대로|말한\s*대로|그\s*방향|이\s*방향)/i

function readString(value = '', maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength)
}

function normalizeReference(value = null) {
  if (!value || typeof value !== 'object') {
    return null
  }

  return {
    sourceType: readString(value.sourceType || value.source_type, 40),
    sourceMessageId: readString(value.sourceMessageId || value.source_message_id, 160),
    sourceDraftId: readString(value.sourceDraftId || value.source_draft_id, 160),
    sourceVariantId: readString(value.sourceVariantId || value.source_variant_id, 160),
    messageText: readString(value.messageText || value.message_text),
    editTarget: readString(value.editTarget || value.edit_target || 'all', 20),
    feedback: value.feedback && typeof value.feedback === 'object' ? value.feedback : null,
    proposedSections:
      value.proposedSections && typeof value.proposedSections === 'object' ? value.proposedSections : null,
    actionableAdvice:
      value.actionableAdvice && typeof value.actionableAdvice === 'object' ? value.actionableAdvice : null,
  }
}

export function normalizeCopilotConversationContext(value = null) {
  if (!value || typeof value !== 'object') {
    return null
  }

  return {
    schemaVersion: readString(value.schemaVersion || value.schema_version, 80),
    activeDraftId: readString(value.activeDraftId || value.active_draft_id, 160),
    currentVersionId: readString(value.currentVersionId || value.current_version_id, 160),
    activeVariant: {
      id: readString(value.activeVariant?.id, 160),
      key: readString(value.activeVariant?.key, 80),
      label: readString(value.activeVariant?.label, 80),
      index: Number.isInteger(value.activeVariant?.index) ? value.activeVariant.index : null,
    },
    recentTurns: Array.isArray(value.recentTurns)
      ? value.recentTurns.slice(-8).map((turn) => ({
          id: readString(turn?.id, 160),
          role: turn?.role === 'user' ? 'user' : 'assistant',
          kind: readString(turn?.kind, 40),
          content: readString(turn?.content),
          sourceDraftId: readString(turn?.sourceDraftId || turn?.source_draft_id, 160),
          sourceVariantId: readString(turn?.sourceVariantId || turn?.source_variant_id, 160),
        }))
      : [],
    latestFeedback: normalizeReference(value.latestFeedback || value.latest_feedback),
    latestSuggestion: normalizeReference(value.latestSuggestion || value.latest_suggestion),
    latestAdvice: normalizeReference(value.latestAdvice || value.latest_advice),
    pendingAction: normalizeReference(value.pendingAction || value.pending_action),
    replyTarget: normalizeReference(value.replyTarget || value.reply_target),
  }
}

function matchesCurrentSelection(reference, { currentDraftId = '', currentVariantId = '' } = {}) {
  if (!reference) {
    return false
  }
  if (reference.sourceDraftId && currentDraftId && reference.sourceDraftId !== currentDraftId) {
    return false
  }
  if (reference.sourceVariantId && currentVariantId && reference.sourceVariantId !== currentVariantId) {
    return false
  }
  return true
}

export function isReferentialCopilotRequest(message = '') {
  return REFERENCE_REQUEST_PATTERN.test(String(message || '').replace(/\s+/g, ' '))
}

export function resolveCopilotConversationReference({
  userMessage = '',
  explicitReplyContext = null,
  conversationContext = null,
  currentDraftId = '',
  currentVariantId = '',
} = {}) {
  const normalizedContext = normalizeCopilotConversationContext(conversationContext)
  const selection = {
    currentDraftId: readString(currentDraftId, 160),
    currentVariantId: readString(currentVariantId, 160),
  }
  const explicitReply = normalizeReference(explicitReplyContext)

  if (matchesCurrentSelection(explicitReply, selection)) {
    return {
      replyContext: explicitReply,
      source: 'explicit_reply',
      conversationContext: normalizedContext,
    }
  }

  if (!normalizedContext || !isReferentialCopilotRequest(userMessage)) {
    return {
      replyContext: null,
      source: 'none',
      conversationContext: normalizedContext,
    }
  }

  const candidates = [
    ['reply_target', normalizedContext.replyTarget],
    ['pending_action', normalizedContext.pendingAction],
    ['latest_feedback', normalizedContext.latestFeedback],
    ['latest_suggestion', normalizedContext.latestSuggestion],
    ['latest_advice', normalizedContext.latestAdvice],
  ]

  for (const [source, candidate] of candidates) {
    if (matchesCurrentSelection(candidate, selection)) {
      return {
        replyContext: candidate,
        source,
        conversationContext: normalizedContext,
      }
    }
  }

  return {
    replyContext: null,
    source: 'stale_or_missing',
    conversationContext: normalizedContext,
  }
}
