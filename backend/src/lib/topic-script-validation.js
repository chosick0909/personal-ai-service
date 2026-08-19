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

export function countTopicActionSignals(text = '') {
  const matches = String(text || '').match(
    /(?:먼저|그다음|다음으로|첫째|둘째|셋째|1[.)]|2[.)]|확인|정하|나누|바꾸|줄이|기록|비교|배치|반복|체크|유지|사용|적용|해보)/g,
  )
  return new Set(matches || []).size
}

export function validateTopicVariation(variation = {}, index = 0) {
  const issues = []
  const fullText = [variation.hook, variation.body, variation.cta].join(' ')
  if (!variation.hook || !variation.body || !variation.cta) issues.push('HOOK/BODY/CTA 중 빈 구간이 있음')
  if (FORBIDDEN_OUTPUT_PATTERN.test(fullText)) issues.push('인사말, 자기소개, 계정 ID 또는 내부 규칙명이 노출됨')
  if (FABRICATED_AUTHORITY_PATTERN.test(fullText)) issues.push('확인되지 않은 1인칭 경험이나 성과가 포함됨')
  if (countTopicActionSignals(variation.body) < 2) issues.push('구체적인 실행 정보가 2개 미만임')
  if (index === 0 && !LOSS_HOOK_PATTERN.test(variation.hook || '')) {
    issues.push('손실 회피형의 구체적 손실이 드러나지 않음')
  }
  if (index === 0 && QUESTION_ENDING_PATTERN.test(String(variation.hook || '').trim())) {
    issues.push('손실 회피형 훅이 경고형 단정 대신 일반 질문형으로 끝남')
  }
  if (index === 1 && !BELIEF_CONTRAST_PATTERN.test(variation.hook || '')) {
    issues.push('통념과 새 판단 기준의 대조가 훅에 드러나지 않음')
  }
  if (index === 1 && QUESTION_ENDING_PATTERN.test(String(variation.hook || '').trim())) {
    issues.push('통념 반박형 훅이 반박형 단정 대신 일반 질문형으로 끝남')
  }
  if (index === 2 && !SCENE_HOOK_PATTERN.test(variation.hook || '')) {
    issues.push('공감 스토리형 훅에 구체적인 시간·장소·행동 장면이 없음')
  }
  if (index === 2 && variation.body.length < Math.max(80, variation.hook.length * 1.5)) {
    issues.push('스토리보다 실행 정보 비중이 부족함')
  }
  return { ok: issues.length === 0, issues }
}

function hookWords(hook = '') {
  return new Set(
    String(hook || '')
      .replace(/[^0-9A-Za-z가-힣\s]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2),
  )
}

function hookSimilarity(left = '', right = '') {
  const leftWords = hookWords(left)
  const rightWords = hookWords(right)
  if (!leftWords.size || !rightWords.size) return 0
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length
  return intersection / Math.min(leftWords.size, rightWords.size)
}

export function validateTopicVariationSet(variations = []) {
  const issuesByIndex = TOPIC_VARIATION_CONFIGS.map((_, index) => [
    ...validateTopicVariation(variations[index] || {}, index).issues,
  ])
  const hooks = TOPIC_VARIATION_CONFIGS.map((_, index) => String(variations[index]?.hook || '').trim())
  const questionIndexes = hooks
    .map((hook, index) => (QUESTION_ENDING_PATTERN.test(hook) ? index : -1))
    .filter((index) => index >= 0)

  if (questionIndexes.length >= 2) {
    for (const index of questionIndexes) {
      issuesByIndex[index].push('여러 유형의 훅이 같은 질문형 문법으로 시작함')
    }
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
  }
}
