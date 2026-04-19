import { useAppState } from '../store/AppState'

function MessageBubble({ message, onApply, onApplyFeedback, isApplyingFeedback }) {
  const isUser = message.role === 'user'
  const feedback = message.feedback
  const isFeedbackApplied = Boolean(feedback?.applied)
  const isApplyDisabled = isFeedbackApplied || isApplyingFeedback
  const applyButtonLabel = isFeedbackApplied
    ? '피드백 반영 완료'
    : isApplyingFeedback
      ? '반영 중...'
      : '피드백 반영하기'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-[22px] px-4 py-3 text-sm leading-6 ${
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
            <div>{message.content}</div>
            {message.proposedSections ? (
              <button
                type="button"
                onClick={() => onApply(message.proposedSections)}
                className="mt-3 rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1.5 text-xs font-semibold text-[#D1D5DB] transition hover:bg-[#232833]"
              >
                이 수정 적용
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({ entering = false, embedded = false }) {
  const {
    chatMessages,
    draftMessage,
    setDraftMessage,
    sendChatMessage,
    isChatLoading,
    applyFeedback,
    isApplyingFeedback,
    pendingSuggestion,
    applySuggestion,
  } = useAppState()
  return (
    <div
      className={`flex ${embedded ? 'h-full min-h-[760px]' : 'h-full min-h-0'} flex-col overflow-hidden ${embedded ? 'rounded-[32px] border border-[#2F3543] bg-[#0F131B]' : 'bg-[linear-gradient(180deg,#0F131B_0%,#131720_100%)] px-4 py-4'}`}
    >
      <div className={`${embedded ? 'shrink-0 border-b border-[#2F3543] px-5 py-4' : 'shrink-0 rounded-[24px] border border-[#2F3543] bg-[#121821] px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.25)]'}`}>
        <div className="inline-flex rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D1D5DB]">
          AI Copilot
        </div>
        <h2 className="mt-3 text-xl font-bold text-[#F3F4F6]">AI 코파일럿</h2>
        <p className="mt-2 text-sm leading-6 text-[#8E97A6]">
          훅 조정, 문장 압축, CTA 교체 같은 편집 요청을 바로 보낼 수 있습니다.
        </p>
      </div>

      <div className={`${embedded ? 'min-h-0 flex-1 overflow-hidden' : 'mt-4 min-h-0 flex-1 overflow-hidden rounded-[28px] border border-[#2F3543] bg-[#121821] shadow-[0_18px_40px_rgba(0,0,0,0.25)]'}`}>
        <div className="flex h-full min-h-0 flex-col">
          <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto ${embedded ? 'px-5 py-4' : 'px-4 py-4'}`}>
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

          <div className={`${embedded ? 'z-10 shrink-0 border-t border-[#2F3543] bg-[#0F131B] px-5 py-4' : 'sticky bottom-0 z-10 shrink-0 border-t border-[#2F3543] bg-[#121821] px-4 py-4'}`}>
            <div className="rounded-[24px] border border-[#2F3543] bg-[#161B24] p-3">
              <textarea
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                className="min-h-[92px] w-full resize-none bg-transparent text-sm leading-6 text-[#E5E7EB] outline-none placeholder:text-[#6B7280]"
                placeholder="예: HOOK을 더 공격적으로 바꿔줘 / CTA를 상담 유도형으로 바꿔줘"
              />
              <button
                type="button"
                onClick={sendChatMessage}
                disabled={isChatLoading}
                className="btn-solid-contrast mt-3 w-full rounded-full px-4 py-3 text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                수정 요청 보내기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
