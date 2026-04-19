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

const RF_CATEGORY_KEYS = [
  'beauty',
  'fashion',
  'self_growth',
  'finance',
  'ai_tech',
  'home_living',
  'cooking',
  'fitness',
  'relationship',
  'daily_life',
  'pet',
  'travel',
  'professional_brand',
]

const RF_STYLE_KEYS = ['informative', 'empathetic', 'problem_solving', 'review', 'storytelling']
const RF_MONETIZATION_KEYS = ['group_buy', 'affiliate', 'ad_collab', 'digital_product', 'consulting', 'service_sale']
const RF_PRODUCTION_KEYS = ['face_on', 'face_partial', 'face_off', 'hand_product', 'screen_recording', 'text_slide', 'voice_over']

const RF_CATEGORY_META = {
  beauty: { label: '뷰티', marketSummary: '글로벌 6,500억 달러 규모, 국내 8조 원대 이상 소비 시장', growthSummary: '산업 인접 기준 연 5%대 성장 추정', conversionRate: 4.8, competition: 62, monetizationSpeed: 82 },
  fashion: { label: '패션', marketSummary: '온라인 패션 거래액 상위권 유지', growthSummary: '마이크로 브랜드 숏폼 유입 확산', conversionRate: 4.2, competition: 66, monetizationSpeed: 76 },
  self_growth: { label: '자기계발', marketSummary: '교육/자기계발 디지털 상품 수요 확대', growthSummary: '문제 해결형 포맷의 LTV가 높음', conversionRate: 3.9, competition: 58, monetizationSpeed: 74 },
  finance: { label: '재테크', marketSummary: '개인 자산관리 관심층 확대로 정보형 수요 증가', growthSummary: '입문자 정리형 포맷의 재방문율 상승', conversionRate: 3.7, competition: 61, monetizationSpeed: 72 },
  ai_tech: { label: 'AI/테크', marketSummary: '자동화/툴 활용 시장이 빠르게 확대', growthSummary: '화면녹화 기반 실전 포맷 효율 상승', conversionRate: 4.1, competition: 55, monetizationSpeed: 79 },
  home_living: { label: '홈/리빙', marketSummary: '살림/정리 카테고리 반복 구매 빈도 높음', growthSummary: '문제 해결형 숏폼의 저장률 우수', conversionRate: 4.5, competition: 57, monetizationSpeed: 80 },
  cooking: { label: '요리', marketSummary: '레시피/주방템 시장은 계절성 수요 강함', growthSummary: '짧은 레시피 비교 포맷 클릭률 우수', conversionRate: 4.4, competition: 59, monetizationSpeed: 78 },
  fitness: { label: '피트니스', marketSummary: '홈트/건강 루틴 시장 수요 지속', growthSummary: '루틴 제시형 콘텐츠 재시청률 높음', conversionRate: 3.8, competition: 64, monetizationSpeed: 71 },
  relationship: { label: '관계/연애', marketSummary: '공감형 카테고리 댓글 밀도 높음', growthSummary: '경험담+해결가이드 결합 포맷 확산', conversionRate: 3.4, competition: 63, monetizationSpeed: 67 },
  daily_life: { label: '일상/브이로그', marketSummary: '광고/브랜디드 협업 친화 카테고리', growthSummary: '캐릭터형 계정 팬덤 축적 시 확장성 높음', conversionRate: 3.3, competition: 69, monetizationSpeed: 65 },
  pet: { label: '반려동물', marketSummary: '반려동물 시장 성장과 제품 추천 전환 강세', growthSummary: '문제 해결형 루틴 콘텐츠 저장률 우수', conversionRate: 4.3, competition: 56, monetizationSpeed: 79 },
  travel: { label: '여행', marketSummary: '경험형 콘텐츠 도달은 강하지만 계절성 존재', growthSummary: '동선 가이드 결합 시 전환 효율 개선', conversionRate: 3.2, competition: 68, monetizationSpeed: 63 },
  professional_brand: { label: '전문직 브랜딩', marketSummary: '전문 서비스/상담형 리드 확보 유리', growthSummary: '신뢰형 전달 시 고단가 전환 가능성 큼', conversionRate: 3.8, competition: 51, monetizationSpeed: 77 },
}

const RF_MONETIZATION_META = {
  group_buy: { label: '공동구매', reason: '반복 구매 제품과 문제 해결형 콘텐츠의 전환 궁합이 높습니다.' },
  affiliate: { label: '어필리에이트', reason: '리뷰형/비교형 콘텐츠에서 클릭-구매 흐름을 빠르게 만들 수 있습니다.' },
  ad_collab: { label: '브랜드 협업/광고', reason: '도달형/스토리형 포맷에서 협업 제안으로 연결하기 좋습니다.' },
  digital_product: { label: '디지털 상품', reason: '정보형 전문성 자산을 전자책/템플릿/강의로 패키징하기 좋습니다.' },
  consulting: { label: '컨설팅', reason: '문제 해결형 포지션이 명확할수록 상담 전환이 유리합니다.' },
  service_sale: { label: '서비스 판매', reason: '코칭/맞춤 서비스형 비즈니스와 연결이 쉽습니다.' },
}

const RF_INSTAGRAM_WHY_NOW = [
  '인스타그램은 단순 SNS를 넘어 검색·추천·구매까지 이어지는 생활형 플랫폼으로 자리잡았고, 국내 사용자도 2025년 대비 약 100만 명 이상 증가하며 성장 중입니다.',
  '릴스 중심 숏폼 구조 덕분에 팔로워가 많지 않아도 노출이 가능해, 초보 계정도 빠르게 테스트하고 기회를 잡을 수 있습니다.',
  '광고 시장 규모가 약 26조 원 수준으로 확대되면서 브랜드 예산이 개인 크리에이터·숏폼으로 이동하고 있어 개인 수익화 기회가 커졌습니다.',
  '지금은 조회수만이 아니라 구매 전환까지 직접 연결되는 구조라 작은 계정도 실제 매출을 만들 가능성이 높습니다.',
]

const RF_CATEGORY_ACTION_BLUEPRINT = {
  beauty: { directions: ['트러블 피부 문제 해결형', '루틴 전후 비교형'], monetization: ['group_buy', 'affiliate'] },
  fashion: { directions: ['체형/상황별 코디 해결형', '가격대별 비교 추천형'], monetization: ['affiliate', 'group_buy'] },
  self_growth: { directions: ['실행 루틴 코칭형', '목표 달성 체크리스트형'], monetization: ['digital_product', 'consulting'] },
  finance: { directions: ['지출/자산관리 구조화형', '초보 투자 원칙 정리형'], monetization: ['digital_product', 'consulting'] },
  ai_tech: { directions: ['직장인 업무 자동화형', 'AI 툴 실전 비교형'], monetization: ['digital_product', 'affiliate'] },
  home_living: { directions: ['생활 문제 즉시 해결형', '정리/청소 루틴 최적화형'], monetization: ['group_buy', 'affiliate'] },
  cooking: { directions: ['10분 실전 레시피형', '상황별 식단 해결형'], monetization: ['group_buy', 'affiliate'] },
  fitness: { directions: ['초보 루틴 점진 개선형', '목표형 식단/운동 가이드형'], monetization: ['digital_product', 'affiliate'] },
  relationship: { directions: ['공감 기반 문제 해결형', '상황별 대화 가이드형'], monetization: ['consulting', 'digital_product'] },
  daily_life: { directions: ['현실 공감 스토리형', '일상 효율 개선형'], monetization: ['ad_collab', 'affiliate'] },
  pet: { directions: ['반려 문제 해결 루틴형', '보호자 실사용 리뷰형'], monetization: ['group_buy', 'affiliate'] },
  travel: { directions: ['예산 최적화 동선형', '상황별 여행 체크리스트형'], monetization: ['affiliate', 'ad_collab'] },
  professional_brand: { directions: ['전문직 신뢰 확보형', '사례 기반 리드 전환형'], monetization: ['consulting', 'service_sale'] },
}

const RF_CATEGORY_MARKET_NARRATIVE = {
  beauty: `뷰티 카테고리는 인스타그램 수익화 관점에서 가장 검증된 분야 중 하나입니다. 글로벌 약 6,500억 달러, 국내 약 8조 원 이상의 시장 규모를 형성하고 있으며, 스킨케어·색조를 중심으로 꾸준한 성장세가 이어지고 있습니다.

인스타그램에서는 제품 자체보다 사용감, 전후 변화, 루틴 제안이 콘텐츠로 전환되기 쉬워 초기 계정도 빠르게 반응을 얻기 유리합니다. 특히 피부 고민 해결, 성분 비교, 실제 후기 신뢰도가 전환에 직결되어 작은 계정도 설득력 있는 콘텐츠만 있으면 구매 연결 가능성이 높습니다.

또한 선크림·클렌징·앰플 같은 반복 구매 제품군이 많아 공동구매와 제휴 마케팅 전환 구조가 빠르게 형성됩니다.`,
  fashion: `패션 카테고리는 인스타그램과 가장 자연스럽게 맞닿아 있는 분야로, 대중성·확장성·수익화 가능성을 동시에 갖춘 시장입니다. 글로벌 약 1조 5천억 달러, 국내 약 50조 원 규모이며 트렌드 순환 덕분에 꾸준한 수요가 유지됩니다.

인스타그램에서는 체형 보정, 출근룩, 가격대별 코디처럼 실용 기준이 분명할수록 저장과 공유가 활발하게 발생합니다. 팔로워 규모가 크지 않아도 구매 의사결정에 직접 도움이 되는 포맷이면 전환으로 연결되기 쉽습니다.

경쟁이 높은 만큼 단순 코디보다 체형·예산·직업군·상황 같은 니치 기준을 선명하게 잡을수록 빠른 차별화가 가능합니다.`,
  self_growth: `자기계발 카테고리는 단순 조회를 넘어 지식·프레임 자체를 판매할 수 있는 고부가가치 시장입니다. 글로벌 약 4,200억 달러, 국내 약 6조 원 규모이며 연평균 약 9.1% 성장으로 확장성이 큽니다.

인스타그램에서는 긴 강의보다 짧고 바로 적용 가능한 인사이트 콘텐츠가 강하게 작동합니다. 이 분야는 저장·재시청·링크 클릭 같은 행동 지표가 높아 실제 수익화로 이어지기 좋은 특징이 있습니다.

전자책·템플릿·강의·코칭으로 확장하기 쉬워 팔로워 수가 크지 않아도 문제 해결 능력과 구조화된 콘텐츠만 갖추면 높은 객단가 매출을 만들 수 있습니다.`,
  finance: `재테크 카테고리는 높은 관심도와 실질적 수익 연결 가능성을 동시에 갖춘 분야입니다. 글로벌 약 4,500억 달러, 국내 약 15조 원 규모이며 연평균 약 12.5% 성장률을 보입니다.

인스타그램에서는 복잡한 이론보다 지출 구조, 관리 순서, 체크리스트처럼 즉시 실행 가능한 정보형 콘텐츠가 높은 반응을 얻습니다. 저장과 재방문이 높아 신뢰 형성에 유리하고, 신뢰는 곧 전환으로 이어집니다.

자산관리 앱·금융 플랫폼 제휴, 예산 템플릿·입문 가이드 판매, 상담형 전환까지 확장 가능한 구조라 중장기 수익화에도 강점이 있습니다.`,
  ai_tech: `AI/테크 카테고리는 2026년 기준 가장 빠르게 성장하는 지식형 시장 중 하나입니다. 글로벌 약 1,200억 달러, 국내 약 2조 원 규모이며 연평균 약 31% 성장으로 상승 탄력이 매우 큽니다.

인스타그램에서는 이론보다 실전 활용 사례가 더 잘 작동합니다. 직장인 자동화, 콘텐츠 제작, 업무 효율화처럼 구체적인 사용 장면을 보여주면 반응과 저장을 동시에 확보하기 쉽습니다.

화면 녹화 중심으로 운영할 수 있어 얼굴 비노출 계정도 진입이 쉽고, 프롬프트 템플릿·자동화 상품·강의·컨설팅으로 고부가가치 확장이 가능합니다.`,
  home_living: `홈/리빙 카테고리는 화려함보다 실전 전환이 강한 시장입니다. 글로벌 약 2,800억 달러, 국내 약 12조 원 규모이며 연평균 약 5.2%의 안정적인 성장세를 보입니다.

정리 전후·청소 전후처럼 눈에 보이는 변화가 즉각적 만족을 만들어 저장·공유가 활발합니다. 얼굴 노출 없이 손·공간·도구 중심으로도 충분히 제작 가능해 운영 부담이 낮습니다.

수납용품·청소도구·주방용품 등 반복 구매 제품이 많고 시즌 수요도 뚜렷해 공동구매·제휴 전환이 안정적으로 형성됩니다.`,
  cooking: `요리 카테고리는 일상성과 소비가 직접 연결되는 분야입니다. 글로벌 약 4,000억 달러, 국내 약 10조 원 규모이며 연평균 약 7.4% 성장으로 안정적인 수요가 유지됩니다.

완성 비주얼과 짧은 조리 과정을 결합한 숏폼은 도달과 저장을 동시에 만들기 좋습니다. 특히 재료가 적고 따라 하기 쉬운 레시피일수록 재시청과 공유가 높아집니다.

식재료·밀키트·주방도구 등 연계 제품군이 넓어 공동구매·제휴 전환에 유리하고, 레시피북·식단표 같은 디지털 확장도 가능합니다.`,
  fitness: `피트니스 카테고리는 루틴 기반 재방문이 강한 분야입니다. 운동·식단은 단발성보다 반복 소비 성격이 강해, 계정 충성도와 장기 전환을 만들기 좋습니다.

인스타그램에서는 전후 비교, 초보 루틴, 자세 교정, 식단 실전 팁처럼 즉시 적용 가능한 콘텐츠가 저장률을 끌어올립니다. 특히 짧은 체크리스트형 포맷은 입문자 유입에 강합니다.

보충제·홈트 도구·디지털 루틴 플랜·코칭 상품까지 수익 경로를 다층적으로 설계할 수 있어 LTV 관점에서도 경쟁력이 있습니다.`,
  relationship: `관계/연애 카테고리는 공감 밀도가 높은 커뮤니티형 시장입니다. 댓글·DM 기반 상호작용이 활발해 신뢰를 빠르게 쌓기 좋고, 상담형 전환으로 이어지기 유리합니다.

인스타그램에서는 상황별 대화법, 갈등 해결 프레임, 감정 정리 루틴처럼 현실 문제를 바로 다루는 포맷이 높은 체류와 저장을 만듭니다. 스토리텔링과 문제 해결형을 함께 쓰면 반응 폭이 커집니다.

디지털 가이드·체크리스트·코칭형 상품으로 확장 가능해 조회수 중심이 아니라 신뢰 중심 수익화를 노리기 좋은 분야입니다.`,
  daily_life: `일상/브이로그 카테고리는 도달 확장과 팬덤 축적에 강한 분야입니다. 캐릭터성과 루틴이 쌓일수록 협업·광고 연결 가능성이 커지는 구조입니다.

인스타그램에서 일상 콘텐츠는 정보와 공감을 섞을수록 반응이 좋아집니다. 단순 기록보다 효율 팁, 경험 기반 인사이트를 함께 제시하면 저장·재방문이 빠르게 올라갑니다.

브랜드 협업, 제휴, 자체 상품 연결까지 단계적으로 확장하기 쉬워 초기엔 성장, 중기엔 수익화로 전환하는 운영 전략에 적합합니다.`,
  pet: `반려동물 카테고리는 감성 도달력과 커머스 전환이 동시에 강한 분야입니다. 글로벌 약 3,000억 달러, 국내 약 4~6조 원 규모이며 연평균 약 6.7% 성장 중입니다.

보호자들은 실사용 후기와 경험 기반 정보를 중요하게 보기 때문에 팔로워 규모가 작아도 공감과 신뢰 중심 콘텐츠는 높은 반응과 전환으로 이어질 수 있습니다.

사료·간식·위생용품 같은 반복 구매 제품군이 중심이라 공동구매·제휴 구조가 강하고, 관리 가이드·체크리스트 같은 지식형 확장도 가능합니다.`,
  travel: `여행 카테고리는 감성 도달과 제휴 수익화를 동시에 노릴 수 있는 시장입니다. 글로벌 약 9,500억 달러, 국내 약 25조 원 규모이며 연평균 약 10.2% 성장세를 보입니다.

풍경 위주의 콘텐츠보다 일정·예산·동선 정보를 결합한 실용형 포맷이 저장과 클릭 전환을 더 잘 만듭니다. 특히 초보 여행자용 체크리스트형 콘텐츠가 반응이 높습니다.

항공·숙소·액티비티·보험 등 제휴 포인트가 다양해 어필리에이트 확장성이 크고, 일정표·가이드맵 같은 디지털 상품 연결도 용이합니다.`,
  professional_brand: `전문직 브랜딩 카테고리는 조회수보다 신뢰와 매출 전환에 강한 고단가 시장입니다. 글로벌 약 1,500억 달러, 국내 약 7조 원 규모이며 연평균 약 11.8% 성장 흐름을 보입니다.

인스타그램에서는 사례 기반 문제 해결, 자주 묻는 질문, 숫자 중심 성과 설명 포맷이 상담 문의로 이어지기 쉽습니다. 적은 팔로워여도 타깃 정확도가 높으면 성과가 나오는 구조입니다.

컨설팅·교육·대행·리드 수수료 등 고부가가치 수익모델로 확장 가능해 장기 브랜딩과 매출 전환을 동시에 만들기 좋습니다.`,
}

function rfStyleLabel(styleKey) {
  return {
    informative: '정보형',
    empathetic: '공감형',
    problem_solving: '문제 해결형',
    review: '리뷰형',
    storytelling: '스토리형',
  }[styleKey] || '정보형'
}

function rfProductionLabel(productionKey) {
  return {
    face_on: '얼굴 노출 진행',
    face_partial: '부분 노출 진행',
    face_off: '비노출 진행',
    hand_product: '손/제품 시연',
    screen_recording: '화면 녹화',
    text_slide: '텍스트 슬라이드',
    voice_over: '보이스오버',
  }[productionKey] || '부분 노출 진행'
}

function rfBuildComprehensiveSummary(result, selectedCategory) {
  if (!result || !selectedCategory) return ''
  const style = rfStyleLabel(result.dominantStyleKey)
  const production = rfProductionLabel(result.dominantProductionKey)
  const second = result.topCategories?.[1]?.label
  const third = result.topCategories?.[2]?.label
  const compareText = [second, third].filter(Boolean).join(', ')

  return [
    `응답 패턴을 종합하면 현재 성향은 ${style} 전달을 중심으로 ${production} 방식에서 강점이 뚜렷합니다.`,
    `그 결과 ${selectedCategory.label} 카테고리가 1순위로 도출됐고, 실행 우선순위는 ${selectedCategory.label}${compareText ? ` → ${compareText}` : ''} 순입니다.`,
    `즉 지금은 범위를 넓히기보다 1순위 카테고리에 집중해 초기 반응과 전환 데이터를 먼저 확보하는 전략이 가장 유리합니다.`,
  ].join(' ')
}

const RF_LIKERT_OPTIONS = [
  { value: 2, label: '매우 그렇다' },
  { value: 1, label: '그렇다' },
  { value: 0, label: '보통이다' },
  { value: -1, label: '아니다' },
  { value: -2, label: '매우 아니다' },
]

const RF_QUESTIONS = [
  { code: 'Q1_INFO_ORGANIZE', type: 'likert', title: '나는 정보를 쉽게 정리해서 전달하는 편이다.', subtitle: '정보형 전달력과 문제해결형 기초 성향을 봅니다.', effects: { styleScores: { informative: 2, problem_solving: 1 }, categoryScores: { self_growth: 1, ai_tech: 1, finance: 1, professional_brand: 1 } } },
  { code: 'Q2_EMPATHY', type: 'likert', title: '나는 감정이나 공감 포인트를 말로 풀어내는 편이다.', subtitle: '공감형/스토리형 콘텐츠 적합도를 측정합니다.', effects: { styleScores: { empathetic: 2, storytelling: 1 }, categoryScores: { relationship: 2, daily_life: 1, travel: 1 } } },
  { code: 'Q3_PROBLEM_SOLVING', type: 'likert', title: '나는 다른 사람의 문제를 듣고 해결책을 제시하는 게 익숙하다.', subtitle: '문제 해결형 콘텐츠와 컨설팅형 수익 적합도를 봅니다.', effects: { styleScores: { problem_solving: 2 }, monetizationScores: { consulting: 1 }, categoryScores: { self_growth: 1, finance: 1, professional_brand: 1, fitness: 1, home_living: 1 } } },
  { code: 'Q4_REVIEW_PREFERENCE', type: 'likert', title: '제품이나 도구를 직접 써보고 비교해보는 걸 좋아한다.', subtitle: '리뷰형 콘텐츠와 제품 전환 구조 적합도를 봅니다.', effects: { styleScores: { review: 2 }, monetizationScores: { affiliate: 1, group_buy: 1 }, categoryScores: { beauty: 1, fashion: 1, ai_tech: 1, home_living: 1, pet: 1, fitness: 1, cooking: 1 } } },
  { code: 'Q5_FACE_COMFORT', type: 'likert', title: '카메라 앞에서 내 얼굴이나 목소리를 드러내는 게 편하다.', subtitle: '노출 성향과 제작 방식 추천에 반영됩니다.', effects: { productionScores: { face_on: 2, voice_over: 1 } }, special: 'face_comfort' },
  { code: 'Q6_DEEP_TOPIC', type: 'likert', title: '한 가지 주제를 반복해서 깊게 파는 게 편하다.', subtitle: '지속형 콘텐츠 운영 적합도를 측정합니다.', effects: { styleScores: { informative: 1, problem_solving: 1 }, monetizationScores: { digital_product: 1, consulting: 1 }, categoryScores: { self_growth: 1, ai_tech: 1, finance: 1, professional_brand: 1, fitness: 1 } } },
  {
    code: 'Q7_IMPRESSION',
    type: 'single_choice',
    title: '사람들이 내 콘텐츠를 보고 가장 먼저 느꼈으면 하는 건?',
    subtitle: '콘텐츠 첫인상 목표를 정합니다.',
    options: [
      { code: 'USEFUL', label: '유용하다', description: '정리되어 있고 바로 써먹을 수 있다', effects: { styleScores: { informative: 4, problem_solving: 3 }, categoryScores: { self_growth: 2, ai_tech: 2, finance: 2, home_living: 1, fitness: 1 } } },
      { code: 'TRUST', label: '믿음 간다', description: '검증된 기준과 경험이 느껴진다', effects: { styleScores: { problem_solving: 3, review: 2 }, categoryScores: { beauty: 2, professional_brand: 2, finance: 1, pet: 1, cooking: 1 } } },
      { code: 'FUN', label: '재밌다 / 표현력이 좋다', description: '몰입감 있고 계속 보게 된다', effects: { styleScores: { storytelling: 3, empathetic: 2 }, categoryScores: { daily_life: 2, relationship: 2, fashion: 1, travel: 1 } } },
    ],
  },
  {
    code: 'Q8_FAST_MONETIZATION',
    type: 'single_choice',
    title: '가장 빨리 수익으로 연결하고 싶은 방식은?',
    subtitle: '초기 수익화 루트 가중치를 강하게 반영합니다.',
    options: [
      { code: 'PRODUCT', label: '제품 추천/판매', description: '리뷰/추천 기반 전환', effects: { monetizationScores: { group_buy: 5, affiliate: 4 }, categoryScores: { beauty: 2, fashion: 2, home_living: 2, cooking: 2, pet: 2, fitness: 1 } } },
      { code: 'KNOWLEDGE', label: '지식/노하우 판매', description: '전자책/강의/컨설팅', effects: { monetizationScores: { digital_product: 5, consulting: 3 }, categoryScores: { self_growth: 2, ai_tech: 2, finance: 2, professional_brand: 2 } } },
      { code: 'BRAND_COLLAB', label: '광고/브랜드 협업', description: '도달 기반 협업', effects: { monetizationScores: { ad_collab: 5 }, categoryScores: { daily_life: 2, beauty: 1, fashion: 2, travel: 2, relationship: 1 } } },
    ],
  },
  {
    code: 'Q9_PRODUCTION_STRENGTH',
    type: 'single_choice',
    title: '가장 자신 있는 제작 방식은?',
    subtitle: '실행 난이도와 꾸준함을 동시에 반영합니다.',
    options: [
      { code: 'HAND_PRODUCT', label: '손/제품 시연', description: '제품 보여주며 설명하기', effects: { productionScores: { hand_product: 4 }, styleScores: { review: 2 }, categoryScores: { beauty: 2, cooking: 2, home_living: 2, pet: 1, fitness: 1 } } },
      { code: 'SCREEN_RECORDING', label: '화면 녹화/자료 정리', description: '툴 사용법, 정보형 정리', effects: { productionScores: { screen_recording: 4, text_slide: 1 }, styleScores: { informative: 2 }, categoryScores: { ai_tech: 3, finance: 2, professional_brand: 2 } } },
      { code: 'TALK_STORY', label: '말하기/경험 공유', description: '스토리텔링 중심 진행', effects: { productionScores: { face_on: 2, voice_over: 2 }, styleScores: { storytelling: 2, empathetic: 2 }, categoryScores: { daily_life: 2, self_growth: 1, relationship: 1, travel: 1 } } },
    ],
  },
  {
    code: 'Q10_QUARTER_GOAL',
    type: 'single_choice',
    title: '초기 3개월 목표에 가장 가까운 건?',
    subtitle: '성장 우선순위를 최종 고정합니다.',
    options: [
      { code: 'FIRST_REVENUE', label: '빠르게 첫 매출 만들기', description: '전환 중심 실험 우선', effects: { monetizationScores: { group_buy: 3, affiliate: 3 }, styleScores: { review: 2 }, categoryScores: { beauty: 1, home_living: 1, pet: 1, cooking: 1, fitness: 1 } } },
      { code: 'POSITIONING', label: '전문성 포지션 만들기', description: '신뢰 기반 브랜딩 축적', effects: { monetizationScores: { digital_product: 3, consulting: 2 }, styleScores: { informative: 2 }, categoryScores: { self_growth: 2, ai_tech: 2, finance: 2, professional_brand: 2 } } },
      { code: 'REACH_SCALE', label: '팔로워/도달 빠르게 키우기', description: '조회수/반응 지표 우선', effects: { monetizationScores: { ad_collab: 2 }, styleScores: { storytelling: 2, empathetic: 2 }, categoryScores: { daily_life: 2, fashion: 1, travel: 1 } } },
    ],
  },
  {
    code: 'Q11_FITNESS_FOCUS',
    type: 'single_choice',
    title: '운동/건강 콘텐츠를 만든다면 가장 자신 있는 포맷은?',
    subtitle: '피트니스 적합도를 별도 분리합니다.',
    options: [
      { code: 'FITNESS_ROUTINE', label: '초보 루틴 설계/체크형', description: '운동 순서, 루틴, 습관화 중심', effects: { categoryScores: { fitness: 4, self_growth: 1 }, styleScores: { problem_solving: 2 }, monetizationScores: { digital_product: 1 } } },
      { code: 'FITNESS_FORM', label: '자세 교정/문제 해결형', description: '실수 교정과 개선 중심', effects: { categoryScores: { fitness: 4 }, styleScores: { informative: 1, problem_solving: 2 }, monetizationScores: { consulting: 1 } } },
      { code: 'FITNESS_NOPE', label: '운동/건강은 비중 낮게', description: '다른 카테고리에 집중', effects: { categoryScores: { daily_life: 1, relationship: 1 } } },
    ],
  },
  {
    code: 'Q12_TRAVEL_FOCUS',
    type: 'single_choice',
    title: '여행 콘텐츠라면 어떤 강점이 더 크나요?',
    subtitle: '여행 카테고리 전용 가중치를 분리합니다.',
    options: [
      { code: 'TRAVEL_ROUTE', label: '동선/예산 최적화 정보', description: '일정·비용·루트 설계', effects: { categoryScores: { travel: 4 }, styleScores: { informative: 2 }, monetizationScores: { affiliate: 1 } } },
      { code: 'TRAVEL_STORY', label: '경험/감성 스토리 전달', description: '분위기 + 공감형 콘텐츠', effects: { categoryScores: { travel: 3, daily_life: 1 }, styleScores: { storytelling: 2, empathetic: 1 }, monetizationScores: { ad_collab: 1 } } },
      { code: 'TRAVEL_NOPE', label: '여행은 우선순위 낮음', description: '다른 카테고리에 집중', effects: { categoryScores: { self_growth: 1, home_living: 1 } } },
    ],
  },
  {
    code: 'Q13_PET_FOCUS',
    type: 'single_choice',
    title: '반려동물 콘텐츠라면 어떤 쪽이 더 맞나요?',
    subtitle: '반려동물 카테고리 적합도를 분리합니다.',
    options: [
      { code: 'PET_PROBLEM', label: '행동/건강 문제 해결형', description: '실전 팁·루틴 중심', effects: { categoryScores: { pet: 4 }, styleScores: { problem_solving: 2 }, monetizationScores: { group_buy: 1, affiliate: 1 } } },
      { code: 'PET_REVIEW', label: '사료/간식/용품 리뷰형', description: '실사용 후기·비교형', effects: { categoryScores: { pet: 4 }, styleScores: { review: 2 }, monetizationScores: { group_buy: 1, affiliate: 1 } } },
      { code: 'PET_NOPE', label: '반려동물은 우선순위 낮음', description: '다른 카테고리에 집중', effects: { categoryScores: { fashion: 1, relationship: 1 } } },
    ],
  },
  {
    code: 'Q14_RELATIONSHIP_FOCUS',
    type: 'single_choice',
    title: '관계/연애 콘텐츠라면 어떤 강점이 더 큰가요?',
    subtitle: '관계/연애 카테고리 적합도를 분리합니다.',
    options: [
      { code: 'RELATIONSHIP_GUIDE', label: '상황별 대화/해결 가이드', description: '문제 해결 중심', effects: { categoryScores: { relationship: 4 }, styleScores: { empathetic: 1, problem_solving: 2 }, monetizationScores: { consulting: 1 } } },
      { code: 'RELATIONSHIP_STORY', label: '경험/공감 스토리형', description: '공감·몰입 중심', effects: { categoryScores: { relationship: 4, daily_life: 1 }, styleScores: { storytelling: 2, empathetic: 2 }, monetizationScores: { digital_product: 1 } } },
      { code: 'RELATIONSHIP_NOPE', label: '관계/연애는 우선순위 낮음', description: '다른 카테고리에 집중', effects: { categoryScores: { ai_tech: 1, professional_brand: 1 } } },
    ],
  },
  { code: 'Q15_FREQUENT_QUESTION', type: 'free_text', title: '사람들이 나한테 자주 묻는 질문은?', subtitle: '키워드 기반으로 카테고리/콘텐츠 타입을 미세 보정합니다.', placeholder: '예: 피부 뭐 써요? / 돈 관리는 어떻게 해요? / AI 자동화 어떻게 시작해요?' },
  { code: 'Q16_PAY_50K', type: 'free_text', title: '지금 당장 5만원 받고 해결해줄 수 있는 것은?', subtitle: '수익 모델과 카테고리를 상위 후보 내에서 보정합니다.', placeholder: '예: 트러블 피부 루틴 정리 / AI 업무 자동화 템플릿 / 살림 동선 체크리스트' },
]

function rfEmptyMap(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {})
}

function rfCreateScores() {
  return {
    categoryScores: rfEmptyMap(RF_CATEGORY_KEYS),
    styleScores: rfEmptyMap(RF_STYLE_KEYS),
    monetizationScores: rfEmptyMap(RF_MONETIZATION_KEYS),
    productionScores: rfEmptyMap(RF_PRODUCTION_KEYS),
  }
}

function rfCloneScores(scores) {
  return {
    categoryScores: { ...scores.categoryScores },
    styleScores: { ...scores.styleScores },
    monetizationScores: { ...scores.monetizationScores },
    productionScores: { ...scores.productionScores },
  }
}

function rfApplyPatch(scores, patch, factor = 1) {
  if (!patch) return
  ;['categoryScores', 'styleScores', 'monetizationScores', 'productionScores'].forEach((group) => {
    const groupPatch = patch[group]
    if (!groupPatch) return
    Object.entries(groupPatch).forEach(([key, value]) => {
      scores[group][key] = (scores[group][key] || 0) + value * factor
    })
  })
}

function rfObjectiveScore(answerMap) {
  const raw = rfCreateScores()
  RF_QUESTIONS.forEach((question) => {
    const answer = answerMap[question.code]
    if (!answer) return
    if (question.type === 'likert') {
      const value = Number(answer.value || 0)
      rfApplyPatch(raw, question.effects, value)
      if (question.special === 'face_comfort' && value <= -1) {
        raw.productionScores.face_off += Math.abs(value) * 2
        ;['ai_tech', 'finance', 'home_living', 'cooking', 'professional_brand'].forEach((key) => {
          raw.categoryScores[key] += 1
        })
      }
    }
    if (question.type === 'single_choice') {
      const option = question.options.find((it) => it.code === answer.optionCode)
      if (option) rfApplyPatch(raw, option.effects, 1)
    }
  })
  return raw
}

function rfFreeTextAdjust(rawScores, answerMap) {
  const adjusted = rfCloneScores(rawScores)
  const notes = []
  const baseTopCategoryKeys = new Set(rfTopEntries(rawScores.categoryScores, 3).map(([key]) => key))
  const boostCategoryInTop3 = (key, amount, note) => {
    if (!baseTopCategoryKeys.has(key)) return
    adjusted.categoryScores[key] += amount
    if (note) notes.push(note)
  }

  const text = `${answerMap.Q15_FREQUENT_QUESTION?.text || ''}\n${answerMap.Q16_PAY_50K?.text || ''}`.toLowerCase()
  const hasAny = (keywords) => keywords.some((word) => text.includes(word))

  if (hasAny(['피부', '트러블', '화장품', '메이크업', '올리브영'])) {
    boostCategoryInTop3('beauty', 3, '뷰티 키워드 보정')
    adjusted.styleScores.review += 1
    adjusted.monetizationScores.group_buy += 1
    adjusted.monetizationScores.affiliate += 1
  }
  if (hasAny(['정리', '수납', '청소', '주방', '살림'])) {
    boostCategoryInTop3('home_living', 3, '리빙 키워드 보정')
    adjusted.styleScores.problem_solving += 1
    adjusted.monetizationScores.group_buy += 1
  }
  if (hasAny(['ai', '자동화', '업무', '챗gpt', '프롬프트', 'gpt'])) {
    boostCategoryInTop3('ai_tech', 3, 'AI/자동화 키워드 보정')
    adjusted.styleScores.informative += 1
    adjusted.monetizationScores.digital_product += 2
    adjusted.monetizationScores.affiliate += 1
  }
  if (hasAny(['재무', 'etf', '월급', '지출', '가계부', '투자'])) {
    boostCategoryInTop3('finance', 3, '재무 키워드 보정')
    adjusted.styleScores.informative += 1
    adjusted.monetizationScores.digital_product += 1
    adjusted.monetizationScores.consulting += 1
  }
  if (hasAny(['운동', '헬스', '다이어트', '근력', '홈트', '체지방', '식단'])) {
    boostCategoryInTop3('fitness', 3, '피트니스 키워드 보정')
    adjusted.styleScores.problem_solving += 1
    adjusted.monetizationScores.digital_product += 1
  }
  if (hasAny(['여행', '항공', '숙소', '호텔', '동선', '투어', '예산'])) {
    boostCategoryInTop3('travel', 3, '여행 키워드 보정')
    adjusted.styleScores.storytelling += 1
    adjusted.monetizationScores.affiliate += 1
    adjusted.monetizationScores.ad_collab += 1
  }
  if (hasAny(['반려', '강아지', '고양이', '집사', '사료', '산책', '훈련'])) {
    boostCategoryInTop3('pet', 3, '반려동물 키워드 보정')
    adjusted.styleScores.review += 1
    adjusted.monetizationScores.group_buy += 1
    adjusted.monetizationScores.affiliate += 1
  }
  if (hasAny(['연애', '썸', '이별', '커플', '대화', '갈등', '관계'])) {
    boostCategoryInTop3('relationship', 3, '관계/연애 키워드 보정')
    adjusted.styleScores.empathetic += 1
    adjusted.monetizationScores.consulting += 1
  }
  if (hasAny(['컨설팅', '코칭', '상담', '진단', '멘토링'])) {
    adjusted.monetizationScores.consulting += 2
    boostCategoryInTop3('professional_brand', 2, '상담/코칭 키워드 보정')
  }

  return { adjusted, notes }
}

function rfTopEntries(scoreMap, count) {
  return Object.entries(scoreMap).sort((a, b) => b[1] - a[1]).slice(0, count)
}

function rfBuildActionPlanForCategory(categoryKey, categoryLabel, styleKey, productionKey, monetizationScores) {
  const styleLabel = rfStyleLabel(styleKey)
  const prodLabel = rfProductionLabel(productionKey)
  const blueprint = RF_CATEGORY_ACTION_BLUEPRINT[categoryKey] || {
    directions: [`${categoryLabel} ${styleLabel} 실행형`, `${categoryLabel} 문제 해결형`],
    monetization: [],
  }

  const directions = blueprint.directions.map((label) => ({
    label,
    reason: `${styleLabel} 톤과 ${prodLabel} 방식이 ${categoryLabel} 카테고리 전환 구조에 적합합니다.`,
  }))

  const fallbackMonetization = rfTopEntries(monetizationScores, 3).map(([key]) => key)
  const monetizationKeys = [...new Set([...blueprint.monetization, ...fallbackMonetization])].slice(0, 2)
  const monetizationRoutes = monetizationKeys.map((key) => ({
    key,
    label: RF_MONETIZATION_META[key]?.label || key,
    reason: RF_MONETIZATION_META[key]?.reason || '현재 성향과 연결 가능한 수익화 방식입니다.',
  }))

  return { directions, monetizationRoutes }
}

function rfBuildTitles(topCategoryKey) {
  const map = {
    beauty: ['이거 몰라서 피부 계속 뒤집어지는 거임', '광고 아니고 진짜 재구매한 이유', '모공 부각 심한 날엔 이 조합만 씀', '트러블 날 때 이 순서부터 바꿔야 함', '화장 안 뜨게 하려면 이거부터 바꿔'],
    ai_tech: ['이거 하나로 업무시간 2시간 줄였습니다', '챗GPT 쓸 때 이 프롬프트부터 바꾸세요', '자동화 초보는 이 순서로 시작하면 됩니다', 'AI툴 3개 비교해보고 남긴 결론', '실무에서 바로 먹히는 자동화 루틴 공개'],
    home_living: ['집안일 시간 줄이려면 이 동선부터 바꿔요', '정리 못하는 사람도 이 규칙이면 됩니다', '주방 정리 이거 하나로 반은 끝나요', '살림템 사기 전에 이 체크부터 하세요', '매일 지치는 집안일, 이 방식이 제일 빨랐어요'],
    finance: ['돈이 안 모이는 사람은 이 순서부터 틀렸어요', '월급 관리, 이 구조로 바꾸니 바로 달라졌어요', 'ETF 초보는 이 실수부터 막아야 합니다', '가계부 오래 못 가는 이유, 딱 하나입니다', '재테크 시작 전에 이 체크리스트 먼저 보세요'],
    professional_brand: ['전문직 계정, 조회수보다 이게 먼저입니다', '문의가 늘어나는 프로필 구조는 따로 있습니다', '상담 전환되는 콘텐츠는 이렇게 다릅니다', '회사홍보 안 먹히는 이유, 포지션부터 틀렸습니다', '신뢰를 쌓는 30초 오프닝 공식'],
    fashion: ['코디가 촌스러워 보이는 진짜 이유', '체형별로 이 비율만 바꿔도 달라집니다', '출근룩 실패 줄이는 3가지 기준', '가성비 옷도 고급져 보이는 조합', '쇼핑 전에 이 체크부터 하세요'],
    pet: ['반려견 문제행동, 이 루틴부터 바꿔보세요', '사료 바꿀 때 꼭 확인해야 할 기준', '초보 집사가 가장 많이 놓치는 포인트', '반려동물 간식, 이건 꼭 피하세요', '병원 가기 전 집에서 확인할 체크리스트'],
    cooking: ['요리 초보가 실패하는 이유, 순서가 틀렸어요', '10분 저녁, 이 조합이면 충분합니다', '자취생 식비 줄이는 레시피 루틴', '다이어트 식단, 맛없게 먹지 마세요', '주방 동선만 바꿔도 요리 속도가 달라집니다'],
    travel: ['2박3일 여행, 이 동선이면 손해 안 봅니다', '여행 예산 새는 포인트를 막는 법', '현지에서 후회 안 하는 준비 체크리스트', '항공/숙소 예약 타이밍 이렇게 잡으세요', '초보 여행자일수록 이 루트를 추천합니다'],
    self_growth: ['계획만 세우고 실패하는 이유는 이것', '꾸준함이 안 되는 사람의 공통 패턴', '작심삼일 끊는 1주 루틴 설계법', '목표 달성률을 올리는 체크포인트', '자기계발, 이 순서부터 바꾸면 됩니다'],
    fitness: ['운동 초보가 3주 안에 포기하는 진짜 이유', '체지방보다 먼저 바꿔야 하는 습관 1개', '홈트는 이 루틴부터 시작해야 오래 갑니다', '식단 실패를 줄이는 현실적인 순서', '운동 효과 안 나는 사람은 이 체크부터'],
    relationship: ['연애가 꼬일 때 대부분 여기서 틀립니다', '썸이 끊기는 사람의 대화 패턴', '갈등이 줄어드는 한 문장 습관', '관계가 멀어지기 전에 확인할 신호', '이 대화법 하나로 분위기가 달라집니다'],
    daily_life: ['하루가 계속 꼬이는 사람의 공통 루틴', '일상 생산성 올리는 현실적인 3단계', '시간이 부족한 사람일수록 먼저 바꿀 것', '지치는 일상을 가볍게 만드는 구조', '매일 반복되는 문제, 이 방식이면 줄어듭니다'],
  }
  return map[topCategoryKey] || ['초보가 가장 먼저 바꿔야 할 1가지', '전환 잘 나오는 포맷', '이 순서로 만들면 편합니다', '시작할 때 놓치면 안 되는 포인트', '수익화 속도 올리는 실전 루틴']
}

function rfComputeResult(answerMap) {
  const rawScores = rfObjectiveScore(answerMap)
  const { adjusted, notes } = rfFreeTextAdjust(rawScores, answerMap)

  const topCategories = rfTopEntries(adjusted.categoryScores, 3).map(([key, score]) => {
    const meta = RF_CATEGORY_META[key]
    const growth = Math.round((meta.conversionRate * 8 + meta.monetizationSpeed * 0.55) / 2)
    return { key, label: meta.label, score: Math.round(score), marketSummary: meta.marketSummary, growthSummary: meta.growthSummary, conversionRate: meta.conversionRate, competition: meta.competition, monetizationSpeed: meta.monetizationSpeed, marketGrowth: growth }
  })

  const topStyles = rfTopEntries(adjusted.styleScores, 3)
  const topProductions = rfTopEntries(adjusted.productionScores, 2)
  const visibilityStyle = topProductions[0]?.[0] === 'face_off' ? '비노출 또는 부분 노출 적합' : topProductions[0]?.[0] === 'face_on' ? '얼굴 노출형 진행 적합' : '부분 노출 + 보이스오버 혼합 적합'

  return {
    rawScores,
    adjustedScores: adjusted,
    topCategories,
    dominantStyleKey: topStyles[0]?.[0] || 'informative',
    dominantProductionKey: topProductions[0]?.[0] || 'face_partial',
    personaSummary: {
      visibilityStyle,
      contentStyle: `${rfStyleLabel(topStyles[0]?.[0])} 중심`,
      strength: `${topCategories[0]?.label || '핵심'} 카테고리 설득력`,
    },
    adjustmentNote: notes.length > 0 ? `자연어 보정 적용: ${notes.join(' / ')}` : '자연어 보정 없음',
    sourceNote: '시장성 문구는 업로드된 “인스타그램 13대 버티컬 시장 분석 및 수익화 전략 리포트” 핵심 수치 요약을 기반으로 구성했습니다.',
  }
}

function RecommendScreenV2() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [selectedCategoryKey, setSelectedCategoryKey] = useState(null)
  const isCompleted = currentIndex >= RF_QUESTIONS.length
  const currentQuestion = RF_QUESTIONS[currentIndex]
  const progress = Math.round((currentIndex / RF_QUESTIONS.length) * 100)

  const result = useMemo(() => (isCompleted ? rfComputeResult(answers) : null), [answers, isCompleted])
  const currentText = currentQuestion?.type === 'free_text' ? answers[currentQuestion.code]?.text || '' : ''

  useEffect(() => {
    if (!result?.topCategories?.length) {
      setSelectedCategoryKey(null)
      return
    }
    setSelectedCategoryKey((prev) => prev || result.topCategories[0].key)
  }, [result])

  const selectedCategory = useMemo(() => {
    if (!result?.topCategories?.length) return null
    return result.topCategories.find((item) => item.key === selectedCategoryKey) || result.topCategories[0]
  }, [result, selectedCategoryKey])

  const selectedActionPlan = useMemo(() => {
    if (!result || !selectedCategory) return null
    return rfBuildActionPlanForCategory(
      selectedCategory.key,
      selectedCategory.label,
      result.dominantStyleKey,
      result.dominantProductionKey,
      result.adjustedScores.monetizationScores,
    )
  }, [result, selectedCategory])

  const selectedTitles = useMemo(() => {
    if (!selectedCategory) return []
    return rfBuildTitles(selectedCategory.key)
  }, [selectedCategory])

  const selectedCategoryNarrative = useMemo(() => {
    if (!selectedCategory) return ''
    return RF_CATEGORY_MARKET_NARRATIVE[selectedCategory.key]
      || `${selectedCategory.label} 카테고리는 현재 성향과 시장 흐름 모두에서 유리한 포지션입니다.`
  }, [selectedCategory])

  const comprehensiveSummary = useMemo(() => {
    return rfBuildComprehensiveSummary(result, selectedCategory)
  }, [result, selectedCategory])

  const saveLikert = (code, value) => {
    setAnswers((prev) => ({ ...prev, [code]: { value } }))
    setCurrentIndex((prev) => prev + 1)
  }
  const saveChoice = (code, optionCode) => {
    setAnswers((prev) => ({ ...prev, [code]: { optionCode } }))
    setCurrentIndex((prev) => prev + 1)
  }
  const saveText = (code, text) => {
    setAnswers((prev) => ({ ...prev, [code]: { text } }))
  }
  const restart = () => {
    setAnswers({})
    setCurrentIndex(0)
    setSelectedCategoryKey(null)
  }

  return (
    <main
      className="min-h-screen bg-[#0B0D12] px-6 py-10 text-[#F3F4F6]"
      style={{
        fontFamily: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
        backgroundImage: 'radial-gradient(circle at 15% 15%, rgba(148,163,184,0.16) 0%, rgba(148,163,184,0) 28%), radial-gradient(circle at 85% 18%, rgba(71,85,105,0.18) 0%, rgba(71,85,105,0) 28%), linear-gradient(180deg, #0B0D12 0%, #0F1219 100%)',
      }}
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#D1D5DB]">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4"><path d="M11.67 4.17 5.84 10l5.83 5.83" fill="none" stroke="currentColor" strokeWidth="1.67" strokeLinecap="round" strokeLinejoin="round" /></svg>
            홈으로
          </a>
          <div className="inline-flex rounded-full border border-[#374151] bg-[#12151D] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#E5E7EB]">
            Content Direction Fit
          </div>
        </div>

        {!isCompleted ? (
          <section className="mt-12 grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            <aside className="rounded-[32px] border border-[#2F3543] bg-[#12151D]/95 p-8 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="text-sm font-semibold text-[#CBD5E1]">Q{currentIndex + 1} / {RF_QUESTIONS.length}</div>
              <h1 className="mt-4 text-[34px] font-bold leading-[1.2] tracking-[-0.03em] text-[#F8FAFC]">내 콘텐츠 방향 추천받기</h1>
              <p className="mt-4 text-sm leading-7 text-[#9CA3AF]">{RF_QUESTIONS.length}문항 하이브리드 진단으로 카테고리·콘텐츠 타입·수익 루트를 점수 기반으로 추천합니다.</p>
              <div className="mt-8">
                <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF]"><span>진행률</span><span>{progress}%</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1E2432]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#CBD5E1_0%,#F8FAFC_100%)] transition-all duration-300" style={{ width: `${progress}%` }} /></div>
              </div>
              <div className="mt-8 rounded-2xl border border-[#2F3543] bg-[#171B24] px-4 py-4 text-xs leading-6 text-[#AEB6C5]">
                Q15, Q16은 자연어 보정 질문입니다.
                <br />
                선택형 점수를 뒤집지 않고 상위 후보를 보정하는 방식으로 적용됩니다.
              </div>
            </aside>

            <section className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.38)]">
              <div className="inline-flex rounded-full border border-[#374151] bg-[#171B24] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">
                {currentQuestion.type === 'likert' ? '척도형 질문' : currentQuestion.type === 'single_choice' ? '선택형 질문' : '서술형 질문'}
              </div>
              <h2 className="mt-5 text-[30px] font-bold leading-[1.3] tracking-[-0.03em] text-[#F8FAFC]">{currentQuestion.title}</h2>
              <p className="mt-3 text-base leading-7 text-[#9CA3AF]">{currentQuestion.subtitle}</p>

              {currentQuestion.type === 'likert' && (
                <div className="mt-8 grid gap-3">
                  {RF_LIKERT_OPTIONS.map((option) => (
                    <button key={`${currentQuestion.code}-${option.value}`} type="button" onClick={() => saveLikert(currentQuestion.code, option.value)} className="rounded-2xl border border-[#2F3543] bg-[#171B24] px-5 py-4 text-left text-sm font-semibold text-[#E5E7EB] transition hover:border-[#94A3B8] hover:bg-[#1D2330]">
                      {option.label}
                    </button>
                  ))}
                </div>
              )}

              {currentQuestion.type === 'single_choice' && (
                <div className="mt-8 grid gap-4">
                  {currentQuestion.options.map((option, index) => (
                    <button key={option.code} type="button" onClick={() => saveChoice(currentQuestion.code, option.code)} className="group rounded-[24px] border border-[#2F3543] bg-[#171B24] p-5 text-left transition hover:-translate-y-0.5 hover:border-[#94A3B8] hover:bg-[#1D2330]">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1E2432] text-sm font-bold text-[#E5E7EB]">{String.fromCharCode(65 + index)}</span>
                            <h3 className="text-lg font-bold text-[#F8FAFC]">{option.label}</h3>
                          </div>
                          <p className="mt-3 text-sm text-[#9CA3AF]">{option.description}</p>
                        </div>
                        <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#94A3B8] transition group-hover:text-[#E2E8F0]"><path d="M7.5 4.17 13.33 10 7.5 15.83" fill="none" stroke="currentColor" strokeWidth="1.67" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {currentQuestion.type === 'free_text' && (
                <div className="mt-8">
                  <textarea value={currentText} onChange={(event) => saveText(currentQuestion.code, event.target.value)} placeholder={currentQuestion.placeholder} className="h-44 w-full resize-none rounded-2xl border border-[#374151] bg-[#171B24] px-4 py-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1] placeholder:text-[#6B7280]" />
                  <div className="mt-3 text-xs text-[#9CA3AF]">키워드가 포함되면 카테고리/수익모델 보정이 자동 적용됩니다.</div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button type="button" onClick={() => setCurrentIndex((prev) => prev + 1)} className="inline-flex h-11 items-center justify-center rounded-full border border-[#3A414F] bg-[#12151D] px-5 text-sm font-semibold text-[#CBD5E1] transition hover:bg-[#1D2330]">건너뛰기</button>
                    <button type="button" onClick={() => setCurrentIndex((prev) => prev + 1)} disabled={currentText.trim().length === 0} className="btn-solid-contrast inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">다음으로</button>
                  </div>
                </div>
              )}
            </section>
          </section>
        ) : (
          <section className="mt-12 grid gap-8">
            <div className="rounded-[36px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.38)] md:p-10">
              <div className="inline-flex rounded-full border border-[#374151] bg-[#171B24] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D1D5DB]">Recommendation Result</div>
              <h1 className="mt-5 text-[42px] font-bold leading-[1.15] tracking-[-0.03em] text-[#F8FAFC]">{selectedCategory ? `추천 카테고리: ${selectedCategory.label}` : '추천 결과'}</h1>
              <p className="mt-4 max-w-[840px] text-base leading-8 text-[#9CA3AF]">{comprehensiveSummary}</p>
            </div>

            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <article className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">Top Categories</div>
                <div className="mt-5 space-y-4">
                  {result.topCategories.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedCategoryKey(item.key)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selectedCategory?.key === item.key
                          ? 'border-[#93C5FD] bg-[#162033] shadow-[0_0_0_1px_rgba(147,197,253,0.28)]'
                          : 'border-[#2F3543] bg-[#171B24] hover:border-[#4B5563] hover:bg-[#1C2230]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div><div className="text-xs font-semibold text-[#CBD5E1]">#{index + 1} 추천</div><div className="mt-1 text-xl font-bold text-[#F8FAFC]">{item.label}</div></div>
                        <div className="rounded-full border border-[#374151] bg-[#12151D] px-3 py-1 text-sm font-bold text-[#F8FAFC]">{item.score}점</div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[#AEB6C5]">{item.marketSummary}</p>
                      <p className="mt-1 text-xs leading-6 text-[#9CA3AF]">{item.growthSummary}</p>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#D1D5DB] md:grid-cols-4">
                        <div className="rounded-lg border border-[#2F3543] bg-[#12151D] px-2 py-2">성장 {item.marketGrowth}%</div>
                        <div className="rounded-lg border border-[#2F3543] bg-[#12151D] px-2 py-2">전환 {item.conversionRate}%</div>
                        <div className="rounded-lg border border-[#2F3543] bg-[#12151D] px-2 py-2">경쟁 {item.competition}</div>
                        <div className="rounded-lg border border-[#2F3543] bg-[#12151D] px-2 py-2">수익화 {item.monetizationSpeed}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </article>

              <article className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">Action Plan</div>
                <h2 className="mt-4 text-[24px] font-bold text-[#F8FAFC]">{selectedCategory ? `${selectedCategory.label} 콘텐츠 방향 + 수익 루트` : '콘텐츠 방향 + 수익 루트'}</h2>
                <div className="mt-5 space-y-3">
                  {selectedActionPlan?.directions.map((direction, index) => (
                    <div key={`${direction.label}-${index}`} className="rounded-xl border border-[#2F3543] bg-[#171B24] p-4">
                      <div className="text-sm font-semibold text-[#F8FAFC]">{direction.label}</div>
                      <div className="mt-1 text-xs leading-6 text-[#AEB6C5]">{direction.reason}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-3">
                  {selectedActionPlan?.monetizationRoutes.map((route) => (
                    <div key={route.key} className="rounded-xl border border-[#2F3543] bg-[#171B24] p-4">
                      <div className="text-sm font-semibold text-[#F8FAFC]">{route.label}</div>
                      <div className="mt-1 text-xs leading-6 text-[#AEB6C5]">{route.reason}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-xl border border-[#2F3543] bg-[#171B24] p-4">
                  <div className="text-sm font-semibold text-[#F8FAFC]">페르소나 요약</div>
                  <div className="mt-2 text-xs leading-6 text-[#AEB6C5]">노출 성향: {result.personaSummary.visibilityStyle}</div>
                  <div className="text-xs leading-6 text-[#AEB6C5]">콘텐츠 타입: {result.personaSummary.contentStyle}</div>
                  <div className="text-xs leading-6 text-[#AEB6C5]">강점: {selectedCategory ? `${selectedCategory.label} 카테고리 설득력` : result.personaSummary.strength}</div>
                </div>
              </article>
            </div>

            <article className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">Why Start Now</div>
              <h2 className="mt-4 text-[24px] font-bold text-[#F8FAFC]">지금 바로 인스타를 시작해야 하는 이유</h2>
              <div className="mt-4 space-y-2">
                {RF_INSTAGRAM_WHY_NOW.map((line, index) => (
                  <p key={`why-now-${index}`} className="text-sm leading-7 text-[#AEB6C5]">{line}</p>
                ))}
              </div>
              <div className="mt-7 rounded-2xl border border-[#2F3543] bg-[#171B24] p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#CBD5E1]">선택 카테고리 시장성</div>
                <h3 className="mt-2 text-lg font-bold text-[#F8FAFC]">{selectedCategory?.label} 카테고리가 유리한 이유</h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[#AEB6C5]">{selectedCategoryNarrative}</p>
              </div>
            </article>

            <article className="rounded-[32px] border border-[#2F3543] bg-[#12151D] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#CBD5E1]">추천 제목 5개</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {selectedTitles.map((title, index) => (
                  <div key={`${title}-${index}`} className="rounded-xl border border-[#2F3543] bg-[#171B24] px-4 py-3 text-sm text-[#E5E7EB]">{title}</div>
                ))}
              </div>
              <div className="mt-5 rounded-xl border border-[#2F3543] bg-[#171B24] px-4 py-3 text-xs text-[#AEB6C5]">{result.adjustmentNote}</div>
              <div className="mt-7 flex flex-wrap gap-3">
                <button type="button" onClick={restart} className="inline-flex h-[52px] items-center justify-center rounded-full border border-[#3A414F] bg-[#171B24] px-7 text-sm font-semibold text-[#E5E7EB] transition hover:bg-[#1D2330]">다시 진단하기</button>
                <a href="/analyze" className="btn-solid-contrast inline-flex h-[52px] items-center justify-center rounded-full px-7 text-sm font-semibold shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition hover:bg-white">이 방향으로 분석 시작하기</a>
              </div>
            </article>
          </section>
        )}
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
  return <RecommendScreenV2 />
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
