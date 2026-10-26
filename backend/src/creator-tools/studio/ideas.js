import { query } from '../store.js'
import { HOOKAI_SYSTEM } from './persona.js'
import { SUCCESS_REEL_CATEGORIES } from '../categories.js'
import { THUMBNAIL_BUCKET } from '../success-reels.js'
import { fieldKnowledge } from './knowledge.js'
import { researchTopic } from './research.js'
import { trendingFor, CHIP_RULE } from './engine.js'

// 주제 찾기: a conversation with 훅ai only about finding the topic, before any plan exists. A good plan starts from a
// topic concrete enough to film, so 훅ai draws out what the student has, uses what it knows about the field, recent
// success reels and web research, and proposes topic cards the student can save and later turn into a plan.

const str = { type: 'string' }
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = items => ({ type: 'array', items })
const category = { type: 'string', enum: SUCCESS_REEL_CATEGORIES }
const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/[ \t]+/g, ' ').trim().slice(0, max) : ''
const list = (value, max, count) => Array.isArray(value) ? value.map(v => clean(v, max)).filter(Boolean).slice(0, count) : []

export const ideaSchema = obj({
  lookup: str,
  category,
  cards: arr(obj({ title: str, angle: str, promise: str, why: str, evidence: arr(str), materials: arr(str), category })),
  reply: str,
  chips: arr(str),
})

export const ideaPrompt = `지금은 '주제 찾기' 대화입니다. 기획안을 쓰기 전에 수강생과 이야기하며, 시청자를 붙잡을 릴스 주제를 함께 찾습니다. 좋은 기획안은 구체적인 주제에서 시작합니다.
- 구체적인 주제란 누가(어떤 시청자) 어떤 순간·고민에서 무엇을 얻는지, 화면에 무엇을 보여줄지가 보이는 주제입니다. 분야 이름이나 막연한 팁 묶음은 주제가 아닙니다.
- 대화: 수강생이 가진 재료(팔거나 소개할 것, 직접 겪은 일, 잘 아는 것, 계정 방향)를 한 번에 하나씩 묻습니다. 이미 답한 것은 다시 묻지 않습니다. 수강생이 추천을 원하거나 맡기면, 또는 재료가 모이면 묻지 않고 cards를 냅니다. 질문만 이어가지 말고 세 번째 답 안에는 cards를 냅니다.
- lookup: 수강생이 특정 제품·서비스·장소·정보 주제를 꺼냈는데 research가 그 대상을 다루지 않으면, 그 대상을 검색할 정확한 이름을 적고 cards는 비웁니다(훅ai가 조사한 뒤 다시 답합니다). 그 밖에는 빈 문자열.
- category: 지금까지 대화로 보이는 분야(모르면 기타).
- cards: 주제 후보 3개, 서로 다른 각도. title은 영상이 무엇인지 바로 보이는 한 줄, angle은 같은 소재의 다른 영상과 다른 점, promise는 시청자가 얻는 것, why는 지금 이 주제가 먹히는 이유를 실제 근거로(fieldKnowledge.topics, trending의 최근 터진 릴스, research의 사실·구매자 후기·시청자 궁금증 중), evidence는 why의 근거를 짧게 2~3개, materials는 이 주제를 찍으려면 수강생에게 필요한 경험·사실·장면 2~4개(수강생이 이미 말한 것은 빼고), category는 분야. cards를 낼 상황이 아니면 [].
- 수강생이 말하지 않은 경험·성과·수치를 주제에 넣지 않습니다. 필요한 것은 materials에 적어 둡니다.
- savedTopics와 recentTopics는 수강생이 이미 저장했거나 만든 주제입니다. 같은 주제를 다시 내지 않습니다.
- reply: 수강생에게 할 말 2~4문장. cards를 냈으면 무엇을 보고 골랐는지 짧게.
- chips: reply의 질문에 바로 누를 수 있는 추천 답변 2~4개. ${CHIP_RULE} cards를 냈으면 고른 뒤 이어갈 요청(더 구체적으로 좁히기, 다른 각도 등)을 이 카드들에 맞게. 마지막은 "알아서 추천해주세요".`

// Success reels that worked in the card's field, shown under each card as proof and as a reference to analyze.
async function reelsFor(db, field, limit = 2) {
  let request = db.from('creator_success_reels').select('shortcode,username,views,thumbnail_path,category').eq('visible', true).eq('analysis_status', 'ready')
  if (field && field !== '기타') request = request.eq('category', field)
  const rows = await query(request.order('views', { ascending: false }).limit(limit)).catch(() => [])
  const paths = rows.map(r => r.thumbnail_path).filter(Boolean)
  const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)).catch(() => []) : []
  const urls = new Map((signed || []).filter(i => i.signedUrl).map(i => [i.path, i.signedUrl]))
  return rows.map(r => ({ id: r.shortcode, username: r.username, views: r.views, thumbnailUrl: urls.get(r.thumbnail_path) || null }))
}

export async function ideaReply(deps, thread, messages, text) {
  const { db } = deps
  const providers = deps.makeProviders(AbortSignal.timeout(480000))
  const [style, made, saved] = await Promise.all([
    query(db.from('studio_styles').select('card').eq('user_id', thread.user_id).maybeSingle()).catch(() => null),
    query(db.from('studio_topics').select('topic').eq('user_id', thread.user_id).order('created_at', { ascending: false }).limit(10)).catch(() => []),
    query(db.from('studio_saved_topics').select('title').eq('user_id', thread.user_id).order('created_at', { ascending: false }).limit(20)).catch(() => []),
  ])
  const conversation = messages.slice(-16).map(m => ({ who: m.role === 'user' ? '수강생' : '훅ai', text: m.content }))
  let research = thread.research || null
  const ask = async () => {
    const field = SUCCESS_REEL_CATEGORIES.includes(thread.category) ? thread.category : null
    const input = { conversation, userMessage: text, voice: style?.card || null, recentTopics: made.map(t => t.topic), savedTopics: saved.map(t => t.title),
      research: research && !research.failed ? { subject: research.subject, facts: research.facts, reviews: research.reviews || [], viewerQuestions: research.viewerQuestions, avoid: research.avoid } : null,
      fieldKnowledge: await fieldKnowledge(db, field), trending: await trendingFor(db, field).catch(() => []) }
    return providers.json('studio-ideas', `${HOOKAI_SYSTEM}\n\n${ideaPrompt}`, input, [], ideaSchema)
  }
  let raw = await ask()
  if (SUCCESS_REEL_CATEGORIES.includes(raw?.category)) thread.category = raw.category
  // 훅ai asked for a lookup: research the named subject once, then answer with what it found.
  const lookup = clean(raw?.lookup, 120)
  if (lookup && !(research?.subject && research.subject.includes(lookup))) {
    research = await researchTopic(providers, { brief: [lookup, ...conversation.filter(m => m.who === '수강생').map(m => m.text)].join('\n').slice(0, 3000), topic: { title: lookup } }).catch(() => null)
    if (research) await query(db.from('studio_idea_threads').update({ research, updated_at: new Date().toISOString() }).eq('id', thread.id)).catch(() => {})
    raw = await ask()
  }
  const cards = await Promise.all((Array.isArray(raw?.cards) ? raw.cards : []).map(async c => {
    const field = SUCCESS_REEL_CATEGORIES.includes(c?.category) ? c.category : thread.category || '기타'
    return { title: clean(c?.title, 120), angle: clean(c?.angle, 240), promise: clean(c?.promise, 240), why: clean(c?.why, 400), evidence: list(c?.evidence, 160, 3),
      materials: list(c?.materials, 160, 4), category: field, reels: await reelsFor(db, field) }
  }))
  return { content: clean(raw?.reply, 800) || '좋아요, 이어서 같이 찾아볼게요.', meta: { chips: list(raw?.chips, 40, 4), cards: cards.filter(c => c.title).slice(0, 3) },
    category: thread.category || null }
}
