import { useAppState } from '../store/AppState'

function MessageBubble({ message, onApply, onApplyFeedback, isApplyingFeedback }) {
  const isUser = message.role === 'user'
  const feedback = message.feedback
  const proposedSections = message.proposedSections
  const changedSections = Array.isArray(message.changedSections) ? message.changedSections : []
  const editTarget = typeof message.editTarget === 'string' ? message.editTarget : 'all'
  const isFeedbackApplied = Boolean(feedback?.applied)
  const isApplyDisabled = isFeedbackApplied || isApplyingFeedback
  const applyButtonLabel = isFeedbackApplied
    ? '피드백 반영 완료'
    : isApplyingFeedback
      ? '반영 중...'
      : '피드백 반영하기'
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
  const applyLabel =
    visibleSections.length === 1
      ? `${visibleSections[0][1]} 수정 적용`
      : '이 수정 적용'

  return (
    <div className={`flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`min-w-0 max-w-[88%] overflow-hidden rounded-[22px] px-4 py-3 text-sm leading-6 ${
          isUser
            ? 'btn-solid-contrast'
            : 'border border-[#2F3543] bg-[#161B24] text-[#D1D5DB]'
        }`}
      >
        {feedback ? (
          <div className="rounded-[18px] border border-[#2F3543] bg-[#161B24] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
                  기획 점수
                </div>
                <div className="mt-1 text-2xl font-bold text-[#F3F4F6]">{feedback.score}점</div>
              </div>
              <button
                type="button"
                onClick={onApplyFeedback}
                disabled={isApplyDisabled}
                className="btn-solid-contrast shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applyButtonLabel}
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#AEB6C5]">{feedback.detail || message.content}</p>
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
                  onClick={() => onApply(proposedSections)}
                  className="rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1.5 text-xs font-semibold text-[#D1D5DB] transition hover:bg-[#232833]"
                >
                  {applyLabel}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({ entering = false, embedded = false, fixedHeight = null }) {
  const {
    chatMessages,
    draftMessage,
    setDraftMessage,
    editTarget,
    setEditTarget,
    sendChatMessage,
    isChatLoading,
    applyFeedback,
    isApplyingFeedback,
    pendingSuggestion,
    applySuggestion,
    copilotRemaining,
  } = useAppState()
  const chatRemainingLabel = Number.isFinite(copilotRemaining.chat) ? `${copilotRemaining.chat}회` : '무제한'
  const feedbackRemainingLabel = Number.isFinite(copilotRemaining.feedback) ? `${copilotRemaining.feedback}회` : '무제한'
  const isChatLimitReached = Number.isFinite(copilotRemaining.chat) && copilotRemaining.chat <= 0
  const isSendDisabled = isChatLoading || isChatLimitReached
  const shouldShowWelcomePrompt = !pendingSuggestion && !isChatLoading && chatMessages.length === 0
  const editTargetOptions = [
    ['all', '전체'],
    ['hook', 'HOOK'],
    ['body', 'BODY'],
    ['cta', 'CTA'],
  ]
  const handleDraftKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) {
      return
    }

    event.preventDefault()
    if (!isSendDisabled && draftMessage.trim()) {
      sendChatMessage()
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
                  isApplyingFeedback={isApplyingFeedback}
                />
              ))}
              {isChatLoading ? (
                <div className="rounded-[22px] border border-[#2F3543] bg-[#161B24] px-4 py-3 text-sm text-[#D1D5DB]">
                  AI가 수정안을 정리하고 있습니다...
                </div>
              ) : null}
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
          <textarea
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            rows={2}
            className="max-h-[96px] min-h-[52px] w-full resize-none bg-transparent text-sm leading-6 text-[#E5E7EB] outline-none placeholder:text-[#6B7280]"
            placeholder="예: HOOK을 더 공격적으로 바꿔줘 / CTA를 상담 유도형으로 바꿔줘"
            disabled={isSendDisabled}
          />
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={sendChatMessage}
              disabled={isSendDisabled}
              className="btn-solid-contrast rounded-full px-4 py-2.5 text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isChatLimitReached ? '한도 도달' : `보내기 (${chatRemainingLabel})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
