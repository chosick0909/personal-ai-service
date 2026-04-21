import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../store/AppState'

function UploadIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="h-10 w-10 text-[#7C3AED]">
      <path
        d="M20 6.67c.5 0 1 .19 1.38.57l10 10-2.36 2.36-5.69-5.69V27.5h-3.33V13.9l-5.69 5.7-2.36-2.36 10-10c.38-.38.88-.57 1.38-.57Zm-12.5 22.5h25c2.77 0 5 2.23 5 5v.83c0 2.77-2.23 5-5 5h-25c-2.77 0-5-2.23-5-5v-.83c0-2.77 2.23-5 5-5Zm0 3.33c-.92 0-1.67.75-1.67 1.67v.83c0 .92.75 1.67 1.67 1.67h25c.92 0 1.67-.75 1.67-1.67v-.83c0-.92-.75-1.67-1.67-1.67h-25Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default function UploadSection() {
  const {
    currentStep,
    analyzeReference,
    isAnalyzing,
    analyzeError,
    analyzeErrorType,
    uploadTitle,
    setUploadTitle,
  } = useAppState()
  const [dragActive, setDragActive] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const isAnalysisStep = currentStep === 'analyzing' || isAnalyzing
    if (!isAnalysisStep) {
      setAnalyzeProgress(0)
      return undefined
    }

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

    return () => window.clearInterval(timer)
  }, [currentStep, isAnalyzing])

  useEffect(() => {
    const isAnalysisStep = currentStep === 'analyzing' || isAnalyzing
    if (!isAnalysisStep) {
      setAnalyzeElapsedSec(0)
      return undefined
    }

    const timer = window.setInterval(() => {
      setAnalyzeElapsedSec((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [currentStep, isAnalyzing])

  const analyzeStageText = useMemo(() => {
    if (analyzeProgress < 20) return '레퍼런스 영상 음성 추출중'
    if (analyzeProgress < 40) return '전사 텍스트 정리중'
    if (analyzeProgress < 60) return '후킹 포인트 분석중'
    if (analyzeProgress < 80) return '구조화 분석중'
    if (analyzeProgress < 95) return 'A/B/C 초안 생성중'
    return '결과 마무리중'
  }, [analyzeProgress])

  const analyzeDelayNotice = useMemo(() => {
    if (!(currentStep === 'analyzing' || isAnalyzing)) {
      return ''
    }
    if (analyzeElapsedSec >= 180) {
      return '분석 지연: 처리 시간이 길어지고 있습니다. 잠시만 더 기다려주세요. 오래 지속되면 영상 길이/용량을 줄여 다시 시도해주세요.'
    }
    if (analyzeElapsedSec >= 90) {
      return '분석 지연: 현재 서버에서 구조 분석을 계속 진행 중입니다.'
    }
    return ''
  }, [currentStep, isAnalyzing, analyzeElapsedSec])

  const analyzeErrorLabel = useMemo(() => {
    if (analyzeErrorType === 'file-too-large') {
      return '용량 초과'
    }
    if (analyzeErrorType === 'timeout') {
      return '타임아웃'
    }
    return '분석 실패'
  }, [analyzeErrorType])

  const handleFile = async (file) => {
    if (!file || isAnalyzing) {
      return
    }

    await analyzeReference(file)
  }

  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto bg-[linear-gradient(180deg,#0D0F14_0%,#141821_100%)] px-4 pb-8 pt-4 md:px-8 md:pb-16 md:pt-20">
      <div className="w-full max-w-[1024px]">
        <div className="mx-auto hidden h-[42px] items-center justify-center rounded-full border border-[#3A414F] bg-[#1B202A] px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB] md:inline-flex">
          {currentStep === 'analyzing' ? 'Step 2: Analyzing Reference' : 'Step 2: Upload Reference'}
        </div>

        <h1 className="mt-2 text-center text-[34px] font-bold leading-[1.15] tracking-[-0.03em] text-[#F3F4F6] md:mt-6 md:text-[42px] md:leading-[63px]">
          레퍼런스 업로드
        </h1>
        <p className="mt-2 text-center text-sm leading-6 text-[#8E97A6] md:text-base md:leading-7">분석할 영상 레퍼런스를 업로드하세요</p>

        {!isAnalyzing && currentStep !== 'analyzing' ? (
          <div className="mx-auto mt-5 w-full max-w-[680px] md:mt-8">
            <label className="mb-2 block text-left text-xs font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
              레퍼런스 제목 (선택)
            </label>
            <input
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              placeholder="비우면 파일명 사용"
              className="h-11 w-full rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1] placeholder:text-[#6B7280] md:h-12"
            />
          </div>
        ) : null}

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragActive(false)
            handleFile(event.dataTransfer.files?.[0] || null)
          }}
          className={`mt-5 rounded-3xl border-2 px-4 py-6 transition md:mt-8 md:h-[434px] md:px-6 md:py-10 ${
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
            onChange={(event) => handleFile(event.target.files?.[0] || null)}
          />

          <div className="flex min-h-[420px] flex-col items-center justify-center text-center md:h-full md:min-h-0">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2A2F3C_0%,#1F2430_100%)] shadow-[0_1px_3px_rgba(0,0,0,0.30)] md:h-20 md:w-20">
              {currentStep === 'analyzing' ? (
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full md:h-14 md:w-14"
                  style={{
                    background: `conic-gradient(#7C3AED ${analyzeProgress * 3.6}deg, #2F3543 ${analyzeProgress * 3.6}deg 360deg)`,
                  }}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#141923] text-[11px] font-semibold text-[#E5E7EB] md:h-[50px] md:w-[50px] md:text-xs">
                    {analyzeProgress}%
                  </div>
                </div>
              ) : (
                <UploadIcon />
              )}
            </div>

            <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB] md:mt-8 md:text-xs">
              {currentStep === 'analyzing' ? `Analyzing ${analyzeProgress}%` : 'Drag & Drop'}
            </div>

            <h2 className="mt-3 text-[32px] font-bold leading-[1.22] tracking-[-0.03em] text-[#F3F4F6] md:mt-4 md:text-2xl md:leading-8">
              {currentStep === 'analyzing'
                ? 'AI가 레퍼런스 구조를 분석하고 있습니다'
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

            <p className="mt-3 text-xs leading-5 text-[#8E97A6] md:text-sm md:leading-6">
              {currentStep === 'analyzing'
                ? '업로드 이후 구조 분석과 초안 생성을 진행 중입니다.'
                : '업로드 이후 구조 분석 → 초안 생성 → 에디터 편집 흐름으로 이동합니다. (긴 영상은 앞부분 중심으로 분석)'}
            </p>
            {currentStep === 'analyzing' ? (
              <p className="mt-1 text-[11px] text-[#9CA3AF] md:text-xs">{analyzeStageText}</p>
            ) : null}
            {analyzeDelayNotice ? (
              <div className="mt-3 rounded-2xl border border-[#FDE68A] bg-[#2A2111] px-3 py-2 text-[11px] text-[#FDE68A] md:px-4 md:text-xs">
                {analyzeDelayNotice}
              </div>
            ) : null}

            {analyzeError ? (
              <div className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs leading-5 text-[#B91C1C] md:px-4 md:text-sm">
                <span className="font-semibold">{analyzeErrorLabel}:</span> {analyzeError}
              </div>
            ) : null}

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => fileInputRef.current?.click()}
              className="btn-solid-contrast mt-5 inline-flex h-12 items-center justify-center rounded-full px-7 text-sm font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-70 md:mt-8 md:h-14 md:px-8 md:text-base"
            >
              {isAnalyzing ? '분석 중...' : '파일 업로드'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
