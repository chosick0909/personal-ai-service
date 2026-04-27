import { AppError } from './errors.js'
import { getAccountProfile } from './account-profile.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const VOICE_TONE_LABELS = {
  expert: '전문가형',
  friendly: '친근한 언니형',
  coach: '코치형',
  storyteller: '스토리텔러형',
  trendy: '트렌디한 MZ 톤',
}

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function buildCharacterSystemPrompt({ account, profile }) {
  const settings = profile?.settings && typeof profile.settings === 'object' ? profile.settings : {}
  const customPrompt = typeof settings.characterPrompt === 'string' ? settings.characterPrompt.trim() : ''
  const additionalInfo = typeof settings.aiAdditionalInfo === 'string' ? settings.aiAdditionalInfo.trim() : ''
  const category = typeof settings.category === 'string' ? settings.category.trim() : ''
  const instagramId = typeof settings.instagramId === 'string' ? settings.instagramId.trim() : ''
  const accountGoal = typeof settings.accountGoal === 'string' ? settings.accountGoal.trim() : ''
  const voiceTones = Array.isArray(settings.voiceTones)
    ? settings.voiceTones.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
    : []
  const voiceToneLabels = voiceTones.map((item) => VOICE_TONE_LABELS[item] || item)
  const voiceTone = voiceTones.length
    ? voiceToneLabels.join(' + ')
    : typeof settings.voiceTone === 'string'
      ? VOICE_TONE_LABELS[settings.voiceTone.trim()] || settings.voiceTone.trim()
      : ''
  const persona = settings.persona && typeof settings.persona === 'object' ? settings.persona : {}
  const strategyPreferences = Array.isArray(settings.strategyPreferences)
    ? settings.strategyPreferences.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const products = Array.isArray(settings.products)
    ? settings.products
        .map((item) => ({
          name: String(item?.name || '').trim(),
          price: String(item?.price || '').trim(),
          description: String(item?.description || '').trim(),
          ctaType: String(item?.ctaType || '').trim(),
        }))
        .filter((item) => item.name || item.price || item.description || item.ctaType)
    : []
  const forbiddenExpressions =
    typeof settings.forbiddenExpressions === 'string' ? settings.forbiddenExpressions.trim() : ''
  const toneGuide = typeof settings.toneGuide === 'string' ? settings.toneGuide.trim() : ''
  const responseGoal = typeof settings.responseGoal === 'string' ? settings.responseGoal.trim() : ''

  const profileTraits = [
    voiceTone || profile?.tone?.trim()
      ? `브랜드 보이스/톤: ${voiceTone || profile.tone.trim()}${voiceTones.length > 1 ? ' (첫 번째 톤을 기본으로, 두 번째 톤은 보조로만 섞기)' : ''}`
      : null,
    profile?.target_audience?.trim() ? `타겟 요약: ${profile.target_audience.trim()}` : null,
    accountGoal || profile?.goal?.trim() ? `운영 목적: ${accountGoal || profile.goal.trim()}` : null,
    profile?.strategy?.trim() ? `전략 요약: ${profile.strategy.trim()}` : null,
    category ? `카테고리: ${category}` : null,
    instagramId ? `인스타그램: @${instagramId.replace(/^@/, '')}` : null,
  ].filter(Boolean)

  const personaTraits = [
    persona?.age ? `연령대: ${String(persona.age).trim()}` : null,
    persona?.gender && String(persona.gender).trim() !== '선택' ? `성별: ${String(persona.gender).trim()}` : null,
    persona?.job ? `직업: ${String(persona.job).trim()}` : null,
    persona?.interests ? `관심사: ${String(persona.interests).trim()}` : null,
    persona?.painPoints ? `주요 고민: ${String(persona.painPoints).trim()}` : null,
    persona?.desiredChange ? `원하는 변화: ${String(persona.desiredChange).trim()}` : null,
  ].filter(Boolean)

  const productLines = products.map((item, index) => {
    const parts = [
      item.name ? `이름=${item.name}` : null,
      item.price ? `가격=${item.price}` : null,
      item.description ? `설명=${item.description}` : null,
      item.ctaType ? `CTA=${item.ctaType}` : null,
    ]
      .filter(Boolean)
      .join(' | ')
    return `- 상품 ${index + 1}: ${parts}`
  })

  return [
    '당신은 현재 선택된 캐릭터 전용 AI다.',
    '현재 캐릭터가 곧 AI의 정체성이다.',
    '다른 캐릭터의 설정, 톤, 전략, 말투를 절대 섞지 마라.',
    '아래 계정 설정 규칙은 예외 없이 응답에 반영한다.',
    `캐릭터 이름: ${account?.name || 'Unnamed Character'}`,
    account?.slug ? `캐릭터 슬러그: @${account.slug}` : null,
    profileTraits.length ? `캐릭터 핵심 속성:\n- ${profileTraits.join('\n- ')}` : null,
    personaTraits.length ? `타겟 페르소나:\n- ${personaTraits.join('\n- ')}` : null,
    strategyPreferences.length ? `전략 선호도:\n- ${strategyPreferences.join('\n- ')}` : null,
    productLines.length ? `연계 상품/서비스:\n${productLines.join('\n')}` : null,
    forbiddenExpressions ? `금지 표현:\n${forbiddenExpressions}` : null,
    toneGuide ? `톤 가이드:\n${toneGuide}` : null,
    responseGoal ? `응답 목표:\n${responseGoal}` : null,
    additionalInfo ? `AI 추가 정보:\n${additionalInfo}` : null,
    customPrompt ? `캐릭터 시스템 프롬프트:\n${customPrompt}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function getAccountCharacterContext(accountId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const profile = await getAccountProfile(accountId)

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, name, slug')
    .eq('id', accountId)
    .single()

  if (error) {
    throw new AppError('Failed to load character account', {
      code: 'ACCOUNT_CHARACTER_FETCH_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return {
    account,
    profile,
    systemPrompt: buildCharacterSystemPrompt({ account, profile }),
  }
}
