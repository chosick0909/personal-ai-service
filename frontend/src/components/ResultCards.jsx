import { useEffect, useMemo, useState } from 'react'
import ScriptCard from './ScriptCard'
import { useAppState } from '../store/AppState'

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

function InsightStatCard({ title, subtitle, value }) {
  return (
    <div className="rounded-[10px] bg-[#1B202A] px-3 py-3">
      <div className="text-base font-bold text-[#F3F4F6]">{value}</div>
      <div className="mt-1 text-[10px] text-[#8E97A6]">{title}</div>
      {subtitle ? <div className="text-[10px] text-[#8E97A6]">{subtitle}</div> : null}
    </div>
  )
}

function InsightPanel({ title, subtitle, body, stats }) {
  return (
    <article className="rounded-[20px] border border-[#2F3543] bg-[#131720] p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">Key Insight</div>
      <h3 className="mt-2 text-base font-semibold text-[#F3F4F6]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#8E97A6]">{body}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((item) => (
          <InsightStatCard key={item.title} title={item.title} subtitle={item.subtitle} value={item.value} />
        ))}
      </div>
      <div className="mt-4 text-xs font-medium text-[#AEB6C5]">{subtitle}</div>
    </article>
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

export default function ResultCards({ transitioning = false, entering = false }) {
  const {
    generatedScripts,
    referenceData,
    selectedScript,
    selectScript,
    goBackToUpload,
  } = useAppState()
  const [isVisible, setIsVisible] = useState(!entering)

  useEffect(() => {
    if (entering) {
      setIsVisible(false)
      const timer = window.setTimeout(() => setIsVisible(true), 24)
      return () => window.clearTimeout(timer)
    }

    setIsVisible(true)
    return undefined
  }, [entering])

  const transcriptText = useMemo(() => {
    const normalized = (referenceData?.transcript || '').trim()
    if (normalized) {
      return normalized
    }
    return '전사 텍스트가 없습니다. (오디오가 없거나 전사 추출에 실패한 파일일 수 있습니다.)'
  }, [referenceData?.transcript])

  const keyPoints = useMemo(() => {
    const points = referenceData?.keyPoints || []
    if (points.length >= 5) {
      return points.slice(0, 5)
    }

    return [
      points[0] || '첫 문장이 문제를 즉시 제기함',
      points[1] || '중간 설명이 짧고 시각적으로 상상하기 쉬움',
      points[2] || 'CTA가 길지 않고 명확함',
      points[3] || '텍스트 오버레이가 첫 화면에 즉시 표시됨',
      points[4] || '불필요한 효과음 없이 메시지에 집중',
    ]
  }, [referenceData?.keyPoints])

  const panels = useMemo(
    () => [
      {
        title: '3단 구조: 문제 제기 → 구체 사례 → 직접적 CTA',
        body: referenceData?.structureAnalysis || '첫 문장 문제 제기 후 사례를 압축하고 명확한 CTA로 마무리되는 구조입니다.',
        subtitle: '자세히 보기',
        stats: [
          { title: '후킹 시간', value: '1-2초' },
          { title: '본문 밀도', value: '높음' },
          { title: 'CTA 명확성', value: '95%' },
        ],
      },
      {
        title: '첫 1~2초 결과 암시 + 강한 문제 제기',
        body: referenceData?.hookAnalysis || '초반에 결과를 암시하고 문제를 직접 제기해 스크롤을 멈추게 만드는 패턴입니다.',
        subtitle: '자세히 보기',
        stats: [
          { title: '주목도', value: '89%' },
          { title: '완주율', value: '76%' },
          { title: '재생 속도', value: '빠름' },
        ],
      },
      {
        title: '손해 회피 + 즉시 적용 + 자기 효능감',
        body: referenceData?.psychologyAnalysis || '손실 회피 심리와 즉시 적용 가능성을 결합해 행동 전환을 유도하는 타입입니다.',
        subtitle: '자세히 보기',
        stats: [
          { title: '설득력', value: '84점' },
          { title: '공감도', value: '높음' },
          { title: '행동 유도', value: '강함' },
        ],
      },
      {
        title: '텍스트 우선 노출 + 빠른 컷 전환',
        body: referenceData?.frameInsight || '텍스트 포인트가 먼저 보이고 컷 전환이 빨라 메시지 긴장감을 유지합니다.',
        subtitle: '자세히 보기',
        stats: [
          { title: '시각 집중도', value: '92%' },
          { title: '컷 속도', value: '2-3초' },
          { title: '텍스트 가독성', value: '높음' },
        ],
      },
    ],
    [referenceData],
  )

  return (
    <div
      className={`h-full overflow-y-auto px-6 py-10 transition-all duration-500 md:px-12 ${
        transitioning
          ? 'pointer-events-none translate-y-4 opacity-0 blur-[3px]'
          : !isVisible
            ? 'translate-y-6 opacity-0 blur-[4px]'
            : 'translate-y-0 opacity-100 blur-0'
      }`}
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
          <h1 className="mt-5 text-5xl font-bold leading-[1.2] tracking-[-0.03em] text-[#F3F4F6]">분석 완료</h1>
          <p className="mt-3 text-base leading-7 text-[#8E97A6]">
            레퍼런스 영상을 다각도로 분석했습니다. 구조, 후킹 포인트, 심리 기제, 시각적 연출까지 세밀하게 파악했으며,
            이를 바탕으로 A/B/C 세 가지 초안을 준비했습니다.
          </p>
        </div>

        <section className="mt-10 rounded-[32px] border border-[#2F3543] bg-[#0F131B] p-10 shadow-[0px_1px_3px_rgba(0,0,0,0.30)]">
          <SmallBadge>Reference Script</SmallBadge>
          <h2 className="mt-6 text-[32px] font-bold leading-10 text-[#F3F4F6]">레퍼런스 스크립트</h2>
          <p className="mt-2 text-sm text-[#8E97A6]">분석된 레퍼런스 영상의 전체 스크립트와 심리 장치입니다.</p>

          <div className="mt-8 overflow-hidden rounded-[14px] border border-[#2F3543] bg-[#131720]">
            <div className="border-b border-[#2F3543] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#AEB6C5]">
              Transcript
            </div>
            <div className="px-4 py-4">
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#D1D5DB]">{transcriptText}</p>
            </div>
          </div>
        </section>

        <section className="mt-12 rounded-[32px] border border-[#2F3543] bg-[#0F131B] p-10 shadow-[0px_1px_3px_rgba(0,0,0,0.30)]">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#AEB6C5]">Key Insights</div>
          <h2 className="mt-3 text-[32px] font-bold text-[#F3F4F6]">핵심 인사이트</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {panels.map((panel) => (
              <InsightPanel key={panel.title} {...panel} />
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-[32px] border border-[#2F3543] bg-[#0F131B] p-10">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#AEB6C5]">Key Insights</div>
          <h2 className="mt-3 text-[32px] font-bold text-[#F3F4F6]">바로 써먹을 체크포인트</h2>
          <div className="mt-8 grid gap-3">
            {keyPoints.map((point) => (
              <CheckpointRow key={point}>{point}</CheckpointRow>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <SmallBadge tone="pink">Select Draft</SmallBadge>
          <h2 className="mt-5 text-4xl font-bold leading-[1.2] tracking-[-0.03em] text-[#F3F4F6]">A/B/C 초안 선택</h2>
          <p className="mt-2 text-sm text-[#8E97A6]">원하는 스타일을 선택하여 에디터로 이동하세요</p>
          <div className="mt-8 grid gap-6 xl:grid-cols-3">
            {generatedScripts.map((script) => (
              <ScriptCard
                key={script.id}
                script={script}
                onSelect={selectScript}
                isSelected={selectedScript?.id === script.id}
                hasSelection={Boolean(selectedScript)}
              />
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
