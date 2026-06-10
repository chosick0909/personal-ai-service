export function createRegexSignalsParser({
  inferRequestedSections,
  detectExplicitPreserveSections,
  extractTargetDurationSeconds,
  isFormatApplyRequest,
  isApplyPreviousAdviceRequest,
} = {}) {
  function hasExplicitTopicChangeSignal(text = '') {
    const source = String(text || '').trim()
    return (
      /(주제|소재|상품|제품|아이템|카테고리|콘셉트|컨셉)(?:를|은|는|이|가)?/i.test(source) ||
      /(?:말고|대신|빼고|버리고|제외하고)/i.test(source) ||
      /(?:^|[\s,])[^.!?\n]{1,40}에서\s+[^.!?\n]{1,40}(?:으로|로)(?:\s|$)/i.test(source)
    )
  }

  return function parseRegexSignals(userMessage = '') {
    const text = String(userMessage || '').trim()
    const compact = text.replace(/\s+/g, '')
    const mentionedSections = inferRequestedSections(text)
    const explicitLocks = detectExplicitPreserveSections(text)
    const targetDurationSeconds = extractTargetDurationSeconds(text)

    return {
      hasEditVerb:
        /(고쳐|수정|바꿔|바꾸|변경|다듬|개선|보완|줄여|늘려|짧게|길게|강하게|세게|약하게|자연스럽게|정리|압축|추가|넣어|빼줘|삭제|교체|짜줘|짜줄래|다시\s*짜|리라이트|rewrite|edit|revise|fix)/i.test(
          text,
        ),
      maybeTopicChange:
        hasExplicitTopicChangeSignal(text) &&
        /(바꿔|바꾸|변경|전환|다시\s*(?:짜|써|작성|만들)|가자|주제|소재|상품|제품|아이템)/i.test(
          text,
        ),
      hasExplicitTopicChange: hasExplicitTopicChangeSignal(text),
      mentionedSections,
      explicitLocks,
      hasDurationCompress: Boolean(targetDurationSeconds),
      targetDurationSeconds,
      hasFormatApply: isFormatApplyRequest(text),
      hasReplyLikeExpression: isApplyPreviousAdviceRequest(text),
      hasQuestionIntent:
        /(어떻게|왜|뭐가|질문|방법|알려|궁금|어때|괜찮|피드백|조언|평가|점수|광고\s*같|판매\s*같|별로|문제|약한가|약해|반응\s*올|안\s*끌리)/i.test(
          text,
        ),
      compactLength: compact.length,
    }
  }
}
