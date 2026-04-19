import { useEffect, useMemo, useState } from 'react'
import { loadAccountProfile, saveAccountProfile } from '../lib/accountApi'
import { useAppState } from '../store/AppState'

const CATEGORY_OPTIONS = [
  '뷰티',
  '육아',
  '반려동물',
  '살림',
  '자기계발',
  '패션',
  'AI',
  '전문직(회사홍보)',
  '재테크',
  '여행',
  '요리',
  '테크 가젯',
  '멘탈케어',
  '교육',
  '기타',
]

const LEGACY_CATEGORY_ALIAS_MAP = {
  '개인 브랜드': '자기계발',
  비즈니스: '전문직(회사홍보)',
  이커머스: '살림',
  '건강/웰니스': '멘탈케어',
  '음식/요리': '요리',
  '패션/뷰티': '뷰티',
}

function normalizeCategory(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return CATEGORY_OPTIONS[0]
  }

  const mapped = LEGACY_CATEGORY_ALIAS_MAP[raw] || raw
  if (CATEGORY_OPTIONS.includes(mapped)) {
    return mapped
  }

  return '기타'
}

const ACCOUNT_PURPOSE_OPTIONS = [
  { id: 'personal-influencer', title: '퍼스널 인플루언싱', description: '광고 / 협찬 / 공동구매 수익' },
  { id: 'brand-marketing', title: '브랜드 마케팅', description: '제품 / 서비스 판매' },
  { id: 'education-content', title: '교육 / 지식 콘텐츠', description: '강의 / 전자책 판매' },
  { id: 'consulting-lead', title: '상담 문의 받기', description: 'DM, 상담 신청, 예약 고객 확보' },
  { id: 'community-growth', title: '커뮤니티 구축', description: '팬층 형성 / 영향력 확대' },
]

const GENDER_OPTIONS = ['선택', '여성', '남성', '전체']
const CTA_TYPE_OPTIONS = ['구매하기', '문의하기', '상담 신청', '예약하기', 'DM 유도']

const STRATEGY_OPTIONS = [
  '정보형 콘텐츠',
  '문제 해결 콘텐츠',
  '감성/공감형 콘텐츠',
  '스토리텔링 콘텐츠',
  '세일즈 콘텐츠',
]

const VOICE_TONE_OPTIONS = [
  { id: 'expert', title: '전문가형', description: '신뢰감 있고 권위적인 톤' },
  { id: 'friendly', title: '친근한 언니형', description: '편안하고 공감하는 톤' },
  { id: 'coach', title: '코치형', description: '동기부여하고 응원하는 톤' },
  { id: 'storyteller', title: '스토리텔러형', description: '이야기로 전달하는 톤' },
  { id: 'trendy', title: '트렌디한 MZ 톤', description: '밈과 트렌드를 활용하는 톤' },
]

function createProduct(index = 0) {
  return {
    id: `product-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    price: '',
    description: '',
    ctaType: CTA_TYPE_OPTIONS[0],
  }
}

function normalizeProducts(input) {
  if (!Array.isArray(input) || !input.length) {
    return [createProduct(0)]
  }

  return input.map((item, index) => ({
    id: item.id || `product-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    name: item.name || '',
    price: item.price || '',
    description: item.description || '',
    ctaType: item.ctaType || CTA_TYPE_OPTIONS[0],
  }))
}

function SectionTitle({ children }) {
  return (
    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[#AEB6C5]">{children}</div>
  )
}

function Input(props) {
  return (
    <input
      {...props}
      className={`h-12 rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1] placeholder:text-[#6B7280] ${props.className || ''}`}
    />
  )
}

function Textarea(props) {
  return (
    <textarea
      {...props}
      className={`w-full min-h-[112px] rounded-2xl border border-[#374151] bg-[#171B24] px-4 py-3 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1] placeholder:text-[#6B7280] ${props.className || ''}`}
    />
  )
}

function Field({ label, description, children }) {
  return (
    <section className="grid gap-2">
      <div>
        <div className="text-sm font-semibold text-[#E5E7EB]">{label}</div>
        {description ? <div className="mt-1 text-xs text-[#8E97A6]">{description}</div> : null}
      </div>
      {children}
    </section>
  )
}

export default function SettingsPage({ onBack }) {
  const { currentAccount, markAccountConfigured, updateCurrentAccountName } = useAppState()
  const [account, setAccount] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({
    accountName: '',
    category: CATEGORY_OPTIONS[0],
    accountGoal: ACCOUNT_PURPOSE_OPTIONS[0].id,
    personaAge: '',
    personaGender: GENDER_OPTIONS[0],
    personaJob: '',
    personaInterests: '',
    personaPainPoints: '',
    personaDesiredChange: '',
    products: [createProduct(0)],
    strategyPreferences: [],
    voiceTone: VOICE_TONE_OPTIONS[0].id,
    characterPrompt: '',
    aiAdditionalInfo: '',
  })

  useEffect(() => {
    let mounted = true

    const run = async () => {
      if (!currentAccount?.id) {
        if (mounted) {
          setIsLoading(false)
        }
        return
      }

      setIsLoading(true)
      setError('')

      try {
        const payload = await loadAccountProfile({
          accountId: currentAccount?.id,
        })
        if (!mounted) {
          return
        }

        const profile = payload.profile || {}
        const settings = profile.settings && typeof profile.settings === 'object' ? profile.settings : {}
        const persona = settings.persona && typeof settings.persona === 'object' ? settings.persona : {}
        const loadedStrategy = Array.isArray(settings.strategyPreferences)
          ? settings.strategyPreferences
          : (profile.strategy || '')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)

        setAccount(payload.account || null)
        setForm({
          accountName: payload.account?.name || '',
          category: normalizeCategory(settings.category || profile.category || CATEGORY_OPTIONS[0]),
          accountGoal:
            settings.accountGoal ||
            profile.goal ||
            (Array.isArray(profile.goals) ? profile.goals[0] : '') ||
            ACCOUNT_PURPOSE_OPTIONS[0].id,
          personaAge: persona.age || '',
          personaGender: persona.gender || GENDER_OPTIONS[0],
          personaJob: persona.job || '',
          personaInterests: persona.interests || '',
          personaPainPoints: persona.painPoints || '',
          personaDesiredChange: persona.desiredChange || '',
          products: normalizeProducts(settings.products),
          strategyPreferences: loadedStrategy,
          voiceTone: settings.voiceTone || profile.tone || VOICE_TONE_OPTIONS[0].id,
          characterPrompt: settings.characterPrompt || '',
          aiAdditionalInfo: settings.aiAdditionalInfo || settings.characterPrompt || '',
        })
      } catch (nextError) {
        if (mounted) {
          setError(nextError.message)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    run()
    return () => {
      mounted = false
    }
  }, [currentAccount?.id])

  const selectedGoal = useMemo(
    () => ACCOUNT_PURPOSE_OPTIONS.find((item) => item.id === form.accountGoal),
    [form.accountGoal],
  )

  const updateField = (key) => (event) => {
    setForm((current) => ({
      ...current,
      [key]: event.target.value,
    }))
  }

  const toggleStrategy = (value) => {
    setForm((current) => ({
      ...current,
      strategyPreferences: current.strategyPreferences.includes(value)
        ? current.strategyPreferences.filter((item) => item !== value)
        : [...current.strategyPreferences, value],
    }))
  }

  const addProduct = () => {
    setForm((current) => ({
      ...current,
      products: [...current.products, createProduct(current.products.length)],
    }))
  }

  const removeProduct = (productId) => {
    setForm((current) => {
      const nextProducts = current.products.filter((item) => item.id !== productId)
      return {
        ...current,
        products: nextProducts.length ? nextProducts : [createProduct(0)],
      }
    })
  }

  const updateProduct = (productId, key, value) => {
    setForm((current) => ({
      ...current,
      products: current.products.map((item) =>
        item.id === productId
          ? {
              ...item,
              [key]: value,
            }
          : item,
      ),
    }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError('')
    setSuccess('')

    try {
      const normalizedProducts = form.products.map((item) => ({
        name: item.name.trim(),
        price: item.price.trim(),
        description: item.description.trim(),
        ctaType: item.ctaType,
      }))

      const targetAudience = [
        form.personaAge && `연령대:${form.personaAge}`,
        form.personaGender && form.personaGender !== '선택' ? `성별:${form.personaGender}` : null,
        form.personaJob && `직업:${form.personaJob}`,
        form.personaInterests && `관심사:${form.personaInterests}`,
      ]
        .filter(Boolean)
        .join(' / ')

      await saveAccountProfile(
        {
          accountName: form.accountName,
          category: form.category,
          tone: form.voiceTone,
          targetAudience,
          goal: form.accountGoal,
          goals: [form.accountGoal],
          strategy: form.strategyPreferences.join(', '),
          settings: {
            accountName: form.accountName,
            category: form.category,
            accountGoal: form.accountGoal,
            persona: {
              age: form.personaAge,
              gender: form.personaGender,
              job: form.personaJob,
              interests: form.personaInterests,
              painPoints: form.personaPainPoints,
              desiredChange: form.personaDesiredChange,
            },
            products: normalizedProducts,
            strategyPreferences: form.strategyPreferences,
            voiceTone: form.voiceTone,
            aiAdditionalInfo: form.aiAdditionalInfo,
            characterPrompt: form.characterPrompt,
          },
        },
        {
          accountId: currentAccount?.id,
        },
      )

      updateCurrentAccountName(currentAccount?.id, form.accountName.trim())
      markAccountConfigured(currentAccount?.id, true)
      setSuccess('설정이 저장되었습니다.')
      window.setTimeout(() => {
        onBack()
      }, 300)
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#0D0F14_0%,#11151D_100%)]">
      <div className="pointer-events-none absolute inset-0 bg-black/55" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-[#2F3543] bg-[#12151D] shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#2F3543] bg-[#12151D] px-6 py-5">
            <div>
              <div className="text-xl font-semibold text-[#F8FAFC]">계정 설정</div>
              <div className="mt-1 text-sm text-[#8E97A6]">
                {account?.name || '현재 계정'}의 운영 전략과 페르소나를 설정합니다.
              </div>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#374151] text-[#AEB6C5] transition hover:bg-[#1B202A]"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            {isLoading ? (
              <div className="rounded-3xl border border-[#2F3543] bg-[#171B24] px-5 py-6 text-sm text-[#CBD5E1]">
                설정 정보를 불러오는 중입니다...
              </div>
            ) : (
              <div className="grid gap-8">
                <section className="grid gap-4 rounded-3xl border border-[#2F3543] bg-[#131A24] p-5">
                  <SectionTitle>⬇ 계정 카테고리</SectionTitle>
                  <Field label="계정 이름">
                    <Input value={form.accountName} onChange={updateField('accountName')} placeholder="예: HookAI 브랜드 계정" />
                  </Field>
                  <Field label="계정 카테고리">
                    <select
                      value={form.category}
                      onChange={updateField('category')}
                      className="h-12 rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1]"
                    >
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </Field>
                </section>

                <section className="grid gap-4 rounded-3xl border border-[#2F3543] bg-[#131A24] p-5">
                  <SectionTitle>⬇ 계정 운영 목적 선택</SectionTitle>
                  <div className="grid gap-3">
                    {ACCOUNT_PURPOSE_OPTIONS.map((item) => {
                      const selected = form.accountGoal === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, accountGoal: item.id }))}
                          className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition ${
                            selected
                              ? 'shimmer-selected border-[#94A3B8] bg-[#1D2330]'
                              : 'border-[#374151] bg-[#171B24] hover:bg-[#1D2330]'
                          }`}
                        >
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                              selected ? 'border-[#CBD5E1] bg-[#CBD5E1] text-[#0B0D12]' : 'border-[#6B7280] text-transparent'
                            }`}
                          >
                            ●
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-[#F3F4F6]">{item.title}</div>
                            <div className="mt-0.5 text-xs text-[#8E97A6]">{item.description}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="grid gap-4 rounded-3xl border border-[#2F3543] bg-[#131A24] p-5">
                  <SectionTitle>⬇ 타겟 페르소나 설정</SectionTitle>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="연령대">
                      <Input value={form.personaAge} onChange={updateField('personaAge')} placeholder="예: 25-35세" />
                    </Field>
                    <Field label="성별">
                      <select
                        value={form.personaGender}
                        onChange={updateField('personaGender')}
                        className="h-12 rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1]"
                      >
                        {GENDER_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="직업">
                    <Input value={form.personaJob} onChange={updateField('personaJob')} placeholder="예: 직장인, 프리랜서, 주부" />
                  </Field>
                  <Field label="관심사">
                    <Input value={form.personaInterests} onChange={updateField('personaInterests')} placeholder="예: 자기계발, 재테크, 운동" />
                  </Field>
                  <Field label="주요 고민/페인 포인트">
                    <Textarea
                      value={form.personaPainPoints}
                      onChange={updateField('personaPainPoints')}
                      placeholder="타겟이 겪고 있는 주요 문제나 고민"
                      className="min-h-[90px]"
                    />
                  </Field>
                  <Field label="원하는 변화">
                    <Textarea
                      value={form.personaDesiredChange}
                      onChange={updateField('personaDesiredChange')}
                      placeholder="타겟이 원하는 최종 결과나 변화"
                      className="min-h-[90px]"
                    />
                  </Field>
                </section>

                <section className="grid gap-4 rounded-3xl border border-[#2F3543] bg-[#131A24] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <SectionTitle>⬇ 연계 상품/서비스 입력</SectionTitle>
                    <button
                      type="button"
                      onClick={addProduct}
                      className="rounded-xl border border-[#374151] bg-[#171B24] px-3 py-2 text-xs font-semibold text-[#E5E7EB] transition hover:bg-[#1D2330]"
                    >
                      + 추가
                    </button>
                  </div>

                  <div className="grid gap-4">
                    {form.products.map((product, index) => (
                      <article key={product.id} className="rounded-2xl border border-[#374151] bg-[#171B24] p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-sm font-semibold text-[#E5E7EB]">상품 {index + 1}</div>
                          <button
                            type="button"
                            onClick={() => removeProduct(product.id)}
                            className="text-sm font-semibold text-[#FCA5A5] transition hover:text-[#F87171]"
                          >
                            삭제
                          </button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input
                            value={product.name}
                            onChange={(event) => updateProduct(product.id, 'name', event.target.value)}
                            placeholder="상품명"
                          />
                          <Input
                            value={product.price}
                            onChange={(event) => updateProduct(product.id, 'price', event.target.value)}
                            placeholder="가격대"
                          />
                        </div>
                        <Textarea
                          value={product.description}
                          onChange={(event) => updateProduct(product.id, 'description', event.target.value)}
                          placeholder="상품 설명"
                          className="mt-3 min-h-[80px]"
                        />
                        <select
                          value={product.ctaType}
                          onChange={(event) => updateProduct(product.id, 'ctaType', event.target.value)}
                          className="mt-3 h-11 w-full rounded-2xl border border-[#374151] bg-[#171B24] px-4 text-sm text-[#F8FAFC] outline-none transition focus:border-[#CBD5E1]"
                        >
                          {CTA_TYPE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="grid gap-4 rounded-3xl border border-[#2F3543] bg-[#131A24] p-5">
                  <SectionTitle>⬇ 전략 선호도 및 보이스/톤 설정</SectionTitle>

                  <Field label="콘텐츠 전략 선호도 (복수 선택 가능)">
                    <div className="grid gap-3 md:grid-cols-2">
                      {STRATEGY_OPTIONS.map((option) => {
                        const checked = form.strategyPreferences.includes(option)
                        return (
                          <button
                            key={option}
                            type="button"
                          onClick={() => toggleStrategy(option)}
                          className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                              checked
                                ? 'shimmer-selected border-[#94A3B8] bg-[#1D2330] text-[#F8FAFC]'
                                : 'border-[#374151] bg-[#171B24] text-[#CBD5E1] hover:bg-[#1D2330]'
                            }`}
                          >
                            <span
                              className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                                checked ? 'border-[#CBD5E1] bg-[#CBD5E1] text-[#0B0D12]' : 'border-[#6B7280] text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                            {option}
                          </button>
                        )
                      })}
                    </div>
                  </Field>

                  <Field label="브랜드 보이스/톤">
                    <div className="grid gap-3">
                      {VOICE_TONE_OPTIONS.map((option) => {
                        const selected = form.voiceTone === option.id
                        return (
                          <button
                            key={option.id}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, voiceTone: option.id }))}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                              selected
                                ? 'shimmer-selected border-[#94A3B8] bg-[#1D2330]'
                                : 'border-[#374151] bg-[#171B24] hover:bg-[#1D2330]'
                            }`}
                          >
                            <div className="text-sm font-semibold text-[#F3F4F6]">{option.title}</div>
                            <div className="mt-1 text-xs text-[#8E97A6]">{option.description}</div>
                          </button>
                        )
                      })}
                    </div>
                  </Field>
                </section>

                <section className="grid gap-4 rounded-3xl border border-[#2F3543] bg-[#131A24] p-5">
                  <SectionTitle>⬇ 추가 정보를 자유 입력</SectionTitle>
                  <Field label="캐릭터 시스템 프롬프트" description="이 계정이 항상 지켜야 할 말투, 금지 표현, 우선순위를 입력">
                    <Textarea
                      value={form.characterPrompt}
                      onChange={updateField('characterPrompt')}
                      className="min-h-[120px]"
                      placeholder="예: 친근하지만 결론부터 말하고, 과장/허위 표현은 금지, 실행 단계 3개로 답변"
                    />
                  </Field>
                  <Field label="AI 추가 정보" description="브랜드 스토리, 금지 단어, 선호 표현 방식 등 자유 입력">
                    <Textarea
                      value={form.aiAdditionalInfo}
                      onChange={updateField('aiAdditionalInfo')}
                      className="min-h-[140px]"
                      placeholder="AI가 콘텐츠를 생성할 때 참고할 정보 입력"
                    />
                  </Field>
                </section>

                <div className="rounded-2xl border border-[#2F3543] bg-[#171B24] px-4 py-3 text-sm text-[#CBD5E1]">
                  현재 운영 목적: {selectedGoal?.title || '-'} / 카테고리: {form.category || '-'}
                </div>

                {error ? (
                  <div className="rounded-2xl border border-[#7F1D1D] bg-[#2A1618] px-4 py-3 text-sm text-[#FCA5A5]">
                    {error}
                  </div>
                ) : null}

                {success ? (
                  <div className="rounded-2xl border border-[#2F3543] bg-[#171B24] px-4 py-3 text-sm text-[#CBD5E1]">
                    {success}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <footer className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-[#2F3543] bg-[#12151D] px-6 py-5">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-[#374151] bg-[#171B24] px-5 py-2.5 text-sm font-semibold text-[#CBD5E1] transition hover:bg-[#1D2330]"
            >
              취소
            </button>
            <button
              type="button"
              disabled={isLoading || isSaving}
              onClick={handleSave}
              className="btn-solid-contrast inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              생성
            </button>
          </footer>
        </div>
      </div>
    </main>
  )
}
