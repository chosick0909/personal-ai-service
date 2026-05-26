const ARRAY_KEYS = [
  'preferredTone',
  'dislikedTone',
  'preferredHookStyle',
  'dislikedExpressions',
  'recentUserCorrections',
]
const TEXT_KEYS = ['lengthPreference', 'ctaPreference', 'lastAcceptedVersionSummary']
const MEMORY_EVENT_TYPES = new Set(['preference', 'dislike', 'constraint', 'topic_reframe'])

export function createInitialCopilotMemory() {
  return {
    preferredTone: [],
    dislikedTone: [],
    preferredHookStyle: [],
    dislikedExpressions: [],
    lengthPreference: '',
    ctaPreference: '',
    recentUserCorrections: [],
    lastAcceptedVersionSummary: '',
    memoryEvents: [],
  }
}

function uniqueList(values = [], maxItems = 10) {
  if (!Array.isArray(values)) {
    return []
  }

  const seen = new Set()
  const output = []
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text || seen.has(text)) {
      continue
    }
    seen.add(text)
    output.push(text)
    if (output.length >= maxItems) {
      break
    }
  }
  return output
}

function normalizeMemoryEvents(events = []) {
  if (!Array.isArray(events)) {
    return []
  }

  const seen = new Set()
  const output = []
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue
    }
    const type = MEMORY_EVENT_TYPES.has(event.type) ? event.type : ''
    const value = String(event.value || '').replace(/\s+/g, ' ').trim()
    if (!type || !value) {
      continue
    }
    const confidence = Math.max(0, Math.min(1, Number(event.confidence || 0.7)))
    const source = String(event.source || '').replace(/\s+/g, ' ').trim()
    const scope = event.scope === 'session' ? 'session' : 'session'
    const oldSubjectToRemove = Array.isArray(event.oldSubjectToRemove)
      ? uniqueList(event.oldSubjectToRemove, 5)
      : []
    const newSubject = String(event.newSubject || '').replace(/\s+/g, ' ').trim()
    const key = JSON.stringify({ type, value, oldSubjectToRemove, newSubject })
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push({
      type,
      value,
      confidence,
      source,
      scope,
      ...(oldSubjectToRemove.length ? { oldSubjectToRemove } : {}),
      ...(newSubject ? { newSubject } : {}),
    })
    if (output.length >= 12) {
      break
    }
  }
  return output
}

export function normalizeCopilotMemory(memory = {}) {
  const source = memory && typeof memory === 'object' ? memory : {}
  return {
    ...createInitialCopilotMemory(),
    ...ARRAY_KEYS.reduce((next, key) => {
      next[key] = uniqueList(source[key], key === 'recentUserCorrections' ? 10 : 8)
      return next
    }, {}),
    ...TEXT_KEYS.reduce((next, key) => {
      next[key] = String(source[key] || '').replace(/\s+/g, ' ').trim()
      return next
    }, {}),
    memoryEvents: normalizeMemoryEvents(source.memoryEvents),
  }
}

function appendUnique(memory, key, value, maxItems = 8) {
  return {
    ...memory,
    [key]: uniqueList([value, ...(memory[key] || [])], maxItems),
  }
}

function appendMemoryEvent(memory, event) {
  return {
    ...memory,
    memoryEvents: normalizeMemoryEvents([event, ...(memory.memoryEvents || [])]),
  }
}

function parseTopicReframeEvent(text = '') {
  const normalized = String(text || '').trim()
  const patterns = [
    /(?:주제(?:를|은|는)?\s*)?(.+?)\s*(?:말고|대신|빼고)\s*(.+?)\s*(?:으로|로)(?:\s|$)/i,
    /(?:기존\s*)?(.+?)\s*(?:버리고|버려|제외하고)\s*(.+?)\s*(?:으로|로)(?:\s|$)/i,
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (!match) continue
    const oldSubjectToRemove = uniqueList(
      String(match[1] || '')
        .split(/\s*(?:,|\/|·|그리고|및|랑|하고|와|과)\s*/g)
        .map((item) => item.replace(/^(?:주제|소재|내용|방향)(?:를|은|는)?\s*/i, '').replace(/\s*(?:은|는|을|를|이|가)$/u, '').trim())
        .filter(Boolean),
      5,
    )
    const newSubject = String(match[2] || '')
      .replace(/(?:으로|로)?\s*(?:바꿔줘|바꿔|바꾸|변경|수정|가자|다시\s*(?:만들|써|작성))\s*$/i, '')
      .replace(/\s*(?:은|는|을|를|이|가)$/u, '')
      .trim()
    if (oldSubjectToRemove.length && newSubject) {
      return { oldSubjectToRemove, newSubject }
    }
  }
  return null
}

export function updateCopilotMemoryFromUserMessage(memory = {}, message = '') {
  const text = String(message || '').trim()
  const compact = text.replace(/\s+/g, '')
  if (!text) {
    return normalizeCopilotMemory(memory)
  }

  if (/처음부터\s*다시|새로\s*시작|리셋|초기화/i.test(text)) {
    return createInitialCopilotMemory()
  }

  let next = normalizeCopilotMemory(memory)

  if (/광고\s*같|판매\s*같|상업적|구매\s*압박|팔려는\s*느낌|세일즈\s*느낌/i.test(text)) {
    next = appendUnique(next, 'dislikedTone', '광고 같거나 판매 압박이 강한 말투', 8)
    next.ctaPreference = next.ctaPreference || '구매 압박보다 저장/확인 이유를 먼저 주는 CTA'
    next = appendMemoryEvent(next, {
      type: 'dislike',
      value: '광고 같거나 판매 압박이 강한 말투를 싫어함',
      confidence: 0.9,
      source: 'salesy_tone_signal',
      scope: 'session',
    })
  }

  if (/딱딱|기계적|ai\s*같|챗gpt\s*같|로봇\s*같/i.test(text)) {
    next = appendUnique(next, 'dislikedTone', '딱딱하거나 기계적인 말투', 8)
    next = appendUnique(next, 'preferredTone', '실제 사람이 말하는 듯한 자연스러운 톤', 8)
    next = appendMemoryEvent(next, {
      type: 'dislike',
      value: '딱딱하거나 기계적인 말투를 피함',
      confidence: 0.85,
      source: 'mechanical_tone_signal',
      scope: 'session',
    })
  }

  if (/자연스럽게|말하듯|사람\s*말|덜\s*딱딱|구어체/i.test(text)) {
    next = appendUnique(next, 'preferredTone', '자연스럽고 말하듯이 쓰는 톤', 8)
    next = appendMemoryEvent(next, {
      type: 'preference',
      value: '자연스럽고 말하듯이 쓰는 톤 선호',
      confidence: 0.85,
      source: 'natural_tone_signal',
      scope: 'session',
    })
  }

  if (/짧게|압축|간결|줄여|너무\s*길/i.test(text)) {
    next.lengthPreference = '짧고 압축적으로'
    next = appendMemoryEvent(next, {
      type: 'preference',
      value: '짧고 압축적인 문장 선호',
      confidence: 0.75,
      source: 'length_signal',
      scope: 'session',
    })
  }

  if (/길게|자세히|풍부하게|더\s*풀어/i.test(text)) {
    next.lengthPreference = '필요한 맥락은 조금 더 풀어서'
  }

  if (/훅.*좋.*너무\s*(세|강)|훅.*과하|후킹.*과하|너무\s*자극/i.test(text)) {
    next = appendUnique(next, 'preferredHookStyle', '긴장감은 유지하되 과한 후킹은 피함', 8)
  }

  if (/hook|훅/i.test(text) && /(유지|그대로|건드리지|살리고)/i.test(text)) {
    next = appendUnique(next, 'recentUserCorrections', 'HOOK은 유지하고 요청한 다른 섹션만 바꾸길 원함', 10)
    next = appendMemoryEvent(next, {
      type: 'constraint',
      value: 'HOOK은 유지',
      confidence: 0.95,
      source: 'section_lock_signal',
      scope: 'session',
    })
  }

  if (/(body|바디|본문)/i.test(text) && /(만|위주|중심)/i.test(text)) {
    next = appendUnique(next, 'recentUserCorrections', 'BODY 중심 수정 요청에서는 HOOK/CTA를 건드리지 않길 원함', 10)
    next = appendMemoryEvent(next, {
      type: 'constraint',
      value: 'BODY 중심 요청에서는 HOOK/CTA 유지',
      confidence: 0.85,
      source: 'section_scope_signal',
      scope: 'session',
    })
  }

  if (/cta|씨티에이|마무리|끝/i.test(text) && /(부담|압박|자연스럽|가볍|상담|저장|댓글)/i.test(text)) {
    next.ctaPreference = '부담 없는 행동 이유 중심 CTA'
  }

  if (/무조건|역대급|지금\s*바로|대박|찐|개이득/.test(text)) {
    next = appendUnique(next, 'dislikedExpressions', '과장되거나 흔한 광고성 표현', 8)
  }

  if (/아까\s*버전|이전\s*버전|전\s*버전|직전.*(좋|나아)|아까.*(좋|나아)|이전.*(좋|나아)/i.test(text)) {
    next = appendUnique(next, 'recentUserCorrections', '직전 수정 방향이 과했거나 이전 버전이 더 나았음', 10)
    next = appendMemoryEvent(next, {
      type: 'preference',
      value: '직전보다 이전 버전의 방향을 더 선호할 수 있음',
      confidence: 0.6,
      source: 'previous_version_signal',
      scope: 'session',
    })
  }

  if (!/안\s*좋|별로|싫/i.test(text) && /이느낌좋|이런느낌좋|좋아|마음에들/i.test(compact)) {
    next.lastAcceptedVersionSummary = '최근 사용자가 현재 방향의 느낌을 선호함'
    next = appendMemoryEvent(next, {
      type: 'preference',
      value: '현재 수정 방향의 느낌을 선호함',
      confidence: 0.75,
      source: 'accepted_direction_signal',
      scope: 'session',
    })
  }

  const topicReframe = parseTopicReframeEvent(text)
  if (topicReframe) {
    next = appendMemoryEvent(next, {
      type: 'topic_reframe',
      value: '기존 소재를 제거하고 새 소재 중심으로 재구성하는 요청',
      confidence: 0.9,
      source: 'topic_reframe_signal',
      scope: 'session',
      oldSubjectToRemove: topicReframe.oldSubjectToRemove,
      newSubject: topicReframe.newSubject,
    })
  }

  return normalizeCopilotMemory(next)
}
