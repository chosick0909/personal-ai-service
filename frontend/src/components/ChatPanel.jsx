import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../store/AppState'

const FEEDBACK_VERDICT_UI = {
  ready: {
    label: '바로 사용 가능',
    buttonLabel: '미리보기 그대로 반영',
    tone: 'border-[#365244] bg-[#102019] text-[#86EFAC]',
  },
  minor_edit: {
    label: '조금 더 다듬기',
    buttonLabel: '미리보기 그대로 반영',
    tone: 'border-[#4B5563] bg-[#1B202A] text-[#E5E7EB]',
  },
  needs_edit: {
    label: '수정 후 사용 권장',
    buttonLabel: '미리보기 그대로 반영',
    tone: 'btn-solid-contrast',
  },
  rewrite_recommended: {
    label: '새 방향 권장',
    buttonLabel: '미리보기 그대로 반영',
    tone: 'border-[#51443A] bg-[#211A16] text-[#FED7AA]',
  },
}

function getFeedbackVerdictUi(feedback) {
  const status = feedback?.verdict?.status
  return FEEDBACK_VERDICT_UI[status] || {
    label: feedback?.verdict?.label || '',
    buttonLabel: '미리보기 그대로 반영',
    tone: 'btn-solid-contrast',
  }
}

const SECTION_KEYS = ['hook', 'body', 'cta']

function detectFeedbackAdviceSection(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (/(?:^|\b)(?:HOOK|훅|후킹)(?:\b|[:：])/i.test(value) || /첫\s*문장|도입|후킹|스크롤|멈추/i.test(value)) {
    return 'hook'
  }
  if (/(?:^|\b)(?:BODY|바디|본문)(?:\b|[:：])/i.test(value) || /본문|흐름|연결|근거|예시|상황|공감/i.test(value)) {
    return 'body'
  }
  if (/(?:^|\b)(?:CTA|씨티에이|마무리|콜투액션)(?:\b|[:：])/i.test(value) || /댓글|저장|구매|신청|상담|링크|행동/i.test(value)) {
    return 'cta'
  }
  return 'all'
}

function inferFeedbackAdviceOperationType(text = '', section = 'all') {
  const value = String(text || '').replace(/\s+/g, ' ')
  if (/행동\s*이유|댓글|저장|구매|신청|상담|링크|CTA|씨티에이/i.test(value)) {
    return 'strengthen_action_reason'
  }
  if (/연결|이어|받아|흐름|첫\s*문장/i.test(value)) {
    return section === 'body' ? 'connect_hook_to_body' : 'partial_rewrite'
  }
  if (/공감|상황|타겟|고민/i.test(value)) {
    return 'empathy_rewrite'
  }
  if (/광고|판매|구매\s*압박|상업/i.test(value)) {
    return section === 'cta' ? 'cta_reframe' : 'partial_rewrite'
  }
  if (/존댓말|반말|말투|어미|해요체|구어체|자연스럽/i.test(value)) {
    return 'tone_adjust'
  }
  return section === 'cta' ? 'strengthen_action_reason' : 'partial_rewrite'
}

function buildFeedbackReplyAdvice(feedback, sourceMessageId = '') {
  const issues = Array.isArray(feedback?.issues) ? feedback.issues.filter(Boolean) : []
  const recommendations = Array.isArray(feedback?.recommendations) ? feedback.recommendations.filter(Boolean) : []
  const operations = []

  for (const issue of issues) {
    const section = detectFeedbackAdviceSection(issue)
    const matchingRecommendation =
      recommendations.find((recommendation) => {
        const recommendationSection = detectFeedbackAdviceSection(recommendation)
        return recommendationSection === section || recommendationSection === 'all'
      }) || ''
    const target = SECTION_KEYS.includes(section) ? section : 'all'
    operations.push({
      type: inferFeedbackAdviceOperationType(`${issue} ${matchingRecommendation}`, target),
      target,
      problem: String(issue || '').trim(),
      instruction:
        String(matchingRecommendation || '').trim() ||
        `${target === 'all' ? '대본' : target.toUpperCase()}에서 피드백이 지적한 문제를 실제 문장 수정으로 해결한다.`,
      preserve: target === 'cta' ? ['기존 주제', '기존 CTA 의도'] : ['기존 주제'],
      avoid: ['새 소재 생성', '허위 수치', '없는 혜택', '과장 후기'],
      priority: 'high',
    })
  }

  for (const recommendation of recommendations) {
    if (operations.some((operation) => operation.instruction === recommendation)) {
      continue
    }
    const section = detectFeedbackAdviceSection(recommendation)
    const target = SECTION_KEYS.includes(section) ? section : 'all'
    operations.push({
      type: inferFeedbackAdviceOperationType(recommendation, target),
      target,
      problem: '',
      instruction: String(recommendation || '').trim(),
      preserve: target === 'cta' ? ['기존 주제', '기존 CTA 의도'] : ['기존 주제'],
      avoid: ['새 소재 생성', '허위 수치', '없는 혜택'],
      priority: 'medium',
    })
  }

  const targetSections = operations.map((operation) => operation.target).filter((target) => SECTION_KEYS.includes(target))
  const preserveSections = SECTION_KEYS.filter((section) => !targetSections.includes(section))

  return {
    sourceType: 'feedback',
    sourceMessageId,
    priority: 'high',
    diagnosis: feedback?.verdict?.reason || feedback?.summary || feedback?.detail || '직전 피드백에서 짚은 문제를 반영',
    editTarget: targetSections.length === 1 ? targetSections[0] : 'full',
    operations,
    instructions: operations.length
      ? operations.map((operation) => operation.instruction || operation.problem).filter(Boolean)
      : [
          feedback?.verdict?.recommendedAction ||
            '직전 피드백에서 제안한 방향과 미리보기 기준으로 수정한다.',
        ],
    preserveSections,
    expectedOutcome: '직전 피드백에서 지적한 문제가 실제 대본에서 완화된 수정본',
    createdAt: new Date().toISOString(),
    messageTurnsSinceCreated: 0,
  }
}

function buildReplyContext(message, advice = null) {
  if (!message || message.role === 'user') {
    return null
  }

  const sourceType = message.feedback ? 'feedback' : message.proposedSections ? 'suggestion' : 'advice'

  return {
    sourceType,
    sourceMessageId: message.id || advice?.sourceMessageId || '',
    messageText: message.content || '',
    editTarget: message.editTarget || advice?.editTarget || 'all',
    feedback: message.feedback || null,
    proposedSections: message.proposedSections || null,
    actionableAdvice: advice || message.actionableAdvice || null,
  }
}

function MessageBubble({
  message,
  onApply,
  onApplyFeedback,
  onApplyAdvice,
  onReply,
  isApplyingFeedback,
  isApplyingSuggestion,
  isAdviceApplyDisabled,
}) {
  const isUser = message.role === 'user'
  const feedback = message.feedback
  const feedbackProposedSections = feedback?.suggestedSections
  const feedbackVerdict = feedback?.verdict
  const feedbackVerdictUi = getFeedbackVerdictUi(feedback)
  const isFeedbackReady = feedbackVerdict?.status === 'ready'
  const proposedSections = message.proposedSections
  const actionableAdvice = message.actionableAdvice
  const changedSections = Array.isArray(message.changedSections) ? message.changedSections : []
  const editTarget = typeof message.editTarget === 'string' ? message.editTarget : 'all'
  const isFeedbackApplied = Boolean(feedback?.applied)
  const isSuggestionApplied = Boolean(message.suggestionApplied)
  const canReply =
    !isUser &&
    (Boolean(feedback) || Boolean(proposedSections) || Boolean(actionableAdvice) || Boolean(message.content))
  const isApplyDisabled = isFeedbackApplied || isApplyingFeedback
  const applyButtonLabel = isFeedbackApplied
    ? feedback?.staleAfterApply
      ? '반영됨 · 재평가 필요'
      : '피드백 반영 완료'
    : isApplyingFeedback
      ? '반영 중...'
      : feedbackVerdictUi.buttonLabel
  const sectionLabels = [
    ['hook', 'HOOK'],
    ['body', 'BODY'],
    ['cta', 'CTA'],
  ]
  const visibleSectionKeys =
    changedSections.length > 0
      ? changedSections
      : ['hook', 'body', 'cta'].includes(editTarget)
        ? [editTarget]
        : sectionLabels.map(([key]) => key)
  const visibleSections = sectionLabels.filter(([key]) => visibleSectionKeys.includes(key))
  const applyLabel = isSuggestionApplied
    ? '수정 적용 완료'
    : isApplyingSuggestion
      ? '수정 반영 중...'
      : visibleSections.length === 1
        ? `${visibleSections[0][1]} 수정 적용`
        : '이 수정 적용'

  return (
    <div
      className={`group/message flex min-w-0 items-start gap-2 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`relative min-w-0 max-w-[88%] overflow-hidden rounded-[22px] px-4 py-3 text-sm leading-6 ${
          isUser
            ? 'btn-solid-contrast'
            : 'border border-[#2F3543] bg-[#161B24] pr-16 text-[#D1D5DB]'
        }`}
      >
        {canReply ? (
          <button
            type="button"
            onClick={() => onReply(message)}
            className="absolute right-3 top-3 z-10 rounded-full border border-[#2F3543] bg-[#10151D]/95 px-3 py-1 text-[11px] font-semibold leading-none text-[#AEB6C5] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.24)] backdrop-blur transition hover:border-[#3A414F] hover:text-[#F3F4F6] focus-visible:opacity-100 group-hover/message:opacity-100"
          >
            답장
          </button>
        ) : null}
        {feedback ? (
          <div
            className={`rounded-[18px] border border-[#2F3543] bg-[#161B24] p-3 ${
              isFeedbackReady ? 'ready-verdict-card' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
                  기획 점수
                </div>
                <div className="mt-1 text-2xl font-bold text-[#F3F4F6]">{feedback.score}점</div>
              </div>
              {feedbackVerdictUi.label ? (
                <div className="shrink-0 max-w-[132px] rounded-full border border-[#3A414F] bg-[#10151D] px-3 py-1.5 text-center text-[11px] font-semibold leading-tight text-[#D1D5DB]">
                  {feedbackVerdictUi.label}
                </div>
              ) : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-[#AEB6C5]">
              {feedbackVerdict?.reason || feedback.detail || message.content}
            </p>
            {feedback.recheckedAfterApply ? (
              <p className="mt-2 rounded-[14px] border border-[#2F3543] bg-[#10151D] px-3 py-2 text-xs leading-5 text-[#AEB6C5]">
                이전 피드백 반영 후 다시 본 결과입니다.
                {Number.isFinite(Number(feedback.previousFeedbackScore))
                  ? ` 이전 점수 ${feedback.previousFeedbackScore}점 → 현재 ${feedback.score}점 기준으로 판단했어요.`
                  : ' 이전에 짚은 문제가 해결됐는지 먼저 보고 판단했어요.'}
              </p>
            ) : null}
            {feedback.detail && feedbackVerdict?.reason ? (
              <p className="mt-2 text-xs leading-5 text-[#8E97A6]">{feedback.detail}</p>
            ) : null}
            {feedbackProposedSections ? (
              <div className="mt-3 min-w-0 space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8E97A6]">
                  {isFeedbackReady ? '선택적으로 다듬을 수 있는 부분' : '피드백 반영 미리보기'}
                </div>
                <div className="min-w-0 max-w-full space-y-2 overflow-hidden rounded-[18px] border border-[#2F3543] bg-[#10151D] p-3">
                  {sectionLabels.map(([key, label]) => (
                    <section key={key} className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8E97A6]">
                        {label}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#E5E7EB]">
                        {feedbackProposedSections[key] || '-'}
                      </p>
                    </section>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onApplyFeedback(feedback)}
                  disabled={isApplyDisabled}
                  className={`inline-flex min-h-10 max-w-full items-center justify-center rounded-full px-4 py-2 text-center text-xs font-semibold leading-tight transition whitespace-normal break-keep disabled:cursor-not-allowed disabled:opacity-70 ${feedbackVerdictUi.tone}`}
                >
                  {applyButtonLabel}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
            {proposedSections ? (
              <div className="mt-3 min-w-0 space-y-3">
                <div className="min-w-0 max-w-full space-y-2 overflow-hidden rounded-[18px] border border-[#2F3543] bg-[#10151D] p-3">
                  {visibleSections.map(([key, label]) => (
                    <section key={key} className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8E97A6]">
                        {label}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#E5E7EB]">
                        {proposedSections[key] || '-'}
                      </p>
                    </section>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onApply(proposedSections, message.id)}
                  disabled={isSuggestionApplied || isApplyingSuggestion}
                  className="rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1.5 text-xs font-semibold text-[#D1D5DB] transition hover:bg-[#232833] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {applyLabel}
                </button>
              </div>
            ) : null}
            {!proposedSections && actionableAdvice ? (
              <button
                type="button"
                onClick={() => onApplyAdvice(actionableAdvice)}
                disabled={isAdviceApplyDisabled}
                className="mt-3 rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1.5 text-xs font-semibold text-[#D1D5DB] transition hover:bg-[#232833] disabled:cursor-not-allowed disabled:opacity-60"
              >
                이 방향으로 수정
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function LoadingBubble({ label }) {
  return (
    <div className="flex min-w-0 justify-start">
      <div className="inline-flex max-w-[88%] items-center gap-2 rounded-[22px] border border-[#2F3543] bg-[#161B24] px-4 py-3 text-sm font-medium text-[#D1D5DB]">
        <span>{label}</span>
        <span className="inline-flex gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8E97A6]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8E97A6] [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8E97A6] [animation-delay:240ms]" />
        </span>
      </div>
    </div>
  )
}

export default function ChatPanel({ embedded = false, fixedHeight = null }) {
  const draftInputRef = useRef(null)
  const [replyTargetMessage, setReplyTargetMessage] = useState(null)
  const {
    chatMessages,
    draftMessage,
    setDraftMessage,
    editTarget,
    setEditTarget,
    sendChatMessage,
    isChatLoading,
    isFeedbackLoading,
    applyFeedback,
    isApplyingFeedback,
    isApplyingSuggestion,
    pendingSuggestion,
    applySuggestion,
    copilotRemaining,
  } = useAppState()
  const chatRemainingLabel = Number.isFinite(copilotRemaining.chat) ? `${copilotRemaining.chat}회` : '무제한'
  const feedbackRemainingLabel = Number.isFinite(copilotRemaining.feedback) ? `${copilotRemaining.feedback}회` : '무제한'
  const isChatLimitReached = Number.isFinite(copilotRemaining.chat) && copilotRemaining.chat <= 0
  const isSendDisabled = isChatLoading || isChatLimitReached
  const loadingLabel = isFeedbackLoading
    ? '피드백 생성 중'
    : isApplyingFeedback
      ? '피드백 반영 중'
      : isApplyingSuggestion
        ? '수정 반영 중'
        : isChatLoading
          ? '답변 생성 중'
          : ''
  const shouldShowWelcomePrompt =
    !pendingSuggestion &&
    !isChatLoading &&
    !isFeedbackLoading &&
    !isApplyingFeedback &&
    !isApplyingSuggestion &&
    chatMessages.length === 0
  const editTargetOptions = [
    ['all', '전체'],
    ['hook', 'HOOK'],
    ['body', 'BODY'],
    ['cta', 'CTA'],
  ]
  const replyAdvice = useMemo(() => {
    if (!replyTargetMessage || replyTargetMessage.role === 'user') {
      return null
    }
    const feedback = replyTargetMessage.feedback
    if (replyTargetMessage.actionableAdvice) {
      return {
        ...replyTargetMessage.actionableAdvice,
        sourceMessageId: replyTargetMessage.id,
      }
    }
    if (feedback) {
      return buildFeedbackReplyAdvice(feedback, replyTargetMessage.id)
    }
    if (replyTargetMessage.proposedSections) {
      return {
        sourceMessageId: replyTargetMessage.id,
        diagnosis: '직전 코파일럿 수정 제안을 기준으로 반영',
        editTarget: replyTargetMessage.editTarget || 'all',
        instructions: ['직전 코파일럿 수정 제안의 방향을 현재 대본에 반영한다.'],
        preserveSections: [],
        expectedOutcome: '직전 수정 제안과 같은 방향의 대본',
        createdAt: new Date().toISOString(),
        messageTurnsSinceCreated: 0,
      }
    }
    return null
  }, [replyTargetMessage])

  const isApplyReplyRequest = (value = '') =>
    /(이대로|그대로|그렇게|그\s*방향|피드백대로|조언대로|방금\s*말한\s*대로).{0,12}(수정|고쳐|바꿔|반영|적용|해줘|해주세요)/i.test(
      String(value || '').replace(/\s+/g, ' '),
    )

  const clearReplyTarget = () => {
    setReplyTargetMessage(null)
  }

  const isReplyDirectApplyAvailable =
    Boolean(replyTargetMessage?.feedback || replyTargetMessage?.proposedSections) &&
    isApplyReplyRequest(draftMessage)
  const isSubmitDisabled = isSendDisabled && !isReplyDirectApplyAvailable

  const handleSendDraft = async () => {
    const message = draftMessage.trim()
    if (!message) {
      return
    }

    if (replyTargetMessage && isApplyReplyRequest(message)) {
      if (replyTargetMessage.feedback) {
        clearReplyTarget()
        setDraftMessage('')
        await applyFeedback(replyTargetMessage.feedback)
        return
      }
      if (replyTargetMessage.proposedSections) {
        clearReplyTarget()
        setDraftMessage('')
        await applySuggestion(replyTargetMessage.proposedSections, replyTargetMessage.id)
        return
      }
    }

    if (isSubmitDisabled) {
      return
    }

    const options = replyTargetMessage
      ? {
          previousAdvice: replyAdvice,
          replyContext: buildReplyContext(replyTargetMessage, replyAdvice),
          replyToMessageId: replyTargetMessage.id,
        }
      : {}
    clearReplyTarget()
    await sendChatMessage(options)
  }

  useEffect(() => {
    const handleFocusCopilotDraft = () => {
      window.requestAnimationFrame(() => {
        draftInputRef.current?.focus()
      })
    }

    window.addEventListener('hookai:focus-copilot-draft', handleFocusCopilotDraft)
    return () => {
      window.removeEventListener('hookai:focus-copilot-draft', handleFocusCopilotDraft)
    }
  }, [])

  const handleDraftKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) {
      return
    }

    event.preventDefault()
    if (draftMessage.trim()) {
      void handleSendDraft()
    }
  }

  return (
    <div
      className={`grid min-h-0 overflow-hidden ${
        embedded
          ? 'h-[min(720px,calc(100vh-48px))] grid-rows-[auto_minmax(0,1fr)_auto] rounded-[32px] border border-[#2F3543] bg-[#0F131B] xl:h-full'
          : 'h-full bg-[linear-gradient(180deg,#0F131B_0%,#131720_100%)] px-4 py-4'
      }`}
      style={
        embedded && Number.isFinite(fixedHeight) && fixedHeight > 0
          ? { height: `${fixedHeight}px`, maxHeight: `${fixedHeight}px` }
          : undefined
      }
    >
      <div className={`${embedded ? 'shrink-0 border-b border-[#2F3543] px-5 py-3' : 'shrink-0 rounded-[24px] border border-[#2F3543] bg-[#121821] px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.25)]'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[#F3F4F6]">AI 코파일럿</div>
          <div className="text-[11px] text-[#94A3B8]">
            수정 {chatRemainingLabel} · 피드백 {feedbackRemainingLabel}
          </div>
        </div>
      </div>

      <div className={`${embedded ? 'min-h-0 min-w-0 overflow-hidden' : 'mt-4 min-h-0 min-w-0 overflow-hidden rounded-[28px] border border-[#2F3543] bg-[#121821] shadow-[0_18px_40px_rgba(0,0,0,0.25)]'}`}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${embedded ? 'px-5 py-4' : 'px-4 py-4'}`}>
            <div className={shouldShowWelcomePrompt ? 'flex min-h-full min-w-0 items-center justify-center' : 'min-w-0 space-y-3'}>
              {shouldShowWelcomePrompt ? (
                <div className="px-2 text-center">
                  <p className="text-[29px] font-medium leading-[1.25] tracking-[-0.02em] text-[#E5E7EB]">
                    지금 무엇을 바꾸고 싶으세요?
                  </p>
                  <p className="mt-3 text-sm text-[#8E97A6]">
                    수정 요청을 보내면 대화가 시작됩니다.
                  </p>
                </div>
              ) : null}

              {pendingSuggestion ? (
                <div className="rounded-2xl border border-[#2F3543] bg-[#161B24] px-4 py-3 text-sm text-[#D1D5DB]">
                  최근 AI 제안이 준비되어 있습니다. 말풍선의 “이 수정 적용”으로 반영할 수 있습니다.
                </div>
              ) : null}

              {chatMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onApply={applySuggestion}
                  onApplyFeedback={applyFeedback}
                  onApplyAdvice={(advice) =>
                    sendChatMessage({
                      message: '이 방향으로 수정해줘',
                      previousAdvice: advice,
                    })
                  }
                  onReply={setReplyTargetMessage}
                  isApplyingFeedback={isApplyingFeedback}
                  isApplyingSuggestion={isApplyingSuggestion}
                  isAdviceApplyDisabled={isSendDisabled}
                />
              ))}
              {loadingLabel ? <LoadingBubble label={loadingLabel} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className={`${embedded ? 'border-t border-[#2F3543] bg-[#0F131B] px-5 py-3' : 'sticky bottom-0 z-10 shrink-0 border-t border-[#2F3543] bg-[#121821] px-4 py-4'}`}>
        <div className="rounded-[22px] border border-[#2F3543] bg-[#161B24] p-3">
          {isChatLimitReached ? (
            <div className="mb-3 rounded-xl border border-[#7F1D1D] bg-[#2A1515] px-3 py-2 text-xs leading-5 text-[#FECACA]">
              수정 요청 한도 도달
            </div>
          ) : null}
          <div className="mb-3 flex gap-1 overflow-x-auto rounded-full border border-[#2F3543] bg-[#10151D] p-1">
            {editTargetOptions.map(([value, label]) => {
              const isActive = editTarget === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEditTarget(value)}
                  className={`min-h-[30px] shrink-0 whitespace-nowrap rounded-full px-3 text-[11px] font-semibold leading-none transition ${
                    isActive
                      ? 'btn-solid-contrast'
                      : 'text-[#9CA3AF] hover:bg-[#1B202A] hover:text-[#E5E7EB]'
                  }`}
                  disabled={isSendDisabled}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {replyTargetMessage ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[#2F3543] bg-[#10151D] px-3 py-2 text-xs text-[#AEB6C5]">
              <span className="min-w-0 truncate">
                이 답변에 답장 중 · {replyTargetMessage.feedback ? '피드백' : replyTargetMessage.proposedSections ? '수정안' : '조언'}
              </span>
              <button
                type="button"
                onClick={clearReplyTarget}
                className="shrink-0 rounded-full px-2 py-1 text-[#8E97A6] transition hover:bg-[#1B202A] hover:text-[#E5E7EB]"
              >
                취소
              </button>
            </div>
          ) : null}
          <textarea
            ref={draftInputRef}
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            rows={2}
            className="max-h-[96px] min-h-[52px] w-full resize-none bg-transparent text-sm leading-6 text-[#E5E7EB] outline-none placeholder:text-[#6B7280]"
            placeholder="예: HOOK을 더 공격적으로 바꿔줘 / CTA를 상담 유도형으로 바꿔줘"
            disabled={isSubmitDisabled}
          />
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={handleSendDraft}
              disabled={isSubmitDisabled}
              className="btn-solid-contrast rounded-full px-4 py-2.5 text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isChatLimitReached && !isReplyDirectApplyAvailable ? '한도 도달' : `보내기 (${chatRemainingLabel})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
