export function createSemanticInstructionParser({
  parseRegexSignals,
  replyContextToEditInstructions,
  parseLegacyEditInstruction,
  buildSemanticInstructionFromLegacy,
  resolveSemanticInstructionConflicts,
  strictSemanticParser,
} = {}) {
  return function parseSemanticEditInstruction({
    userMessage = '',
    intentResult = {},
    previousAdvice = null,
    replyContext = null,
    editTarget = '',
  } = {}) {
    const regexSignals = parseRegexSignals(userMessage)
    const resolvedReplyContext = replyContext || intentResult.replyContext || null
    const resolvedPreviousAdvice = replyContextToEditInstructions({
      replyContext: resolvedReplyContext,
      userMessage,
      fallbackAdvice: previousAdvice || intentResult.previousAdvice || null,
      editTarget: editTarget || intentResult.editTarget || '',
    })
    const mergedIntentResult = {
      ...intentResult,
      previousAdvice: resolvedPreviousAdvice || previousAdvice || intentResult.previousAdvice || null,
      replyContext: resolvedReplyContext,
      replyToMessageId:
        intentResult.replyToMessageId ||
        resolvedReplyContext?.sourceMessageId ||
        resolvedReplyContext?.source_message_id ||
        resolvedPreviousAdvice?.sourceMessageId ||
        '',
    }
    const legacyInstruction = parseLegacyEditInstruction(userMessage, mergedIntentResult)
    const candidateInstruction = buildSemanticInstructionFromLegacy({
      request: userMessage,
      intentResult: mergedIntentResult,
      regexSignals,
      legacyInstruction,
    })
    const strictInstruction = strictSemanticParser
      ? strictSemanticParser.fromLegacyInstruction({
          userMessage,
          regexSignals,
          legacyInstruction,
          candidateInstruction,
          resolvedPreviousAdvice,
          resolvedReplyContext,
        })
      : candidateInstruction
    return resolveSemanticInstructionConflicts(
      strictInstruction,
    )
  }
}
