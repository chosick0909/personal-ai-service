const MAX_RECENT_TURNS = 8
const MAX_CONTENT_LENGTH = 500

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
  activeDraftId = '',
  currentVersionId = '',
  selectedVariant = {},
  explicitReplyContext = null,
} = {}) {
  const messages = Array.isArray(chatMessages) ? chatMessages : []
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
    schemaVersion: 'copilot-conversation-v1',
    activeDraftId: String(activeDraftId || ''),
    currentVersionId: String(currentVersionId || ''),
    activeVariant: {
      id: String(selectedVariant.selectedScriptId || selectedVariant.selectedVariantId || ''),
      key: String(selectedVariant.selectedVariantKey || ''),
      label: String(selectedVariant.selectedLabel || ''),
      index: Number.isInteger(selectedVariant.selectedVariantIndex)
        ? selectedVariant.selectedVariantIndex
        : null,
    },
    recentTurns: messages.slice(-MAX_RECENT_TURNS).map(compactMessage),
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
