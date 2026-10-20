import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../store/AppState'
import { formatScriptSections, reconcileScriptSections, estimateScriptSeconds } from '../lib/scriptText'
import { MIN_SCRIPT_SECONDS, MAX_SCRIPT_SECONDS } from '../../../shared/script-duration.mjs'

function getFeedbackVerdictLabel(feedback) {
  return feedback?.verdict?.label || ''
}

function SectionSkeleton({ label, tone, minHeight = 'min-h-[124px]' }) {
  return (
    <div className={`grid gap-3 rounded-[18px] border border-[#2F3543] bg-[#111722] px-4 py-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</span>
        <span className="text-xs opacity-80">생성중...</span>
      </div>
      <div className={`grid content-start gap-3 rounded-[12px] px-1 py-1 ${minHeight}`}>
        <div className="h-3 w-[82%] animate-pulse rounded-full bg-[#2A303B]" />
        <div className="h-3 w-[94%] animate-pulse rounded-full bg-[#252B36]" />
        <div className="h-3 w-[68%] animate-pulse rounded-full bg-[#2A303B]" />
      </div>
    </div>
  )
}

export default function Editor({ embedded = false }) {
  const {
    selectedScript,
    editorSections,
    isEditorPreparing,
    isSavingVersion,
    isPdfExporting,
    updateEditorSections,
    openVersionHistory,
    saveVersion,
    requestFeedback,
    isFeedbackLoading,
    isChatLoading,
    feedback,
    goBackToResults,
    exportCurrentScriptPdf,
    copilotRemaining,
    setDraftMessage,
    requestDurationAdjust,
  } = useAppState()
  const totalLength =
    editorSections.hook.length + editorSections.body.length + editorSections.cta.length
  const totalSpeechSeconds = Math.round(estimateScriptSeconds(
    editorSections,
  ))
  const feedbackRemainingLabel = Number.isFinite(copilotRemaining.feedback) ? `${copilotRemaining.feedback}회` : '무제한'
  const isFeedbackLimitReached = Number.isFinite(copilotRemaining.feedback) && copilotRemaining.feedback <= 0
  const isFeedbackButtonDisabled = isFeedbackLoading || isFeedbackLimitReached
  const [isScriptCopied, setIsScriptCopied] = useState(false)
  const sectionSignature = JSON.stringify(editorSections)
  const [editorDraft, setEditorDraft] = useState(null)
  const editorText = editorDraft?.signature === sectionSignature ? editorDraft.text : formatScriptSections(editorSections)
  const editScript = (text) => {
    const next = reconcileScriptSections(editorSections, editorText, text)
    setEditorDraft({ signature: JSON.stringify(next), text })
    updateEditorSections(next)
  }
  const [durationTargetInput, setDurationTargetInput] = useState('')
  const copiedTimerRef = useRef(null)
  const parsedDurationTarget = Number(durationTargetInput)
  const normalizedDurationTarget = Number.isInteger(parsedDurationTarget) ? parsedDurationTarget : null
  const isDurationTargetFilled = durationTargetInput.trim().length > 0
  const isDurationTargetValid =
    Number.isInteger(normalizedDurationTarget) &&
    normalizedDurationTarget >= MIN_SCRIPT_SECONDS &&
    normalizedDurationTarget <= MAX_SCRIPT_SECONDS &&
    normalizedDurationTarget !== totalSpeechSeconds
  const durationButtonLabel = isDurationTargetValid ? `${normalizedDurationTarget}초로 ${normalizedDurationTarget > totalSpeechSeconds ? '늘리기' : '줄이기'}` : '분량 조절 제안 받기'
  const durationHint = !isDurationTargetFilled
    ? '목표 시간을 입력하면 분량을 늘리거나 줄여드려요.'
    : !isDurationTargetValid
      ? `현재와 다른 ${MIN_SCRIPT_SECONDS}~${MAX_SCRIPT_SECONDS}초를 입력해주세요.`
      : '조절한 대본을 미리 확인한 뒤 적용할 수 있어요.'
  const feedbackVerdictLabel = getFeedbackVerdictLabel(feedback)
  const isCurrentFeedbackStale = Boolean(feedback?.applied || feedback?.staleAfterApply)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const copyCurrentScriptText = async () => {
    const text = formatScriptSections(editorSections)

    if (!text) {
      return
    }

    let didCopyToClipboard = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        didCopyToClipboard = true
      } catch {
        didCopyToClipboard = false
      }
    }

    if (!didCopyToClipboard) {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    setDraftMessage((current) => {
      const normalizedCurrent = String(current || '').trim()
      if (!normalizedCurrent) {
        return text
      }
      if (normalizedCurrent.includes(text)) {
        return normalizedCurrent
      }
      return `${normalizedCurrent}\n\n${text}`
    })
    window.dispatchEvent(new CustomEvent('hookai:focus-copilot-draft'))

    setIsScriptCopied(true)
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current)
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setIsScriptCopied(false)
      copiedTimerRef.current = null
    }, 1400)
  }

  const submitDurationAdjust = async () => {
    if (!isDurationTargetValid || isChatLoading || isEditorPreparing) {
      return
    }
    await requestDurationAdjust(normalizedDurationTarget)
  }

  return (
    <div
      className={`${embedded ? '' : 'h-full overflow-y-auto bg-[linear-gradient(180deg,#0D0F14_0%,#11151D_100%)] px-6 py-8 md:px-10'}`}
    >
      <div className={`${embedded ? 'w-full' : 'mx-auto max-w-[760px]'}`}>
        {!embedded ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex rounded-full border border-[#3A414F] bg-[#1B202A] px-4 py-2 text-sm font-semibold text-[#D1D5DB]">
                Script Editor
              </div>
              <h1 className="mt-5 text-[34px] font-bold tracking-[-0.04em] text-[#F3F4F6]">
                {selectedScript?.label || '선택한 초안'} 편집
              </h1>
              <p className="mt-3 text-base leading-8 text-[#8E97A6]">
                대본을 자유롭게 다듬고 저장 내역과 AI 피드백을 함께 관리합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openVersionHistory}
                disabled={isEditorPreparing}
                className="rounded-full border border-[#3A414F] bg-[#1B202A] px-5 py-2.5 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833]"
              >
                저장 내역
              </button>
              <button
                type="button"
                onClick={() => saveVersion('USER')}
                disabled={isEditorPreparing || isSavingVersion}
                className="btn-solid-contrast rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-[#D1D5DB] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingVersion ? '저장 중...' : '버전 저장'}
              </button>
            </div>
          </div>
        ) : null}

        <div className={`${embedded ? '' : 'mt-6'} rounded-[32px] border border-[#2F3543] bg-[#0F131B] p-6 ${embedded ? '' : 'shadow-[0_20px_60px_rgba(0,0,0,0.25)]'}`}>
          <div className="grid gap-4">
            {isEditorPreparing ? <SectionSkeleton label="대본" tone="text-[#CBD5E1]" minHeight="min-h-[360px]" /> : (
              <label className="grid gap-3 rounded-[18px] border border-[#2F3543] bg-[#111722] px-4 py-4">
                <span className="text-xs font-semibold text-[#CBD5E1]">대본</span>
                <textarea aria-label="대본" value={editorText} onChange={(event) => editScript(event.target.value)} onBlur={() => setEditorDraft(null)}
                  className="min-h-[420px] w-full resize-y bg-transparent text-sm leading-7 text-[#E5E7EB] outline-none"
                  placeholder="대본을 자유롭게 작성하세요." />
              </label>
            )}
          </div>

          <div className="mt-5 rounded-[22px] border border-[#2F3543] bg-[#131720] px-4 py-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-[#8E97A6]">
                  현재 총 분량{' '}
                  <span className="font-semibold text-[#E5E7EB]">
                    {totalLength.toLocaleString()} 글자 · 약 {totalSpeechSeconds}초
                  </span>
                  {feedback ? (
                    <>
                      {' '}·{' '}
                      {isCurrentFeedbackStale ? (
                        <span className="font-semibold text-[#AEB6C5]">피드백 반영됨 · 재평가 필요</span>
                      ) : (
                        <>
                          최근 피드백 <span className="font-semibold text-[#D1D5DB]">{feedback.score}점</span>
                          {feedbackVerdictLabel ? (
                            <span className="font-semibold text-[#AEB6C5]"> · {feedbackVerdictLabel}</span>
                          ) : null}
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="rounded-[18px] border border-[#2A303B] bg-[#0F141D] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-[#CBD5E1]">분량 조절</span>
                    <span className="text-[11px] text-[#7C8798]">늘리기 · 줄이기</span>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="grid gap-1">
                      <label className="flex h-10 items-center gap-2 rounded-full border border-[#2F3543] bg-[#151B26] px-3 text-xs text-[#94A3B8]">
                        목표
                        <input
                          type="number"
                          inputMode="numeric"
                          min="10"
                          max={MAX_SCRIPT_SECONDS}
                          value={durationTargetInput}
                          onChange={(event) => setDurationTargetInput(event.target.value.replace(/\D/g, ''))}
                          className="h-7 w-16 rounded-full border border-[#3A414F] bg-[#0F141D] px-2 text-center text-sm font-semibold text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1]"
                          placeholder="N"
                          aria-label="목표 초수"
                        />
                        초
                      </label>
                      <span className="pl-2 text-[11px] leading-4 text-[#94A3B8]">{durationHint}</span>
                    </div>
                    <button
                      type="button"
                      onClick={submitDurationAdjust}
                      disabled={!isDurationTargetValid || isChatLoading || isEditorPreparing}
                      className="h-10 rounded-full border border-[#3A414F] bg-[#F8F5EF] px-4 text-xs font-semibold text-[#111827] transition hover:bg-white disabled:cursor-not-allowed disabled:bg-[#1B202A] disabled:text-[#6B7280]"
                    >
                      {isChatLoading && isDurationTargetValid ? '생성 중...' : durationButtonLabel}
                    </button>
                  </div>
                </div>

                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={requestFeedback}
                    disabled={isFeedbackButtonDisabled || isEditorPreparing}
                    className="h-12 rounded-full border border-[#3A414F] bg-[#1B202A] px-6 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isEditorPreparing
                      ? '초안 준비 중...'
                      : isFeedbackLoading
                      ? '피드백 생성 중...'
                      : isFeedbackLimitReached
                        ? '피드백 한도 도달'
                      : isCurrentFeedbackStale
                        ? '재평가하기'
                      : `피드백 (${feedbackRemainingLabel})`}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBackToResults}
              disabled={isEditorPreparing}
              className="rounded-full border border-[#3A414F] bg-[#1B202A] px-5 py-2.5 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833]"
            >
              다시 선택하기
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyCurrentScriptText}
                disabled={isEditorPreparing || !totalLength}
                className={`rounded-full border px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  isScriptCopied
                    ? 'border-[#34D399] bg-[#10231B] text-[#A7F3D0]'
                    : 'border-[#3A414F] bg-[#1B202A] text-[#D1D5DB] hover:bg-[#232833]'
                }`}
              >
                {isScriptCopied ? '복사됨' : '텍스트 복사'}
              </button>
              <button
                type="button"
                onClick={exportCurrentScriptPdf}
                disabled={isEditorPreparing || isPdfExporting}
                className="btn-solid-contrast rounded-full px-6 py-3 text-sm font-semibold shadow-[0_20px_44px_rgba(0,0,0,0.25)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPdfExporting ? '내보내는 중...' : '완성 및 내보내기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
