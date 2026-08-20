export const TOPIC_VARIATION_CONFIGS = [
  { key: 'A', label: '손실 회피형', hookMode: 'loss_warning' },
  { key: 'B', label: '통념 반박형', hookMode: 'belief_contrast' },
  { key: 'C', label: '공감 스토리형', hookMode: 'scene_story' },
]

const FORBIDDEN_OUTPUT_PATTERN =
  /(?:안녕하세요|잠깐만요|혹시요|저는\s|제가\s+[^.!?]{0,24}(?:입니다|예요|이에요)|@[a-z0-9_.]+|writing_playbook|hook_templates?|narrative_patterns?|rag\s*원문|내부\s*규칙)/i
const FABRICATED_AUTHORITY_PATTERN =
  /(?:제\s*(?:고객|아이|가족|남편|아내|수강생)|제가\s*(?:직접|해봤|경험)|전문가가\s*말하길|매출이\s*\d|조회수가\s*\d)/i
const LOSS_HOOK_PATTERN =
  /(?:계속|그대로|잘못|놓치|낭비|손해|새는|헛수고|기회|오히려|더\s*(?:커|길|짧|느려|어려)|결과가\s*(?:줄|떨어)|망치|두\s*번|다시\s*하)/
const BELIEF_CONTRAST_PATTERN =
  /(?:문제는\s*[^.!?]{1,40}(?:아니라|보다)|[^.!?]{1,30}(?:한다고|한다고 해서|만으로는)\s*[^.!?]{0,20}(?:아니|충분하지|해결되지)|사실\s*[^.!?]{1,35}(?:아니|반대)|[^.!?]{1,30}보다\s*[^.!?]{1,30}(?:먼저|중요)|[^.!?]{1,30}(?:부터가|부터는)\s*(?:아니|잘못)|(?:정답|핵심)은\s*[^.!?]{1,40})/
const SCENE_HOOK_PATTERN =
  /(?:때마다|하는\s*순간|하려는\s*순간|하려는데|막상|앞에서|화면을\s*켜|사진을\s*찍|거울을\s*보|문을\s*열|자리에\s*앉|나가기\s*전|퇴근\s*후|아침에|밤마다|식탁에서|현관에서|회의에서|카메라\s*앞)/
const QUESTION_ENDING_PATTERN = /(?:[?？]|나요|까요|인가요|보이나요)\s*$/
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
  const text = [variation.hook, variation.body, variation.cta].filter(Boolean).join(' ')
  const spokenCharacters = text.replace(/[\s.,!?。！？·~"'“”‘’()[\]{}:;\-–—]/g, '').length
  const sentenceCount = splitTopicSentences(text).length
  return Math.round((spokenCharacters / 4.5 + sentenceCount * 0.3) * 10) / 10
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
  const claims = String(text || '').match(/(?:\d+(?:\.\d+)?\s*(?:%|퍼센트|만원|원|배|kg|g|mg|cm|mm|개월|일\s*만에))/gi) || []
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

  if (!variation.hook || !variation.body || !variation.cta) issues.push('HOOK/BODY/CTA 중 빈 구간이 있음')
  if (FORBIDDEN_OUTPUT_PATTERN.test(fullText)) issues.push('인사말, 자기소개, 계정 ID 또는 내부 규칙명이 노출됨')
  if (FABRICATED_AUTHORITY_PATTERN.test(fullText)) issues.push('확인되지 않은 1인칭 경험이나 성과가 포함됨')
  if (totalSentenceCount < 9 || totalSentenceCount > 13) issues.push(`전체 문장 수가 9~13개가 아님 (${totalSentenceCount}개)`)
  if (sectionSentenceCounts.hook < 1 || sectionSentenceCounts.hook > 2) issues.push('HOOK 문장 수가 1~2개가 아님')
  if (sectionSentenceCounts.body < 7 || sectionSentenceCounts.body > 10) issues.push('BODY 문장 수가 7~10개가 아님')
  if (sectionSentenceCounts.cta !== 1) issues.push('CTA가 한 문장이 아님')
  if (estimatedSeconds < 60 || estimatedSeconds > 90) issues.push(`예상 발화 시간이 60~90초가 아님 (${estimatedSeconds}초)`)
  if (concreteMethodCount < 3) issues.push(`구체적인 실행 방법이 3개 미만임 (${concreteMethodCount}개)`)
  if (GENERIC_ADVICE_PATTERN.test(variation.body) && concreteMethodCount < 3) issues.push('일반론이 실행 정보 대신 사용됨')
  if (!hasHookBodyBridge(variation)) issues.push('HOOK의 문제나 약속을 BODY 첫 두 문장이 이어받지 못함')
  if (!RESPONSE_ACTION_PATTERN.test(variation.cta || '')) issues.push('CTA가 BODY 결론을 구체적인 행동으로 연결하지 못함')
  if (hasUnsupportedNumericClaim(fullText, context.allowedEvidenceText || '')) issues.push('근거팩에 없는 수치 또는 성과 주장이 포함됨')

  if (index === 0 && !LOSS_HOOK_PATTERN.test(variation.hook || '')) issues.push('손실 회피형의 구체적 손실이 드러나지 않음')
  if (index === 0 && QUESTION_ENDING_PATTERN.test(String(variation.hook || '').trim())) issues.push('손실 회피형 훅이 경고형 단정 대신 일반 질문형으로 끝남')
  if (index === 1 && !BELIEF_CONTRAST_PATTERN.test(variation.hook || '')) issues.push('통념과 새 판단 기준의 대조가 훅에 드러나지 않음')
  if (index === 1 && QUESTION_ENDING_PATTERN.test(String(variation.hook || '').trim())) issues.push('통념 반박형 훅이 반박형 단정 대신 일반 질문형으로 끝남')
  if (index === 2 && !SCENE_HOOK_PATTERN.test(variation.hook || '')) issues.push('공감 스토리형 훅에 구체적인 시간·장소·행동 장면이 없음')

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    metrics: { estimatedSeconds, totalSentenceCount, sectionSentenceCounts, concreteMethodCount },
  }
}

function hookSimilarity(left = '', right = '') {
  const leftWords = meaningfulWords(left)
  const rightWords = meaningfulWords(right)
  if (!leftWords.size || !rightWords.size) return 0
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length
  return intersection / Math.min(leftWords.size, rightWords.size)
}

export function validateTopicVariationSet(variations = [], context = {}) {
  const validations = TOPIC_VARIATION_CONFIGS.map((_, index) => validateTopicVariation(variations[index] || {}, index, context))
  const issuesByIndex = validations.map((item) => [...item.issues])
  const hooks = TOPIC_VARIATION_CONFIGS.map((_, index) => String(variations[index]?.hook || '').trim())
  const questionIndexes = hooks.map((hook, index) => (QUESTION_ENDING_PATTERN.test(hook) ? index : -1)).filter((index) => index >= 0)

  if (questionIndexes.length >= 2) {
    for (const index of questionIndexes) issuesByIndex[index].push('여러 유형의 훅이 같은 질문형 문법으로 시작함')
  }

  for (let left = 0; left < hooks.length; left += 1) {
    for (let right = left + 1; right < hooks.length; right += 1) {
      if (hookSimilarity(hooks[left], hooks[right]) >= 0.6) {
        issuesByIndex[left].push('다른 유형의 훅과 표현 및 문장 골격이 지나치게 유사함')
        issuesByIndex[right].push('다른 유형의 훅과 표현 및 문장 골격이 지나치게 유사함')
      }
    }
  }

  return {
    ok: issuesByIndex.every((issues) => issues.length === 0),
    issuesByIndex: issuesByIndex.map((issues) => [...new Set(issues)]),
    metricsByIndex: validations.map((item) => item.metrics),
  }
}
