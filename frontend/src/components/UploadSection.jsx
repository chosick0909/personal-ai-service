import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../store/AppState'

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-10 w-10 text-[#7C3AED]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15.5V5.5" />
      <path d="M8.5 9L12 5.5 15.5 9" />
      <path d="M5 16.5v1.25A2.25 2.25 0 0 0 7.25 20h9.5A2.25 2.25 0 0 0 19 17.75V16.5" />
      <path d="M8.25 16.5h7.5" />
    </svg>
  )
}

const MAX_REFERENCE_VIDEO_BYTES = 300 * 1024 * 1024
const SUPPORTED_REFERENCE_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'])

function formatFileSize(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0MB'
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)}MB`
}

function validateReferenceUploadFile(file) {
  if (!file) {
    return '업로드할 영상을 먼저 선택해주세요.'
  }

  const fileName = String(file.name || '')
  const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

  if (Number(file.size || 0) <= 0) {
    return '파일 크기가 0인 영상은 업로드할 수 없어요. 다른 파일을 선택해주세요.'
  }

  if (Number(file.size || 0) > MAX_REFERENCE_VIDEO_BYTES) {
    return `영상 용량이 너무 커요. 300MB 이하 영상으로 다시 올려주세요. 현재 파일은 약 ${formatFileSize(file.size)}입니다.`
  }

  if (!SUPPORTED_REFERENCE_VIDEO_EXTENSIONS.has(extension)) {
    return '지원하지 않는 영상 형식이에요. mp4, mov, m4v, webm, avi, mkv 파일로 다시 올려주세요.'
  }

  if (file.type && !String(file.type).toLowerCase().startsWith('video/')) {
    return '브라우저가 이 파일을 영상으로 인식하지 못했어요. mp4 또는 mov로 변환 후 다시 올려주세요.'
  }

  return ''
}

export default function UploadSection() {
  const {
    currentStep,
    analyzeReference,
    analyzeReferenceScript,
    cancelCurrentAnalysis,
    isAnalyzing,
    analyzeError,
    analyzeErrorType,
    uploadPhase,
    uploadTopic,
    setUploadTopic,
    uploadTitle,
    setUploadTitle,
    referenceScriptText,
    setReferenceScriptText,
  } = useAppState()
  const [inputMode, setInputMode] = useState('video')
  const [dragActive, setDragActive] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0)
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [localUploadError, setLocalUploadError] = useState('')
  const fileInputRef = useRef(null)
  const isAnalysisStep = currentStep === 'analyzing' || isAnalyzing
  const displayedAnalyzeProgress = isAnalysisStep ? analyzeProgress : 0
  const displayedAnalyzeElapsedSec = isAnalysisStep ? analyzeElapsedSec : 0

  useEffect(() => {
    if (!isAnalysisStep) {
      return undefined
    }

    const resetTimer = window.setTimeout(() => {
      setAnalyzeProgress(0)
    }, 0)
    const timer = window.setInterval(() => {
      setAnalyzeProgress((current) => {
        if (current >= 95) {
          return current
        }

        if (current < 28) {
          return Math.min(95, current + 6)
        }
        if (current < 62) {
          return Math.min(95, current + 4)
        }
        if (current < 84) {
          return Math.min(95, current + 2)
        }
        return Math.min(95, current + 1)
      })
    }, 520)

    return () => {
      window.clearTimeout(resetTimer)
      window.clearInterval(timer)
    }
  }, [isAnalysisStep])

  useEffect(() => {
    if (!isAnalysisStep) {
      return undefined
    }

    const resetTimer = window.setTimeout(() => {
      setAnalyzeElapsedSec(0)
    }, 0)
    const timer = window.setInterval(() => {
      setAnalyzeElapsedSec((current) => current + 1)
    }, 1000)

    return () => {
      window.clearTimeout(resetTimer)
      window.clearInterval(timer)
    }
  }, [isAnalysisStep])

  const analyzeStageText = useMemo(() => {
    if (uploadPhase === 'creating-session') return '업로드 준비 중 · 서버에 작업을 먼저 등록하고 있습니다'
    if (uploadPhase === 'uploading') return '업로드 중 · 이 단계에서는 화면을 끄거나 앱을 전환하지 마세요'
    if (uploadPhase === 'server-accepted') return '서버에 접수됨 · 이제 재접속해도 최근 분석에서 이어서 확인할 수 있습니다'
    if (uploadPhase === 'analyzing') return '서버 분석 중 · 최근 분석에서 이어서 확인할 수 있습니다'
    if (displayedAnalyzeProgress < 20) return '레퍼런스 영상 음성 추출중'
    if (displayedAnalyzeProgress < 40) return '전사 텍스트 정리중'
    if (displayedAnalyzeProgress < 60) return '후킹 포인트 분석중'
    if (displayedAnalyzeProgress < 80) return '구조화 분석중'
    if (displayedAnalyzeProgress < 95) return 'A/B/C 초안 생성중'
    return '결과 마무리중'
  }, [displayedAnalyzeProgress, uploadPhase])

  const uploadPhaseSteps = useMemo(() => {
    const activeIndex =
      uploadPhase === 'creating-session' || uploadPhase === 'uploading'
        ? 0
        : uploadPhase === 'server-accepted' || uploadPhase === 'analyzing'
          ? 1
          : currentStep === 'analyzing' || isAnalyzing
            ? 2
            : uploadPhase === 'completed'
              ? 3
              : -1

    return [
      {
        label: '업로드 중',
        description: '아직 위험',
      },
      {
        label: '서버 접수',
        description: '이후 복구 가능',
      },
      {
        label: '분석 중',
        description: 'AI 처리',
      },
      {
        label: '완료',
        description: '결과 확인',
      },
    ].map((item, index) => ({
      ...item,
      active: activeIndex === index,
      done: activeIndex > index,
    }))
  }, [currentStep, isAnalyzing, uploadPhase])

  const analyzeDelayNotice = useMemo(() => {
    if (!isAnalysisStep) {
      return ''
    }
    if (displayedAnalyzeElapsedSec >= 180) {
      return '분석 지연: 처리 시간이 길어지고 있습니다. 잠시만 더 기다려주세요. 오래 지속되면 영상 길이/용량을 줄여 다시 시도해주세요.'
    }
    if (displayedAnalyzeElapsedSec >= 90) {
      return '분석 지연: 현재 서버에서 구조 분석을 계속 진행 중입니다.'
    }
    return ''
  }, [displayedAnalyzeElapsedSec, isAnalysisStep])

  const analyzeErrorLabel = useMemo(() => {
    if (localUploadError) {
      return '업로드 준비 실패'
    }
    if (analyzeErrorType === 'rate-limited') {
      return '업로드 제한'
    }
    if (analyzeErrorType === 'file-too-large') {
      return '용량 초과'
    }
    if (analyzeErrorType === 'unsupported-file') {
      return '지원하지 않는 파일'
    }
    if (analyzeErrorType === 'timeout') {
      return '타임아웃'
    }
    if (analyzeErrorType === 'recovering') {
      return '복구 확인 중'
    }
    return '분석 실패'
  }, [analyzeErrorType, localUploadError])

  const handleFile = async (file) => {
    if (!file || isAnalyzing) {
      return
    }

    const validationError = validateReferenceUploadFile(file)
    if (validationError) {
      setLocalUploadError(validationError)
      return
    }

    setLocalUploadError('')
    await analyzeReference(file, { topic: uploadTopic })
  }

  const handleScriptAnalyze = async () => {
    if (isAnalyzing) {
      return
    }
    const normalized = referenceScriptText.trim()
    if (normalized.length < 20) {
      setLocalUploadError('분석할 레퍼런스 대본을 최소 20자 이상 입력해주세요.')
      return
    }
    setLocalUploadError('')
    await analyzeReferenceScript(normalized, { topic: uploadTopic })
  }

  const handleCancelAnalysis = async () => {
    setIsCanceling(true)
    const canceled = await cancelCurrentAnalysis()
    setIsCanceling(false)
    if (canceled) {
      setIsCancelConfirmOpen(false)
    }
  }

  return (
    <div className="notranslate flex h-full w-full items-start justify-center overflow-y-auto bg-[linear-gradient(180deg,#0D0F14_0%,#141821_100%)] px-4 pb-6 pt-2 md:px-8 md:pb-16 md:pt-20" translate="no">
      <div className="w-full max-w-[1024px]">
        <div className="mx-auto flex h-[42px] w-fit items-center justify-center rounded-full border border-[#3A414F] bg-[#1B202A] px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">
          {currentStep === 'analyzing' ? '2단계 · 레퍼런스 분석 중' : '2단계 · 레퍼런스 업로드'}
        </div>

        <h1 className="mt-1 text-center text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-[#F3F4F6] md:mt-6 md:text-[42px] md:leading-[63px]">
          레퍼런스 업로드
        </h1>
        <p className="mt-1.5 text-center text-[13px] leading-5 text-[#8E97A6] md:text-base md:leading-7">
          영상 파일을 올리거나, 레퍼런스 대본만 붙여넣어 빠르게 분석하세요
        </p>

        {!isAnalyzing && currentStep !== 'analyzing' ? (
          <div className="mx-auto mt-4 w-full max-w-[680px] md:mt-8">
            <label className="mb-2 block text-left text-xs font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
              레퍼런스 제목 (선택)
            </label>
            <input
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              placeholder="비우면 파일명 사용"
              className="h-10 w-full rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1] placeholder:text-[#6B7280] md:h-12"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="block text-left text-xs font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
                이번 릴스 주제 (선택)
              </label>
              {uploadTopic ? (
                <button
                  type="button"
                  onClick={() => setUploadTopic('')}
                  className="text-[11px] font-medium text-[#94A3B8] transition hover:text-[#E5E7EB]"
                >
                  세팅대로 진행
                </button>
              ) : null}
            </div>
            <input
              value={uploadTopic}
              onChange={(event) => setUploadTopic(event.target.value)}
              placeholder="예: 물광토너 제품소개"
              className="mt-2 h-10 w-full rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1] placeholder:text-[#6B7280] md:h-12"
            />
            <p className="mt-1.5 text-left text-[11px] leading-4.5 text-[#8E97A6] md:mt-2 md:text-xs md:leading-5">
              계정 사전세팅은 그대로 참고하고, 이번 영상에서 다룰 소주제가 있으면 여기에 적어주세요.
            </p>
          </div>
        ) : null}

        {!isAnalyzing && currentStep !== 'analyzing' ? (
          <div className="mx-auto mt-4 grid w-full max-w-[680px] grid-cols-2 gap-2 rounded-2xl border border-[#2F3543] bg-[#10151E] p-1.5 md:mt-6">
            {[
              { key: 'video', label: '영상으로 분석' },
              { key: 'script', label: '대본으로 분석' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setInputMode(item.key)
                  setLocalUploadError('')
                }}
                className={`h-10 rounded-xl text-sm font-semibold transition ${
                  inputMode === item.key
                    ? 'bg-[#F8F5EF] text-[#111827]'
                    : 'text-[#94A3B8] hover:bg-[#171B24] hover:text-[#E5E7EB]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <div
          onDragOver={(event) => {
            event.preventDefault()
            if (inputMode !== 'video') return
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            if (inputMode !== 'video') return
            setDragActive(false)
            handleFile(event.dataTransfer.files?.[0] || null)
          }}
          className={`mt-4 rounded-[26px] border-2 px-4 py-5 transition md:mt-8 md:h-[434px] md:rounded-3xl md:px-6 md:py-10 ${
            dragActive
              ? 'border-[#8B95A7] bg-[#181C25]'
              : 'border-[#2F3543] bg-[#131720]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              handleFile(event.target.files?.[0] || null)
              event.target.value = ''
            }}
          />

          <div className="flex min-h-[280px] flex-col items-center justify-center text-center md:h-full md:min-h-0">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2A2F3C_0%,#1F2430_100%)] shadow-[0_1px_3px_rgba(0,0,0,0.30)] md:h-20 md:w-20">
              {currentStep === 'analyzing' ? (
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full md:h-14 md:w-14"
                  style={{
                    background: `conic-gradient(#7C3AED ${displayedAnalyzeProgress * 3.6}deg, #2F3543 ${displayedAnalyzeProgress * 3.6}deg 360deg)`,
                  }}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#141923] text-[10px] font-semibold text-[#E5E7EB] md:h-[50px] md:w-[50px] md:text-xs">
                    {displayedAnalyzeProgress}%
                  </div>
                </div>
              ) : (
                <UploadIcon />
              )}
            </div>

            <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB] md:mt-8 md:text-xs">
              {currentStep === 'analyzing'
                ? `분석 중 ${displayedAnalyzeProgress}%`
                : inputMode === 'script'
                  ? '대본 입력'
                  : '파일 선택'}
            </div>

            <h2 className="mt-2.5 text-[23px] font-bold leading-[1.14] tracking-[-0.03em] text-[#F3F4F6] md:mt-4 md:text-2xl md:leading-8">
              {currentStep === 'analyzing'
                ? 'AI가 레퍼런스 구조를 분석하고 있습니다'
                : inputMode === 'script'
                  ? '레퍼런스 대본을 붙여넣으세요'
                : (
                  <>
                    <span className="md:hidden">레퍼런스 영상을 선택하세요</span>
                    <span className="hidden md:inline">
                      레퍼런스 영상을 이곳에 놓거나
                      <br />
                      파일을 선택하세요
                    </span>
                  </>
                )}
            </h2>

            <p className="mt-2 text-[11px] leading-4.5 text-[#8E97A6] md:text-sm md:leading-6">
              {currentStep === 'analyzing'
                ? '업로드 이후 구조 분석과 초안 생성을 진행 중입니다.'
                : inputMode === 'script'
                  ? '영상 화면 정보 없이 대본의 문장 구조, 후킹 흐름, 설득 흐름만 빠르게 분석합니다.'
                : '업로드 이후 구조 분석 → 초안 생성 → 에디터 편집 흐름으로 이동합니다. (긴 영상은 앞부분 중심으로 분석)'}
            </p>
            {!isAnalyzing && currentStep !== 'analyzing' && inputMode === 'script' ? (
              <div className="mt-5 w-full max-w-[620px]">
                <textarea
                  value={referenceScriptText}
                  onChange={(event) => setReferenceScriptText(event.target.value)}
                  placeholder="레퍼런스 릴스의 자막/대본을 그대로 붙여넣어 주세요."
                  className="min-h-[150px] w-full resize-y rounded-3xl border border-[#374151] bg-[#0F141D] px-4 py-4 text-left text-sm leading-6 text-[#F8FAFC] outline-none transition placeholder:text-[#6B7280] focus:border-[#CBD5E1] md:min-h-[190px]"
                />
                <p className="mt-2 text-left text-[11px] leading-4.5 text-[#8E97A6] md:text-xs md:leading-5">
                  빠르지만 화면 전환, 제품 노출, 표정, 자막 위치 같은 시각 정보는 반영되지 않습니다.
                </p>
              </div>
            ) : null}
            {currentStep === 'analyzing' ? (
              <p className="mt-1 text-[11px] text-[#9CA3AF] md:text-xs">{analyzeStageText}</p>
            ) : null}
            {currentStep === 'analyzing' || isAnalyzing ? (
              <div className="mt-4 grid w-full max-w-[620px] grid-cols-4 gap-2 rounded-2xl border border-[#2F3543] bg-[#10151E] p-2">
                {uploadPhaseSteps.map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-xl px-2 py-2 text-center transition ${
                      step.active
                        ? 'bg-[#232B39] text-[#F3F4F6]'
                        : step.done
                          ? 'bg-[#13251B] text-[#86EFAC]'
                          : 'text-[#6B7280]'
                    }`}
                  >
                    <div className="text-[10px] font-semibold leading-4 md:text-xs">{step.label}</div>
                    <div className="mt-0.5 text-[9px] leading-3 opacity-80 md:text-[10px]">{step.description}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {uploadPhase === 'uploading' ? (
              <div className="mt-3 rounded-2xl border border-[#7C2D12] bg-[#21160E] px-3 py-2 text-[11px] leading-4 text-[#FDBA74] md:px-4 md:text-xs">
                지금은 영상이 서버에 올라가는 중입니다. 이 단계에서는 화면 잠금, 앱 전환, Safari 종료 시 실패할 수 있습니다.
              </div>
            ) : null}
            {analyzeDelayNotice ? (
              <div className="mt-3 rounded-2xl border border-[#FDE68A] bg-[#2A2111] px-3 py-2 text-[11px] text-[#FDE68A] md:px-4 md:text-xs">
                {analyzeDelayNotice}
              </div>
            ) : null}

            {localUploadError || analyzeError ? (
              <div className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs leading-5 text-[#B91C1C] md:px-4 md:text-sm">
                <span className="font-semibold">{analyzeErrorLabel}:</span> {localUploadError || analyzeError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-row items-center justify-center gap-4 md:mt-8 md:gap-5">
              {currentStep === 'analyzing' || isAnalyzing ? (
                <button
                  type="button"
                  onClick={() => setIsCancelConfirmOpen(true)}
                  className="inline-flex h-11 min-w-[116px] items-center justify-center whitespace-nowrap rounded-full border border-[#4B5563] bg-[#171B24] px-5 text-xs font-semibold text-[#FCA5A5] transition hover:border-[#7F1D1D] hover:bg-[#2A1417] md:h-14 md:min-w-[150px] md:px-6 md:text-base"
                >
                  분석 중단
                </button>
              ) : null}
              {inputMode === 'script' && currentStep !== 'analyzing' ? (
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={handleScriptAnalyze}
                  className="btn-solid-contrast inline-flex h-11 min-w-[132px] items-center justify-center rounded-full px-5 text-xs font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-70 md:h-14 md:min-w-[180px] md:px-6 md:text-base"
                >
                  대본 빠른 분석
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-solid-contrast inline-flex h-11 min-w-[116px] items-center justify-center rounded-full px-5 text-xs font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-70 md:h-14 md:min-w-[150px] md:px-6 md:text-base"
                >
                  {isAnalyzing ? '분석 중...' : '파일 업로드'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {isCancelConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-[420px] rounded-[24px] border border-[#343A45] bg-[#111723] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.48)]">
            <h3 className="text-xl font-bold tracking-[-0.02em] text-[#F3F4F6]">분석을 중단하시겠어요?</h3>
            <p className="mt-3 text-sm leading-6 text-[#AEB6C5]">
              진행 중인 분석은 중단되고, 생성된 분석 기록도 삭제됩니다.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isCanceling}
                onClick={() => setIsCancelConfirmOpen(false)}
                className="h-11 rounded-full border border-[#3A414F] bg-[#171B24] text-sm font-semibold text-[#E5E7EB] transition hover:bg-[#202633] disabled:cursor-not-allowed disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isCanceling}
                onClick={handleCancelAnalysis}
                className="h-11 rounded-full border border-[#7F1D1D] bg-[#3A171A] text-sm font-semibold text-[#FCA5A5] transition hover:bg-[#4A1B1F] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCanceling ? '중단 중...' : '중단'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
