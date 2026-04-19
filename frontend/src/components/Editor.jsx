import { useAppState } from '../store/AppState'

function countCharacters(text = '') {
  return text.length
}

function estimateSpeechSeconds(text = '') {
  const normalizedLength = text.replace(/\s+/g, '').length
  if (!normalizedLength) {
    return 0
  }
  return Math.max(1, Math.round(normalizedLength / 5))
}

function formatSectionMeta(text = '') {
  const characters = countCharacters(text)
  const seconds = estimateSpeechSeconds(text)
  return `${characters.toLocaleString()} 글자 · 약 ${seconds}초`
}

function SectionEditor({ label, value, onChange, tone, placeholder }) {
  return (
    <label className={`grid gap-3 rounded-[18px] border border-[#2F3543] bg-[#111722] px-4 py-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</span>
        <span className="text-xs opacity-80">{formatSectionMeta(value)}</span>
      </div>
      <textarea
        value={value}
        onChange={onChange}
        className="min-h-[124px] w-full resize-y rounded-[12px] bg-transparent px-1 py-1 text-sm leading-7 text-[#E5E7EB] outline-none"
        placeholder={placeholder}
      />
    </label>
  )
}

export default function Editor({ transitioning = false, entering = false, embedded = false }) {
  const {
    selectedScript,
    editorSections,
    updateEditorSection,
    setIsVersionModalOpen,
    saveVersion,
    requestFeedback,
    isFeedbackLoading,
    feedback,
    goBackToResults,
    exportCurrentScriptPdf,
    copilotRemaining,
  } = useAppState()
  const totalLength =
    editorSections.hook.length + editorSections.body.length + editorSections.cta.length
  const isFeedbackLimitReached = copilotRemaining.feedback <= 0
  const isFeedbackButtonDisabled = isFeedbackLoading || isFeedbackLimitReached

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
                HOOK, BODY, CTA 구조를 다듬고 저장 내역과 AI 피드백을 함께 관리합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIsVersionModalOpen(true)}
                className="rounded-full border border-[#3A414F] bg-[#1B202A] px-5 py-2.5 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833]"
              >
                저장 내역
              </button>
              <button
                type="button"
                onClick={() => saveVersion('USER')}
                className="btn-solid-contrast rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-[#D1D5DB]"
              >
                버전 저장
              </button>
            </div>
          </div>
        ) : null}

        <div className={`${embedded ? '' : 'mt-6'} rounded-[32px] border border-[#2F3543] bg-[#0F131B] p-6 ${embedded ? '' : 'shadow-[0_20px_60px_rgba(0,0,0,0.25)]'}`}>
          <div className="grid gap-4">
            <SectionEditor
              label="Hook"
              value={editorSections.hook}
              onChange={(event) => updateEditorSection('hook', event.target.value)}
              tone="text-[#FCA5A5]"
              placeholder="첫 1초를 잡는 훅 문장을 다듬으세요."
            />
            <SectionEditor
              label="Body"
              value={editorSections.body}
              onChange={(event) => updateEditorSection('body', event.target.value)}
              tone="text-[#93C5FD]"
              placeholder="핵심 설명과 전개를 정리하세요."
            />
            <SectionEditor
              label="CTA"
              value={editorSections.cta}
              onChange={(event) => updateEditorSection('cta', event.target.value)}
              tone="text-[#86EFAC]"
              placeholder="행동 유도 문장을 정리하세요."
            />
          </div>

          <div className="mt-5 rounded-[22px] border border-[#2F3543] bg-[#131720] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-[#8E97A6]">
                현재 총 분량 <span className="font-semibold text-[#E5E7EB]">{totalLength.toLocaleString()} 글자</span>
                {feedback ? (
                  <>
                    {' '}· 최근 피드백 <span className="font-semibold text-[#D1D5DB]">{feedback.score}점</span>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                onClick={requestFeedback}
                disabled={isFeedbackButtonDisabled}
                className="rounded-full border border-[#3A414F] bg-[#1B202A] px-5 py-2.5 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isFeedbackLoading
                  ? '피드백 생성 중...'
                  : isFeedbackLimitReached
                    ? '피드백 한도 도달'
                    : `피드백 (${copilotRemaining.feedback}회)`}
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-[#94A3B8]">남은 횟수: 피드백 {copilotRemaining.feedback}회 · 수정 {copilotRemaining.chat}회</p>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBackToResults}
              className="rounded-full border border-[#3A414F] bg-[#1B202A] px-5 py-2.5 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833]"
            >
              다시 선택하기
            </button>
            <button
              type="button"
              onClick={exportCurrentScriptPdf}
              className="btn-solid-contrast rounded-full px-6 py-3 text-sm font-semibold shadow-[0_20px_44px_rgba(0,0,0,0.25)] transition hover:bg-white"
            >
              완성 및 내보내기
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
