import { query } from '../store.js'
import { fail } from '../domain.js'
import { HOOKAI_SYSTEM, STAGE_ORDER, nextStage } from './persona.js'
import { HOOK_TYPES, STORY_FORMATS, schedule } from '../success-reel-analysis.js'
import { SUCCESS_REEL_CATEGORIES } from '../categories.js'
import { estimateLineSeconds } from '../../../../shared/script-duration.mjs'
import { COVER_PRINCIPLES, COVER_PRINCIPLE_NAMES, coverHint, SCRIPT_PRINCIPLES, HOOK_PRINCIPLES } from './copy-principles.js'
import { fieldKnowledge } from './knowledge.js'
import { libraryEntry, coverKnowledge, provenFormulas } from './formula-study.js'
import { prepareTopic, researchFresh } from './research.js'

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
      const excerpt = slot === 'hook' ? { type: a.hook?.category, why: a.hook?.analysis, formula: a.hook?.formula, original: { note: '레퍼런스 원문(작동 원리를 이해하는 참고용, 단어·장면을 옮기지 않음)', spokenHook: a.hook?.spokenHook, visualHook: a.hook?.visualHook } }
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
      const entry = slot === 'hook' || slot === 'structure' ? await libraryEntry(db, slot, source.id) : null
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
    // What 훅ai looked up on the web about the topic before planning (public facts with sources).
    research: session.topic?.research && !session.topic.research.failed ? { subject: session.topic.research.subject, facts: session.topic.research.facts, reviews: session.topic.research.reviews || [], unconfirmed: session.topic.research.unconfirmed || [], viewerQuestions: session.topic.research.viewerQuestions, avoid: session.topic.research.avoid } : null,
    // How 훅ai read the student's key words at the cover stage, so every later stage keeps the same meaning.
    briefReading: session.thumbnail?.plan?.terms?.length ? { terms: session.thumbnail.plan.terms, purpose: session.thumbnail.plan.purpose } : null,
    thumbnail: chosen('thumbnail'), hook: chosen('hook'),
    script: session.script?.edited || chosen('script')?.lines || null,
    filming: session.filming ? { storyboard: session.filming.storyboard, editing: session.filming.editing, editingPlan: session.filming.editingPlan, memo: session.memo } : null,
    caption: session.caption?.edited || chosen('caption'),
    placeholders: session.placeholders || [],
    voice: session.style_snapshot || null,
    ...extras,
  }
}

// What 훅ai has learned about the plan's field from its daily study; null until the field is known and studied.
const knowledgeFor = async (db, session) => ({ fieldKnowledge: await fieldKnowledge(db, session.topic?.category) })

const providersJson = (providers, op, instructions, input, schema) => providers.json(op, `${HOOKAI_SYSTEM}\n\n${instructions}`, input, [], schema)

// ---------- topic chat ----------
const topicSchema = obj({
  reply: str, chips: arr(str),
  proposals: arr(obj({ title: str, angle: str, promise: str, why: str, category: str })),
  topic: obj({ ready: bool, title: str, angle: str, promise: str, facts: arr(str), audience: str, category: str }),
})
// Suggested answers steer what students type, and what they type decides how good the plan can be.
const CHIP_RULE = '추천 답변(chips)은 수강생이 누르기만 해도 기획안이 강해지는 답이어야 합니다. 서로 다른 방향의 답을 수강생 입장의 짧은 말로 씁니다. 각 답은 research(조사한 사실·구매자 후기·시청자 궁금증)와 fieldKnowledge(이 분야에서 터지는 주제·시청자 말투)에서 시청자를 붙잡을 재료가 되는 구체적인 내용으로 쓰고, 어떤 주제에나 붙는 막연한 답은 쓰지 않습니다. 수강생 본인의 경험·사실을 묻는 질문이면 수강생이 사실대로 고를 수 있도록 실제로 흔한 서로 다른 상황을 제시합니다(맞는 것이 없으면 수강생이 직접 적습니다).'
const topicPrompt = `지금은 '주제 정하기' 단계입니다. 수강생과 대화하며 이번 릴스의 주제를 확정합니다.
- reply: 수강생에게 할 말(2~4문장). 질문은 한 번에 하나만.
- chips: reply의 질문에 바로 누를 수 있는 추천 답변 2~4개. ${CHIP_RULE} 항상 "그냥 알아서 해주세요"를 마지막에 넣습니다. 질문이 없으면 [].
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
  // With something written already, 훅ai looks it up first, so its first question and suggested answers use the research.
  if (String(session.brief || '').trim().length >= 4 && !researchFresh(session)) session = await prepareTopic(deps, session, deps.makeProviders(AbortSignal.timeout(180000)), { research: true, category: false })
  const resolved = await resolveSources(deps.db, session.user_id, session.sources)
  if (!Object.keys(resolved).length && !session.topic?.research) {
    return { content: '어떤 릴스를 만들어볼까요? 담고 싶은 내용을 편하게 적어주세요. 막막하면 "주제 제안해줘"를 눌러보세요.',
      meta: { chips: ['주제 제안해줘', '내 경험을 이야기하고 싶어요', '제품을 소개하고 싶어요'] } }
  }
  const providers = deps.makeProviders(new AbortController().signal)
  const raw = await providersJson(providers, 'studio-topic', topicPrompt, { ...sessionContext(session, resolved, await knowledgeFor(deps.db, session)), event: '세션 시작. 레퍼런스 포맷을 한 문장으로 짚고 첫 질문을 하세요.' }, topicSchema)
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
  const providers = deps.makeProviders(AbortSignal.timeout(480000))
  const recent = messages.slice(-12).map(m => ({ who: m.role === 'user' ? '수강생' : '훅ai', text: m.content }))
  if (session.stage === 'topic') {
    if (String(session.brief || '').trim().length >= 4 && !researchFresh(session)) session = await prepareTopic(deps, session, deps.makeProviders(AbortSignal.timeout(180000)), { research: true, category: false })
    const style = await query(deps.db.from('studio_topics').select('topic,category').eq('user_id', session.user_id).order('created_at', { ascending: false }).limit(8))
    const wantsIdeas = /제안|추천|알아서|모르겠/.test(text)
    const trending = wantsIdeas || !Object.keys(resolved).length ? await trendingFor(deps.db, session.topic?.category) : []
    // Students lose patience after a few questions: settle the topic once they ask to, or after three answers.
    const answered = messages.filter(m => m.role === 'user').length
    const mustDecide = answered >= 3 || /충분|정해|확정|그만|알아서|그냥 해|바로 해|넘어가/.test(text)
    const directive = mustDecide ? '지금까지 모인 정보로 더 묻지 말고 topic.ready=true로 주제를 확정하세요. 빠진 사실은 facts에 넣지 말고(뒤 단계에서 묻습니다) title·promise는 아는 사실만으로 씁니다. chips는 [].' : '질문은 한 번에 하나. 이미 답을 받은 내용은 다시 묻지 않습니다.'
    const raw = await providersJson(providers, 'studio-topic', topicPrompt, { ...sessionContext(session, resolved, await knowledgeFor(deps.db, session)), recentTopics: style.map(t => t.topic), trending, conversation: recent, userMessage: text, directive }, topicSchema)
    return normalizeTopicReply(raw)
  }
  // On the finished plan the student says what to change; the request decides which part is revised.
  const stage = session.stage === 'done' ? (/캡션|해시태그/.test(text) ? 'caption' : /썸네일|커버|제목/.test(text) ? 'thumbnail' : /첫 ?문장|훅/.test(text) && !/대본/.test(text) ? 'hook' : 'script') : session.stage
  const input = { ...sessionContext(session, resolved, await knowledgeFor(deps.db, session)), conversation: recent, userMessage: text }
  let raw = await providersJson(providers, 'studio-revise', revisePrompt(stage), input, reviseSchema)
  // A revision that misses a condition the student set is rewritten once, with the misses named.
  const missed = revision => (revision.proposal?.has && Array.isArray(revision.proposal.requests) ? revision.proposal.requests : []).filter(r => r && r.met === false).map(r => clean(r.condition, 160)).filter(Boolean)
  const misses = missed(raw)
  if (misses.length) raw = await providersJson(providers, 'studio-revise', `${revisePrompt(stage)}\n방금 쓴 결과를 대조했더니 이 조건을 지키지 못했습니다: ${misses.join(' / ')}. 결과를 처음부터 다시 써서 모든 조건을 지키고, 다시 대조합니다.`, input, reviseSchema)
  const proposal = raw.proposal?.has ? normalizeProposal(stage, raw.proposal) : null
  return { content: clean(raw.reply, 800) || '네, 반영했어요.', meta: { chips: list(raw.chips, 30, 4), proposal } }
}

// Field order is writing order: the revision is written first, then checked against the student's conditions,
// and only then described, so the reply reports what the text actually does instead of what was intended.
const reviseSchema = obj({
  proposal: obj({ has: bool, text: str, onScreen: str, lines: arr(obj({ part: { type: 'string', enum: PARTS }, spoken: str, onScreen: str, seconds: num })), hashtags: arr(str),
    requests: arr(obj({ condition: str, evidence: str, met: bool })), summary: str }),
  reply: str, chips: arr(str) })
const revisePrompt = stage => `지금은 '${({ thumbnail: '썸네일 카피', hook: '첫 문장', script: '대본', filming: '촬영·편집', caption: '캡션' })[stage]}' 단계입니다. 수강생의 요청이나 질문에 답하고, 현재 내용을 고쳐 달라는 요청이면 proposal에 고친 결과를 담습니다.
쓰는 순서대로 채웁니다.
- proposal.has: 고친 결과가 있으면 true. 없으면 false와 빈 값.
- 단계별 proposal: 썸네일·첫 문장 → text(고친 문장)와 onScreen(화면 자막). 대본 → lines(전체 대본, part는 hook/body/cta, seconds 포함). 캡션 → text(캡션 본문)와 hashtags(# 없이). 촬영·편집 → text에 조언만.
- proposal.requests: 다 쓴 결과를 수강생의 요청과 하나씩 대조합니다. 이번 요청과, 대화에서 수강생이 앞서 정해 두어 아직 유효한 조건을 각각 condition으로 적고, 방금 쓴 결과에서 그 조건이 어떻게 드러나는지 evidence에 실제 글자 그대로 옮긴 뒤 met을 판정합니다. 개수·위치·순서·길이·뺄 것·넣을 것처럼 글자로 확인할 수 있는 조건은 세어서 확인하고, 단어에 대한 조건은 그 단어가 다른 말과 붙어 쓰인 경우까지 겉모양 그대로 셉니다.
- proposal.summary: 결과에서 실제로 바뀐 점 한 줄.
- reply: 2~4문장. 결과에 실제로 반영된 것만 말합니다. met이 false인 조건이 있으면 무엇을 못 지켰고 왜인지 그대로 말합니다. 질문이면 그 답.
- chips: 지금 결과를 시청자가 더 끝까지 보게 만들 다음 수정 요청 0~3개. 이 기획안에서 가장 약한 곳(넘길 위험이 있는 줄, 더 구체적일 수 있는 장면, 흐릿한 약속)을 짚은 이 기획안만의 구체적인 요청으로 쓰고, 어느 기획안에나 붙는 일반 요청은 쓰지 않습니다.
규칙: 수강생이 고친 부분은 유지하고 요청한 부분만 바꿉니다. 수강생이 건 조건은 결과 전체에서 지킵니다. 없는 사실을 넣지 않습니다. 대본은 말하듯 짧게.`

function normalizeProposal(stage, p) {
  if (stage === 'script') { const lines = normalizeLines(p.lines); return lines.length >= 2 ? { stage, summary: clean(p.summary, 200), lines } : null }
  if (stage === 'caption') { const text = clean(p.text, 2200); return text ? { stage, summary: clean(p.summary, 200), text, hashtags: list(p.hashtags, 40, 8).map(t => t.replace(/^#+/, '')) } : null }
  if (stage === 'thumbnail' || stage === 'hook') { const text = clean(p.text, 200); return text ? { stage, summary: clean(p.summary, 200), text, onScreen: clean(p.onScreen, 40) } : null }
  return null
}
const seconds = value => Number.isFinite(Number(value)) ? Math.max(1, Math.min(180, Math.round(Number(value)))) : 3
function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(l => ({ part: PARTS.includes(l?.part) ? l.part : 'body', spoken: clean(l?.spoken, 400), onScreen: clean(l?.onScreen, 60) })).filter(l => l.spoken).slice(0, 24)
    // Seconds come from the words, not the model's guess, so the editor, print view and saved formulas agree.
    .map(l => ({ ...l, seconds: estimateLineSeconds(l.spoken) }))
}

// ---------- stage generation ----------
const questions = arr(obj({ key: str, question: str, chips: arr(str) }))
// What 훅ai found when it re-read its own draft (persona rule 8); anything listed triggers one rewrite.
const check = obj({ referenceTraces: arr(str), unprovidedFacts: arr(str), swipeRisks: arr(str) })
const stageSchemas = {
  thumbnail: obj({ questions, plan: obj({ terms: arr(obj({ word: str, meaning: str })), purpose: str, reader: str, promise: str, quotes: arr(str) }), check, options: arr(obj({ label: { type: 'string', enum: COVER_PRINCIPLE_NAMES }, text: str, why: str })), placeholders: arr(str) }),
  hook: obj({ questions, check, options: arr(obj({ spoken: str, onScreen: str, type: { type: 'string', enum: HOOK_TYPES }, why: str })), placeholders: arr(str) }),
  script: obj({ questions, check, options: arr(obj({ label: str, why: str, lines: arr(obj({ part: { type: 'string', enum: PARTS }, spoken: str, onScreen: str, seconds: num })) })), placeholders: arr(str) }),
  filming: obj({ questions, storyboard: arr(obj({ scene: num, seconds: num, shot: str, action: str, onScreen: str, spoken: str })), location: str, props: arr(str), camera: str, lighting: str, editing: str,
    editingPlan: obj({ subtitleStyle: str, cuts: str, transitions: str, effects: str, sound: str, checklist: arr(str) }), checklist: arr(str), placeholders: arr(str) }),
  caption: obj({ questions, check, options: arr(obj({ text: str, hashtags: arr(str), why: str })), placeholders: arr(str) }),
}
// Every stage asks before it invents. Facts the student already gave live in topic.facts/brief/attachments/answers.
// What 훅ai learned in common from success reels (공식 사전 entries with how many success reels use each).
const PROVEN_NOTE = 'provenFormulas는 훅ai가 성공 릴스를 매일 공부하며 확인한 첫 문장·전개 공식과 그 공식을 쓴 성공 릴스 수(reels)입니다. 공식의 작동 원리를 이번 소재에 옮기는 것이지, 공식 문장을 빈칸 채우기로 쓰는 것이 아닙니다.'
// Self-check before finishing: the lines a viewer would swipe away on. What is still left after fixing triggers one rewrite.
const SWIPE_CHECK = '다 쓴 뒤 시청자 입장에서 한 줄씩 다시 봅니다. 넘기고 싶어지는 줄(궁금한 게 없거나, 예고만 하거나, 누구나 할 수 있는 말이거나, 앞의 말을 반복하거나, 소리 내 읽었을 때 앞뒤가 이어지지 않아 말이 안 되는 줄)을 찾아 고친 최종본을 냅니다. 고치지 못하고 남은 줄만 check.swipeRisks에 그 줄과 이유로 적습니다.'
const ASK_RULE = `질문 규칙: 없으면 이 영상이 성립하지 않는 사실(영상이 바로 그것에 대한 대상의 이름, 영상의 중심이 되는 경험이나 수치)이 topic.facts, brief, attachments, answers 어디에도 없을 때만 questions에 담아 먼저 묻습니다. 질문은 최대 2개, 한 번에 답할 수 있게 구체적으로. key는 짧은 식별자. chips는 바로 누를 수 있는 답 2~3개이며 그중 하나는 반드시 "알아서 해주세요"입니다. ${CHIP_RULE} questions가 있으면 다른 항목은 전부 빈 값([] 또는 "")으로 둡니다. 그 밖의 세부(표현, 장면, 말투, 길이 등)는 묻지 말고 훅ai가 정합니다. "모름/없음/알아서/훅ai 재량"으로 답한 사실은 다시 묻지 않고, 그 사실 없이도 성립하게 씁니다. placeholders는 비워 둡니다.`
// After one round of questions (or once the student says "알아서"), 훅ai drafts with what it has: a quick draft the student can revise beats another question.
const NO_QUESTIONS = `이번에는 질문하지 않습니다(questions는 빈 배열). 이미 한 번 물었거나 수강생이 훅ai에게 맡겼습니다. 주어진 사실만으로 반드시 완성된 안을 냅니다.`

const stagePrompts = {
  // Covers are 훅ai's own copywriting from the student's topic; references are not sent to this stage.
  thumbnail: `${ASK_RULE}\n'썸네일 카피' 단계입니다. 릴스 커버에 크게 넣을 제목 3안을 훅ai가 직접 제안합니다. 레퍼런스는 이 단계에 쓰지 않습니다. 근거는 brief·topic·answers·attachments에 적힌 주제와 사실, 그리고 research(훅ai가 출처와 함께 조사한 대상의 사실과 시청자가 궁금해하는 점)입니다.
1. plan을 먼저 채웁니다. terms: brief·답변의 핵심 단어(소재, 하려는 일)를 원문 그대로 word에 적고, meaning에 그 단어의 사전적인 뜻을 풀어 씁니다(외래어·줄임말은 원래 말의 뜻으로). meaning은 단어를 바르게 읽기 위한 것이고, 제목에는 풀어 쓴 뜻이 아니라 수강생이 쓴 원래 표현을 그대로 씁니다. purpose: terms의 뜻만으로 이 영상이 '누가 무엇을 하려는 영상인지' 한 문장. 이후 reader·promise·제목은 모두 purpose에서 출발하고, terms의 뜻에 없는 사건이나 상황을 새로 만들지 않습니다. purpose는 수강생이 하려는 일(소개·추천·후기 등)이고, promise는 시청자가 이 영상을 보고 얻는 것입니다. promise는 research.facts에서 이 대상이 시청자에게 실제로 해 주는 일과 research.viewerQuestions에서 시청자가 알고 싶은 것을 찾아 정하고, '소개한다'처럼 수강생의 목적을 그대로 약속으로 쓰지 않습니다. quotes: 이번 커버들이 기대는 brief·답변·첨부·research의 구절을 한 글자도 바꾸지 않고 그대로 옮겨 적습니다(바꿔 쓰거나 요약하지 않음). reader: 이 커버를 보고 멈춰야 할 사람과 그 사람이 지금 처한 상황 한 줄. promise: 이 영상을 끝까지 보면 그 사람이 얻는 것 한 가지(한 영상에 약속 하나). reader와 promise, 그리고 모든 제목은 quotes에 적은 구절로 뒷받침되는 내용만 담습니다.
successCovers는 실제로 조회수가 크게 나온 커버 문구들입니다. 각 문구가 어떤 원칙으로 먹혔는지(길이, 말투, 구어 표현, 숫자·장소·대상의 쓰임) 읽어 이번 커버의 감각을 맞춥니다. 그 문구의 단어·소재·문장 틀은 가져오지 않습니다.
coverLessons는 훅ai가 분야와 상관없이 성공 릴스의 커버를 매일 공부해 쌓은 교훈입니다(lessons: 원칙이 실제로 쓰이는 방식과 이유, form: 성공한 커버의 겉모양). 원칙을 고르고 다듬는 근거로 쓰되, 이번 주제와 수강생이 쓴 말이 먼저입니다.
2. 아래 커버 카피 원칙 중 이 주제·이 사람에게 가장 잘 맞는 서로 다른 3개를 골라 한 안에 하나씩 적용합니다. label에는 고른 원칙 이름을 씁니다. 세 안 모두 같은 promise를 다른 방식으로 겨눕니다.
${COVER_PRINCIPLES.map(p => `- ${p.name}: ${p.how}`).join('\n')}
3. 쓰는 기준: 각 20자 안팎의 한 구절. 판매자·제품 자랑이 아니라 시청자가 얻는 것으로. 단어를 쉼표로 늘어놓지 않고 말이 되게 잇습니다. 무엇이·얼마나·어떻게가 빠진 막연한 결과 표현이나 어디에나 붙는 유행어로 때우지 않고, 이 주제에서만 나올 수 있는 구체적인 말을 씁니다. 숫자·기간·가격·할인·한정·성분·사용법 같은 사실은 brief나 research(훅ai가 출처와 함께 조사한 사실)에 있을 때만. research의 구체적인 사실(무엇을 어떻게 해 주는지, 시청자가 궁금해하는 점)은 막연한 말 대신 쓸 재료입니다.
4. 다 쓰고 점검합니다. 소리 내 읽었을 때 걸리는 데가 없는가. 같은 분야의 다른 계정이 그대로 가져다 써도 말이 되는 일반론이면 이 주제의 구체적인 사실·장면으로 다시 씁니다. 각 제목이 말하는 상황·사건이 purpose와 같은 일을 말하는지, quotes의 구절이 brief·답변·첨부·research에 그 단어, 그 뜻 그대로 있는지 하나씩 대조합니다. 주어지지 않은 사실이나 원문을 다르게 읽은 내용이 들어갔으면 check.unprovidedFacts에 적습니다.
why는 이 제목을 왜 누르게 되는지 시청자 입장에서 한 줄.`,
  hook: `${ASK_RULE}\n'첫 문장' 단계입니다. 영상 첫 3초에 말할 문장 3개를 만듭니다. 고른 썸네일(thumbnail)이 한 약속을 첫 문장이 이어받아야 합니다.
1안: sources.hook이 있으면 그것이 일으킨 감정(why·type)을 이번 소재로 옮긴 말, 없으면 provenFormulas.hooks 중 이번 약속에 가장 맞는 공식의 작동 원리를 이번 소재로 옮긴 말. 2·3안: 서로 다른 훅 유형.
첫 문장의 기준:
${HOOK_PRINCIPLES.map(p => `- ${p}`).join('\n')}
${PROVEN_NOTE}
spoken은 40자 이내 구어체, onScreen은 첫 화면 자막(15자 이내), type은 훅 유형, why는 왜 붙잡는지 한 줄.
${SWIPE_CHECK}`,
  script: `${ASK_RULE}\n'대본' 단계입니다. 고른 첫 문장(hook)으로 시작하는 전체 대본을 서로 다른 전개 3안으로 만듭니다.
- sources.structure가 있으면 1안은 그 구간들의 역할과 순서·리듬을 이번 소재에 적용합니다(각 구간이 시청자에게 하는 일을 옮기는 것이지 그 구간의 문장을 옮기는 것이 아닙니다). 2·3안은 같은 첫 문장에서 시작하는 다른 전개 방식. sources.structure가 없으면 provenFormulas.structures 중 이번 소재·약속에 맞는 서로 다른 공식을 골라 안마다 하나씩 적용합니다.
- 모든 안은 아래 대본 원칙을 지킵니다.
${SCRIPT_PRINCIPLES.map(p => `  - ${p.name}: ${p.how}`).join('\n')}
${PROVEN_NOTE}
- label은 그 안의 전개 방식을 짧게, why는 어떤 시청자에게 맞는지 한 줄.
- lines: part는 hook/body/cta, spoken은 말할 문장(짧고 구어체), onScreen은 그 구간 자막, seconds는 구간 길이. 전체 길이는 sources.structure.durationSeconds와 비슷하게, 없으면 30~50초.
- 마무리는 sources의 마무리 장치를 옮기거나, 이 영상을 저장·공유할 이유가 되는 말로 씁니다.
${SWIPE_CHECK}`,
  filming: `${ASK_RULE}\n'촬영·편집' 단계입니다. 확정된 대본(script)을 그대로 찍을 수 있게 장면 4~8개의 스토리보드와 촬영 가이드를 만듭니다.
- sources.filming.filming이 있으면 그 구도·화면 장치를 적용합니다. storyboard: scene 번호, seconds, shot(구도·거리), action(화면 속 행동·보여줄 것), onScreen(자막), spoken(그 장면 대사; script에서 그대로).
- 촬영: location, props(준비물), camera(거치·각도), lighting, checklist(촬영 전 확인 3~6개). 집·스마트폰으로 가능한 수준으로. editing에는 편집 방향 한 줄.
- 편집(editingPlan): sources.filming.editing이 있으면 그 자막 스타일·컷 템포·전환·효과·사운드를 적용합니다. subtitleStyle(자막 글꼴 느낌·크기·위치·색·강조), cuts(컷 길이·템포), transitions(전환), effects(줌·스탬프·그래픽 등), sound(배경음·효과음·나레이션), checklist(편집할 때 확인 3~6개). 휴대폰 편집 앱으로 가능한 수준으로.`,
  caption: `${ASK_RULE}\n'캡션' 단계입니다. 인스타 캡션 3안을 만듭니다. 첫 줄은 썸네일·첫 문장의 약속을 이어받고, 본문은 대본의 핵심을 2~4줄로, 마무리는 저장·댓글을 부르는 이유 한 줄. hashtags는 # 없이 5~8개.
sources.caption이 있으면 그 첫 줄 장치·본문 구조·마무리 방식을 따르고, sources.caption.original(원문)에 이모지가 쓰였으면 같은 느낌으로 이모지를 줄마다 자연스럽게 조합해 넣습니다(원문에 이모지가 없으면 넣지 않음). why는 이 캡션이 맞는 이유 한 줄. 없는 사실은 쓰지 않습니다.`,
}

const plain = value => String(value || '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// After a quoted phrase the student's text must go on with a space, punctuation or a particle/ending (는·를·에…),
// never with the rest of a longer word: a quote that stops mid-word is a misreading of that word.
const PARTICLE_START = new Set([...'은는이가을를에의도로와과랑만요서까고다며면께처보부및엔인한해했하던든'])
const HANGUL = /[\uAC00-\uD7A3]/
// Quotes the student did not write: checked against their own words (brief, chat answers, attachments) and the topic
// title they accepted; topic.facts is 훅ai's summary, so it does not count as a source. Spacing differences are ignored.
export function ungroundedQuotes(session, quotes) {
  const source = plain([session.brief, ...(session.topic?.answers || []).map(a => typeof a === 'string' ? a : `${a?.q || a?.question || ''} ${a?.a || a?.answer || ''}`), ...(session.attachments || []).map(a => a?.content), session.topic?.title, session.topic?.research?.subject, ...(session.topic?.research?.facts || []), ...(session.topic?.research?.viewerQuestions || [])].join(' \n '))
  const grounded = quote => {
    const chars = [...plain(quote).replace(/ /g, '')]
    if (!chars.length) return true
    const re = new RegExp(chars.map(escapeRe).join(' ?'), 'g')
    for (const m of source.matchAll(re)) {
      const next = source[m.index + m[0].length]
      if (!next || !HANGUL.test(next) || PARTICLE_START.has(next)) return true
    }
    return false
  }
  return (Array.isArray(quotes) ? quotes : []).map(q => String(q || '').trim()).filter(q => q && !grounded(q)).slice(0, 4)
}

// Cover titles that came with 추천 reels (proven covers), same field first, as worked examples for the thumbnail stage.
export async function successCovers(db, category, limit = 12) {
  const rows = await query(db.from('creator_success_reels').select('cover_title,category').eq('recommended', true).not('cover_title', 'is', null).limit(200)).catch(() => [])
  const same = rows.filter(r => category && r.category === category), rest = rows.filter(r => !(category && r.category === category))
  return [...same, ...rest].map(r => r.cover_title).filter(Boolean).slice(0, limit)
}

// One round of questions per plan: afterwards (or once the student delegated) every stage drafts without asking.
export const mayAsk = session => !(session.topic?.askedStages?.length > 0) && !session.topic?.delegated
export async function generateStage(deps, session, stage) {
  // The first draft of a plan waits for its field and web research; later stages reuse what is saved.
  if (stage !== 'topic' && session.topic?.title && (!researchFresh(session) || !session.topic.categoryChecked)) session = await prepareTopic(deps, session, deps.makeProviders(AbortSignal.timeout(180000)))
  const resolved = stage === 'thumbnail' ? {} : await resolveSources(deps.db, session.user_id, session.sources)
  const providers = deps.makeProviders(AbortSignal.timeout(240000))
  const knowledge = { ...(await knowledgeFor(deps.db, session)), ...(stage === 'hook' || stage === 'script' ? { provenFormulas: await provenFormulas(deps.db) } : {}) }
  const context = stage === 'thumbnail' ? { ...sessionContext(session, resolved, knowledge), successCovers: await successCovers(deps.db, session.topic?.category), coverLessons: await coverKnowledge(deps.db) } : sessionContext(session, resolved, knowledge)
  const asking = mayAsk(session)
  let raw = await providersJson(providers, `studio-${stage}`, asking ? stagePrompts[stage] : `${stagePrompts[stage]}\n${NO_QUESTIONS}`, context, stageSchemas[stage])
  const parseAsks = value => (Array.isArray(value.questions) ? value.questions : []).map(q => ({ key: clean(q.key, 40) || 'info', question: clean(q.question, 300), chips: [...new Set([...list(q.chips, 60, 3), '알아서 해주세요'])] })).filter(q => q.question).slice(0, 2)
  let asks = parseAsks(raw)
  if (asks.length && asking) return { questions: asks, placeholders: [] }
  if (asks.length) {
    // 훅ai asked anyway: the unanswered points become its own call, and it drafts once more.
    const facts = [...(session.topic?.facts || []), ...asks.map(q => `${q.key}: 훅ai 재량(묻지 않고 정함)`)]
    raw = await providersJson(providers, `studio-${stage}`, `${stagePrompts[stage]}\n${NO_QUESTIONS}`, sessionContext({ ...session, topic: { ...(session.topic || {}), facts } }, resolved, knowledge), stageSchemas[stage])
    asks = parseAsks(raw)
    if (asks.length) fail('STAGE_EMPTY', '훅ai가 초안을 내지 못했어요. 다시 시도해주세요.', 422)
  }
  const found = raw.check ? [...list(raw.check.referenceTraces, 80, 6), ...list(raw.check.unprovidedFacts, 80, 6), ...(stage === 'hook' || stage === 'script' ? list(raw.check.swipeRisks, 120, 6).map(r => `시청자가 넘길 줄: ${r}`) : [])] : []
  // Grounding: a cover may only lean on words the student actually wrote. A "quote" that is not in their text
  // means 훅ai re-read a word as something else, so the draft is rewritten from the original words.
  if (stage === 'thumbnail') found.push(...ungroundedQuotes(session, [...(raw.plan?.quotes || []), ...(raw.plan?.terms || []).map(t => t?.word)]).map(q => `원문에 없는 구절을 원문처럼 인용함: "${q}"`))
  if (found.length) {
    raw = await providersJson(providers, `studio-${stage}`, `${stagePrompts[stage]}\n${NO_QUESTIONS}\n방금 쓴 초안을 점검했더니 다음이 걸렸습니다: ${found.join(' / ')}. ${stage === 'thumbnail' ? '이 단계의 쓰는 기준' : stage === 'hook' || stage === 'script' ? '이 단계의 기준과 원칙 7' : '원칙 7'}을 처음부터 다시 적용해서, 이것들이 없는 안으로 새로 씁니다.`, context, stageSchemas[stage])
  }
  const placeholders = list(raw.placeholders, 120, 12)
  if (stage === 'thumbnail') {
    // Each cover names the copy principle it uses; the hint tells a first-time student what that principle does.
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => { const label = COVER_PRINCIPLE_NAMES.includes(o.label) ? o.label : ''; return { text: clean(o.text, 40), why: clean(o.why, 200), label, hint: coverHint(label) } }).filter(o => o.text).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '썸네일 카피를 만들지 못했어요. 다시 시도해주세요.', 422)
    const terms = (Array.isArray(raw.plan?.terms) ? raw.plan.terms : []).map(t => ({ word: clean(t?.word, 40), meaning: clean(t?.meaning, 120) })).filter(t => t.word && t.meaning).slice(0, 8)
    return { value: { options, chosen: 0, custom: null, plan: raw.plan ? { terms, purpose: clean(raw.plan.purpose, 200), reader: clean(raw.plan.reader, 200), promise: clean(raw.plan.promise, 200) } : null }, placeholders }
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
