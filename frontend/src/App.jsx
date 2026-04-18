import { useEffect, useMemo, useState } from 'react'
import AppLayout from './components/AppLayout'
import ChatPanel from './components/ChatPanel'
import Editor from './components/Editor'
import ResultCards from './components/ResultCards'
import SettingsPage from './components/SettingsPage'
import Sidebar from './components/Sidebar'
import UploadSection from './components/UploadSection'
import VersionModal from './components/VersionModal'
import { getAuthPersistMode, setAuthPersistMode, supabase } from './lib/supabase'
// Deploy trigger: frontend touchpoint.
import { AppStateProvider, useAppState } from './store/AppState'

function LandingScreen() {
  const stepCards = [
    {
      id: 'step-1',
      label: 'Step 1',
      title: '레퍼런스 업로드',
      body: '분석하고 싶은 영상 파일을 드래그 앤 드롭하거나 직접 선택하세요.',
      border: '#2F3543',
      shadow: 'rgba(0, 0, 0, 0.28)',
      badgeBg: '#1C2230',
      badgeColor: '#D1D5DB',
      glow: '#1C2230',
    },
    {
      id: 'step-2',
      label: 'Step 2',
      title: 'AI 분석 + 초안 생성',
      body: '구조, 후킹 포인트, 심리 기제를 분석하고 A/B/C 세 가지 초안을 자동으로 생성합니다.',
      border: '#2F3543',
      shadow: 'rgba(0, 0, 0, 0.28)',
      badgeBg: '#1C2230',
      badgeColor: '#D1D5DB',
      glow: '#1C2230',
    },
    {
      id: 'step-3',
      label: 'Step 3',
      title: '에디터에서 수정',
      body: '마음에 드는 초안을 선택해 에디터로 이동하고, AI 코파일럿과 함께 완성하세요.',
      border: '#2F3543',
      shadow: 'rgba(0, 0, 0, 0.28)',
      badgeBg: '#1C2230',
      badgeColor: '#D1D5DB',
      glow: '#1C2230',
    },
  ]

  const featureCards = [
    {
      id: 'feature-1',
      title: '심층 레퍼런스 분석',
      body: '단순한 텍스트 추출이 아닌, 영상의 구조·후킹 포인트·심리 기제·시각적 연출까지 다각도로 분석합니다.',
      chips: [
        { label: '구조 분석', bg: '#1D2330', color: '#D1D5DB', border: '#2F3543' },
        { label: '후킹 포인트', bg: '#1D2330', color: '#D1D5DB', border: '#2F3543' },
        { label: '심리 기제', bg: '#1D2330', color: '#D1D5DB', border: '#2F3543' },
      ],
      border: '#2F3543',
      gradient: 'linear-gradient(169deg, #12151D 0%, #171B24 100%)',
      iconBg: '#1E2432',
    },
    {
      id: 'feature-2',
      title: 'A/B/C 자동 초안 생성',
      body: '분석 결과를 바탕으로 세 가지 톤앤매너의 초안을 자동 생성. 강한 문제 제기형, 정보 압축형, 공감 유도형 중에서 선택하세요.',
      chips: [
        { label: 'A안', bg: '#1D2330', color: '#D1D5DB', border: '#2F3543' },
        { label: 'B안', bg: '#1D2330', color: '#D1D5DB', border: '#2F3543' },
        { label: 'C안', bg: '#1D2330', color: '#D1D5DB', border: '#2F3543' },
      ],
      border: '#2F3543',
      gradient: 'linear-gradient(169deg, #12151D 0%, #171B24 100%)',
      iconBg: '#1E2432',
    },
    {
      id: 'feature-3',
      title: '실시간 AI 피드백',
      body: '에디터 우측 AI 코파일럿 패널에서 수정 요청을 보내고 즉시 피드백과 점수를 받아 콘텐츠를 개선하세요.',
      chips: [],
      border: '#2F3543',
      gradient: 'linear-gradient(173deg, #12151D 0%, #171B24 100%)',
      iconBg: '#1E2432',
    },
    {
      id: 'feature-4',
      title: '버전 관리 및 히스토리',
      body: '모든 레퍼런스와 작업 내역이 자동 저장되어 언제든 이전 버전을 불러오고 비교할 수 있습니다.',
      chips: [],
      border: '#2F3543',
      gradient: 'linear-gradient(173deg, #12151D 0%, #171B24 100%)',
      iconBg: '#1E2432',
    },
  ]

  const storyboardCards = [
    {
      id: 'board-a',
      title: '레퍼런스 분석 리포트',
      border: '#2F3543',
      bg: 'linear-gradient(170deg, #12151D 0%, #171B24 100%)',
      items: [
        { label: '구조 분석', value: '문제 제기 → 사례 → CTA', color: '#D1D5DB', bg: '#1D2330' },
        { label: '후킹 포인트', value: '첫 2초 반전 질문형', color: '#D1D5DB', bg: '#1D2330' },
        { label: '심리 기제', value: '손실 회피 + 권위 암시', color: '#D1D5DB', bg: '#1D2330' },
      ],
    },
    {
      id: 'board-b',
      title: 'A/B/C 초안 미리보기',
      border: '#2F3543',
      bg: 'linear-gradient(170deg, #12151D 0%, #171B24 100%)',
      items: [
        { label: 'A안', value: '강한 문제 제기형', color: '#D1D5DB', bg: '#1D2330' },
        { label: 'B안', value: '정보 압축형', color: '#D1D5DB', bg: '#1D2330' },
        { label: 'C안', value: '공감 유도형', color: '#D1D5DB', bg: '#1D2330' },
      ],
    },
  ]

  const useCases = [
    '광고 외주 스크립트 제작',
    '쇼핑몰 상세페이지 영상 기획',
    '브랜드 숏폼 포맷 표준화',
    'AI 코파일럿 기반 빠른 리라이트',
  ]

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#0B0D12] text-[#F3F4F6]"
      style={{
        fontFamily: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
        backgroundImage:
          'radial-gradient(ellipse 153.53% 105.45% at 20% 10%, rgba(148, 163, 184, 0.14) 0%, rgba(148, 163, 184, 0) 50%), radial-gradient(ellipse 141.31% 97.05% at 80% 80%, rgba(203, 213, 225, 0.08) 0%, rgba(203, 213, 225, 0) 50%), linear-gradient(180deg, #0B0D12 0%, #0F1219 100%)',
      }}
    >
      <div className="pointer-events-none absolute -left-16 top-24 h-72 w-72 rounded-full bg-[#334155]/35 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-[28rem] h-80 w-80 rounded-full bg-[#475569]/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-20 left-1/3 h-72 w-72 rounded-full bg-[#64748B]/30 blur-3xl" />

      <div className="mx-auto w-full max-w-[1920px] px-6 pb-28 pt-24 md:pt-[154px]">
        <section className="mx-auto max-w-[1024px] text-center">
          <div className="inline-flex h-9 items-center justify-center rounded-full border border-[#3A4252] bg-[#171B24] px-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">
            Verified Workflow
          </div>
          <h1 className="mt-7 text-[40px] font-bold leading-[1.2] tracking-[-0.03em] text-[#F8FAFC] md:text-[72px] md:leading-[79.2px]">
            검증 가능한 기준으로
            <br />
            숏폼 기획을 표준화하세요
          </h1>
          <p className="mx-auto mt-6 max-w-[600px] text-base leading-8 text-[#9CA3AF] md:text-[18px]">
            레퍼런스 분석, 초안 생성, 에디팅, 피드백까지
            <br className="hidden md:block" />
            한 플로우에서 운영 가능한 콘텐츠 제작 워크스테이션입니다.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/recommend"
              className="btn-solid-contrast inline-flex h-[59px] items-center justify-center gap-2 rounded-full px-8 text-lg font-semibold shadow-[0_12px_32px_rgba(0,0,0,0.38)] transition hover:bg-white"
            >
              <span>내 콘텐츠 방향 추천받기</span>
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
                <path
                  d="M6.67 3.33 13.34 10l-6.67 6.67"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.67"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <a
              href="/login"
              className="inline-flex h-[59px] items-center justify-center rounded-full border border-[#4B5563] bg-[#111827] px-8 text-lg font-semibold !text-[#F8FAFC] transition hover:bg-[#1F2937]"
            >
              <span className="!text-[#F8FAFC]">바로 시작하기</span>
            </a>
          </div>

          <div className="mt-14 grid w-full gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-[#2F3543] bg-[#12151D] px-6 py-5 text-left">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">평균 분석 시간</div>
              <div className="mt-2 text-3xl font-bold text-[#F8FAFC]">15초</div>
              <div className="mt-1 text-sm text-[#9CA3AF]">레퍼런스 업로드 후 1차 리포트 생성</div>
            </div>
            <div className="rounded-2xl border border-[#2F3543] bg-[#12151D] px-6 py-5 text-left">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">초안 생산성</div>
              <div className="mt-2 text-3xl font-bold text-[#F8FAFC]">3x</div>
              <div className="mt-1 text-sm text-[#9CA3AF]">A/B/C 자동 초안으로 작성 시간 단축</div>
            </div>
            <div className="rounded-2xl border border-[#2F3543] bg-[#12151D] px-6 py-5 text-left">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">운영 일관성</div>
              <div className="mt-2 text-3xl font-bold text-[#F8FAFC]">89%</div>
              <div className="mt-1 text-sm text-[#9CA3AF]">포맷 규칙 기반 구조 재사용률</div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-16 grid max-w-[1100px] gap-6 lg:grid-cols-2">
          {storyboardCards.map((board) => (
            <article
              key={board.id}
              className="rounded-[28px] border p-6 md:p-8"
              style={{
                borderColor: board.border,
                background: board.bg,
                boxShadow: '0 10px 30px rgba(17,24,39,0.06)',
              }}
            >
              <h3 className="text-[22px] font-bold tracking-[-0.02em] text-[#F8FAFC]">{board.title}</h3>
              <div className="mt-5 grid gap-3">
                {board.items.map((item) => (
                  <div key={`${board.id}-${item.label}`} className="rounded-2xl border border-[#2F3543] bg-[#171B24] p-4">
                    <div
                      className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold"
                      style={{ backgroundColor: item.bg, color: item.color }}
                    >
                      {item.label}
                    </div>
                    <p className="mt-2 text-sm font-medium text-[#E5E7EB]">{item.value}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="mx-auto mt-10 flex max-w-[1100px] flex-wrap items-center justify-center gap-3 rounded-[24px] border border-[#2F3543] bg-[#12151D]/90 p-5 shadow-[0_10px_34px_rgba(0,0,0,0.34)] backdrop-blur-sm">
          {useCases.map((useCase) => (
            <span
              key={useCase}
              className="inline-flex items-center rounded-full border border-[#2F3543] bg-[#171B24] px-4 py-2 text-xs font-medium text-[#CBD5E1] md:text-sm"
            >
              {useCase}
            </span>
          ))}
        </section>

        <section className="mx-auto mt-20 grid max-w-[1025px] gap-6 xl:grid-cols-3">
          {stepCards.map((card) => (
            <article
              key={card.id}
              className="relative overflow-hidden rounded-3xl border bg-[#12151D] p-8"
              style={{
                borderColor: card.border,
                boxShadow: `0 4px 16px ${card.shadow}`,
              }}
            >
              <div
                className="pointer-events-none absolute -right-7 -top-8 h-32 w-32 rounded-full blur-3xl"
                style={{ backgroundColor: card.glow, opacity: 0.5 }}
              />
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full border"
                style={{ backgroundColor: card.badgeBg, borderColor: card.border }}
              >
                <span className="h-4 w-4 rounded-sm border-2" style={{ borderColor: card.badgeColor }} />
              </div>
              <div
                className="mt-4 inline-flex h-[25px] items-center rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{
                  backgroundColor: card.badgeBg,
                  borderColor: card.border,
                  color: card.badgeColor,
                }}
              >
                {card.label}
              </div>
              <h3 className="mt-3 text-3xl font-bold leading-9 tracking-[-0.02em] text-[#F8FAFC]">{card.title}</h3>
              <p className="mt-4 text-sm leading-6 text-[#9CA3AF]">{card.body}</p>
            </article>
          ))}
        </section>
      </div>

      <section className="bg-[#0D1016] py-24">
        <div className="mx-auto w-full max-w-[1152px] px-6">
          <div className="flex justify-center">
            <div className="inline-flex h-[34px] items-center justify-center rounded-full border border-[#3A4252] bg-[#171B24] px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">
              Core Capabilities
            </div>
          </div>
          <h2 className="mx-auto mt-6 max-w-[560px] text-center text-[34px] font-bold leading-[1.35] tracking-[-0.03em] text-[#F8FAFC] md:text-[42px] md:leading-[63px]">
            실무 기준으로 바로 쓸 수 있는
            <br className="hidden md:block" />
            제작 파이프라인
          </h2>

          <div className="mt-16 grid gap-8 lg:grid-cols-2">
            {featureCards.map((card) => (
              <article
                key={card.id}
                className="rounded-[28px] border p-10"
                style={{
                  borderColor: card.border,
                  background: card.gradient,
                  minHeight: card.chips.length ? 246 : 194,
                }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: card.iconBg }}>
                  <span className="h-4 w-4 rounded-sm border-2 border-current text-[#E5E7EB]" />
                </div>
                <h3 className="mt-3 text-[30px] font-bold leading-9 tracking-[-0.02em] text-[#F8FAFC]">{card.title}</h3>
                <p className="mt-4 text-base leading-7 text-[#9CA3AF]">{card.body}</p>
                {card.chips.length ? (
                  <div className="mt-6 flex flex-wrap gap-2">
                    {card.chips.map((chip) => (
                      <span
                        key={chip.label}
                        className="inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold"
                        style={{
                          backgroundColor: chip.bg,
                          color: chip.color,
                          borderColor: chip.border,
                        }}
                      >
                        {chip.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-28 pt-16">
        <div className="mx-auto w-full max-w-[896px] rounded-[36px] border border-[#2F3543] p-10 text-center shadow-[0_30px_60px_-14px_rgba(0,0,0,0.45)] md:p-16" style={{ background: 'linear-gradient(168deg, #12151D 0%, #171B24 55%, #1E2432 100%)' }}>
          <h2 className="text-[36px] font-bold leading-[1.35] tracking-[-0.03em] text-[#F8FAFC] md:text-[48px] md:leading-[72px]">
            지금 팀의 콘텐츠 기준을
            <br className="hidden md:block" />
            시스템으로 고정하세요
          </h2>
          <p className="mx-auto mt-3 max-w-[560px] text-base leading-8 text-[#9CA3AF] md:text-[18px]">
            레퍼런스 분석부터 초안, 에디팅, 저장 이력까지
            <br className="hidden md:block" />
            재현 가능한 워크플로우로 운영할 수 있습니다.
          </p>
          <a
            href="/signup"
            className="btn-solid-contrast mt-10 inline-flex h-[67px] items-center justify-center gap-2 rounded-full px-10 text-lg font-semibold shadow-[0_12px_34px_rgba(0,0,0,0.38)] transition hover:bg-white"
          >
            무료로 시작하기
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
              <path
                d="M6.67 3.33 13.34 10l-6.67 6.67"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.67"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
      </section>
    </main>
  )
}

const TRAIT_LABELS = {
  logic: '논리형',
  structure: '구조형',
  trust: '신뢰형',
  experience: '경험형',
  emotion: '감성형',
  expression: '표현형',
  direct: '직설형',
  entertainment: '재미형',
  monetization: '수익지향형',
}

const RECOMMEND_QUESTIONS = [
  {
    id: 'q1',
    step: 'Q1',
    title: '사람들이 당신 콘텐츠를 보고 가장 먼저 느꼈으면 하는 건 뭔가요?',
    subtitle: '첫인상에서 무엇을 가져가게 할지 고르는 질문입니다.',
    options: [
      {
        id: 'q1-a',
        label: 'A',
        title: '유용하다',
        description: '정리된 정보와 실전 팁을 준다',
        traits: { logic: 2, structure: 2, trust: 1 },
      },
      {
        id: 'q1-b',
        label: 'B',
        title: '재밌다',
        description: '표현력과 감정선이 먼저 살아난다',
        traits: { emotion: 2, expression: 2, entertainment: 1 },
      },
      {
        id: 'q1-c',
        label: 'C',
        title: '믿음 간다',
        description: '경험과 검증된 기준이 느껴진다',
        traits: { trust: 2, experience: 2, monetization: 1 },
      },
    ],
  },
  {
    id: 'q2',
    step: 'Q2',
    title: '말할 때 본인 스타일에 가장 가까운 쪽은 무엇인가요?',
    subtitle: '전달 방식의 기본 톤을 확인합니다.',
    options: [
      {
        id: 'q2-a',
        label: 'A',
        title: '차분하게 구조적으로',
        description: '순서대로 설명하는 게 편하다',
        traits: { logic: 2, structure: 2 },
      },
      {
        id: 'q2-b',
        label: 'B',
        title: '공감되게 부드럽게',
        description: '상황과 감정을 먼저 건드린다',
        traits: { emotion: 2, trust: 1, expression: 1 },
      },
      {
        id: 'q2-c',
        label: 'C',
        title: '짧고 직설적으로',
        description: '핵심만 빠르게 던지는 편이다',
        traits: { direct: 2, monetization: 1, entertainment: 1 },
      },
    ],
  },
  {
    id: 'q3',
    step: 'Q3',
    title: '지속적으로 만들기 가장 쉬운 소재는 어떤 쪽인가요?',
    subtitle: '콘텐츠 지속 가능성을 보는 질문입니다.',
    options: [
      {
        id: 'q3-a',
        label: 'A',
        title: '내 경험/후기',
        description: '써본 것, 겪은 것, 비교한 것',
        traits: { experience: 2, trust: 1, expression: 1 },
      },
      {
        id: 'q3-b',
        label: 'B',
        title: '정보 정리/분석',
        description: '자료 보고 핵심 뽑는 게 편하다',
        traits: { logic: 2, structure: 1, trust: 1 },
      },
      {
        id: 'q3-c',
        label: 'C',
        title: '반응/캐릭터/밈',
        description: '표현하고 살리는 게 편하다',
        traits: { entertainment: 2, expression: 2, emotion: 1 },
      },
    ],
  },
  {
    id: 'q4',
    step: 'Q4',
    title: '가장 빨리 수익으로 연결하고 싶은 방식은 무엇인가요?',
    subtitle: '수익화 선호를 직접 반영합니다.',
    options: [
      {
        id: 'q4-a',
        label: 'A',
        title: '제품/서비스 추천',
        description: '리뷰나 비교를 통해 구매 전환',
        traits: { monetization: 2, trust: 2, experience: 1 },
      },
      {
        id: 'q4-b',
        label: 'B',
        title: '전문성 기반 리드 확보',
        description: '노하우로 상담/강의/브랜드 연결',
        traits: { logic: 2, structure: 2, monetization: 1 },
      },
      {
        id: 'q4-c',
        label: 'C',
        title: '대중 노출과 팬층',
        description: '도달을 키우고 이후 광고/콜라보 연결',
        traits: { entertainment: 2, emotion: 1, expression: 2 },
      },
    ],
  },
  {
    id: 'q5',
    step: 'Q5',
    title: '사람들이 당신에게 자주 묻는 건 어떤 쪽인가요?',
    subtitle: '이미 시장이 당신에게 기대하는 역할을 확인합니다.',
    options: [
      {
        id: 'q5-a',
        label: 'A',
        title: '이거 사도 돼?',
        description: '구매 판단, 비교, 후기',
        traits: { trust: 2, experience: 2, monetization: 1 },
      },
      {
        id: 'q5-b',
        label: 'B',
        title: '어떻게 해야 돼?',
        description: '방법, 전략, 루틴, 구조',
        traits: { logic: 2, structure: 2, trust: 1 },
      },
      {
        id: 'q5-c',
        label: 'C',
        title: '너 진짜 말 재밌게 한다',
        description: '표현력, 감정선, 캐릭터성',
        traits: { expression: 2, entertainment: 2, emotion: 1 },
      },
    ],
  },
  {
    id: 'q6',
    step: 'Q6',
    title: '콘텐츠를 만들 때 가장 자신 있는 생산 방식은 무엇인가요?',
    subtitle: '실행 속도와 지속성에 직접 영향을 주는 질문입니다.',
    options: [
      {
        id: 'q6-a',
        label: 'A',
        title: '제품/서비스 직접 써보고 비교',
        description: '실사용 기반으로 설명이 가능하다',
        traits: { experience: 2, trust: 2, monetization: 1 },
      },
      {
        id: 'q6-b',
        label: 'B',
        title: '정보를 체계적으로 재구성',
        description: '복잡한 걸 쉽게 정리하는 편이다',
        traits: { logic: 2, structure: 2, trust: 1 },
      },
      {
        id: 'q6-c',
        label: 'C',
        title: '감정/캐릭터 기반으로 풀어내기',
        description: '공감과 몰입을 만드는 데 강하다',
        traits: { emotion: 2, expression: 2, entertainment: 1 },
      },
    ],
  },
  {
    id: 'q7',
    step: 'Q7',
    title: '당장 3개월 안에 가장 중요한 목표는 무엇인가요?',
    subtitle: '단기 전략을 결정하는 핵심 변수입니다.',
    options: [
      {
        id: 'q7-a',
        label: 'A',
        title: '바로 매출 연결',
        description: '제휴/협찬/추천 수익을 빠르게 만들고 싶다',
        traits: { monetization: 3, trust: 1, experience: 1, direct: 1 },
      },
      {
        id: 'q7-b',
        label: 'B',
        title: '전문가 포지션 확보',
        description: '브랜드 신뢰와 고단가 구조를 만들고 싶다',
        traits: { logic: 2, structure: 2, trust: 2, monetization: 1 },
      },
      {
        id: 'q7-c',
        label: 'C',
        title: '도달과 팬덤 확장',
        description: '조회수와 반응을 크게 키우고 싶다',
        traits: { entertainment: 2, expression: 2, emotion: 1 },
      },
    ],
  },
  {
    id: 'q8',
    step: 'Q8',
    title: '어떤 방식의 오프닝을 만들 때 가장 손에 익나요?',
    subtitle: '초반 이탈률을 줄이는 시작 방식 관련 질문입니다.',
    options: [
      {
        id: 'q8-a',
        label: 'A',
        title: '문제 제기형',
        description: '실수/손해 포인트를 먼저 던진다',
        traits: { direct: 2, monetization: 1, trust: 1 },
      },
      {
        id: 'q8-b',
        label: 'B',
        title: '설명 정리형',
        description: '핵심 개념을 순서대로 풀어준다',
        traits: { logic: 2, structure: 2 },
      },
      {
        id: 'q8-c',
        label: 'C',
        title: '감정 공감형',
        description: '상황 공감으로 시청자를 끌어들인다',
        traits: { emotion: 2, expression: 1, entertainment: 1 },
      },
    ],
  },
  {
    id: 'q9',
    step: 'Q9',
    title: '카메라 앞에서 가장 편한 모습은 무엇인가요?',
    subtitle: '촬영 난이도와 지속성을 결정하는 질문입니다.',
    options: [
      {
        id: 'q9-a',
        label: 'A',
        title: '제품/화면 보여주며 설명',
        description: '객관적 근거를 같이 제시하는 편',
        traits: { trust: 2, experience: 2, logic: 1 },
      },
      {
        id: 'q9-b',
        label: 'B',
        title: '화이트보드/자막 중심 설명',
        description: '구조화된 정보 전달이 편하다',
        traits: { structure: 2, logic: 2, trust: 1 },
      },
      {
        id: 'q9-c',
        label: 'C',
        title: '표정/말맛 중심 진행',
        description: '캐릭터와 몰입감으로 끌고 간다',
        traits: { expression: 2, entertainment: 2, emotion: 1 },
      },
    ],
  },
  {
    id: 'q10',
    step: 'Q10',
    title: '댓글에서 어떤 반응이 가장 많이 달리길 원하나요?',
    subtitle: '콘텐츠 KPI 우선순위에 대한 질문입니다.',
    options: [
      {
        id: 'q10-a',
        label: 'A',
        title: '“이거 사볼게요”',
        description: '행동/구매 전환 반응',
        traits: { monetization: 3, trust: 1, experience: 1 },
      },
      {
        id: 'q10-b',
        label: 'B',
        title: '“설명 진짜 명확하네요”',
        description: '전문성/구조 인정 반응',
        traits: { logic: 2, structure: 2, trust: 1 },
      },
      {
        id: 'q10-c',
        label: 'C',
        title: '“너무 공감돼요”',
        description: '감정/몰입 반응',
        traits: { emotion: 2, expression: 1, entertainment: 1 },
      },
    ],
  },
  {
    id: 'q11',
    step: 'Q11',
    title: '현재 보유한 자산 중 가장 강한 것은 무엇인가요?',
    subtitle: '초기 성장에 바로 활용 가능한 자산을 평가합니다.',
    options: [
      {
        id: 'q11-a',
        label: 'A',
        title: '실사용 경험 데이터',
        description: '비교/리뷰 가능한 기록이 많다',
        traits: { experience: 2, trust: 2, monetization: 1 },
      },
      {
        id: 'q11-b',
        label: 'B',
        title: '전문 지식/노하우',
        description: '체계적으로 설명 가능한 역량이 있다',
        traits: { logic: 2, structure: 2, trust: 1 },
      },
      {
        id: 'q11-c',
        label: 'C',
        title: '개인 스토리/캐릭터',
        description: '차별화된 서사가 있다',
        traits: { emotion: 2, expression: 2, entertainment: 1 },
      },
    ],
  },
  {
    id: 'q12',
    step: 'Q12',
    title: '초기 30개 콘텐츠 전략으로 가장 끌리는 건 무엇인가요?',
    subtitle: '운영 전략과 포지셔닝을 최종 확인합니다.',
    options: [
      {
        id: 'q12-a',
        label: 'A',
        title: '리뷰 시리즈 고정',
        description: '한 카테고리 제품군을 반복 비교',
        traits: { monetization: 2, experience: 2, trust: 2 },
      },
      {
        id: 'q12-b',
        label: 'B',
        title: '정보 아카이브 구축',
        description: '주제별로 체계적 가이드 제작',
        traits: { structure: 2, logic: 2, trust: 1 },
      },
      {
        id: 'q12-c',
        label: 'C',
        title: '캐릭터형 에피소드',
        description: '공감형 에피소드로 팬덤 확보',
        traits: { entertainment: 2, expression: 2, emotion: 1 },
      },
    ],
  },
]

const CATEGORY_LIBRARY = [
  {
    id: 'review-recommend',
    name: '리뷰/추천형',
    marketGrowth: 34,
    conversionRate: 4.8,
    competition: 62,
    monetizationSpeed: 82,
    summary: '구매 전환과 협찬 연결이 가장 빠른 현실형 카테고리',
    monetizationWays: ['협찬', '제휴 링크', '쿠팡파트너스'],
    contentTopics: ['가정제품 리뷰', '뷰티 제품', '전자기기', '생활 꿀템'],
    strengths: ['진입 쉬움', '돈 연결 빠름'],
    cautions: ['경쟁 많음'],
    traits: { experience: 3, trust: 3, monetization: 3, logic: 1, direct: 1 },
  },
  {
    id: 'expert-info',
    name: '전문 정보형',
    marketGrowth: 29,
    conversionRate: 3.9,
    competition: 58,
    monetizationSpeed: 74,
    summary: '신뢰 기반으로 고단가 상품을 만들기 좋은 카테고리',
    monetizationWays: ['강의', '컨설팅', '전자책'],
    contentTopics: ['자기계발', '마케팅', 'AI 정보', '재테크'],
    strengths: ['단가 높음', '팬 생김'],
    cautions: ['신뢰 쌓는 시간 필요'],
    traits: { logic: 3, structure: 3, trust: 2, monetization: 2 },
  },
  {
    id: 'personal-brand',
    name: '개인 브랜딩형',
    marketGrowth: 33,
    conversionRate: 3.1,
    competition: 52,
    monetizationSpeed: 63,
    summary: '스토리 기반 팬덤을 만들고 장기 성장하기 좋은 카테고리',
    monetizationWays: ['브랜딩 협업', '광고', '자체 상품'],
    contentTopics: ['창업 과정', '일상 공유', '성장 스토리'],
    strengths: ['팬덤 강함', '장기적으로 큼'],
    cautions: ['초반 수익 느림'],
    traits: { emotion: 3, experience: 2, trust: 2, expression: 2, structure: 1 },
  },
  {
    id: 'entertainment-emotion',
    name: '엔터/감성형',
    marketGrowth: 41,
    conversionRate: 2.4,
    competition: 77,
    monetizationSpeed: 59,
    summary: '도달/조회수는 유리하지만 수익 구조를 같이 설계해야 하는 카테고리',
    monetizationWays: ['광고', '협찬'],
    contentTopics: ['유머', '공감 콘텐츠', '짧은 상황극'],
    strengths: ['조회수 잘 터짐'],
    cautions: ['수익 연결 약함'],
    traits: { entertainment: 3, expression: 3, emotion: 2, direct: 1 },
  },
]

const TRENDING_NICHES = [
  { id: 'beauty', name: '뷰티', traits: { experience: 2, trust: 2, monetization: 2 } },
  { id: 'diet-health', name: '다이어트/건강', traits: { trust: 2, logic: 1, monetization: 2 } },
  { id: 'pets', name: '반려동물', traits: { emotion: 2, trust: 1, expression: 1 } },
  { id: 'parenting', name: '육아 상품 정보제공', traits: { trust: 2, experience: 2, monetization: 1 } },
  { id: 'fashion', name: '패션 리뷰', traits: { expression: 2, experience: 2, monetization: 1 } },
  { id: 'self-dev', name: '자기계발 설명', traits: { logic: 2, structure: 2, trust: 1 } },
  { id: 'ai-auto', name: 'AI/자동화 정보제공', traits: { logic: 2, structure: 2, monetization: 1 } },
  { id: 'side-income', name: '부업/투자 정보제공', traits: { trust: 2, logic: 1, monetization: 2 } },
]

function scoreRecommendation(answers) {
  const traitTotals = answers.reduce((acc, answer) => {
    Object.entries(answer.traits).forEach(([trait, value]) => {
      acc[trait] = (acc[trait] || 0) + value
    })
    return acc
  }, {})

  const categories = CATEGORY_LIBRARY.map((category) => {
    const traitScore = Object.entries(category.traits).reduce((sum, [trait, weight]) => {
      return sum + (traitTotals[trait] || 0) * weight
    }, 0)

    const dataScore =
      category.marketGrowth * 0.25 +
      category.conversionRate * 5 +
      category.monetizationSpeed * 0.3 -
      category.competition * 0.12

    const totalScore = Math.round(traitScore * 2.1 + dataScore)

    return {
      ...category,
      traitScore,
      dataScore: Math.round(dataScore),
      totalScore,
    }
  }).sort((a, b) => b.totalScore - a.totalScore)

  const trendingNiches = TRENDING_NICHES.map((niche) => {
    const fitScore = Object.entries(niche.traits).reduce((sum, [trait, weight]) => {
      return sum + (traitTotals[trait] || 0) * weight
    }, 0)

    return {
      ...niche,
      fitScore,
    }
  })
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 6)

  return {
    traitTotals,
    categories,
    topCategory: categories[0],
    secondaryCategory: categories[1],
    tertiaryCategory: categories[2],
    trendingNiches,
  }
}

function RecommendScreen() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState([])

  const currentQuestion = RECOMMEND_QUESTIONS[currentIndex]
  const isCompleted = currentIndex >= RECOMMEND_QUESTIONS.length

  const result = useMemo(() => {
    if (!isCompleted) {
      return null
    }
    return scoreRecommendation(answers)
  }, [answers, isCompleted])

  const dominantTraits = useMemo(() => {
    if (!result) {
      return []
    }

    return Object.entries(result.traitTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  }, [result])

  const handleOptionClick = (option) => {
    setAnswers((prev) => [...prev, option])
    setCurrentIndex((prev) => prev + 1)
  }

  const handleRestart = () => {
    setAnswers([])
    setCurrentIndex(0)
  }

  return (
    <main
      className="min-h-screen bg-[#0B0D12] px-6 py-10 text-[#F3F4F6]"
      style={{
        fontFamily: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
        backgroundImage:
          'radial-gradient(circle at 15% 15%, rgba(148,163,184,0.16) 0%, rgba(148,163,184,0) 28%), radial-gradient(circle at 85% 18%, rgba(71,85,105,0.18) 0%, rgba(71,85,105,0) 28%), linear-gradient(180deg, #0B0D12 0%, #0F1219 100%)',
      }}
    >
      <div className="mx-auto max-w-[1080px]">
        <div className="flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#D1D5DB]">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
              <path d="M11.67 4.17 5.84 10l5.83 5.83" fill="none" stroke="currentColor" strokeWidth="1.67" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            홈으로
          </a>
          <div className="inline-flex rounded-full border border-[#374151] bg-[#12151D] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#E5E7EB]">
            Content Fit Diagnosis
          </div>
        </div>

        {!isCompleted ? (
          <section className="mt-12 grid gap-8 lg:grid-cols-[0.78fr_1.22fr]">
            <aside className="rounded-[32px] border border-[#2F3543] bg-[#12151D]/95 p-8 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="text-sm font-semibold text-[#CBD5E1]">
                {currentQuestion.step} / Q{RECOMMEND_QUESTIONS.length}
              </div>
              <h1 className="mt-4 text-[34px] font-bold leading-[1.2] tracking-[-0.03em] text-[#F8FAFC]">
                내 콘텐츠 방향 추천받기
              </h1>
              <p className="mt-4 text-sm leading-7 text-[#9CA3AF]">
                객관식 답변만으로 성향을 점수화하고, 콘텐츠 카테고리와 시장 지표를 함께 매칭합니다.
              </p>

              <div className="mt-8">
                <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF]">
                  <span>진행률</span>
                  <span>{Math.round((currentIndex / RECOMMEND_QUESTIONS.length) * 100)}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1E2432]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#CBD5E1_0%,#F8FAFC_100%)] transition-all duration-300"
                    style={{ width: `${(currentIndex / RECOMMEND_QUESTIONS.length) * 100}%` }}
                  />
                </div>
              </div>

              <div className="mt-10 grid gap-3">
                {RECOMMEND_QUESTIONS.map((question, index) => (
                  <div
                    key={question.id}
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      index < currentIndex
                        ? 'border-[#374151] bg-[#1F2937] text-[#E5E7EB]'
                        : index === currentIndex
                          ? 'border-[#CBD5E1] bg-[#171B24] text-[#F8FAFC]'
                          : 'border-[#2F3543] bg-[#12151D] text-[#9CA3AF]'
                    }`}
                  >
                    {question.step}. {question.title}
                  </div>
                ))}
              </div>
            </aside>

            <section className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.38)]">
              <div className="inline-flex rounded-full border border-[#374151] bg-[#171B24] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">
                {currentQuestion.step}
              </div>
              <h2 className="mt-5 text-[34px] font-bold leading-[1.24] tracking-[-0.03em] text-[#F8FAFC]">
                {currentQuestion.title}
              </h2>
              <p className="mt-3 text-base leading-7 text-[#9CA3AF]">{currentQuestion.subtitle}</p>

              <div className="mt-8 grid gap-4">
                {currentQuestion.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleOptionClick(option)}
                    className="group rounded-[24px] border border-[#2F3543] bg-[#171B24] p-5 text-left transition hover:-translate-y-0.5 hover:border-[#94A3B8] hover:bg-[#1D2330] hover:shadow-[0_16px_30px_rgba(0,0,0,0.36)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1E2432] text-sm font-bold text-[#E5E7EB]">
                            {option.label}
                          </span>
                          <h3 className="text-[22px] font-bold tracking-[-0.02em] text-[#F8FAFC]">
                            {option.title}
                          </h3>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-[#9CA3AF]">{option.description}</p>
                      </div>
                      <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#94A3B8] transition group-hover:text-[#E2E8F0]">
                        <path d="M7.5 4.17 13.33 10 7.5 15.83" fill="none" stroke="currentColor" strokeWidth="1.67" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </section>
        ) : (
          <section className="mt-12 grid gap-8">
            <div className="rounded-[36px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.38)] md:p-10">
              <div className="inline-flex rounded-full border border-[#374151] bg-[#171B24] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">
                Recommendation Result
              </div>
              <h1 className="mt-5 text-[42px] font-bold leading-[1.15] tracking-[-0.03em] text-[#F8FAFC]">
                {result.topCategory.name}이 가장 유리합니다
              </h1>
              <p className="mt-4 max-w-[760px] text-base leading-8 text-[#9CA3AF]">
                답변 패턴을 가중치 점수로 환산한 결과, 현재 성향과 수익화 조건에 가장 잘 맞는 카테고리는
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.topCategory.name}</span>
                {' '}
                입니다.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-4">
                <div className="rounded-[20px] border border-[#2F3543] bg-[#171B24] p-5">
                  <div className="text-sm font-semibold text-[#CBD5E1]">시장 성장률</div>
                  <div className="mt-2 text-[32px] font-bold text-[#F8FAFC]">{result.topCategory.marketGrowth}%</div>
                </div>
                <div className="rounded-[20px] border border-[#2F3543] bg-[#171B24] p-5">
                  <div className="text-sm font-semibold text-[#CBD5E1]">예상 전환율</div>
                  <div className="mt-2 text-[32px] font-bold text-[#F8FAFC]">{result.topCategory.conversionRate}%</div>
                </div>
                <div className="rounded-[20px] border border-[#2F3543] bg-[#171B24] p-5">
                  <div className="text-sm font-semibold text-[#CBD5E1]">경쟁도</div>
                  <div className="mt-2 text-[32px] font-bold text-[#F8FAFC]">{result.topCategory.competition}</div>
                </div>
                <div className="rounded-[20px] border border-[#2F3543] bg-[#171B24] p-5">
                  <div className="text-sm font-semibold text-[#CBD5E1]">수익화 속도</div>
                  <div className="mt-2 text-[32px] font-bold text-[#F8FAFC]">{result.topCategory.monetizationSpeed}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
              <article className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">1. 사용자 성향 분석</div>
                <h2 className="mt-4 text-[28px] font-bold tracking-[-0.03em] text-[#F8FAFC]">선택 결과 기반 성향</h2>
                <div className="mt-6 grid gap-3">
                  {dominantTraits.map(([trait, score]) => (
                    <div key={trait} className="rounded-2xl border border-[#2F3543] bg-[#171B24] px-4 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-sm font-semibold text-[#F8FAFC]">{trait}</div>
                        <div className="text-sm font-bold text-[#E5E7EB]">{score}점</div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1E2432]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#CBD5E1_0%,#F8FAFC_100%)]"
                          style={{ width: `${Math.min(score * 14, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-sm leading-7 text-[#9CA3AF]">
                  현재 응답 패턴은
                  {' '}
                  <span className="font-semibold text-[#F8FAFC]">
                    {dominantTraits.map(([trait]) => TRAIT_LABELS[trait] || trait).join(', ')}
                  </span>
                  {' '}
                  성향이 강하게 나타났습니다. 즉, 단순한 흥미보다
                  {' '}
                  <span className="font-semibold text-[#F8FAFC]">신뢰 가능한 전달력과 수익 연결성</span>
                  이 더 유리한 구조입니다.
                </p>
              </article>

              <article className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">2. 데이터 기반 추천</div>
                <h2 className="mt-4 text-[28px] font-bold tracking-[-0.03em] text-[#F8FAFC]">왜 이 카테고리인가</h2>
                <div className="mt-6 space-y-4">
                  {[result.topCategory, result.secondaryCategory, result.tertiaryCategory].map((category, index) => (
                    <div
                      key={category.id}
                      className={`rounded-[24px] border p-5 ${
                        index === 0
                          ? 'border-[#94A3B8] bg-[#1D2330]'
                          : 'border-[#2F3543] bg-[#171B24]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[#CBD5E1]">#{index + 1} 추천</div>
                          <div className="mt-1 text-[24px] font-bold text-[#F8FAFC]">{category.name}</div>
                        </div>
                        <div className="rounded-full border border-[#374151] bg-[#12151D] px-4 py-2 text-sm font-bold text-[#F8FAFC]">
                          총점 {category.totalScore}
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[#9CA3AF]">{category.summary}</p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-[#2F3543] bg-[#12151D] px-3 py-3">
                          <div className="text-xs font-semibold text-[#9CA3AF]">수익 방식</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {category.monetizationWays.map((item) => (
                              <span
                                key={`${category.id}-mon-${item}`}
                                className="rounded-full border border-[#374151] bg-[#171B24] px-2 py-1 text-xs font-medium text-[#CBD5E1]"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[#2F3543] bg-[#12151D] px-3 py-3">
                          <div className="text-xs font-semibold text-[#9CA3AF]">콘텐츠</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {category.contentTopics.map((item) => (
                              <span
                                key={`${category.id}-topic-${item}`}
                                className="rounded-full border border-[#374151] bg-[#171B24] px-2 py-1 text-xs font-medium text-[#CBD5E1]"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-xl border border-[#2F3543] bg-[#171B24] px-3 py-3 text-xs text-[#CBD5E1]">
                          <span className="font-semibold">장점</span>
                          <div className="mt-1">{category.strengths.join(' / ')}</div>
                        </div>
                        <div className="rounded-xl border border-[#2F3543] bg-[#171B24] px-3 py-3 text-xs text-[#CBD5E1]">
                          <span className="font-semibold">단점</span>
                          <div className="mt-1">{category.cautions.join(' / ')}</div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-[#CBD5E1] md:grid-cols-4">
                        <div className="rounded-xl border border-[#2F3543] bg-[#12151D] px-3 py-3">성장률 {category.marketGrowth}%</div>
                        <div className="rounded-xl border border-[#2F3543] bg-[#12151D] px-3 py-3">전환율 {category.conversionRate}%</div>
                        <div className="rounded-xl border border-[#2F3543] bg-[#12151D] px-3 py-3">경쟁도 {category.competition}</div>
                        <div className="rounded-xl border border-[#2F3543] bg-[#12151D] px-3 py-3">수익화 {category.monetizationSpeed}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">3. 최종 해석</div>
              <h2 className="mt-4 text-[28px] font-bold tracking-[-0.03em] text-[#F8FAFC]">추천 결론</h2>
              <p className="mt-4 text-base leading-8 text-[#CBD5E1]">
                현재 성향은
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.topCategory.name}</span>
                {' '}
                과 가장 강하게 맞물립니다. 시장 성장률
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.topCategory.marketGrowth}%</span>
                ,
                예상 전환율
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.topCategory.conversionRate}%</span>
                ,
                수익화 속도 지표
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.topCategory.monetizationSpeed}</span>
                를 기준으로 보면, 초기 실행 대비 결과 회수가 가장 빠른 축에 속합니다.
              </p>
              <p className="mt-4 text-base leading-8 text-[#CBD5E1]">
                추천 시작안은
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.topCategory.name}</span>
                ,
                보조 확장안은
                {' '}
                <span className="font-semibold text-[#F8FAFC]">{result.secondaryCategory.name}</span>
                입니다.
                초반 10개 콘텐츠는 주력 카테고리 하나로 밀고, 반응 데이터 확보 후 보조 카테고리를 섞는 전략이 가장 합리적입니다.
              </p>

              <div className="mt-8 rounded-2xl border border-[#2F3543] bg-[#171B24] p-5">
                <div className="text-sm font-semibold text-[#F8FAFC]">요즘 잘 되는 세부 카테고리 (성향 적합도 기준)</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.trendingNiches.map((niche) => (
                    <span
                      key={niche.id}
                      className="inline-flex items-center gap-2 rounded-full border border-[#374151] bg-[#12151D] px-3 py-1.5 text-xs font-medium text-[#CBD5E1]"
                    >
                      {niche.name}
                      <span className="font-semibold text-[#F8FAFC]">적합도 {niche.fitScore}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex h-12 items-center justify-center rounded-full border border-[#374151] bg-[#171B24] px-6 text-sm font-semibold text-[#E5E7EB] transition hover:bg-[#1E2432]"
                >
                  다시 진단하기
                </button>
                <a
                  href="/analyze"
                  className="btn-solid-contrast inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition hover:bg-white"
                >
                  이 방향으로 분석 시작하기
                </a>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function AuthScreen({
  mode,
  title,
  subtitle,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  onSubmit,
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => getAuthPersistMode())

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#0b0d12_0%,#111827_100%)] px-6 py-10">
      <div className="w-full max-w-[420px] rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1D2330] text-lg font-semibold text-[#F3F4F6]">
          PA
        </div>
        <h1 className="mt-6 text-center text-[30px] font-bold tracking-[-0.03em] text-[#F8FAFC]">
          {title}
        </h1>
        <p className="mt-3 text-center text-sm leading-6 text-[#9CA3AF]">{subtitle}</p>

        <div className="mt-8 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#CBD5E1]">이메일</span>
            <input
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError('')
              }}
              placeholder="your@email.com"
              className="h-12 rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#CBD5E1]">비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
              }}
              placeholder="••••••••"
              className="h-12 rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1]"
            />
          </label>
          {mode === 'login' ? (
            <label className="mt-1 inline-flex items-center gap-2 text-sm text-[#CBD5E1]">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded border border-[#4B5563] bg-[#171B24] accent-[#D1D5DB]"
              />
              자동 로그인
            </label>
          ) : null}
        </div>

        {error ? <div className="mt-4 text-sm text-[#dc2626]">{error}</div> : null}

        <button
          type="button"
          disabled={isSubmitting}
          onClick={async () => {
            try {
              setIsSubmitting(true)
              setAuthPersistMode(mode === 'login' ? rememberMe : true)
              const result = await onSubmit({
                loginId: email,
                password,
                accountName: email.split('@')[0] || email,
              })
              if (mode === 'signup' && result?.requiresEmailConfirmation) {
                if (result?.rateLimited) {
                  window.alert('인증 메일은 30초 간격으로만 다시 요청할 수 있습니다. 받은 메일을 확인한 뒤 로그인해주세요.')
                } else {
                  window.alert('회원가입 완료. 이메일 인증 후 로그인해주세요.')
                }
                window.location.assign('/login')
                return
              }
              window.location.assign('/analyze')
            } catch (nextError) {
              setError(nextError.message || `${primaryLabel}에 실패했습니다.`)
            } finally {
              setIsSubmitting(false)
            }
          }}
          className="btn-solid-contrast mt-8 flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {primaryLabel}
        </button>

        <button
          type="button"
          disabled={isOAuthSubmitting}
          onClick={async () => {
            try {
              setIsOAuthSubmitting(true)
              setError('')
              setAuthPersistMode(mode === 'login' ? rememberMe : true)
              const redirectTo = `${window.location.origin}/analyze`
              const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                  redirectTo,
                },
              })

              if (oauthError) {
                throw oauthError
              }
            } catch (nextError) {
              setError(nextError.message || 'Google 로그인에 실패했습니다.')
              setIsOAuthSubmitting(false)
            }
          }}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#374151] bg-[#171B24] text-sm font-semibold text-[#F8FAFC] transition hover:bg-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
            <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.8-5.4 3.8-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.8 2.4 2.6 6.7 2.6 12s4.2 9.6 9.4 9.6c5.4 0 9-3.8 9-9.1 0-.6-.1-1-.1-1.4H12Z" />
          </svg>
          Google로 계속하기
        </button>

        <div className="mt-6 text-center text-sm text-[#9CA3AF]">
          {mode === 'login' ? '계정이 없나요? ' : '이미 계정이 있나요? '}
          <a href={secondaryHref} className="font-semibold text-[#F3F4F6]">
            {secondaryLabel}
          </a>
        </div>
      </div>
    </main>
  )
}

function LoginScreen() {
  const { login, isLoggedIn, isAuthReady } = useAppState()

  useEffect(() => {
    if (isAuthReady && isLoggedIn) {
      window.location.replace('/analyze')
    }
  }, [isAuthReady, isLoggedIn])

  if (isAuthReady && isLoggedIn) {
    return null
  }

  return (
    <AuthScreen
      mode="login"
      title="콘텐츠 기획 AI"
      subtitle="AI와 함께하는 콘텐츠 전략 설계"
      primaryLabel="로그인"
      secondaryHref="/signup"
      secondaryLabel="회원가입"
      onSubmit={login}
    />
  )
}

function SignupScreen() {
  const { signup, isLoggedIn, isAuthReady } = useAppState()

  useEffect(() => {
    if (isAuthReady && isLoggedIn) {
      window.location.replace('/analyze')
    }
  }, [isAuthReady, isLoggedIn])

  if (isAuthReady && isLoggedIn) {
    return null
  }

  return (
    <AuthScreen
      mode="signup"
      title="콘텐츠 기획 AI"
      subtitle="AI와 함께할 새 워크스페이스를 만들어보세요"
      primaryLabel="회원가입"
      secondaryHref="/login"
      secondaryLabel="로그인"
      onSubmit={signup}
    />
  )
}

function MainPanel() {
  const { currentStep, viewTransition, isEditorEntering, isResultEntering } = useAppState()

  if (currentStep === 'upload' || currentStep === 'analyzing') {
    return <UploadSection />
  }

  if (currentStep === 'result' || currentStep === 'editor') {
    return (
      <ResultCards
        transitioning={viewTransition === 'to-editor' || viewTransition === 'to-result'}
        entering={isResultEntering || isEditorEntering}
      />
    )
  }

  return <Editor transitioning={false} entering={false} />
}

function StudioShell() {
  const { isVersionModalOpen, currentStep, viewTransition, toast, isLoggedIn, isAuthReady } = useAppState()

  if (!isAuthReady) {
    return null
  }

  if (!isLoggedIn) {
    return <LoginScreen />
  }

  return (
    <AppLayout
      sidebar={<Sidebar />}
      main={<MainPanel />}
      panel={null}
    >
      {toast ? (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[60] -translate-x-1/2">
          <div className="min-w-[280px] rounded-[22px] border border-[#374151] bg-[#12151D]/95 px-5 py-4 text-center text-sm font-medium text-[#E5E7EB] shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            {toast.message}
          </div>
        </div>
      ) : null}
      {isVersionModalOpen ? <VersionModal /> : null}
    </AppLayout>
  )
}

function StudioApp() {
  return <StudioShell />
}

function SettingsShell() {
  const { isLoggedIn, isAuthReady } = useAppState()

  if (!isAuthReady) {
    return null
  }

  if (!isLoggedIn) {
    return <LoginScreen />
  }

  return <SettingsPage onBack={() => window.location.assign('/analyze')} />
}

function SettingsApp() {
  return <SettingsShell />
}

function LoginApp() {
  return <LoginScreen />
}

function SignupApp() {
  return <SignupScreen />
}

function IntroApp() {
  return <LandingScreen />
}

function RecommendApp() {
  return <RecommendScreen />
}

export default function App() {
  const pathname = window.location.pathname

  let content = <IntroApp />

  if (pathname.startsWith('/settings')) {
    content = <SettingsApp />
  } else if (pathname.startsWith('/login')) {
    content = <LoginApp />
  } else if (pathname.startsWith('/signup')) {
    content = <SignupApp />
  } else if (pathname.startsWith('/analyze')) {
    content = <StudioApp />
  } else if (pathname.startsWith('/recommend')) {
    content = <RecommendApp />
  }

  return <AppStateProvider>{content}</AppStateProvider>
}
