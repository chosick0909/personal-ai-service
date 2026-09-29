const MAX_RECENT_TURNS = 48
const MAX_CONTENT_LENGTH = 4000

function compactText(value = '', maxLength = MAX_CONTENT_LENGTH) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function messageKind(message = {}) {
  if (message.feedback) return 'feedback'
  if (message.proposedSections) return 'suggestion'
  if (message.actionableAdvice) return 'advice'
  return message.role === 'user' ? 'user' : 'reply'
}

function compactMessage(message = {}) {
  return {
    id: String(message.id || ''),
    role: message.role === 'user' ? 'user' : 'assistant',
    kind: messageKind(message),
    content: compactText(message.content),
    sourceAccountId: String(message.sourceAccountId || ''),
    sourceReferenceId: String(message.sourceReferenceId || ''),
    sourceVersionId: String(message.sourceVersionId || ''),
    proposedSections: message.proposedSections || null,
    suggestionApplied: Boolean(message.suggestionApplied || message.feedback?.applied),
    sourceDraftId: String(message.sourceDraftId || ''),
    sourceVariantId: String(message.sourceVariantId || ''),
  }
}

function buildMessageContext(message = {}) {
  if (!message || message.role === 'user') {
    return null
  }

  return {
    sourceType: messageKind(message),
    sourceMessageId: String(message.id || ''),
    sourceDraftId: String(message.sourceDraftId || ''),
    sourceVariantId: String(message.sourceVariantId || ''),
    messageText: compactText(message.content),
    editTarget: String(message.editTarget || 'all'),
    feedback: message.feedback || null,
    proposedSections: message.proposedSections || null,
    actionableAdvice: message.actionableAdvice || null,
  }
}

export function buildCopilotConversationContext({
  chatMessages = [],
  accountId = '',
  referenceId = '',
  activeDraftId = '',
  currentVersionId = '',
  selectedVariant = {},
  explicitReplyContext = null,
} = {}) {
  const variantId = String(selectedVariant.selectedVariantId || selectedVariant.selectedScriptId || '')
  const matches = (message) =>
    (!message.sourceAccountId || message.sourceAccountId === accountId) &&
    (!message.sourceReferenceId || message.sourceReferenceId === referenceId) &&
    (!message.sourceDraftId || message.sourceDraftId === activeDraftId) &&
    (!message.sourceVariantId || message.sourceVariantId === variantId || message.sourceVariantId === selectedVariant.selectedScriptId)
  const messages = (Array.isArray(chatMessages) ? chatMessages : []).filter(matches).map((message) => ({ ...message, sourceVariantId: variantId }))
  const savedSummary = [...messages].reverse().map((message) => message.conversationSummary).find((summary) =>
    summary?.text && summary.accountId === accountId && summary.referenceId === referenceId &&
    summary.activeDraftId === activeDraftId && summary.variantId === variantId &&
    messages.some((message) => message.id === summary.throughMessageId))
  const coveredIndex = savedSummary ? messages.findIndex((message) => message.id === savedSummary.throughMessageId) : -1
  const uncoveredMessages = messages.slice(coveredIndex + 1)
  const assistantMessages = messages.filter((message) => message?.role === 'assistant')
  const latestFeedbackMessage = [...assistantMessages].reverse().find((message) => message?.feedback)
  const latestSuggestionMessage = [...assistantMessages].reverse().find((message) => message?.proposedSections)
  const latestAdviceMessage = [...assistantMessages].reverse().find((message) => message?.actionableAdvice)
  const pendingSource =
    [...assistantMessages]
      .reverse()
      .find(
        (message) =>
          (message?.feedback && !message.feedback.applied) ||
          (message?.proposedSections && !message.suggestionApplied) ||
          message?.actionableAdvice,
      ) || null

  return {
    schemaVersion: 'copilot-conversation-v2',
    accountId,
    referenceId,
    summary: savedSummary || null,
    overflow: uncoveredMessages.length > MAX_RECENT_TURNS,
    activeDraftId: String(activeDraftId || ''),
    currentVersionId: String(currentVersionId || ''),
    activeVariant: {
      id: variantId,
      key: String(selectedVariant.selectedVariantKey || ''),
      label: String(selectedVariant.selectedLabel || ''),
      index: Number.isInteger(selectedVariant.selectedVariantIndex)
        ? selectedVariant.selectedVariantIndex
        : null,
    },
    recentTurns: uncoveredMessages.slice(-MAX_RECENT_TURNS).map(compactMessage),
    latestFeedback: buildMessageContext(latestFeedbackMessage),
    latestSuggestion: buildMessageContext(latestSuggestionMessage),
    latestAdvice: buildMessageContext(latestAdviceMessage),
    pendingAction: pendingSource
      ? {
          type: pendingSource.feedback
            ? 'apply_feedback'
            : pendingSource.proposedSections
              ? 'apply_suggestion'
              : 'apply_advice',
          ...buildMessageContext(pendingSource),
        }
      : null,
    replyTarget: explicitReplyContext || null,
  }
}

export function sameCopilotEditorSnapshot(left, right) {
  if (!left || !right) return false
  return ['accountId', 'referenceId', 'draftId', 'variantId', 'versionId'].every((key) =>
    String(left[key] || '') === String(right[key] || '')) &&
    ['hook', 'body', 'cta'].every((key) => String(left.sections?.[key] || '') === String(right.sections?.[key] || ''))
}
