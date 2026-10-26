import { query } from '../store.js'
import { fail } from '../domain.js'
import { HOOKAI_SYSTEM, STAGE_ORDER, nextStage } from './persona.js'
import { HOOK_LIBRARY, STRUCTURE_LIBRARY } from './library.js'
import { HOOK_TYPES, STORY_FORMATS, schedule } from '../success-reel-analysis.js'
import { SUCCESS_REEL_CATEGORIES } from '../categories.js'

const str = { type: 'string' }
const num = { type: 'number' }
const bool = { type: 'boolean' }
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = items => ({ type: 'array', items })
const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/[ \t]+/g, ' ').trim().slice(0, max) : ''
const list = (value, max, count) => Array.isArray(value) ? value.map(v => clean(v, max)).filter(Boolean).slice(0, count) : []
export const SLOTS = ['hook', 'structure', 'filming', 'caption']
const SLOT_LABELS = { hook: '첫 문장(후킹)', structure: '전개', filming: '촬영/편집', caption: '캡션' }
const PARTS = ['hook', 'body', 'cta']
const PART_LABELS = { hook: '첫 문장', body: '본문', cta: '마무리 멘트' }

// ---------- sources ----------
// A slot source is a reel analysis, a saved formula or a library entry. Only the slot's excerpt reaches the prompt.
export async function resolveSources(db, userId, sources = {}) {
  const resolved = {}
  for (const slot of SLOTS) {
    const source = sources?.[slot]
    if (!source?.kind || !source?.id) continue
    if (source.kind === 'reel') {
      const reel = await query(db.from('creator_success_reels').select('shortcode,username,caption,views,analysis,analysis_status,category,visible,owner_user_id').eq('shortcode', source.id).maybeSingle())
      if (!reel || !(reel.visible || reel.owner_user_id === userId)) fail('SOURCE_NOT_FOUND', '레퍼런스를 찾을 수 없어요.', 404)
      if (reel.analysis_status !== 'ready') fail('SOURCE_NOT_READY', '아직 분석이 끝나지 않은 레퍼런스가 있어요.', 409)
      const a = reel.analysis
      const excerpt = slot === 'hook' ? { formula: a.hook?.formula, spokenHook: a.hook?.spokenHook, visualHook: a.hook?.visualHook, type: a.hook?.category, why: a.hook?.analysis }
        : slot === 'structure' ? { format: a.structure?.category, description: a.structure?.description, steps: (a.structure?.steps || []).map(s => ({ role: s.role, purpose: s.purpose })), durationSeconds: a.durationSeconds, why: a.structure?.analysis }
        : slot === 'filming' ? { filming: { location: a.filming?.location, shotType: a.filming?.shotType, onScreen: a.filming?.onScreen, guide: a.filming?.guide },
          editing: a.editing || { subtitleStyle: a.filming?.textOverlay, cuts: a.filming?.editing, transitions: '확인되지 않음', effects: '확인되지 않음', sound: '확인되지 않음', guide: [] } }
        : { ...(a.caption || { firstLine: '확인되지 않음', structure: '확인되지 않음', cta: '확인되지 않음', hashtags: '확인되지 않음', analysis: '원본 캡션 분석이 없어 캡션 형식만 참고' }), original: String(reel.caption || '').slice(0, 700) }
      resolved[slot] = { kind: 'reel', id: reel.shortcode, label: `@${reel.username}`, category: reel.category, excerpt, topic: a.overview?.topic }
    } else if (source.kind === 'formula') {
      const row = await query(db.from('studio_formulas').select('id,kind,title,spec').eq('id', source.id).eq('user_id', userId).maybeSingle())
      if (!row) fail('SOURCE_NOT_FOUND', '저장한 공식을 찾을 수 없어요.', 404)
      resolved[slot] = { kind: 'formula', id: row.id, label: row.title, excerpt: row.spec }
    } else if (source.kind === 'library') {
      const entry = slot === 'hook' ? HOOK_LIBRARY.find(h => h.id === source.id) : slot === 'structure' ? STRUCTURE_LIBRARY.find(s => s.id === source.id) : null
      if (!entry) fail('SOURCE_NOT_FOUND', '공식 사전 항목을 찾을 수 없어요.', 404)
      resolved[slot] = { kind: 'library', id: entry.id, label: entry.title, excerpt: slot === 'hook' ? { type: entry.type, formula: entry.formula, example: entry.example } : { format: entry.format, segments: entry.segments } }
    }
  }
  return resolved
}

// Compact state 훅ai sees on every call. Never the whole chat.
function sessionContext(session, resolved, extras = {}) {
  const chosen = (field, key = 'options') => { const f = session[field]; if (!f) return null; if (f.custom) return f.custom; return f[key]?.[f.chosen ?? 0] ?? null }
  return {
    mode: session.mode,
    sources: Object.fromEntries(Object.entries(resolved).map(([slot, s]) => [slot, { from: s.label, ...s.excerpt }])),
    brief: session.brief, attachments: (session.attachments || []).map(a => ({ name: a.name, content: String(a.content || '').slice(0, 3000) })),
    answers: session.topic?.answers || [],
    topic: session.topic ? { title: session.topic.title, angle: session.topic.angle, promise: session.topic.promise, facts: session.topic.facts, audience: session.topic.audience, category: session.topic.category } : null,
    thumbnail: chosen('thumbnail'), hook: chosen('hook'),
    script: session.script?.edited || chosen('script')?.lines || null,
    filming: session.filming ? { storyboard: session.filming.storyboard, editing: session.filming.editing, editingPlan: session.filming.editingPlan, memo: session.memo } : null,
    caption: session.caption?.edited || chosen('caption'),
    placeholders: session.placeholders || [],
    voice: session.style_snapshot || null,
    ...extras,
  }
}

const providersJson = (providers, op, instructions, input, schema) => providers.json(op, `${HOOKAI_SYSTEM}\n\n${instructions}`, input, [], schema)

// ---------- topic chat ----------
const topicSchema = obj({
  reply: str, chips: arr(str),
  proposals: arr(obj({ title: str, angle: str, promise: str, why: str, category: str })),
  topic: obj({ ready: bool, title: str, angle: str, promise: str, facts: arr(str), audience: str, category: str }),
})
const topicPrompt = `지금은 '주제 정하기' 단계입니다. 수강생과 대화하며 이번 릴스의 주제를 확정합니다.
- reply: 수강생에게 할 말(2~4문장). 질문은 한 번에 하나만.
- chips: reply의 질문에 바로 누를 수 있는 추천 답변 2~4개(짧게). 항상 "그냥 알아서 해주세요"를 마지막에 넣습니다. 질문이 없으면 [].
- proposals: 주제 후보 3개(수강생이 주제를 못 정했거나 "제안해줘"를 원할 때). 각 후보는 title(주제 한 줄), angle(차별 관점), promise(시청자가 얻는 것), why(지금 이 분야에서 먹히는 이유; trending이 있으면 그 근거), category(분야). 후보를 낼 상황이 아니면 [].
- topic: 주제를 확정할 수 있을 만큼 정보가 모이면 ready=true와 함께 채웁니다. title, angle, promise, facts(수강생이 실제로 준 사실만, 없으면 []), audience(누구에게), category(분야). 아직이면 ready=false와 빈 값.
규칙: brief가 있으면 그 소재가 곧 주제이고, 질문과 제안은 그 소재 안에서만 합니다. 레퍼런스(sources)가 있으면 첫 질문은 그 형식을 수강생의 소재에 살리는 데 필요한 재료(형식이 요구하는 비교 대상, 경험, 기준 등)를 묻습니다. 질문은 한 번에 하나씩, 전체 대화에서 최대 3개. directive가 있으면 그 지시를 최우선으로 따릅니다. 수강생이 답한 사실은 facts에 그대로 담습니다. 수강생이 "알아서"라고 하면 더 묻지 말고 proposals 또는 topic으로 넘어갑니다. facts에 없는 사실을 title·promise에 넣지 않습니다. 분야(category)는 다음 중 하나: ${SUCCESS_REEL_CATEGORIES.join(', ')}.`

async function trendingFor(db, category) {
  let request = db.from('creator_success_reels').select('username,views,category,analysis').eq('visible', true).eq('analysis_status', 'ready')
  if (category && SUCCESS_REEL_CATEGORIES.includes(category)) request = request.eq('category', category)
  const rows = await query(request.order('analysis_requests', { ascending: false }).order('views', { ascending: false }).limit(6))
  return rows.map(r => ({ account: `@${r.username}`, category: r.category, views: r.views, topic: r.analysis?.overview?.topic, hookType: r.analysis?.hook?.category, hookFormula: r.analysis?.hook?.formula, format: r.analysis?.structure?.category }))
}

export async function openerMessage(deps, session) {
  const resolved = await resolveSources(deps.db, session.user_id, session.sources)
  if (!Object.keys(resolved).length) {
    return { content: '어떤 릴스를 만들어볼까요? 담고 싶은 내용을 편하게 적어주세요. 막막하면 "주제 제안해줘"를 눌러보세요.',
      meta: { chips: ['주제 제안해줘', '내 경험을 이야기하고 싶어요', '제품을 소개하고 싶어요'] } }
  }
  const providers = deps.makeProviders(new AbortController().signal)
  const raw = await providersJson(providers, 'studio-topic', topicPrompt, { ...sessionContext(session, resolved), event: '세션 시작. 레퍼런스 포맷을 한 문장으로 짚고 첫 질문을 하세요.' }, topicSchema)
  return normalizeTopicReply(raw)
}

function normalizeTopicReply(raw) {
  const topic = raw.topic?.ready && clean(raw.topic.title, 120) ? { title: clean(raw.topic.title, 120), angle: clean(raw.topic.angle, 200), promise: clean(raw.topic.promise, 200),
    facts: list(raw.topic.facts, 200, 12), audience: clean(raw.topic.audience, 120), category: SUCCESS_REEL_CATEGORIES.includes(raw.topic.category) ? raw.topic.category : '기타' } : null
  return { content: clean(raw.reply, 600) || '좋아요, 이어서 볼게요.', meta: { chips: list(raw.chips, 30, 4),
    proposals: (Array.isArray(raw.proposals) ? raw.proposals : []).map(p => ({ title: clean(p.title, 120), angle: clean(p.angle, 200), promise: clean(p.promise, 200), why: clean(p.why, 200),
      category: SUCCESS_REEL_CATEGORIES.includes(p.category) ? p.category : '기타' })).filter(p => p.title).slice(0, 3), topic } }
}

export async function chat(deps, session, messages, text) {
  const resolved = await resolveSources(deps.db, session.user_id, session.sources)
  const providers = deps.makeProviders(AbortSignal.timeout(120000))
  const recent = messages.slice(-12).map(m => ({ who: m.role === 'user' ? '수강생' : '훅ai', text: m.content }))
  if (session.stage === 'topic') {
    const style = await query(deps.db.from('studio_topics').select('topic,category').eq('user_id', session.user_id).order('created_at', { ascending: false }).limit(8))
    const wantsIdeas = /제안|추천|알아서|모르겠/.test(text)
    const trending = wantsIdeas || !Object.keys(resolved).length ? await trendingFor(deps.db, session.topic?.category) : []
    // Students lose patience after a few questions: settle the topic once they ask to, or after three answers.
    const answered = messages.filter(m => m.role === 'user').length
    const mustDecide = answered >= 3 || /충분|정해|확정|그만|알아서|그냥 해|바로 해|넘어가/.test(text)
    const directive = mustDecide ? '지금까지 모인 정보로 더 묻지 말고 topic.ready=true로 주제를 확정하세요. 빠진 사실은 facts에 넣지 말고(뒤 단계에서 묻습니다) title·promise는 아는 사실만으로 씁니다. chips는 [].' : '질문은 한 번에 하나. 이미 답을 받은 내용은 다시 묻지 않습니다.'
    const raw = await providersJson(providers, 'studio-topic', topicPrompt, { ...sessionContext(session, resolved), recentTopics: style.map(t => t.topic), trending, conversation: recent, userMessage: text, directive }, topicSchema)
    return normalizeTopicReply(raw)
  }
  // On the finished plan the student says what to change; the request decides which part is revised.
  const stage = session.stage === 'done' ? (/캡션|해시태그/.test(text) ? 'caption' : /썸네일|커버|제목/.test(text) ? 'thumbnail' : /첫 ?문장|훅/.test(text) && !/대본/.test(text) ? 'hook' : 'script') : session.stage
  const raw = await providersJson(providers, 'studio-revise', revisePrompt(stage), { ...sessionContext(session, resolved), conversation: recent, userMessage: text }, reviseSchema)
  const proposal = raw.proposal?.has ? normalizeProposal(stage, raw.proposal) : null
  return { content: clean(raw.reply, 800) || '네, 반영했어요.', meta: { chips: list(raw.chips, 30, 4), proposal } }
}

const reviseSchema = obj({ reply: str, chips: arr(str),
  proposal: obj({ has: bool, summary: str, text: str, onScreen: str, lines: arr(obj({ part: { type: 'string', enum: PARTS }, spoken: str, onScreen: str, seconds: num })), hashtags: arr(str) }) })
const revisePrompt = stage => `지금은 '${({ thumbnail: '썸네일 카피', hook: '첫 문장', script: '대본', filming: '촬영·편집', caption: '캡션' })[stage]}' 단계입니다. 수강생의 요청이나 질문에 답하고, 현재 내용을 고쳐 달라는 요청이면 proposal에 고친 결과를 담습니다.
- reply: 2~4문장. 무엇을 어떻게 바꿨는지, 또는 질문에 대한 답.
- chips: 이어서 누를 만한 짧은 요청 0~3개(예: "더 짧게", "더 친근하게").
- proposal.has: 고친 결과가 있으면 true. 없으면 false와 빈 값.
- 단계별 proposal: 썸네일·첫 문장 → text(고친 문장)와 onScreen(화면 자막). 대본 → lines(전체 대본, part는 hook/body/cta, seconds 포함). 캡션 → text(캡션 본문)와 hashtags(# 없이). 촬영·편집 → text에 조언만.
- summary: 바뀐 점 한 줄.
규칙: 수강생이 고친 부분은 유지하고 요청한 부분만 바꿉니다. 없는 사실을 넣지 않습니다. 대본은 말하듯 짧게.`

function normalizeProposal(stage, p) {
  if (stage === 'script') { const lines = normalizeLines(p.lines); return lines.length >= 2 ? { stage, summary: clean(p.summary, 200), lines } : null }
  if (stage === 'caption') { const text = clean(p.text, 2200); return text ? { stage, summary: clean(p.summary, 200), text, hashtags: list(p.hashtags, 40, 8).map(t => t.replace(/^#+/, '')) } : null }
  if (stage === 'thumbnail' || stage === 'hook') { const text = clean(p.text, 200); return text ? { stage, summary: clean(p.summary, 200), text, onScreen: clean(p.onScreen, 40) } : null }
  return null
}
const seconds = value => Number.isFinite(Number(value)) ? Math.max(1, Math.min(180, Math.round(Number(value)))) : 3
function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(l => ({ part: PARTS.includes(l?.part) ? l.part : 'body', spoken: clean(l?.spoken, 400), onScreen: clean(l?.onScreen, 60), seconds: seconds(l?.seconds) })).filter(l => l.spoken).slice(0, 24)
}

// ---------- stage generation ----------
const questions = arr(obj({ key: str, question: str, chips: arr(str) }))
export const THUMB_LABELS = ['심리 차용형', '후킹 강화형', '3단공식 적용형']
const stageSchemas = {
  thumbnail: obj({ questions, mechanism: str, options: arr(obj({ label: { type: 'string', enum: THUMB_LABELS }, text: str, why: str })), placeholders: arr(str) }),
  hook: obj({ questions, options: arr(obj({ spoken: str, onScreen: str, type: { type: 'string', enum: HOOK_TYPES }, why: str })), placeholders: arr(str) }),
  script: obj({ questions, options: arr(obj({ label: str, why: str, lines: arr(obj({ part: { type: 'string', enum: PARTS }, spoken: str, onScreen: str, seconds: num })) })), placeholders: arr(str) }),
  filming: obj({ questions, storyboard: arr(obj({ scene: num, seconds: num, shot: str, action: str, onScreen: str, spoken: str })), location: str, props: arr(str), camera: str, lighting: str, editing: str,
    editingPlan: obj({ subtitleStyle: str, cuts: str, transitions: str, effects: str, sound: str, checklist: arr(str) }), checklist: arr(str), placeholders: arr(str) }),
  caption: obj({ questions, options: arr(obj({ text: str, hashtags: arr(str), why: str })), placeholders: arr(str) }),
}
// Every stage asks before it invents. Facts the student already gave live in topic.facts/brief/attachments/answers.
const ASK_RULE = `질문 규칙: 없으면 이 영상이 성립하지 않는 사실(영상이 바로 그것에 대한 대상의 이름, 영상의 중심이 되는 경험이나 수치)이 topic.facts, brief, attachments, answers 어디에도 없을 때만 questions에 담아 먼저 묻습니다. 질문은 최대 2개, 한 번에 답할 수 있게 구체적으로. key는 짧은 식별자. chips는 바로 누를 수 있는 답 2~3개이며 그중 하나는 반드시 "알아서 해주세요"입니다. questions가 있으면 다른 항목은 전부 빈 값([] 또는 "")으로 둡니다. 그 밖의 세부(표현, 장면, 말투, 길이 등)는 묻지 말고 훅ai가 정합니다. "모름/없음/알아서/훅ai 재량"으로 답한 사실은 다시 묻지 않고, 그 사실 없이도 성립하게 씁니다. placeholders는 비워 둡니다.`
// After one round of questions (or once the student says "알아서"), 훅ai drafts with what it has: a quick draft the student can revise beats another question.
const NO_QUESTIONS = `이번에는 질문하지 않습니다(questions는 빈 배열). 이미 한 번 물었거나 수강생이 훅ai에게 맡겼습니다. 주어진 사실만으로 반드시 완성된 안을 냅니다.`

const stagePrompts = {
  thumbnail: `${ASK_RULE}\n'썸네일 카피' 단계입니다. 릴스 커버에 크게 넣을 제목 3안을 만듭니다. 각 20자 이내, 한눈에 읽히게.
먼저 mechanism에 한 줄로 적습니다: 레퍼런스(sources.hook, 없으면 주제 자체)가 시청자에게 일으킨 감정 → 이번 소재의 시청자가 그 감정을 느끼는 실제 순간.
options는 정확히 3개이고 label을 이 순서로 씁니다.
- "심리 차용형": mechanism의 순간을 제목으로.
- "후킹 강화형": 같은 감정을 더 강하게.
- "3단공식 적용형": 꾸미는 말 + 핵심 단어 + 끝맺는 말 구조. 레퍼런스와 무관하게 소재만으로.
why는 이 제목을 왜 누르게 되는지 한 줄.`,
  hook: `${ASK_RULE}\n'첫 문장' 단계입니다. 영상 첫 3초에 말할 문장 3개를 만듭니다. 고른 썸네일(thumbnail)이 한 약속을 첫 문장이 이어받아야 합니다.
1안: sources.hook이 일으킨 감정(why·type)을 이번 소재로 옮긴 말. 2·3안: 다른 훅 유형. spoken은 40자 이내 구어체, onScreen은 첫 화면 자막(15자 이내), type은 훅 유형, why는 왜 붙잡는지 한 줄.`,
  script: `${ASK_RULE}\n'대본' 단계입니다. 고른 첫 문장(hook)으로 시작하는 전체 대본을 서로 다른 전개 3안으로 만듭니다.
- sources.structure가 있으면 1안은 그 구간들의 역할과 순서·리듬을 이번 소재에 적용합니다(각 구간이 시청자에게 하는 일을 옮기는 것이지 그 구간의 문장을 옮기는 것이 아닙니다). 2·3안은 같은 첫 문장에서 시작하는 다른 전개 방식.
- label은 그 안의 전개 방식을 짧게, why는 어떤 시청자에게 맞는지 한 줄.
- lines: part는 hook/body/cta, spoken은 말할 문장(짧고 구어체), onScreen은 그 구간 자막, seconds는 구간 길이. 전체 길이는 sources.structure.durationSeconds와 비슷하게, 없으면 30~50초.
- 마무리는 sources의 마무리 장치를 옮기거나, 이 영상을 저장·공유할 이유가 되는 말로 씁니다.`,
  filming: `${ASK_RULE}\n'촬영·편집' 단계입니다. 확정된 대본(script)을 그대로 찍을 수 있게 장면 4~8개의 스토리보드와 촬영 가이드를 만듭니다.
- sources.filming.filming이 있으면 그 구도·화면 장치를 적용합니다. storyboard: scene 번호, seconds, shot(구도·거리), action(화면 속 행동·보여줄 것), onScreen(자막), spoken(그 장면 대사; script에서 그대로).
- 촬영: location, props(준비물), camera(거치·각도), lighting, checklist(촬영 전 확인 3~6개). 집·스마트폰으로 가능한 수준으로. editing에는 편집 방향 한 줄.
- 편집(editingPlan): sources.filming.editing이 있으면 그 자막 스타일·컷 템포·전환·효과·사운드를 적용합니다. subtitleStyle(자막 글꼴 느낌·크기·위치·색·강조), cuts(컷 길이·템포), transitions(전환), effects(줌·스탬프·그래픽 등), sound(배경음·효과음·나레이션), checklist(편집할 때 확인 3~6개). 휴대폰 편집 앱으로 가능한 수준으로.`,
  caption: `${ASK_RULE}\n'캡션' 단계입니다. 인스타 캡션 3안을 만듭니다. 첫 줄은 썸네일·첫 문장의 약속을 이어받고, 본문은 대본의 핵심을 2~4줄로, 마무리는 저장·댓글을 부르는 이유 한 줄. hashtags는 # 없이 5~8개.
sources.caption이 있으면 그 첫 줄 장치·본문 구조·마무리 방식을 따르고, sources.caption.original(원문)에 이모지가 쓰였으면 같은 느낌으로 이모지를 줄마다 자연스럽게 조합해 넣습니다(원문에 이모지가 없으면 넣지 않음). why는 이 캡션이 맞는 이유 한 줄. 없는 사실은 쓰지 않습니다.`,
}

// One round of questions per plan: afterwards (or once the student delegated) every stage drafts without asking.
export const mayAsk = session => !(session.topic?.askedStages?.length > 0) && !session.topic?.delegated
export async function generateStage(deps, session, stage) {
  const resolved = await resolveSources(deps.db, session.user_id, session.sources)
  const providers = deps.makeProviders(AbortSignal.timeout(240000))
  const context = sessionContext(session, resolved)
  const asking = mayAsk(session)
  let raw = await providersJson(providers, `studio-${stage}`, asking ? stagePrompts[stage] : `${stagePrompts[stage]}\n${NO_QUESTIONS}`, context, stageSchemas[stage])
  const parseAsks = value => (Array.isArray(value.questions) ? value.questions : []).map(q => ({ key: clean(q.key, 40) || 'info', question: clean(q.question, 300), chips: [...new Set([...list(q.chips, 40, 2), '알아서 해주세요'])] })).filter(q => q.question).slice(0, 2)
  let asks = parseAsks(raw)
  if (asks.length && asking) return { questions: asks, placeholders: [] }
  if (asks.length) {
    // 훅ai asked anyway: the unanswered points become its own call, and it drafts once more.
    const facts = [...(session.topic?.facts || []), ...asks.map(q => `${q.key}: 훅ai 재량(묻지 않고 정함)`)]
    raw = await providersJson(providers, `studio-${stage}`, `${stagePrompts[stage]}\n${NO_QUESTIONS}`, sessionContext({ ...session, topic: { ...(session.topic || {}), facts } }, resolved), stageSchemas[stage])
    asks = parseAsks(raw)
    if (asks.length) fail('STAGE_EMPTY', '훅ai가 초안을 내지 못했어요. 다시 시도해주세요.', 422)
  }
  const placeholders = list(raw.placeholders, 120, 12)
  if (stage === 'thumbnail') {
    // 훅ai writes the covers itself from the hook's psychology; the old cover-preserving generator copied the reference's wording.
    const options = (Array.isArray(raw.options) ? raw.options : []).map((o, i) => ({ text: clean(o.text, 40), why: clean(o.why, 200), label: THUMB_LABELS.includes(o.label) ? o.label : THUMB_LABELS[i] || '' })).filter(o => o.text).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '썸네일 카피를 만들지 못했어요. 다시 시도해주세요.', 422)
    return { value: { options, chosen: 0, custom: null, mechanism: clean(raw.mechanism, 300) }, placeholders }
  }
  if (stage === 'hook') {
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => ({ spoken: clean(o.spoken, 200), onScreen: clean(o.onScreen, 40), type: HOOK_TYPES.includes(o.type) ? o.type : '기타', why: clean(o.why, 200) })).filter(o => o.spoken).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '첫 문장을 만들지 못했어요. 다시 시도해주세요.', 422)
    return { value: { options, chosen: 0, custom: null }, placeholders }
  }
  if (stage === 'script') {
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => ({ label: clean(o.label, 40), why: clean(o.why, 200), lines: normalizeLines(o.lines) })).filter(o => o.lines.length >= 2).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '대본을 만들지 못했어요. 다시 시도해주세요.', 422)
    return { value: { options, chosen: 0, edited: null }, placeholders }
  }
  if (stage === 'filming') {
    const storyboard = (Array.isArray(raw.storyboard) ? raw.storyboard : []).map((s, i) => ({ scene: i + 1, seconds: seconds(s?.seconds), shot: clean(s?.shot, 200), action: clean(s?.action, 300), onScreen: clean(s?.onScreen, 60), spoken: clean(s?.spoken, 400) })).filter(s => s.action || s.spoken).slice(0, 10)
    if (storyboard.length < 2) fail('STAGE_EMPTY', '스토리보드를 만들지 못했어요. 다시 시도해주세요.', 422)
    const ep = raw.editingPlan || {}
    return { value: { storyboard, location: clean(raw.location, 200), props: list(raw.props, 80, 10), camera: clean(raw.camera, 300), lighting: clean(raw.lighting, 200), editing: clean(raw.editing, 300), checklist: list(raw.checklist, 200, 6),
      editingPlan: { subtitleStyle: clean(ep.subtitleStyle, 300), cuts: clean(ep.cuts, 300), transitions: clean(ep.transitions, 200), effects: clean(ep.effects, 300), sound: clean(ep.sound, 200), checklist: list(ep.checklist, 200, 6) } }, placeholders }
  }
  if (stage === 'caption') {
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => ({ text: typeof o.text === 'string' ? o.text.normalize('NFC').trim().slice(0, 2200) : '', hashtags: list(o.hashtags, 40, 8).map(t => t.replace(/^#+/, '').replace(/\s+/g, '')), why: clean(o.why, 200) })).filter(o => o.text).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '캡션을 만들지 못했어요. 다시 시도해주세요.', 422)
    return { value: { options, chosen: 0, edited: null }, placeholders }
  }
  fail('STAGE_UNKNOWN', '알 수 없는 단계예요.')
}

// A student's answer to a parked question: record it as a fact, ask the next one, or resume the stage.
export async function answerAsk(deps, session, text) {
  const ask = session.ask
  const current = ask.questions[ask.index]
  const answer = text.trim()
  const unknown = /^(없|몰라|모르|모름|스킵|skip|건너|없어)/.test(answer)
  const delegated = /알아서|맡길|맡겨|그냥 해|그냥해|아무거나|상관없|넘어가|니가 정|네가 정|훅ai가 정/.test(answer)
  const facts = [...(session.topic?.facts || []), `${current.key}: ${delegated ? `훅ai 재량(수강생이 맡김) — ${answer}` : unknown ? `없음(수강생이 모름) — ${answer}` : answer}`].slice(-30)
  const topic = { ...(session.topic || {}), facts, delegated: Boolean(session.topic?.delegated || delegated) }
  // "알아서" ends the questions: the remaining ones are 훅ai's call too.
  const next = delegated ? ask.questions.length : ask.index + 1
  if (delegated) for (const q of ask.questions.slice(ask.index + 1)) topic.facts = [...topic.facts, `${q.key}: 훅ai 재량(수강생이 맡김)`].slice(-30)
  if (next < ask.questions.length) {
    await query(deps.db.from('studio_sessions').update({ topic, ask: { ...ask, index: next }, updated_at: new Date().toISOString() }).eq('id', session.id))
    return { reply: { content: ask.questions[next].question, meta: { chips: ask.questions[next].chips, ask: ask.questions[next].key } }, resumed: false }
  }
  await query(deps.db.from('studio_sessions').update({ topic, ask: null, updated_at: new Date().toISOString() }).eq('id', session.id))
  await startStage(deps, { ...session, topic, ask: null }, ask.stage, { force: true })
  return { reply: { content: '고마워요. 받은 내용으로 바로 만들게요.', meta: { chips: [] } }, resumed: true }
}

const message = error => error?.exposeMessage ? error.message : '훅ai가 잠시 멈췄어요. 다시 시도해주세요.'

// Background stage job; the session row carries the job state the screen polls.
export function runStageJob(deps, sessionId, stage) {
  return (deps.schedule || schedule)(`studio:${sessionId}:${stage}`, async () => {
    const db = deps.db
    try {
      const session = await query(db.from('studio_sessions').select('*').eq('id', sessionId).single())
      const { value, placeholders, questions: asks } = await generateStage(deps, session, stage)
      if (asks) {
        // 훅ai needs facts first: park the stage, ask the first question in chat, wait for answers.
        const topic = { ...(session.topic || {}), askedStages: [...(session.topic?.askedStages || []), stage] }
        await query(db.from('studio_sessions').update({ topic, ask: { stage, questions: asks, index: 0 }, job_status: 'idle', job_stage: null, job_error: null, updated_at: new Date().toISOString() }).eq('id', sessionId))
        await query(db.from('studio_messages').insert({ session_id: sessionId, user_id: session.user_id, role: 'hookai', stage, content: asks[0].question, meta: { chips: asks[0].chips, ask: asks[0].key } }))
        return
      }
      const merged = [...new Set([...(session.placeholders || []), ...placeholders])].slice(0, 20)
      await query(db.from('studio_sessions').update({ [stage]: value, placeholders: merged, ask: null, job_status: 'idle', job_stage: null, job_error: null, updated_at: new Date().toISOString() }).eq('id', sessionId))
    } catch (error) {
      await query(db.from('studio_sessions').update({ job_status: 'failed', job_error: message(error), updated_at: new Date().toISOString() }).eq('id', sessionId)).catch(() => {})
    }
  })
}

export async function startStage(deps, session, stage, { force = false } = {}) {
  if (!STAGE_ORDER.includes(stage) || stage === 'topic' || stage === 'done') fail('STAGE_UNKNOWN', '알 수 없는 단계예요.')
  if (!session.topic?.title) fail('TOPIC_REQUIRED', '먼저 주제를 정해주세요.', 409)
  const patch = { stage, updated_at: new Date().toISOString() }
  const stale = session.job_status === 'running' && Date.parse(session.job_started_at) < Date.now() - 6 * 60000
  if (session.job_status === 'running' && !stale) return { ...session, ...patch }
  if (force || !session[stage]) Object.assign(patch, { job_status: 'running', job_stage: stage, job_error: null, job_started_at: new Date().toISOString() })
  await query(deps.db.from('studio_sessions').update(patch).eq('id', session.id))
  if (patch.job_status === 'running') runStageJob(deps, session.id, stage)
  return { ...session, ...patch }
}

// ---------- formulas ----------
// A formula stores structure, not prose, so reusing it means applying a pattern rather than copying lines.
export function formulaFromSession(session, resolved, kind) {
  const chosen = (field) => { const f = session[field]; if (!f) return null; if (f.custom) return { text: f.custom }; return f.options?.[f.chosen ?? 0] ?? null }
  if (kind === 'hook') {
    const hook = chosen('hook'); if (!hook) return null
    // The source formula only applies when the student kept the source's hook device.
    const sourceType = resolved.hook?.excerpt?.type
    const type = hook.type || sourceType || '기타'
    return { title: `첫 문장: ${hook.spoken || hook.text}`.slice(0, 80), spec: { type, formula: type === sourceType ? resolved.hook?.excerpt?.formula || '' : '', spoken: hook.spoken || hook.text, onScreen: hook.onScreen || '' }, example: hook.spoken || hook.text || '' }
  }
  if (kind === 'structure') {
    const lines = session.script?.edited || chosen('script')?.lines; if (!lines?.length) return null
    const segments = lines.map(l => [PART_LABELS[l.part], `${l.seconds}초 · ${l.onScreen || '자막 없음'}`])
    return { title: `전개: ${session.script?.options?.[session.script?.chosen ?? 0]?.label || session.topic?.title || '내 전개'}`.slice(0, 80),
      spec: { format: resolved.structure?.excerpt?.format || '', segments, totalSeconds: lines.reduce((s, l) => s + l.seconds, 0) }, example: lines.map(l => l.spoken).join('\n').slice(0, 1200) }
  }
  if (kind === 'filming') {
    const f = session.filming; if (!f) return null
    const e = f.editingPlan || {}
    return { title: `촬영/편집: ${f.storyboard?.[0]?.shot || session.topic?.title || '내 촬영 방식'}`.slice(0, 80),
      spec: { shots: (f.storyboard || []).map(s => s.shot), camera: f.camera, lighting: f.lighting, location: f.location, subtitleStyle: e.subtitleStyle, cuts: e.cuts, transitions: e.transitions, effects: e.effects, sound: e.sound,
        onScreenStyle: (f.storyboard || []).map(s => s.onScreen).filter(Boolean).slice(0, 4) }, example: [f.camera, e.subtitleStyle].filter(Boolean).join(' / ') }
  }
  if (kind === 'caption') {
    const c = session.caption?.edited || chosen('caption'); if (!c) return null
    const linesOf = String(c.text || '').split('\n').filter(Boolean)
    return { title: `캡션: ${linesOf[0] || session.topic?.title || '내 캡션'}`.slice(0, 80), spec: { firstLine: linesOf[0] || '', bodyLines: linesOf.length - 1, ending: linesOf[linesOf.length - 1] || '', hashtags: c.hashtags || [] }, example: c.text || '' }
  }
  return null
}

// 내 공식 straight from a reel analysis (분석 결과 화면의 저장 버튼), same shapes as formulaFromSession.
export function formulaFromReel(reel, kind) {
  const a = reel?.analysis; if (!a) return null
  const source = { shortcode: reel.shortcode, username: reel.username || null }
  if (kind === 'hook') {
    const h = a.hook || {}; if (!h.spokenHook && !h.formula) return null
    return { title: `첫 문장: ${h.spokenHook || h.formula}`.slice(0, 80), spec: { type: h.category || '기타', formula: h.formula || '', spoken: h.spokenHook || '', onScreen: h.visualHook || '' }, example: h.spokenHook || '', source }
  }
  if (kind === 'structure') {
    const st = a.structure || {}; if (!st.steps?.length && !st.description) return null
    return { title: `전개: ${st.category || st.description || '레퍼런스 전개'}`.slice(0, 80), spec: { format: st.category || '', description: st.description || '', segments: (st.steps || []).map(step => [step.role || '', step.purpose || '']), totalSeconds: a.durationSeconds || 0 },
      example: String(a.transcript?.korean || '').slice(0, 1200), source }
  }
  if (kind === 'filming') {
    const f = a.filming || {}, e = a.editing || {}; if (!f.shotType && !f.location && !e.subtitleStyle) return null
    return { title: `촬영/편집: ${f.shotType || f.location || '레퍼런스 촬영'}`.slice(0, 80), spec: { location: f.location || '', shotType: f.shotType || '', onScreen: f.onScreen || '', guide: f.guide || [],
      subtitleStyle: e.subtitleStyle || f.textOverlay || '', cuts: e.cuts || f.editing || '', transitions: e.transitions || '', effects: e.effects || '', sound: e.sound || '', editingGuide: e.guide || [] },
      example: [f.shotType, e.subtitleStyle || f.textOverlay].filter(Boolean).join(' / '), source }
  }
  if (kind === 'caption') {
    const c = a.caption; if (!c && !reel.caption) return null
    const firstLine = String(reel.caption || '').split('\n').find(Boolean) || ''
    return { title: `캡션: ${firstLine || c?.firstLine || '레퍼런스 캡션'}`.slice(0, 80), spec: { firstLine: c?.firstLine || '', structure: c?.structure || '', cta: c?.cta || '', hashtags: c?.hashtags || '', analysis: c?.analysis || '' }, example: String(reel.caption || '').slice(0, 1200), source }
  }
  return null
}

// ---------- style ----------
const styleSchema = obj({ card: obj({ tone: str, sentence: str, signature: arr(str), avoid: arr(str), ending: str, summary: str }) })
export async function buildStyleCard(deps, { description, choices, samples }) {
  const providers = deps.makeProviders(AbortSignal.timeout(90000))
  const raw = await providersJson(providers, 'studio-style', `수강생의 말투를 한 장의 카드로 정리합니다. description(본인 설명), choices(객관식), samples(직접 쓴 대본·캡션)를 보고 tone(존댓말/반말·분위기), sentence(문장 길이·리듬), signature(자주 쓰는 표현·버릇 2~5개), avoid(이 사람이 안 쓸 표현 1~4개), ending(마무리 습관), summary(한 줄 요약)를 씁니다. samples에 없는 특징을 지어내지 않습니다.`,
    { description, choices, samples: String(samples || '').slice(0, 6000) }, styleSchema)
  const c = raw.card || {}
  return { tone: clean(c.tone, 120), sentence: clean(c.sentence, 160), signature: list(c.signature, 60, 5), avoid: list(c.avoid, 60, 4), ending: clean(c.ending, 120), summary: clean(c.summary, 160) }
}

export { nextStage, STAGE_ORDER, SLOT_LABELS }
