import { query } from '../store.js'
import { fail } from '../domain.js'
import { HOOKAI_SYSTEM } from './persona.js'
import { COVER_PRINCIPLES, COVER_PRINCIPLE_NAMES, coverHint } from './copy-principles.js'
import { canOpenReel } from '../success-reel-analysis.js'
import { isCarousel } from '../success-reels.js'
import { fieldKnowledge } from './knowledge.js'
import { prepareTopic, readBrief, researchFresh } from './research.js'
import { ungroundedQuotes } from './engine.js'
import { CAROUSEL_TEMPLATES, CAROUSEL_TEMPLATE_IDS, carouselTemplate, MAX_CAROUSEL_SLIDES, COVER_KICKER_LIMIT, COVER_TITLE_LIMIT, slideOverflows, slideLength, longLines } from '../../../../shared/carousel-templates.mjs'

// 캐러셀 만들기: 훅ai plans a carousel in the order a student thinks about it — the cover title, the whole body,
// the split into slides — and the browser designs the slides from a template. Kept apart from the reel plans.
export const CAROUSEL_STAGES = ['cover', 'body', 'slides', 'design', 'caption', 'done']
export const CAROUSEL_SLOTS = ['structure', 'design', 'caption']
export const nextCarouselStage = stage => CAROUSEL_STAGES[Math.min(CAROUSEL_STAGES.length - 1, CAROUSEL_STAGES.indexOf(stage) + 1)]

const str = { type: 'string' }
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = items => ({ type: 'array', items })
const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/\\(['"])/g, '$1').replace(/[ \t]+/g, ' ').trim().slice(0, max) : ''
const list = (value, max, count) => Array.isArray(value) ? value.map(v => clean(v, max)).filter(Boolean).slice(0, count) : []
// Slide text keeps its line breaks; emphasis markers that do not close are dropped rather than shown as asterisks.
const block = (value, max) => { const text = typeof value === 'string' ? value.normalize('NFC').replace(/\r/g, '').split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, max) : ''
  return (text.match(/\*\*/g) || []).length % 2 ? text.replace(/\*\*/g, '') : text }

// The persona was written for reels; a carousel is read, not heard.
const CAROUSEL_SYSTEM = `${HOOKAI_SYSTEM}

[이번 작업]
이번에 만드는 것은 영상이 아니라 인스타그램 캐러셀(여러 장을 옆으로 넘기며 읽는 게시물)입니다. 위 원칙의 '영상·대본·시청자'는 '캐러셀·본문·읽는 사람'으로 읽습니다. 말로 하는 문장이 아니라 눈으로 읽는 글이므로, 한 장에 들어갈 만큼 짧고, 소리 없이 읽어도 뜻이 한 번에 들어와야 합니다.
이번에는 질문하지 않습니다. 화자 본인만 아는 사실(본인의 사례·수치·경력·가격)이 꼭 필요한 자리는 지어내지 않고 [대괄호] 빈칸으로 남기고, 그 빈칸을 placeholders에 적습니다.
수강생이 brief에 적은 자기 경험과 숫자는 화자 본인의 사실입니다. 단서를 달지 않고 그대로 말합니다. 글 안에서 스스로 말의 무게를 깎지 않습니다: 사실 여부를 한발 물리는 말, 개인차를 알리는 말, 의견일 뿐이라고 밝히는 말을 덧붙이지 않습니다. 말할 수 있는 것은 단정해서 말하고, 근거가 없어 단정할 수 없는 것(왜 그런지에 대한 추측, 확인되지 않은 원리)은 단서를 달아 넣는 대신 아예 쓰지 않습니다.
why·templateWhy·reply처럼 수강생이 읽는 설명은 수강생의 말로 씁니다. 입력 자료의 이름(brief, units, slides 같은 작업 용어)을 꺼내지 않고, 읽는 사람에게 어떤 일이 일어나는지를 말합니다.
revision이 있으면 수강생이 방금 만든 안(previous)을 보고 요청(request)한 것입니다. 요청한 점을 고치되, 요청하지 않은 부분의 방향은 유지합니다.`

// ---------- references ----------
// A carousel plan borrows three things: how a post is ordered (structure), how it looks (design) and how its caption
// works. A reel can lend its flow and caption; only a carousel can lend a design.
export async function resolveCarouselSources(db, userId, sources = {}) {
  const resolved = {}
  for (const slot of CAROUSEL_SLOTS) {
    const id = sources?.[slot]?.id
    if (!id) continue
    const reel = await query(db.from('creator_success_reels').select('shortcode,username,caption,analysis,analysis_status,category,visible,owner_user_id,source').eq('shortcode', id).maybeSingle())
    if (!(await canOpenReel(db, reel, userId))) fail('SOURCE_NOT_FOUND', '레퍼런스를 찾을 수 없어요.', 404)
    if (reel.analysis_status !== 'ready') fail('SOURCE_NOT_READY', '아직 분석이 끝나지 않은 레퍼런스가 있어요.', 409)
    const a = reel.analysis, carousel = isCarousel(a)
    if (slot === 'design' && !carousel) fail('SOURCE_NOT_CAROUSEL', '디자인은 캐러셀 레퍼런스에서만 가져올 수 있어요.', 422)
    const note = '짜임만 따르는 참고용입니다. 레퍼런스의 소재·사실·수치·문장·사진은 가져오지 않습니다.'
    const excerpt = slot === 'structure' ? (carousel
      ? { kind: 'carousel', note, format: a.structure?.category, description: a.structure?.description, why: a.structure?.analysis,
        slides: (a.structure?.slides || []).map(s => ({ n: s.n, role: s.role, turn: s.turn, text: String(s.text || '').slice(0, 200) })) }
      : { kind: 'reel', note, format: a.structure?.category, description: a.structure?.description, why: a.structure?.analysis,
        steps: (a.structure?.steps || []).map(s => ({ role: s.role, purpose: s.purpose })) })
      : slot === 'design' ? { note: '틀의 종류와 색 조합만 참고합니다.', frame: a.design?.frame, background: a.design?.background, emphasis: a.design?.emphasis, textAmount: a.design?.textAmount, imageUse: a.design?.imageUse, colors: a.design?.colors || [] }
        : { note, ...(a.caption || {}), original: String(reel.caption || '').slice(0, 700) }
    resolved[slot] = { id: reel.shortcode, label: `@${reel.username}`, kind: carousel ? 'carousel' : 'reel', excerpt,
      permalink: String(reel.source || '').startsWith('upload') && reel.source !== 'upload-link' ? null : `https://www.instagram.com/${carousel ? 'p' : 'reel'}/${reel.shortcode}/` }
  }
  return resolved
}
const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const normalizeCarouselSources = value => ({ ...Object.fromEntries(CAROUSEL_SLOTS.map(slot => [slot, value?.[slot]?.id])
  .filter(([, id]) => typeof id === 'string' && /^[A-Za-z0-9_-]{5,60}$/.test(id)).map(([slot, id]) => [slot, { id }])),
  ...(typeof value?.plan?.id === 'string' && PLAN_ID.test(value.plan.id) ? { plan: { id: value.plan.id.toLowerCase() } } : {}) })

// 릴스·캐러셀 동시 제작: a carousel started from a reel plan tells the same story. The reel plan as the student has it
// now (cover copy, first line, script, caption) is read on every stage, so later edits to the reel carry over.
const planLines = s => { const lines = s?.edited || s?.options?.[s?.chosen ?? 0]?.lines; return Array.isArray(lines) ? lines.map(l => clean(l?.spoken, 400)).filter(Boolean) : [] }
const planPick = f => clean(f?.custom || f?.options?.[f?.chosen ?? 0]?.text || f?.options?.[f?.chosen ?? 0]?.spoken || '', 200)
export async function companionPlan(db, row) {
  const id = row.sources?.plan?.id
  if (!id) return null
  const plan = await query(db.from('studio_sessions').select('id,title,topic,thumbnail,hook,script,caption').eq('id', id).eq('user_id', row.user_id).maybeSingle()).catch(() => null)
  if (!plan) return null
  const script = planLines(plan.script), caption = plan.caption?.edited || plan.caption?.options?.[plan.caption?.chosen ?? 0]
  const input = { note: '수강생이 같은 주제로 먼저 만든 릴스 기획안입니다. 이 캐러셀은 그 릴스와 같은 이야기를 합니다: 화자의 사실·숫자·경험과 핵심 주장은 여기서 가져옵니다. 대본은 귀로 듣는 말이므로 문장을 옮기지 않고, 눈으로 읽는 캐러셀에 맞게 새로 씁니다.',
    title: clean(plan.title || plan.topic?.title, 120), thumbnail: planPick(plan.thumbnail), firstLine: planPick(plan.hook), script, caption: clean(caption?.text, 2200) }
  return { id: plan.id, title: input.title, input, text: [input.thumbnail, input.firstLine, ...script, input.caption].filter(Boolean).join('\n') }
}
// The reel plan's words count as the student's own when a carousel quotes them.
const withPlan = (row, plan) => plan ? { ...row, attachments: [...(row.attachments || []), { content: plan.text }] } : row

// ---------- what a carousel plan holds, as the student has it now ----------
export const chosenCover = row => { const c = row.cover; if (!c) return null; if (c.custom) return { text: c.custom, kicker: c.customKicker || '' }; const o = c.options?.[c.chosen ?? 0]; return o ? { text: o.text, kicker: o.kicker || '' } : null }
export const chosenBody = row => { const b = row.body; if (!b) return null; if (b.edited) return b.edited; const o = b.options?.[b.chosen ?? 0]; return o ? { units: o.units, closing: o.closing } : null }
export const chosenCaption = row => { const c = row.caption; if (!c) return null; return c.edited || c.options?.[c.chosen ?? 0] || null }

function context(row, resolved, extras = {}) {
  const research = row.topic?.research
  return {
    brief: row.brief,
    ...(row.topic?.requests?.length ? { requests: { note: '수강생이 적은 만들기 요청. 모든 단계에서 지킵니다(주제가 아님).', items: row.topic.requests } } : {}),
    topic: row.topic ? { title: row.topic.title, category: row.topic.category } : null,
    research: research && !research.failed ? { subject: research.subject, facts: research.facts, reviews: research.reviews || [], unconfirmed: research.unconfirmed || [], viewerQuestions: research.viewerQuestions, avoid: research.avoid } : null,
    sources: Object.fromEntries(Object.entries(resolved).map(([slot, s]) => [slot, { from: s.label, ...s.excerpt }])),
    coverReading: row.cover?.plan?.terms?.length ? { terms: row.cover.plan.terms, purpose: row.cover.plan.purpose, promise: row.cover.plan.promise } : null,
    cover: chosenCover(row),
    body: chosenBody(row),
    slides: row.slides?.items?.map(s => ({ role: s.role, heading: s.heading, text: s.text })) || null,
    caption: chosenCaption(row),
    voice: row.style_snapshot || null,
    ...extras,
  }
}

// ---------- stage prompts ----------
const coverSchema = obj({
  plan: obj({ terms: arr(obj({ word: str, meaning: str })), purpose: str, quotes: arr(str), reader: str, promise: str }),
  options: arr(obj({ label: { type: 'string', enum: COVER_PRINCIPLE_NAMES }, kicker: str, text: str, why: str })),
  check: obj({ unprovidedFacts: arr(str) }), placeholders: arr(str),
})
const coverPrompt = `'표지 제목' 단계입니다. 캐러셀 첫 장에 크게 넣을 제목 3안을 훅ai가 직접 제안합니다. 레퍼런스는 이 단계에 쓰지 않습니다. 근거는 brief·topic에 적힌 주제와 사실, 그리고 research(훅ai가 출처와 함께 조사한 대상의 사실과 읽는 사람이 궁금해하는 점)입니다.
1. plan을 먼저 채웁니다. terms: brief의 핵심 단어(소재, 하려는 일)를 원문 그대로 word에 적고 meaning에 그 단어의 사전적인 뜻을 풉니다. meaning은 단어를 바르게 읽기 위한 것이고, 제목에는 수강생이 쓴 원래 표현을 씁니다. purpose: terms의 뜻만으로 이 캐러셀이 '누가 무엇을 하려는 글인지' 한 문장. quotes: 이번 제목들이 기대는 brief·research의 구절을 한 글자도 바꾸지 않고 옮겨 적습니다. reader: 이 표지를 보고 멈춰야 할 사람과 그 사람이 지금 처한 상황 한 줄. promise: 끝까지 넘겨 본 사람이 얻는 것 한 가지를 그것만 짧게 적습니다(한 캐러셀에 약속 하나). promise는 수강생의 목적(소개·추천)을 그대로 쓰지 않고, research에서 이 대상이 읽는 사람에게 실제로 해 주는 일과 궁금해하는 점에서 찾습니다.
2. 아래 표지 카피 원칙 중 이 주제·이 사람에게 가장 잘 맞는 서로 다른 3개를 골라 한 안에 하나씩 적용합니다. label에는 고른 원칙 이름을 씁니다. 세 안 모두 같은 promise를 다른 방식으로 겨눕니다.
${COVER_PRINCIPLES.map(p => `- ${p.name}: ${p.how}`).join('\n')}
3. 쓰는 기준. 표지는 피드와 프로필 격자에서 손톱만 하게 보이고, 누르는 게 아니라 옆으로 넘기게 만드는 것이 일입니다. text는 작게 봐도 한눈에 읽히는 한 구절이고(${COVER_TITLE_LIMIT}자 이내, 두 문장으로 나누지 않음), kicker는 제목 위에 작게 놓는 한 줄입니다(${COVER_KICKER_LIMIT}자 이내). kicker는 제목이 누구에게 하는 말인지, 또는 제목을 읽고 생기는 물음을 먼저 꺼내는 일을 하며, 제목만으로 충분하면 빈 문자열로 둡니다(제목을 되풀이하지 않음). 제목은 판매자·제품 자랑이 아니라 읽는 사람이 얻는 것으로 쓰고, 단어를 쉼표로 늘어놓지 않고 말이 되게 잇습니다. 무엇이·얼마나·어떻게가 빠진 막연한 결과 표현이나 어디에나 붙는 유행어로 때우지 않고, 이 주제에서만 나올 수 있는 구체적인 말을 씁니다. 숫자·기간·가격 같은 사실은 brief나 research에 있을 때만 씁니다. 제목에 숫자를 걸면 본문이 실제로 그 개수를 다뤄야 합니다.
4. 다 쓰고 점검합니다. 같은 분야의 다른 계정이 그대로 가져다 써도 말이 되는 일반론이면 이 주제의 구체적인 사실·장면으로 다시 씁니다. 각 제목이 말하는 상황이 purpose와 같은 일을 말하는지, quotes의 구절이 brief·research에 그 단어, 그 뜻 그대로 있는지 대조합니다. 주어지지 않은 사실이 들어갔으면 check.unprovidedFacts에 적습니다.
why는 이 표지를 본 사람이 왜 다음 장으로 넘기게 되는지 읽는 사람 입장에서 한 줄.`

const bodySchema = obj({
  options: arr(obj({ label: str, why: str, units: arr(obj({ text: str })), closing: str })),
  check: obj({ unprovidedFacts: arr(str), referenceTraces: arr(str), swipeRisks: arr(str) }), placeholders: arr(str),
})
const bodyPrompt = `'본문 기획' 단계입니다. 표지(cover) 다음 장부터 마지막 장 앞까지 들어갈 내용 전체를 3안으로 씁니다. 아직 장으로 나누지 않고, 내용의 덩어리(units)를 읽는 순서대로 적습니다. 한 덩어리는 한 가지만 말하고, 나중에 한 장이 되거나 옆 덩어리와 한 장에 묶입니다.
- 약속: 표지 제목이 건 약속 하나를 끝까지 따라갑니다. 첫 덩어리는 인사·자기소개 없이 그 약속을 받아 곧바로 이야기를 엽니다. 약속을 받치지 않는 내용은 넣지 않습니다. 표지에 건 숫자가 있으면 본문이 그 개수를 그대로 다룹니다.
- 넘김: 읽는 사람은 장마다 그만 볼지 정합니다. 각 덩어리는 그것만 읽어도 얻는 것이 있어야 하고, 동시에 다음을 넘겨야 할 이유(아직 안 나온 답, 번호가 알려 주는 남은 개수, 뒤집힐 것이라는 낌새, 끝나지 않은 문장)를 남깁니다. 아무것도 주지 않고 다음 장을 예고만 하는 덩어리는 쓰지 않습니다.
- 구체: 숫자·장면·예시·순서처럼 저장해 두고 다시 볼 만한 것으로 채웁니다. 같은 분야의 누가 써도 되는 일반론은 이 주제의 사실로 다시 씁니다. 사실은 brief와 research에 있는 것만 씁니다.
- 글: 한 덩어리는 짧은 줄 1~4개입니다(줄바꿈으로 구분). 한 줄은 한 호흡에 읽히는 길이로 끊습니다. 설명하는 글이 아니라 말을 거는 글로 쓰되, voice가 있으면 그 말투를 따릅니다.
- 덩어리 수: 주제가 필요로 하는 만큼. 표지와 마지막 장을 더해 ${MAX_CAROUSEL_SLIDES}장을 넘지 않게 합니다.
- closing: 마지막 장에 넣을 한두 줄입니다. 이 캐러셀을 저장하거나 공유하거나 댓글을 남길 실제 이유를 주는 말로 씁니다. 본문과 상관없이 어디에나 붙는 인사·부탁으로 끝내지 않습니다.
- sources.structure가 있으면 1안은 그 짜임을 따릅니다. 캐러셀 레퍼런스(kind carousel)는 장의 순서, 장마다 맡은 일(role), 다음 장으로 넘기는 장치(turn)를 그대로 두고 내용만 이번 주제로 새로 씁니다. 릴스 레퍼런스(kind reel)는 구간의 순서와 각 구간이 하는 일을 옮깁니다. 이때 1안의 label은 "레퍼런스 구성 그대로"입니다. 2·3안은 같은 주제를 1안과 다른 전개 방식으로 씁니다. 전개 방식은 이 주제의 약속을 가장 잘 전하는 것으로 고르고, 세 안은 덩어리의 순서와 각 덩어리가 하는 일이 서로 달라야 합니다(같은 내용의 말만 바꾼 안은 안 됩니다). 레퍼런스가 없으면 3안 모두 서로 다른 전개입니다.
- label은 그 안의 전개 방식을 짧게, why는 어떤 사람에게 맞는지 한 줄.
다 쓴 뒤 읽는 사람 입장에서 한 덩어리씩 다시 봅니다. 여기서 멈춰도 아쉽지 않은 덩어리(궁금한 게 남지 않거나, 앞의 말을 되풀이하거나, 누구나 할 수 있는 말)를 check.swipeRisks에 적습니다.`

const slidesSchema = obj({
  template: { type: 'string', enum: CAROUSEL_TEMPLATE_IDS }, templateWhy: str,
  slides: arr(obj({ heading: str, text: str, image: str })),
  last: obj({ heading: str, text: str }),
  weak: arr(obj({ slide: { type: 'number' }, why: str })),
})
const slidesPrompt = `'슬라이드 나누기' 단계입니다. 확정된 본문(body.units)을 장으로 나눕니다. 표지와 마지막 장은 따로 있으므로 slides에는 그 사이의 장만 순서대로 적습니다.
- 내용은 본문 그대로입니다. 새 사실이나 새 주장을 더하지 않고, 덩어리의 순서를 바꾸지 않습니다. 한 장에 넣으려고 줄이는 것, 긴 덩어리를 두 장으로 나누는 것, 짧은 덩어리 둘을 한 장에 묶는 것만 합니다. 줄일 때는 수강생이 쓴 표현과 숫자를 남깁니다.
- 틀: templates 중 이 내용에 가장 맞는 하나를 template에 고르고 이유를 templateWhy에 한 줄로 적습니다. 고르는 기준은 한 장에 들어갈 글의 양과 글의 성격입니다(한마디로 끊어 말하는 글인지, 두 가지를 맞세우는 글인지, 번호를 붙여 정리하는 글인지, 풀어 쓰는 글인지, 누군가의 말을 옮겨 적는 글인지, 여러 가지를 하나씩 소개하는 글인지). sources.design이 있으면 그 틀(frame)과 글 양(textAmount)에 가장 가까운 것을 먼저 봅니다. currentTemplate이 있으면 수강생이 이미 고른 틀이므로 바꾸지 않습니다.
- 글 양: 고른 틀의 limits를 지킵니다(heading·text는 글자 수, lines는 줄 수, lineChars는 한 줄에 들어가는 글자 수; heading 한도가 0인 틀은 heading을 빈 문자열로). 한도를 넘는 장은 두 장으로 나눕니다. 표지와 마지막 장을 더해 ${MAX_CAROUSEL_SLIDES}장을 넘지 않습니다.
- heading: 그 장을 한눈에 알려 주는 소제목입니다. 본문 첫 줄을 되풀이하지 않고, 번호를 매기는 글이면 번호가 heading의 일부입니다. 고른 틀에 headingShows가 있으면 그 틀은 heading 자리에 그것을 보여 주므로 heading에는 그것을 씁니다.
- text: 그 장의 글입니다. 한 줄은 lineChars자를 넘기지 않고, 뜻이 한 덩어리로 끊기는 자리에서 줄을 바꿉니다(꾸미는 말과 꾸밈을 받는 말, 강조한 구절은 한 줄에 둡니다). 한 줄이 lineChars보다 길면 화면에서 뜻과 상관없는 자리에서 한 번 더 꺾입니다. 그 장에서 읽는 사람이 꼭 가져가야 할 말 한 군데만 **이렇게** 별표 두 개로 감쌉니다(한 장에 한 군데, 문장 전체가 아니라 핵심 구절).
- 두 가지를 위아래로 맞세우는 틀을 골랐으면 text는 정확히 두 줄이고, 첫 줄과 둘째 줄이 서로 맞서는 짝이어야 합니다.
- image: 그 장에 사진이나 그림이 들어가는 틀이면, 글의 내용을 받쳐 줄 장면을 한 줄로 적습니다(무엇이, 어디에, 어떤 분위기로). 글자·로고·실제 인물이나 브랜드의 이름은 넣지 않습니다. 사진이 필요 없는 틀이면 빈 문자열.
- last: 마지막 장입니다. text는 body.closing을 틀의 한도에 맞춘 것이고, heading은 필요할 때만 씁니다.
- weak: 다 나눈 뒤 처음부터 넘겨 봅니다. 그 장에서 멈춰도 아쉽지 않은 장(다음 장을 넘길 이유가 없는 장)이 있으면 slides의 몇 번째인지(1부터)와 이유를 적습니다. 없으면 빈 배열.`

const captionSchema = obj({ options: arr(obj({ text: str, hashtags: arr(str), why: str })), placeholders: arr(str) })
const captionPrompt = `'캡션' 단계입니다. 확정된 슬라이드(slides)가 이 캐러셀의 실제 내용입니다. 인스타그램 캡션 3안을 씁니다.
- 첫 줄은 피드에서 '더 보기' 앞에 보이는 유일한 줄입니다. 표지가 건 약속을 되풀이하지 않고, 표지를 본 사람이 넘겨 보게 만드는 다른 한마디로 씁니다.
- 본문은 슬라이드의 핵심을 2~4줄로 받치거나, 슬라이드에 다 담지 못한 한 가지(이유·배경·주의할 점)를 더합니다. 슬라이드의 글을 그대로 옮겨 적지 않습니다. 사실은 brief와 research에 있는 것만 씁니다.
- 마무리는 저장·댓글·공유를 부르는 실제 이유 한 줄입니다.
- hashtags는 # 없이 이 캐러셀의 소재로 5~8개.
- sources.caption이 있으면 그 첫 줄 장치·본문 구조·마무리 방식을 따르고, 원문(original)에 이모지가 쓰였으면 같은 느낌으로 넣습니다(없으면 넣지 않음).
why는 이 캡션이 맞는 이유 한 줄.`

const json = (providers, op, prompt, input, schema) => providers.json(op, `${CAROUSEL_SYSTEM}\n\n${prompt}`, input, [], schema)
const revision = (note, previous) => note ? { revision: { request: clean(note, 600), previous } } : {}

// ---------- normalising what the model returns ----------
let seq = 0
const slideId = () => `s${Date.now().toString(36)}${(seq = (seq + 1) % 1296).toString(36)}`
export function normalizeSlide(raw, role = 'body') {
  return { id: /^[a-z0-9]{3,20}$/.test(raw?.id || '') ? raw.id : slideId(), role, heading: clean(raw?.heading, 80), text: block(raw?.text, 600), image: clean(raw?.image, 200) }
}
// The slides a plan is made of, as the student edits them: one cover first, one last slide at the end.
export function normalizeSlides(items) {
  const all = (Array.isArray(items) ? items : []).map(s => normalizeSlide(s, ['cover', 'body', 'last'].includes(s?.role) ? s.role : 'body'))
  const cover = all.find(s => s.role === 'cover'), last = all.findLast(s => s.role === 'last')
  const body = all.filter(s => s.role === 'body' && (s.heading || s.text)).slice(0, MAX_CAROUSEL_SLIDES - 2)
  return [...(cover ? [cover] : []), ...body, ...(last ? [last] : [])]
}
export function normalizeDesign(value, slideIds = []) {
  const colour = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v.toUpperCase() : undefined
  const image = v => { const id = /^[0-9a-f-]{36}$/.test(v?.id || '') ? v.id : null; if (!id) return null
    const n = (x, lo, hi, d) => Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d
    return { id, x: n(v.x, 0, 1, 0.5), y: n(v.y, 0, 1, 0.5), zoom: n(v.zoom, 1, 4, 1) } }
  // 자유 편집: where the student dragged a slide's title or text (a share of the slide's width/height) and how much
  // larger or smaller they made it.
  const n = (x, lo, hi, d) => Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d
  const moved = m => { const out = {}
    for (const key of ['heading', 'text']) { const v = m?.[key]; if (!v) continue
      const one = { x: n(v.x, -1, 1, 0), y: n(v.y, -1, 1, 0), scale: n(v.scale, 0.6, 1.6, 1) }
      if (one.x || one.y || one.scale !== 1) out[key] = one }
    return Object.keys(out).length ? out : null }
  const slides = {}
  for (const id of slideIds) { const s = value?.slides?.[id], move = moved(s?.move)
    if (s?.image || s?.image2 || move) slides[id] = { image: image(s.image), image2: image(s.image2), ...(move ? { move } : {}) } }
  return { template: carouselTemplate(value?.template).id, ratio: value?.ratio === '3:4' ? '3:4' : '4:5',
    colors: Object.fromEntries(['background', 'text', 'accent'].map(k => [k, colour(value?.colors?.[k])]).filter(([, v]) => v)),
    fonts: Object.fromEntries(['heading', 'body'].map(k => [k, clean(value?.fonts?.[k], 40)]).filter(([, v]) => v)),
    handle: clean(value?.handle, 40), profileImage: image(value?.profileImage), slides }
}

// A reference's colours as a starting palette: its first colour is the background it used most, the text is whichever
// of its other colours (or black/white) reads best on that, and the accent is its most vivid remaining colour.
export function paletteFrom(colors) {
  const list = (Array.isArray(colors) ? colors : []).filter(c => /^#[0-9a-fA-F]{6}$/.test(c || '')).map(c => c.toUpperCase())
  if (list.length < 2) return {}
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const luminance = hex => { const [r, g, b] = rgb(hex).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  const vivid = hex => { const [r, g, b] = rgb(hex); return Math.max(r, g, b) - Math.min(r, g, b) }
  const background = list[0], rest = list.slice(1)
  const text = [...rest, '#FFFFFF', '#111111'].filter(c => contrast(c, background) >= 4.5).sort((a, b) => vivid(a) - vivid(b))[0] || (luminance(background) > 0.5 ? '#111111' : '#FFFFFF')
  const accent = rest.filter(c => c !== text).sort((a, b) => vivid(b) - vivid(a))[0]
  return { background, text, ...(accent && vivid(accent) > 0.15 ? { accent } : {}) }
}

// ---------- generating a stage ----------
// Before the first draft: what the brief is about (apart from how-to requests), its field and the web research.
async function prepare(deps, row, providers) {
  let topic = row.topic
  if (!topic?.title || topic.brief !== row.brief) {
    const reading = await readBrief(providers, { brief: row.brief, previousTopic: topic?.title || '', previousBrief: topic?.brief || '' }).catch(() => null)
    const title = reading?.subject || String(row.brief || '').split('\n')[0].slice(0, 60)
    topic = reading?.sameSubject && topic?.title ? { ...topic, brief: row.brief, requests: [...new Set([...(topic.requests || []), ...(reading.requests || [])])].slice(0, 8) }
      : { title, category: '기타', requests: reading?.requests || [], brief: row.brief }
  }
  if (!researchFresh({ brief: row.brief, topic }) || !topic.categoryChecked) topic = (await prepareTopic(deps, { brief: row.brief, topic }, providers)).topic
  if (topic !== row.topic) await query(deps.db.from('studio_carousels').update({ topic, title: row.title || topic.title }).eq('id', row.id))
  return { ...row, topic, title: row.title || topic.title }
}

export async function generateCarouselStage(deps, row, stage, { note = '' } = {}) {
  const providers = deps.makeProviders(AbortSignal.timeout(600000))
  if (stage === 'cover') row = await prepare(deps, row, providers)
  const resolved = await resolveCarouselSources(deps.db, row.user_id, row.sources)
  const plan = await companionPlan(deps.db, row)
  row = withPlan(row, plan)
  const knowledge = { fieldKnowledge: await fieldKnowledge(deps.db, row.topic?.category).catch(() => null), ...(plan ? { reelPlan: plan.input } : {}) }
  const input = extras => context(row, resolved, { ...knowledge, ...extras })
  // One rewrite for what the model's own check and the code's check found.
  const draft = async (op, prompt, schema, extras, findings) => {
    let raw = await json(providers, op, prompt, input(extras), schema)
    const found = findings(raw)
    if (found.length) raw = await json(providers, op, `${prompt}\n방금 쓴 초안을 점검했더니 다음이 걸렸습니다: ${found.join(' / ')}. 이 단계의 기준을 처음부터 다시 적용해서, 이것들이 없는 안으로 새로 씁니다.`, input(extras), schema)
    return raw
  }
  if (stage === 'cover') {
    const raw = await draft('studio-carousel-cover', coverPrompt, coverSchema, revision(note, row.cover?.options?.map(o => o.text)),
      r => [...list(r.check?.unprovidedFacts, 80, 6), ...ungroundedQuotes(row, [...(r.plan?.quotes || []), ...(r.plan?.terms || []).map(t => t?.word)]).map(q => `원문에 없는 구절을 원문처럼 인용함: "${q}"`),
        // Letters are counted here: a cover that does not fit is no cover, however good the line is.
        ...(Array.isArray(r.options) ? r.options : []).filter(o => slideLength(o?.text) > COVER_TITLE_LIMIT || slideLength(o?.kicker) > COVER_KICKER_LIMIT).map(o => `표지에 넣기엔 긴 제목(제목 ${COVER_TITLE_LIMIT}자, 윗줄 ${COVER_KICKER_LIMIT}자 이내): "${clean(o.text, 60)}"`)])
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => { const label = COVER_PRINCIPLE_NAMES.includes(o.label) ? o.label : ''; return { text: clean(o.text, 60), kicker: clean(o.kicker, 40), why: clean(o.why, 200), label, hint: coverHint(label) } }).filter(o => o.text).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '표지 제목을 만들지 못했어요. 다시 시도해주세요.', 422)
    const terms = (Array.isArray(raw.plan?.terms) ? raw.plan.terms : []).map(t => ({ word: clean(t?.word, 40), meaning: clean(t?.meaning, 120) })).filter(t => t.word && t.meaning).slice(0, 8)
    return { topic: row.topic, title: row.title, value: { options, chosen: 0, custom: null, customKicker: null, plan: { terms, purpose: clean(raw.plan?.purpose, 200), reader: clean(raw.plan?.reader, 200), promise: clean(raw.plan?.promise, 200) } }, placeholders: list(raw.placeholders, 120, 12) }
  }
  if (stage === 'body') {
    if (!chosenCover(row)) fail('STAGE_ORDER', '표지 제목을 먼저 정해주세요.', 409)
    const raw = await draft('studio-carousel-body', bodyPrompt, bodySchema, revision(note, chosenBody(row)),
      r => [...list(r.check?.unprovidedFacts, 80, 6), ...list(r.check?.referenceTraces, 80, 6), ...list(r.check?.swipeRisks, 120, 6).map(risk => `멈춰도 아쉽지 않은 덩어리: ${risk}`)])
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => ({ label: clean(o.label, 40), why: clean(o.why, 200), closing: block(o.closing, 200),
      units: (Array.isArray(o.units) ? o.units : []).map(u => ({ text: block(u?.text, 400) })).filter(u => u.text).slice(0, 30) })).filter(o => o.units.length >= 2).slice(0, 3)
      .map((o, i) => resolved.structure && i === 0 ? { ...o, label: '레퍼런스 구성 그대로', reference: true } : o)
    if (!options.length) fail('STAGE_EMPTY', '본문을 만들지 못했어요. 다시 시도해주세요.', 422)
    return { value: { options, chosen: 0, edited: null }, placeholders: list(raw.placeholders, 120, 12) }
  }
  if (stage === 'slides') {
    const body = chosenBody(row), cover = chosenCover(row)
    if (!body || !cover) fail('STAGE_ORDER', '본문을 먼저 정해주세요.', 409)
    const keep = row.slides?.templateChosen ? row.slides.template : null
    const extras = { templates: CAROUSEL_TEMPLATES.map(t => ({ id: t.id, name: t.name, suits: t.description, ...(t.heading ? { headingShows: t.heading } : {}), limits: t.limits.body, lastLimit: t.limits.last.text, photosPerSlide: t.images.body })), ...(keep ? { currentTemplate: keep } : {}),
      ...revision(note, row.slides?.items?.filter(s => s.role === 'body').map(s => ({ heading: s.heading, text: s.text }))) }
    let raw = await json(providers, 'studio-carousel-slides', slidesPrompt, input(extras), slidesSchema)
    const template = keep || carouselTemplate(raw.template).id
    // The reason is the first answer's: a second call is told the template is already chosen.
    const templateWhy = clean(raw.templateWhy, 200)
    const build = r => normalizeSlides([{ role: 'cover', heading: cover.text, text: cover.kicker }, ...(Array.isArray(r.slides) ? r.slides : []).map(s => ({ ...s, role: 'body' })), { role: 'last', heading: r.last?.heading, text: r.last?.text || body.closing }])
    let items = build(raw)
    // Slides over the template's limits are sent back once: the count of letters is checked here, not left to the model.
    const over = items.map((s, i) => slideOverflows(template, s) ? i + 1 : 0).filter(Boolean)
    const wide = list => list.reduce((n, s) => n + longLines(template, s).length, 0)
    const lines = items.flatMap(s => longLines(template, s))
    if (over.length || lines.length) {
      const found = [...(over.length ? [`전체(표지 포함)에서 ${over.join(', ')}번째 장이 고른 틀의 한도를 넘습니다. 넘는 장은 줄이거나 두 장으로 나눠 다시 적습니다.`] : []),
        ...(lines.length ? [`한 줄에 들어가는 글자 수(lineChars)를 넘는 줄이 있습니다: ${lines.slice(0, 6).map(l => `"${l}"`).join(' / ')}. 이런 줄은 뜻이 끊기는 자리에서 두 줄로 나눠 적습니다(줄 수 한도를 넘으면 그 장을 두 장으로).`] : [])]
      raw = await json(providers, 'studio-carousel-slides', `${slidesPrompt}\n방금 나눈 것을 세어 보니 ${found.join(' ')}`, input({ ...extras, currentTemplate: template }), slidesSchema)
      const again = build(raw)
      // Kept only when it is no worse on either count.
      if (again.filter(s => slideOverflows(template, s)).length <= over.length && wide(again) <= lines.length) items = again
    }
    if (items.filter(s => s.role === 'body').length < 1) fail('STAGE_EMPTY', '슬라이드를 나누지 못했어요. 다시 시도해주세요.', 422)
    const bodies = items.filter(s => s.role === 'body')
    const weak = (Array.isArray(raw.weak) ? raw.weak : []).map(w => ({ id: bodies[Math.round(Number(w?.slide)) - 1]?.id, why: clean(w?.why, 200) })).filter(w => w.id && w.why).slice(0, 8)
    return { value: { items, template, templateWhy, templateChosen: Boolean(keep), weak } }
  }
  if (stage === 'design') {
    if (!row.slides?.items?.length) fail('STAGE_ORDER', '슬라이드를 먼저 나눠주세요.', 409)
    const mine = await query(deps.db.from('studio_styles').select('choices').eq('user_id', row.user_id).maybeSingle()).catch(() => null)
    const saved = mine?.choices?.carouselDesign || {}
    // A new design starts from the student's own look (내 디자인) when they saved one; a design reference picked for
    // this carousel lends its colours on top of that. Once the design exists, the student's choices stand.
    const borrowed = row.design ? {} : paletteFrom(resolved.design?.excerpt?.colors)
    return { value: normalizeDesign({ ...saved, ...(Object.keys(borrowed).length ? { colors: borrowed } : {}), ...(row.design || {}), template: row.design?.template || row.slides.template, slides: row.design?.slides }, row.slides.items.map(s => s.id)) }
  }
  if (stage === 'caption') {
    if (!row.slides?.items?.length) fail('STAGE_ORDER', '슬라이드를 먼저 나눠주세요.', 409)
    const raw = await json(providers, 'studio-carousel-caption', captionPrompt, input(revision(note, chosenCaption(row))), captionSchema)
    const options = (Array.isArray(raw.options) ? raw.options : []).map(o => ({ text: typeof o.text === 'string' ? o.text.normalize('NFC').trim().slice(0, 2200) : '', hashtags: list(o.hashtags, 40, 8).map(t => t.replace(/^#+/, '').replace(/\s+/g, '')), why: clean(o.why, 200) })).filter(o => o.text).slice(0, 3)
    if (!options.length) fail('STAGE_EMPTY', '캡션을 만들지 못했어요. 다시 시도해주세요.', 422)
    return { value: { options, chosen: 0, edited: null }, placeholders: list(raw.placeholders, 120, 12) }
  }
  fail('STAGE_UNKNOWN', '알 수 없는 단계예요.')
}

// ---------- talking to 훅ai about the plan ----------
// What 훅ai says when a stage opens, before anything is written.
export const CAROUSEL_OPENERS = {
  cover: '어떤 캐러셀인지 읽어 볼게요. 넘기지 않고는 못 배길 표지 제목부터 잡아요.',
  body: '표지 정했으니, 표지 다음 장부터 마지막 장 앞까지 들어갈 내용을 3안으로 써 볼게요.',
  slides: '이제 내용을 장으로 나눌게요. 어디서 끊을지, 어떤 틀이 맞을지 같이 봐요.',
  design: '글은 다 됐어요. 틀을 고르면 모든 장이 한 번에 배치돼요. 색·글꼴·사진은 여기서 바꿔요.',
  caption: '거의 다 왔어요. 캡션만 쓰면 끝이에요.',
  done: '고생 많으셨어요! 👏 캐러셀이 완성됐어요. 이미지를 받아 가세요.',
}
const STAGE_NAMES = { cover: '표지 제목', body: '본문 기획', slides: '슬라이드 나누기', design: '디자인', caption: '캡션' }
const chipList = (value, count) => (Array.isArray(value) ? value : []).map(v => clean(v, 1000)).filter(c => c && c.length <= 160).slice(0, count)
// Field order is writing order: the revision first, then checked against what the student asked, then described.
const reviseSchema = obj({
  proposal: obj({ has: { type: 'boolean' }, text: str, kicker: str, units: arr(obj({ text: str })), closing: str, slides: arr(obj({ heading: str, text: str, image: str })), last: obj({ heading: str, text: str }), hashtags: arr(str),
    requests: arr(obj({ condition: str, evidence: str, met: { type: 'boolean' } })), summary: str }),
  reply: str, chips: arr(str) })
const revisePrompt = stage => `지금은 '${STAGE_NAMES[stage]}' 단계입니다. 수강생의 요청이나 질문에 답하고, 현재 내용을 고쳐 달라는 요청이면 proposal에 고친 결과를 담습니다.
쓰는 순서대로 채웁니다.
- proposal.has: 고친 결과가 있으면 true. 없으면 false와 빈 값.
- 단계별 proposal: 표지 제목 → text(큰 제목)와 kicker(제목 위 작은 한 줄, ${COVER_KICKER_LIMIT}자 이내, 없으면 빈 문자열). 본문 기획 → units(본문 전체를 읽는 순서대로, 한 덩어리에 한 가지)와 closing(마지막 장 문구). 슬라이드 나누기 → slides(표지와 마지막 장 사이의 장 전체를 순서대로: heading, text, image)와 last(마지막 장). 캡션 → text(캡션 본문)와 hashtags(# 없이). 디자인 → proposal 없이 reply에 조언만(색·글꼴·사진은 수강생이 화면에서 바꿉니다).
- 슬라이드를 고칠 때는 template의 limits를 지키고(한 줄은 lineChars자 이내, 뜻이 끊기는 자리에서 줄바꿈), 한 장에서 가장 중요한 구절 한 군데만 **별표 두 개**로 감쌉니다. 요청하지 않은 장은 글자 하나 바꾸지 않고 그대로 다시 적습니다.
- proposal.requests: 다 쓴 결과를 수강생의 요청과 하나씩 대조합니다. 이번 요청과, 대화에서 수강생이 앞서 정해 두어 아직 유효한 조건을 각각 condition으로 적고, 방금 쓴 결과에서 그 조건이 어떻게 드러나는지 evidence에 실제 글자 그대로 옮긴 뒤 met을 판정합니다. 개수·위치·순서·길이·뺄 것·넣을 것처럼 글자로 확인할 수 있는 조건은 세어서 확인합니다.
- proposal.summary: 결과에서 실제로 바뀐 점 한 줄.
- reply: 2~4문장. 결과에 실제로 반영된 것만 말합니다. met이 false인 조건이 있으면 무엇을 못 지켰고 왜인지 그대로 말합니다. 질문이면 그 답.
- chips: 지금 결과를 읽는 사람이 더 끝까지 넘기게 만들 다음 수정 요청 0~3개. 이 캐러셀에서 가장 약한 곳(멈춰도 아쉽지 않은 장, 더 구체적일 수 있는 말, 흐릿한 약속)을 짚은 이 캐러셀만의 구체적인 요청으로 쓰고, 어느 캐러셀에나 붙는 일반 요청은 쓰지 않습니다.
규칙: 수강생이 고친 부분은 유지하고 요청한 부분만 바꿉니다. 수강생이 건 조건은 결과 전체에서 지킵니다. 없는 사실을 넣지 않습니다.`

function normalizeProposal(stage, p) {
  const summary = clean(p.summary, 200)
  if (stage === 'cover') { const text = clean(p.text, 60); return text ? { stage, summary, text, kicker: clean(p.kicker, 40) } : null }
  if (stage === 'body') { const units = (Array.isArray(p.units) ? p.units : []).map(u => ({ text: block(u?.text, 400) })).filter(u => u.text).slice(0, 30); return units.length >= 2 ? { stage, summary, units, closing: block(p.closing, 200) } : null }
  if (stage === 'slides') { const slides = (Array.isArray(p.slides) ? p.slides : []).map(s => ({ heading: clean(s?.heading, 80), text: block(s?.text, 600), image: clean(s?.image, 200) })).filter(s => s.heading || s.text).slice(0, MAX_CAROUSEL_SLIDES - 2)
    return slides.length ? { stage, summary, slides, last: { heading: clean(p.last?.heading, 80), text: block(p.last?.text, 200) } } : null }
  if (stage === 'caption') { const text = typeof p.text === 'string' ? p.text.normalize('NFC').trim().slice(0, 2200) : ''; return text ? { stage, summary, text, hashtags: list(p.hashtags, 40, 8).map(t => t.replace(/^#+/, '')) } : null }
  return null
}
// On the finished plan the request decides which part is revised.
export const chatStage = (row, text) => row.stage !== 'done' ? row.stage : /캡션|해시태그/.test(text) ? 'caption' : /표지|제목/.test(text) ? 'cover' : 'slides'
export async function carouselChat(deps, row, messages, text) {
  const resolved = await resolveCarouselSources(deps.db, row.user_id, row.sources).catch(() => ({}))
  const providers = deps.makeProviders(AbortSignal.timeout(480000))
  const stage = chatStage(row, text)
  const template = row.slides?.template ? carouselTemplate(row.design?.template || row.slides.template) : null
  const plan = await companionPlan(deps.db, row)
  const input = context(row, resolved, { fieldKnowledge: await fieldKnowledge(deps.db, row.topic?.category).catch(() => null), ...(plan ? { reelPlan: plan.input } : {}),
    ...(template ? { template: { name: template.name, ...(template.heading ? { headingShows: template.heading } : {}), limits: template.limits.body, lastLimit: template.limits.last.text } } : {}),
    conversation: messages.slice(-12).map(m => ({ who: m.role === 'user' ? '수강생' : '훅ai', text: m.content })), userMessage: text })
  let raw = await json(providers, 'studio-carousel-revise', revisePrompt(stage), input, reviseSchema)
  // A revision that misses a condition the student set is rewritten once, with the misses named.
  const misses = (raw.proposal?.has && Array.isArray(raw.proposal.requests) ? raw.proposal.requests : []).filter(r => r && r.met === false).map(r => clean(r.condition, 160)).filter(Boolean)
  if (misses.length) raw = await json(providers, 'studio-carousel-revise', `${revisePrompt(stage)}\n방금 쓴 결과를 대조했더니 이 조건을 지키지 못했습니다: ${misses.join(' / ')}. 결과를 처음부터 다시 써서 모든 조건을 지키고, 다시 대조합니다.`, input, reviseSchema)
  const proposal = raw.proposal?.has && row[stage] ? normalizeProposal(stage, raw.proposal) : null
  return { content: clean(raw.reply, 800) || '네, 반영했어요.', meta: { chips: chipList(raw.chips, 3), proposal } }
}
// A revision the student accepted becomes the version in use.
export function applyCarouselProposal(row, p) {
  if (!p || !row[p.stage]) fail('PROPOSAL_NOT_FOUND', '적용할 제안을 찾을 수 없어요.', 404)
  if (p.stage === 'cover') return applyCarouselPatch(row, { cover: { custom: p.text, customKicker: p.kicker } })
  if (p.stage === 'body') return applyCarouselPatch(row, { body: { edited: { units: p.units, closing: p.closing } } })
  if (p.stage === 'caption') return applyCarouselPatch(row, { caption: { edited: { text: p.text, hashtags: p.hashtags } } })
  // Slides keep their ids where the position is the same, so the photos placed on them stay with them.
  const now = row.slides.items, bodies = now.filter(s => s.role === 'body'), cover = now.find(s => s.role === 'cover'), last = now.findLast(s => s.role === 'last')
  return applyCarouselPatch(row, { slides: { items: [cover, ...p.slides.map((s, i) => ({ ...s, id: bodies[i]?.id, role: 'body' })), { ...last, heading: p.last?.heading ?? last.heading, text: p.last?.text || last.text }] } })
}

// ---------- the student's own edits ----------
export function applyCarouselPatch(row, body) {
  const patch = {}
  if (typeof body.title === 'string') patch.title = clean(body.title, 80)
  if (body.cover && row.cover) {
    const next = { ...row.cover }
    if (Number.isInteger(body.cover.chosen) && row.cover.options?.[body.cover.chosen]) Object.assign(next, { chosen: body.cover.chosen, custom: null, customKicker: null })
    if (typeof body.cover.custom === 'string') Object.assign(next, { custom: clean(body.cover.custom, 60) || null, customKicker: clean(body.cover.customKicker, 40) || null })
    patch.cover = next
  }
  if (body.body && row.body) {
    const next = { ...row.body }
    if (Number.isInteger(body.body.chosen) && row.body.options?.[body.body.chosen]) Object.assign(next, { chosen: body.body.chosen, edited: null })
    if (body.body.edited && typeof body.body.edited === 'object') next.edited = { closing: block(body.body.edited.closing, 200),
      units: (Array.isArray(body.body.edited.units) ? body.body.edited.units : []).map(u => ({ text: block(u?.text, 400) })).filter(u => u.text).slice(0, 30) }
    patch.body = next
    // Slides already split from the earlier body are kept (they may hold the student's own edits) but marked,
    // so the screen can offer to split the new body again.
    if (row.slides?.items && JSON.stringify(chosenBody({ body: next })) !== JSON.stringify(chosenBody(row))) patch.slides = { ...row.slides, stale: true }
  }
  if (body.slides && row.slides) {
    const next = { ...(patch.slides || row.slides) }
    if (Array.isArray(body.slides.items)) {
      next.items = normalizeSlides(body.slides.items)
      if (!next.items.some(s => s.role === 'cover') || !next.items.some(s => s.role === 'last')) fail('SLIDES_INVALID', '표지와 마지막 장은 지울 수 없어요.', 422)
      next.weak = (next.weak || []).filter(w => next.items.some(s => s.id === w.id))
    }
    if (CAROUSEL_TEMPLATE_IDS.includes(body.slides.template)) Object.assign(next, { template: body.slides.template, templateChosen: true })
    patch.slides = next
  }
  if (body.design && row.slides?.items) patch.design = normalizeDesign({ ...(row.design || {}), ...body.design }, (patch.slides || row.slides).items.map(s => s.id))
  if (body.caption && row.caption) {
    const next = { ...row.caption }
    if (Number.isInteger(body.caption.chosen) && row.caption.options?.[body.caption.chosen]) Object.assign(next, { chosen: body.caption.chosen, edited: null })
    if (body.caption.edited && typeof body.caption.edited === 'object') next.edited = { text: typeof body.caption.edited.text === 'string' ? body.caption.edited.text.normalize('NFC').trim().slice(0, 2200) : '',
      hashtags: (Array.isArray(body.caption.edited.hashtags) ? body.caption.edited.hashtags : []).map(t => clean(t, 40).replace(/^#+/, '')).filter(Boolean).slice(0, 8) }
    patch.caption = next
  }
  // The cover slide always shows the cover title in use.
  const slides = patch.slides || row.slides
  if (patch.cover && slides?.items) { const cover = chosenCover({ cover: patch.cover }); if (cover) patch.slides = { ...slides, items: slides.items.map(s => s.role === 'cover' ? { ...s, heading: cover.text, text: cover.kicker } : s) } }
  return patch
}

export const publicCarousel = row => ({ id: row.id, stage: row.stage, title: row.title || row.topic?.title || null, brief: row.brief, sources: row.sources, topic: row.topic ? { title: row.topic.title, category: row.topic.category, requests: row.topic.requests || [], research: row.topic.research && !row.topic.research.failed ? { subject: row.topic.research.subject, sources: row.topic.research.sources || [] } : null } : null,
  cover: row.cover, body: row.body, slides: row.slides, design: row.design, caption: row.caption,
  job: { stage: row.job_stage, status: row.job_status, error: row.job_error, startedAt: row.job_started_at }, createdAt: row.created_at, updatedAt: row.updated_at })
