import { estimateScriptSeconds } from '../../../shared/script-duration.mjs'
export const TOPIC_VARIATION_CONFIGS = [
  { key: 'A', label: '손실 회피형', hookMode: 'loss_warning' },
  { key: 'B', label: '통념 반박형', hookMode: 'belief_contrast' },
  { key: 'C', label: '공감 스토리형', hookMode: 'scene_story' },
]

const FABRICATED_AUTHORITY_PATTERN =
  /(?:제\s*(?:고객|아이|가족|남편|아내|수강생)|제가\s*(?:직접|해봤|경험)|전문가가\s*말하길|매출이\s*\d|조회수가\s*\d)/i
const LOSS_HOOK_PATTERN =
  /(?:계속|그대로|잘못|놓치|낭비|손해|새는|헛수고|기회|오히려|더\s*(?:커|길|짧|느려|어려)|결과가\s*(?:줄|떨어)|망치|두\s*번|다시\s*하)/
const BELIEF_CONTRAST_PATTERN =
  /(?:문제는\s*[^.!?]{1,40}(?:아니라|보다)|[^.!?]{1,30}(?:한다고|한다고 해서|만으로는)\s*[^.!?]{0,20}(?:아니|충분하지|해결되지)|사실\s*[^.!?]{1,35}(?:아니|반대)|[^.!?]{1,30}보다\s*[^.!?]{1,30}(?:먼저|중요)|[^.!?]{1,30}(?:부터가|부터는)\s*(?:아니|잘못)|(?:정답|핵심)은\s*[^.!?]{1,40})/
const SCENE_HOOK_PATTERN =
  /(?:때마다|하는\s*순간|하려는\s*순간|하려는데|막상|앞에서|화면을\s*켜|사진을\s*찍|거울을\s*보|문을\s*열|자리에\s*앉|나가기\s*전|퇴근\s*후|아침에|밤마다|식탁에서|현관에서|회의에서|카메라\s*앞)/
const GENERIC_ADVICE_PATTERN = /(?:기준을\s*(?:하나\s*)?정|순서를\s*(?:두\s*단계로\s*)?나눠|잘\s*해보|꾸준히\s*하|노력해|상황에\s*맞게|적절히\s*활용)/i
const ACTION_VERB_PATTERN = /(?:확인|정리|분리|배치|기록|비교|교체|조절|측정|제거|추가|선택|사용|적용|설정|고정|준비|줄이|늘리|바꾸|맞추|나누|반복|체크|유지|멈추|피하|놓|두|꺼내|열|닫|씻|닦|자르|섞|누르|저장|작성|예약|연결|해보|담|털|쓸|옮기|접|바르|볶|삶|굽|걸)/
const DETAIL_SIGNAL_PATTERN = /(?:먼저|그다음|마지막|첫째|둘째|셋째|\d+[.)]|때|전에|후에|하면|해서|도록|위해|때문|대신|기준|정도|간격|위치|방향|순서|횟수|시간|상태|경우)/
const RESPONSE_ACTION_PATTERN = /(?:저장|댓글|공유|팔로우|확인|체크|비교|적용|해보)/

export function splitTopicSentences(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？])\s+|(?=\d+[.)]\s*)/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function estimateTopicSpeechSeconds(variation = {}) {
  return estimateScriptSeconds(variation)
}

export function countConcreteActionMethods(text = '') {
  const sentences = splitTopicSentences(text)
  let count = 0
  for (const sentence of sentences) {
    if (GENERIC_ADVICE_PATTERN.test(sentence)) continue
    if (ACTION_VERB_PATTERN.test(sentence) && DETAIL_SIGNAL_PATTERN.test(sentence)) count += 1
  }
  return count
}

export function countTopicActionSignals(text = '') {
  return countConcreteActionMethods(text)
}

function meaningfulWords(text = '') {
  return new Set(
    String(text || '')
      .replace(/[^0-9A-Za-z가-힣\s]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim().replace(/(?:은|는|이|가|을|를|에|에서|으로|로|와|과|도|만|의)$/, ''))
      .filter((word) => word.length >= 2 && !/^(?:그리고|하지만|그래서|이렇게|저렇게|먼저|다음|정말|바로|문제|방법)$/.test(word)),
  )
}

function hasHookBodyBridge(variation = {}) {
  const hookTerms = meaningfulWords(variation.hook)
  const firstBodySentences = splitTopicSentences(variation.body).slice(0, 2).join(' ')
  const bodyTerms = meaningfulWords(firstBodySentences)
  if (!hookTerms.size || !bodyTerms.size) return false
  return [...hookTerms].some((term) => bodyTerms.has(term) || [...bodyTerms].some((item) => item.includes(term) || term.includes(item)))
}

function hasUnsupportedNumericClaim(text = '', allowedEvidenceText = '') {
  // A currency unit must end or take a grammatical particle; it cannot be
  // the first syllable of an unrelated compound noun (e.g. an item label).
  const claims = String(text || '').match(/(?:\d+(?:\.\d+)?\s*(?:%|퍼센트|(?:만원|원)(?=$|[\s.,!?。！？]|으로|을|이(?:다|에요|예요|면|라|고|었|었어요|었습니다)|입니다|에(?:서|는|도|요|$)|의|부터|까지|씩|짜리)|배|kg|g|mg|cm|mm|개월|일\s*만에))/gi) || []
  if (!claims.length) return false
  const allowed = String(allowedEvidenceText || '').replace(/\s+/g, '')
  return claims.some((claim) => !allowed.includes(claim.replace(/\s+/g, '')))
}

export function validateTopicVariation(variation = {}, index = 0, context = {}) {
  const issues = []
  const fullText = [variation.hook, variation.body, variation.cta].join(' ')
  const sectionSentenceCounts = {
    hook: splitTopicSentences(variation.hook).length,
    body: splitTopicSentences(variation.body).length,
    cta: splitTopicSentences(variation.cta).length,
  }
  const totalSentenceCount = sectionSentenceCounts.hook + sectionSentenceCounts.body + sectionSentenceCounts.cta
  const estimatedSeconds = estimateTopicSpeechSeconds(variation)
  const concreteMethodCount = countConcreteActionMethods(variation.body)

  if (!fullText.trim()) issues.push('대본 전체가 비어 있음')
  if (/(?:writing_playbook|hook_templates?|narrative_patterns?|rag\s*원문|내부\s*규칙)/i.test(fullText)) issues.push('내부 규칙명이 노출됨')
  // Whether a first-person claim is invented depends on user-provided facts,
  // not the presence of first-person wording. The factual reviewer owns it.
  // Coherence is checked semantically in evaluateVariations. Lexical overlap
  // alone cannot distinguish a clear pronoun from an unrelated repeated noun.
  // CTA coherence, like hook/body coherence, is a meaning judgment owned by
  // evaluateVariations. An actionable ending need not contain a preset verb.
  if (hasUnsupportedNumericClaim(fullText, context.allowedEvidenceText || '')) issues.push('근거팩에 없는 수치 또는 성과 주장이 포함됨')


  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    metrics: { estimatedSeconds, totalSentenceCount, sectionSentenceCounts, concreteMethodCount, firstPersonClaimSignal: FABRICATED_AUTHORITY_PATTERN.test(fullText), lexicalBridge: hasHookBodyBridge(variation), ctaActionSignal: RESPONSE_ACTION_PATTERN.test(variation.cta || ''), hookPatternSignal: [LOSS_HOOK_PATTERN, BELIEF_CONTRAST_PATTERN, SCENE_HOOK_PATTERN][index]?.test(variation.hook || '') || false },
  }
}


export function validateTopicVariationSet(variations = [], context = {}) {
  const validations = TOPIC_VARIATION_CONFIGS.map((_, index) => validateTopicVariation(variations[index] || {}, index, context))
  const issuesByIndex = validations.map((item) => [...item.issues])
  const texts = TOPIC_VARIATION_CONFIGS.map((_, index) => ['hook','body','cta'].map(key=>String(variations[index]?.[key]||'')).join(' ').replace(/\s+/g,' ').trim())


  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      if (texts[left] && texts[left] === texts[right]) {
        issuesByIndex[left].push('다른 초안과 대본 전체가 완전히 동일함')
        issuesByIndex[right].push('다른 초안과 대본 전체가 완전히 동일함')
      }
    }
  }

  return {
    ok: issuesByIndex.every((issues) => issues.length === 0),
    issuesByIndex: issuesByIndex.map((issues) => [...new Set(issues)]),
    metricsByIndex: validations.map((item) => item.metrics),
  }
}
