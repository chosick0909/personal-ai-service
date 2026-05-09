import { useEffect, useMemo, useRef, useState } from 'react'
import ScriptCard from './ScriptCard'
import Editor from './Editor'
import ChatPanel from './ChatPanel'
import { useAppState } from '../store/AppState'

const REFERENCE_SCRIPT_SECTION_TITLE = '레퍼런스 스크립트'
const REFERENCE_SCRIPT_SECTION_DESCRIPTION = '업로드한 레퍼런스 영상에서 추출한 전체 스크립트입니다.'
const MISSING_TRANSCRIPT_DRAFT_MESSAGE =
  '전사 텍스트를 추출하지 못해서 초안을 생성할 수 없습니다. 음성이 또렷한 영상이나 자막이 있는 영상을 업로드해주세요.'
// Deploy touchpoint: keep the reference script heading fixed.

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path d="M10.5 2.67 5.17 8l5.33 5.33-1.17 1.17L2.83 8l6.5-6.5 1.17 1.17Z" fill="currentColor" />
    </svg>
  )
}

function SmallBadge({ children, tone = 'violet' }) {
  const toneClass =
    tone === 'pink'
      ? 'border-[#3A414F] bg-[#1B202A] text-[#D1D5DB]'
      : tone === 'amber'
        ? 'border-[#3A414F] bg-[#1B202A] text-[#D1D5DB]'
        : 'border-[#3A414F] bg-[#1B202A] text-[#D1D5DB]'

  return (
    <div className={`inline-flex h-[42px] items-center rounded-full border px-4 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
      {children}
    </div>
  )
}

function CheckpointRow({ children }) {
  return (
    <div className="group flex min-h-[64px] items-start overflow-hidden rounded-[20px] border border-[#2F3543] bg-[linear-gradient(180deg,#111723_0%,#0F1420_100%)] px-5 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition hover:border-[#3A4252] hover:bg-[linear-gradient(180deg,#131B2A_0%,#101725_100%)]">
      <span className="mr-3 mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#596174] bg-[#101523] text-xs text-[#D1D5DB]">•</span>
      <span className="min-w-0 break-words text-[15px] leading-7 text-[#E5E7EB]">{children}</span>
    </div>
  )
}

function PlaybookNoticeCard({ title, body, tone = 'default' }) {
  const toneClass =
    tone === 'rule'
      ? 'border-[#2A3345] bg-[linear-gradient(180deg,#101724_0%,#0D1320_100%)]'
      : tone === 'success'
        ? 'border-[#2C3C32] bg-[linear-gradient(180deg,#111A16_0%,#0E1512_100%)]'
      : 'border-[#2F3543] bg-[linear-gradient(180deg,#121722_0%,#0F141D_100%)]'

  return (
    <article className={`rounded-[20px] border p-5 ${toneClass}`}>
      <div className="text-base font-bold tracking-[-0.01em] text-[#F3F4F6] md:text-[18px]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[#D1D5DB]">{body}</p>
    </article>
  )
}

function normalizeInsightText(value = '') {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^[\s•\-–—\d.)]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitInsightSentences(value = '') {
  return normalizeInsightText(value)
    .split(/(?<=[.!?。！？])\s+|(?<=다\.)\s+|(?<=요\.)\s+/)
    .map((sentence) =>
      sentence
        .replace(/^(도입부|도입|전개|결론|마지막|초반|중반|후반)(에서는|은|는|으로는)?\s*[:：,\-–—]?\s*/i, '')
        .trim(),
    )
    .filter(Boolean)
}

function softenLongSentence(sentence = '', maxLength = 115) {
  const text = normalizeInsightText(sentence)
  if (text.length <= maxLength) {
    return text
  }

  const cutCandidates = [',', '며 ', '고 ', '지만 ', '통해 ', '이어서 ', '마지막으로 ', '또한 ']
    .map((token) => {
      const index = text.lastIndexOf(token, maxLength)
      return index > 36 ? index + token.trimEnd().length : -1
    })
    .filter((index) => index > 0)
    .sort((a, b) => b - a)

  const cutIndex = cutCandidates[0] || text.lastIndexOf(' ', maxLength)
  const shortened = text.slice(0, cutIndex > 36 ? cutIndex : maxLength).replace(/[,\s]+$/g, '').trim()
  if (!shortened) {
    return ''
  }
  return /[.!?。！？]$/.test(shortened) ? shortened : `${shortened}.`
}

function summarizeInsightText(value = '', fallback = '') {
  const sentences = splitInsightSentences(value)
  const picked = sentences
    .filter((sentence) => sentence.length >= 12)
    .slice(0, 2)
    .map((sentence) => softenLongSentence(sentence))
    .filter(Boolean)

  if (picked.length) {
    return picked.join(' ')
  }

  return fallback
}

function DraftSkeletonCard({ label, title }) {
  return (
    <article className="min-h-[360px] rounded-[28px] border border-[#2F3543] bg-[#121821] p-6">
      <div className="inline-flex h-10 items-center rounded-full border border-[#3A414F] px-4 text-sm font-semibold text-[#D1D5DB]">
        {label}
      </div>
      <h3 className="mt-6 text-2xl font-bold text-[#F3F4F6]">{title}</h3>
      <div className="mt-8 space-y-4">
        <div className="rounded-[18px] border border-[#4B2A30] bg-[#1B1014] p-5">
          <div className="h-3 w-16 rounded-full bg-[#3A2328]" />
          <div className="mt-5 h-3 w-full rounded-full bg-[#2A1A1F]" />
          <div className="mt-3 h-3 w-4/5 rounded-full bg-[#2A1A1F]" />
        </div>
        <div className="rounded-[18px] border border-[#24364E] bg-[#101722] p-5">
          <div className="h-3 w-16 rounded-full bg-[#23324A]" />
          <div className="mt-5 h-3 w-full rounded-full bg-[#1C2738]" />
          <div className="mt-3 h-3 w-3/4 rounded-full bg-[#1C2738]" />
        </div>
        <div className="rounded-[18px] border border-[#244231] bg-[#101A15] p-5">
          <div className="h-3 w-12 rounded-full bg-[#1F3A2D]" />
          <div className="mt-5 h-3 w-5/6 rounded-full bg-[#182A21]" />
        </div>
      </div>
      <div className="mt-6 rounded-full border border-[#3A414F] bg-[#1B202A] px-4 py-3 text-center text-sm font-semibold text-[#AEB6C5]">
        초안 생성 중...
      </div>
    </article>
  )
}

export default function ResultCards() {
  const {
    generatedScripts,
    referenceData,
    selectedScript,
    selectScript,
    clearScriptSelection,
    goBackToUpload,
    currentStep,
    openVersionHistory,
    saveVersion,
    isEditorPreparing,
    isSavingVersion,
  } = useAppState()
  const editorSectionRef = useRef(null)
  const draftSectionRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const editorPanelRef = useRef(null)
  const [shouldScrollToEditor, setShouldScrollToEditor] = useState(false)
  const [editorPanelHeight, setEditorPanelHeight] = useState(null)
  const [isDesktopEditorLayout, setIsDesktopEditorLayout] = useState(false)
  const [activeResultStep, setActiveResultStep] = useState(0)
  const [isResultStepLeaving, setIsResultStepLeaving] = useState(false)
  const resultStepTimerRef = useRef(null)
  const isReferenceProcessing = referenceData?.status === 'processing'
  const hasTranscript = Boolean((referenceData?.transcript || '').trim())
  const shouldBlockDraftsForMissingTranscript = !hasTranscript && generatedScripts.length === 0
  const isDraftGenerationPending = isReferenceProcessing && hasTranscript && generatedScripts.length === 0
  const transcriptText = useMemo(() => {
    const normalized = (referenceData?.transcript || '').trim()
    if (normalized) {
      return normalized
    }
    return MISSING_TRANSCRIPT_DRAFT_MESSAGE
  }, [referenceData?.transcript])
  const categoryPlaybook = referenceData?.categoryPlaybook || null
  const monetizationInsight =
    '돈 되는 릴스는 문제 상황이 구체적이고, 제품이나 서비스가 해결책으로 자연스럽게 이어져야 합니다. 전후 차이, 후기, 작은 증거가 붙고 CTA도 하나로 짧게 가야 다음 행동이 쉬워집니다. 너무 세게 파는 느낌보다 “필요하면 다음 단계로” 연결되는 흐름이 전환에 더 유리합니다.'
  const viralInsight =
    '잘 되는 릴스는 첫 1~3초에 멈추게 하고, 첫 화면이 분명해야 합니다. 공감이나 반전, 궁금증이 있어야 댓글과 저장 이유가 생기고, 광고처럼 보이지 않을수록 반응이 더 잘 붙습니다. 질문형 훅, 궁금증형 훅, 텍스트 오버레이 같은 요소도 계속 강하게 작동하는 편입니다.'

  const keyPoints = useMemo(() => {
    const points = referenceData?.keyPoints || []
    if (points.length >= 5) {
      return points.slice(0, 5)
    }

    return [
      points[0] || '첫 문장이 문제를 즉시 제기함',
      points[1] || '중간 설명이 짧고 핵심 메시지가 빠르게 전달됨',
      points[2] || 'CTA가 길지 않고 명확함',
      points[3] || '구조 흐름이 자연스럽고 이탈 포인트가 적음',
    ]
  }, [referenceData?.keyPoints])

  const compactInsightCards = useMemo(
    () =>
      [
        {
          title: '구조 핵심',
          body: summarizeInsightText(
            referenceData?.structureAnalysis,
            '문제 제기에서 사례, 해결 기준, CTA로 자연스럽게 이어지는 구조입니다.',
          ),
          tone: 'success',
        },
        {
          title: '후킹 포인트',
          body: summarizeInsightText(
            referenceData?.hookAnalysis,
            '초반에 공감 문제를 바로 꺼내 시청자가 자기 이야기처럼 느끼게 만듭니다.',
          ),
        },
        {
          title: '심리 기제',
          body: summarizeInsightText(
            referenceData?.psychologyAnalysis,
            '불안, 공감, 변화 기대를 순서대로 건드려 끝까지 보게 만드는 흐름입니다.',
          ),
        },
      ].filter((item) => item.body && !item.body.includes('분석이 없습니다')),
    [referenceData],
  )
  const resultSteps = useMemo(
    () => [
      {
        badge: 'Reference Script',
        title: REFERENCE_SCRIPT_SECTION_TITLE,
        subtitle: REFERENCE_SCRIPT_SECTION_DESCRIPTION,
      },
      {
        badge: 'Key Insights',
        title: '핵심 인사이트',
        subtitle: '레퍼런스에서 초안에 꼭 가져갈 구조만 짧게 정리했습니다.',
      },
      {
        badge: 'Checkpoints',
        title: '바로 써먹을 체크포인트',
        subtitle: '이번 초안을 만들 때 바로 적용할 기준입니다.',
      },
      {
        badge: 'Select Draft',
        title: shouldBlockDraftsForMissingTranscript ? '초안 생성 불가' : 'A/B/C 초안 선택',
        subtitle: shouldBlockDraftsForMissingTranscript
          ? MISSING_TRANSCRIPT_DRAFT_MESSAGE
          : isDraftGenerationPending
            ? '읽는 동안 A/B/C 초안을 백그라운드에서 생성하고 있습니다.'
            : '원하는 스타일을 선택하여 에디터로 이동하세요.',
      },
    ],
    [isDraftGenerationPending, shouldBlockDraftsForMissingTranscript],
  )
  const isEditorMode = currentStep === 'editor' && Boolean(selectedScript)
  const displayedResultStep =
    isEditorMode && activeResultStep === 0
      ? resultSteps.length - 1
      : Math.min(activeResultStep, resultSteps.length - 1)
  const activeStep = resultSteps[displayedResultStep]
  const resultProgress = Math.round(((displayedResultStep + 1) / resultSteps.length) * 100)

  const moveResultStep = (nextStep) => {
    const boundedStep = Math.max(0, Math.min(resultSteps.length - 1, nextStep))
    if (boundedStep === activeResultStep || isResultStepLeaving || resultStepTimerRef.current) {
      return
    }
    setIsResultStepLeaving(true)
    resultStepTimerRef.current = window.setTimeout(() => {
      if (currentStep === 'editor' && boundedStep < resultSteps.length - 1) {
        clearScriptSelection()
      }
      setActiveResultStep(boundedStep)
      setIsResultStepLeaving(false)
      resultStepTimerRef.current = null
    }, 520)
  }

  useEffect(() => {
    if (!shouldScrollToEditor || currentStep !== 'editor' || !selectedScript) {
      return
    }

    const timer = window.setTimeout(() => {
      const container = scrollContainerRef.current
      const section = editorSectionRef.current

      if (container && section) {
        const containerRect = container.getBoundingClientRect()
        const sectionRect = section.getBoundingClientRect()
        const targetTop = container.scrollTop + (sectionRect.top - containerRect.top) - 6

        container.scrollTo({
          top: Math.max(0, targetTop),
          behavior: 'smooth',
        })
      } else {
        section?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }
      setShouldScrollToEditor(false)
    }, 80)

    return () => window.clearTimeout(timer)
  }, [shouldScrollToEditor, currentStep, selectedScript])

  useEffect(() => {
    return () => {
      if (resultStepTimerRef.current) {
        window.clearTimeout(resultStepTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (currentStep !== 'editor' || !selectedScript || !editorPanelRef.current) {
      return
    }

    const updateHeight = () => {
      const nextHeight = editorPanelRef.current?.getBoundingClientRect().height
      if (Number.isFinite(nextHeight) && nextHeight > 0) {
        setEditorPanelHeight(Math.round(nextHeight))
      }
    }

    updateHeight()

    const observer = new ResizeObserver(() => {
      updateHeight()
    })

    observer.observe(editorPanelRef.current)
    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [currentStep, selectedScript])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)')
    const updateLayoutMode = () => {
      setIsDesktopEditorLayout(mediaQuery.matches)
    }

    updateLayoutMode()
    mediaQuery.addEventListener('change', updateLayoutMode)

    return () => {
      mediaQuery.removeEventListener('change', updateLayoutMode)
    }
  }, [])

  useEffect(() => {
    if (currentStep !== 'editor' || !selectedScript) {
      return
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        clearScriptSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [currentStep, selectedScript, clearScriptSelection])

  return (
    <div
      ref={scrollContainerRef}
      className="h-full overflow-y-auto px-4 py-6 md:px-12 md:py-10"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 97.8% 156.47% at 20% 10%, rgba(84,89,102,0.18) 0%, rgba(84,89,102,0) 50%), radial-gradient(ellipse 94.34% 150.94% at 80% 80%, rgba(140,146,160,0.12) 0%, rgba(140,146,160,0) 50%), linear-gradient(180deg, #0D0F14 0%, #11151D 100%)',
      }}
    >
      <div className="mx-auto w-full max-w-[1184px]">
        <button
          type="button"
          onClick={goBackToUpload}
          className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-[#AEB6C5] transition hover:bg-[#1B202A]"
        >
          <BackIcon />
          돌아가기
        </button>

        <div className="mt-6">
          <SmallBadge>Analysis Results</SmallBadge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.2] tracking-[-0.03em] text-[#F3F4F6] md:mt-5 md:text-5xl">
            {isReferenceProcessing ? '분석 결과 정리 중' : '분석 완료'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#8E97A6] md:text-base md:leading-7">
            {isDraftGenerationPending
              ? '전사와 핵심 인사이트를 먼저 정리했습니다. A/B/C 초안은 백그라운드에서 생성 중입니다.'
              : shouldBlockDraftsForMissingTranscript
              ? '레퍼런스 영상 분석은 완료했지만, 전사 텍스트가 없어 A/B/C 초안 생성은 진행하지 않았습니다.'
              : '레퍼런스 영상을 다각도로 분석했습니다. 구조, 후킹 포인트, 심리 기제, 시각적 연출까지 세밀하게 파악했으며, 이를 바탕으로 A/B/C 세 가지 초안을 준비했습니다.'}
          </p>
        </div>

        <section className="mt-8 md:mt-10">
          <div className="mb-5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF]">
              <span>진행률</span>
              <span>{displayedResultStep + 1} / {resultSteps.length}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1E2432]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#CBD5E1_0%,#F8FAFC_100%)] transition-all duration-300"
                style={{ width: `${resultProgress}%` }}
              />
            </div>
          </div>

          <div
            key={`result-step-${displayedResultStep}`}
            className={`min-h-[560px] rounded-[28px] border border-[#2F3543] bg-[#0F131B]/96 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-xl transition-opacity duration-[520ms] ease-[cubic-bezier(0.16,1,0.3,1)] md:rounded-[32px] md:p-10 ${
              isResultStepLeaving ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <SmallBadge tone={displayedResultStep === 3 ? 'pink' : 'violet'}>{activeStep.badge}</SmallBadge>
            <h2 className="mt-4 text-3xl font-bold leading-[1.2] tracking-[-0.03em] text-[#F3F4F6] md:mt-6 md:text-[42px]">
              {activeStep.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#8E97A6] md:text-base md:leading-7">{activeStep.subtitle}</p>

            {displayedResultStep === 0 ? (
              <div className="mt-8 overflow-hidden rounded-[18px] border border-[#2F3543] bg-[#131720]">
                <div className="border-b border-[#2F3543] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
                  Transcript
                </div>
                <div className="max-h-[420px] overflow-y-auto px-4 py-4">
                  <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#D1D5DB]">{transcriptText}</p>
                </div>
              </div>
            ) : null}

            {displayedResultStep === 1 ? (
              <div className="mt-8 grid gap-4">
                {(compactInsightCards.length
                  ? compactInsightCards
                  : [{ title: '핵심 흐름', body: '레퍼런스 구조를 정리하는 중입니다. 초안 생성 전 먼저 읽을 수 있는 요약을 곧 보여드립니다.' }]
                ).map((panel) => (
                  <PlaybookNoticeCard key={panel.title} title={panel.title} body={panel.body} tone={panel.tone} />
                ))}
              </div>
            ) : null}

            {displayedResultStep === 2 ? (
              <div className="mt-8 grid gap-3">
                {keyPoints.map((point) => (
                  <CheckpointRow key={point}>{point}</CheckpointRow>
                ))}
                {categoryPlaybook?.insight ? (
                  <PlaybookNoticeCard
                    title={categoryPlaybook.label ? `${categoryPlaybook.label} 업종 인사이트` : '업종 인사이트'}
                    body={categoryPlaybook.insight}
                  />
                ) : null}
                {categoryPlaybook?.hookAiRule ? (
                  <PlaybookNoticeCard title="HookAI의 팁" body={categoryPlaybook.hookAiRule} tone="rule" />
                ) : null}
              </div>
            ) : null}

            {displayedResultStep === 3 ? (
              <div ref={draftSectionRef} className="mt-8">
                {shouldBlockDraftsForMissingTranscript ? (
                  <div className="rounded-[20px] border border-[#3A414F] bg-[#121722] px-5 py-5 text-sm leading-6 text-[#D1D5DB]">
                    {MISSING_TRANSCRIPT_DRAFT_MESSAGE}
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4">
                      <PlaybookNoticeCard title="수익화 잘 되는 릴스 특징" body={monetizationInsight} tone="success" />
                      <PlaybookNoticeCard title="전환을 만드는 흐름" body={viralInsight} />
                    </div>
                    <div className="mt-6 grid gap-5 md:gap-6 xl:grid-cols-3">
                      {isDraftGenerationPending
                        ? [
                            ['A안', '원본형'],
                            ['B안', '대화형'],
                            ['C안', '후킹형'],
                          ].map(([label, title]) => <DraftSkeletonCard key={label} label={label} title={title} />)
                        : generatedScripts.map((script) => (
                            <ScriptCard
                              key={script.id}
                              script={script}
                              onSelect={(scriptId) => {
                                setShouldScrollToEditor(true)
                                selectScript(scriptId)
                              }}
                              isSelected={selectedScript?.id === script.id}
                              hasSelection={Boolean(selectedScript)}
                              disabled={isEditorPreparing}
                            />
                          ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => moveResultStep(displayedResultStep - 1)}
                disabled={displayedResultStep <= 0 || isResultStepLeaving}
                className="inline-flex h-12 items-center justify-center rounded-full border border-[#3A414F] bg-[#171B24] px-6 text-sm font-semibold text-[#E5E7EB] transition hover:bg-[#1D2330] disabled:cursor-default disabled:opacity-40"
              >
                이전
              </button>
              {displayedResultStep < resultSteps.length - 1 ? (
                <button
                  type="button"
                  onClick={() => moveResultStep(displayedResultStep + 1)}
                  disabled={isResultStepLeaving}
                  className="btn-solid-contrast inline-flex h-12 items-center justify-center rounded-full px-7 text-sm font-semibold transition hover:bg-white disabled:cursor-default disabled:opacity-60"
                >
                  다음
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goBackToUpload}
                  className="inline-flex h-12 items-center justify-center rounded-full border border-[#3A414F] bg-[#171B24] px-6 text-sm font-semibold text-[#E5E7EB] transition hover:bg-[#1D2330]"
                >
                  새 레퍼런스 분석
                </button>
              )}
            </div>
          </div>
        </section>

        {isEditorMode && displayedResultStep === resultSteps.length - 1 ? (
          <section ref={editorSectionRef} className="mt-10 md:mt-14">
            <SmallBadge tone="pink">Editor</SmallBadge>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4 md:mt-5">
              <div>
                <h2 className="text-3xl font-bold leading-[1.2] tracking-[-0.03em] text-[#F3F4F6] md:text-4xl">스크립트 에디터</h2>
                <p className="mt-2 text-sm text-[#8E97A6]">
                  {isEditorPreparing
                    ? `선택한 ${selectedScript.label}을 에디터에 준비하고 있습니다.`
                    : `선택한 ${selectedScript.label}을 자유롭게 수정하고 AI 코파일럿으로 피드백을 적용하세요.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openVersionHistory}
                  disabled={isEditorPreparing}
                  className="rounded-full border border-[#3A414F] bg-[#1B202A] px-5 py-2.5 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#232833] disabled:cursor-not-allowed disabled:opacity-60"
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
            <div className="mt-6 grid items-start gap-6 md:mt-8 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div ref={editorPanelRef} className="min-w-0">
                <Editor embedded />
              </div>
              <div
                className="min-w-0 overflow-hidden xl:sticky xl:top-6 xl:self-start"
                style={
                  isDesktopEditorLayout && Number.isFinite(editorPanelHeight) && editorPanelHeight > 0
                    ? { height: `${editorPanelHeight}px`, maxHeight: `${editorPanelHeight}px` }
                    : undefined
                }
              >
                <ChatPanel
                  embedded
                  fixedHeight={isDesktopEditorLayout ? editorPanelHeight : null}
                />
              </div>
            </div>
          </section>
        ) : null}

      </div>
    </div>
  )
}
