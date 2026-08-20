const BROAD_TOPIC_PATTERN = /^(?:살림|운동|헬스|뷰티|화장|요리|육아|청소|정리|다이어트|패션|마케팅|브랜딩|재테크|부업|공부|교육|건강|자기계발|릴스|인스타|쇼츠)$/i
const SPECIFICITY_SIGNAL_PATTERN = /(?:하는\s*법|방법|루틴|순서|기준|실수|원인|해결|줄이|늘리|만들|개선|예방|고르는|고르는\s*법|꿀팁|노하우|전략|체크|관리|시간|비용|초보|직장인|사장님|부모|아이|고객)/i

function normalizeText(value = '', maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function normalizeTopicClarifications(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    targetAudience: normalizeText(input.targetAudience || input.target_audience, 300),
    specificProblem: normalizeText(input.specificProblem || input.specific_problem, 500),
    desiredOutcome: normalizeText(input.desiredOutcome || input.desired_outcome, 500),
  }
}

function readAccountContext(accountSettings = {}) {
  const persona = accountSettings?.persona && typeof accountSettings.persona === 'object'
    ? accountSettings.persona
    : {}
  return {
    targetAudience: normalizeText(
      persona.job || accountSettings.targetAudience || accountSettings.target_audience,
      300,
    ),
    specificProblem: normalizeText(
      persona.painPoints || accountSettings.painPoints || accountSettings.pain_points,
      500,
    ),
    desiredOutcome: normalizeText(
      persona.desiredChange || accountSettings.desiredOutcome || accountSettings.desired_outcome,
      500,
    ),
  }
}

function topicHasEnoughDirection(topic = '') {
  const normalized = normalizeText(topic)
  if (!normalized) return false
  if (BROAD_TOPIC_PATTERN.test(normalized)) return false
  return normalized.length >= 12 || SPECIFICITY_SIGNAL_PATTERN.test(normalized)
}

export function assessTopicReadiness({ topic = '', accountSettings = {}, clarifications = {} } = {}) {
  const normalizedTopic = normalizeText(topic)
  const account = readAccountContext(accountSettings)
  const answers = normalizeTopicClarifications(clarifications)
  const inferredContext = {
    targetAudience: answers.targetAudience || account.targetAudience,
    specificProblem: answers.specificProblem || account.specificProblem,
    desiredOutcome: answers.desiredOutcome || account.desiredOutcome,
  }
  const topicSpecific = topicHasEnoughDirection(normalizedTopic)
  const questions = []

  if (!inferredContext.targetAudience) {
    questions.push({
      id: 'targetAudience',
      question: '누구를 위한 영상인가요?',
      placeholder: '예: 퇴근 후 집안일이 버거운 직장인',
    })
  }
  if (!inferredContext.specificProblem || (!topicSpecific && !answers.specificProblem)) {
    questions.push({
      id: 'specificProblem',
      question: '시청자가 해결해야 할 구체적인 문제는 무엇인가요?',
      placeholder: '예: 청소 순서가 매번 달라 시간이 오래 걸림',
    })
  }
  if (!inferredContext.desiredOutcome || (!topicSpecific && !answers.desiredOutcome)) {
    questions.push({
      id: 'desiredOutcome',
      question: '영상을 본 뒤 어떤 결과를 얻어야 하나요?',
      placeholder: '예: 매일 청소 시간을 15분 안으로 줄이기',
    })
  }

  const uniqueQuestions = Array.from(new Map(questions.map((item) => [item.id, item])).values()).slice(0, 3)
  const inputQuality = uniqueQuestions.length === 0
    ? 'ready'
    : normalizedTopic.length <= 6 || BROAD_TOPIC_PATTERN.test(normalizedTopic)
      ? 'insufficient'
      : 'needs_context'

  return {
    ready: uniqueQuestions.length === 0,
    inputQuality,
    questions: uniqueQuestions,
    inferredContext,
    clarifications: answers,
  }
}

export const __topicScriptPreflightTest = {
  topicHasEnoughDirection,
  readAccountContext,
}
