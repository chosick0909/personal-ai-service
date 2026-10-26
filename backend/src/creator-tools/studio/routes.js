import Redis from 'ioredis'
import multer from 'multer'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { asyncHandler } from '../../lib/errors.js'
import { fail, uuid } from '../domain.js'
import { database, query, ownedMedia } from '../store.js'
import { redisConnection } from '../queue.js'
import { createProviders } from '../providers.js'
import { studio2Enabled, canRecommend } from './access.js'
import { STAGE_OPENERS, STAGE_ORDER, nextStage, HOOKAI_SYSTEM } from './persona.js'
import { planContextFor } from './plan-context.js'
import { SLOTS, resolveSources, openerMessage, chat, startStage, formulaFromSession, formulaFromReel, buildStyleCard, answerAsk } from './engine.js'
import { THUMBNAIL_BUCKET, classifyReelCategories } from '../success-reels.js'
import { BUCKET } from '../store.js'
import { instagramPostUrl } from '../reference-quality.js'
import { readPublicImage } from '../network.js'
import { probeVideo, ff } from '../media.js'
import { requestReelAnalysis, runReelAnalysis, schedule } from '../success-reel-analysis.js'
import { SUCCESS_REEL_CATEGORIES } from '../categories.js'
import { fieldKnowledge, studyOnce, startDailyStudy } from './knowledge.js'
import { libraryEntries, libraryEntry } from './formula-study.js'
import { LOOKUP_PRIORITY } from '../instagram-lookup.js'
import { createDemoLink, refreshDemoUsers, startDemoRefresh } from '../demo-links.js'
import { ideaReply } from './ideas.js'
import { extractSupportingMaterials } from '../../lib/supporting-materials.js'

let redis
const sharedRedis = () => { if (!redis) { redis = new Redis({ ...redisConnection(), maxRetriesPerRequest: 1 }); redis.on('error', () => {}) } return redis }
const deps = () => ({ db: database(), redis: sharedRedis(), makeProviders: signal => createProviders({ db: database(), redis: sharedRedis(), job: { id: null, user_id: null }, signal }) })
const TAGS = ['hook', 'structure', 'filming', 'caption']
const uploadMaterials = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 1, fieldSize: 4096 } })
const uploadVideo = multer({ storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, tmpdir()), filename: (_req, _file, cb) => cb(null, `studio-${randomUUID()}.upload`) }), limits: { fileSize: 150 * 1024 * 1024, files: 1 } })
const UPLOADS_PER_DAY = 10
const text = (value, max) => typeof value === 'string' ? value.normalize('NFC').trim().slice(0, max) : ''

// Version history: what the student is about to replace is kept first, newest at the top, ten deep.
const remember = (field, value, note) => value ? [{ note, at: new Date().toISOString(), value }, ...(field?.history || [])].slice(0, 10) : field?.history || []
const currentScript = s => s?.edited || s?.options?.[s?.chosen ?? 0]?.lines || null
const currentCaption = c => c?.edited || c?.options?.[c?.chosen ?? 0] || null
const optionName = i => `${'ABC'[i] || i + 1}안`
// The cover or first line in use, kept as a saved version. An original option keeps its index so loading it selects it again.
const pickApplied = f => f?.applied && f.custom === f.applied.text
const currentPick = (field, f) => {
  if (!f) return null
  if (pickApplied(f)) return { text: f.applied.text, onScreen: f.applied.onScreen || '', summary: f.applied.summary || '', applied: true }
  if (f.custom) return { text: f.custom }
  const o = f.options?.[f.chosen ?? 0]
  return !o ? null : field === 'hook' ? { text: o.spoken, onScreen: o.onScreen || '', option: f.chosen ?? 0 } : { text: o.text, option: f.chosen ?? 0 }
}
const pickNote = f => pickApplied(f) ? '훅ai와 고친 안' : f?.custom ? '직접 쓴 안' : optionName(f?.chosen ?? 0)
export const sessionHistory = { remember, currentScript, currentCaption, optionName }

const publicSession = row => ({ id: row.id, mode: row.mode, stage: row.stage, title: row.title, sources: row.sources, brief: row.brief, attachments: row.attachments,
  topic: row.topic, thumbnail: row.thumbnail, hook: row.hook, script: row.script, filming: row.filming, caption: row.caption, memo: row.memo, placeholders: row.placeholders, ask: row.ask,
  job: { status: row.job_status, stage: row.job_stage, error: row.job_error, startedAt: row.job_started_at }, createdAt: row.created_at, updatedAt: row.updated_at })
const publicMessage = row => ({ id: row.id, role: row.role, stage: row.stage, content: row.content, meta: row.meta, createdAt: row.created_at })

function normalizeSources(value) {
  const out = {}
  for (const slot of SLOTS) {
    const s = value?.[slot]
    if (s && ['reel', 'formula', 'library'].includes(s.kind) && /^[A-Za-z0-9_-]{1,40}$/.test(String(s.id || ''))) out[slot] = { kind: s.kind, id: String(s.id) }
  }
  return out
}

export function registerStudioRoutes(router) {
  const enabled = req => { if (!studio2Enabled(req.auth.userId)) fail('FEATURE_DISABLED', '아직 공개되지 않은 기능입니다.', 404) }
  const owned = async (req, select = '*') => {
    const row = await query(database().from('studio_sessions').select(select).eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).maybeSingle())
    if (!row) fail('SESSION_NOT_FOUND', '기획안을 찾을 수 없어요.', 404)
    return row
  }
  const addMessage = (sessionId, userId, role, stage, content, meta = {}) =>
    query(database().from('studio_messages').insert({ session_id: sessionId, user_id: userId, role, stage, content, meta }).select('*').single())

  // ----- sessions (내 기획안) -----
  router.get('/creator-tools/studio/sessions', asyncHandler(async (req, res) => {
    enabled(req)
    const rows = await query(database().from('studio_sessions').select('id,mode,stage,title,topic,sources,job_status,created_at,updated_at').eq('user_id', req.auth.userId).order('updated_at', { ascending: false }).limit(100))
    res.set('Cache-Control', 'private, no-store').json({ sessions: rows.map(r => ({ id: r.id, mode: r.mode, stage: r.stage, title: r.title || r.topic?.title || null, sources: r.sources, jobStatus: r.job_status, createdAt: r.created_at, updatedAt: r.updated_at })) })
  }))
  router.post('/creator-tools/studio/sessions', asyncHandler(async (req, res) => {
    enabled(req)
    const mode = ['single', 'mix', 'topic'].includes(req.body?.mode) ? req.body.mode : 'topic'
    let sources = normalizeSources(req.body?.sources)
    if (mode === 'single') { const one = sources.hook || sources.structure || sources.filming || sources.caption; if (!one) fail('SOURCE_REQUIRED', '레퍼런스를 골라주세요.'); sources = Object.fromEntries(SLOTS.map(s => [s, one])) }
    if (mode === 'mix' && !Object.keys(sources).length) fail('SOURCE_REQUIRED', '조합할 레퍼런스를 하나 이상 골라주세요.')
    await resolveSources(database(), req.auth.userId, sources)
    const style = await query(database().from('studio_styles').select('card').eq('user_id', req.auth.userId).maybeSingle())
    const row = await query(database().from('studio_sessions').insert({ user_id: req.auth.userId, mode, sources, brief: text(req.body?.brief, 8000), style_snapshot: style?.card || null }).select('*').single())
    // The plan opens at once; 훅ai's first message is written in the background and appears in the chat when ready.
    void (async () => {
      const opener = await openerMessage(deps(), row).catch(() => ({ content: '어떤 릴스를 만들어볼까요? 담고 싶은 내용을 편하게 적어주세요.', meta: { chips: ['주제 제안해줘'] } }))
      await addMessage(row.id, req.auth.userId, 'hookai', 'topic', opener.content, opener.meta).catch(() => {})
    })()
    res.status(201).json({ session: publicSession(row), messages: [] })
  }))
  router.get('/creator-tools/studio/sessions/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const messages = await query(database().from('studio_messages').select('*').eq('session_id', row.id).order('created_at', { ascending: true }).limit(200))
    const resolved = await resolveSources(database(), req.auth.userId, row.sources).catch(() => ({}))
    res.set('Cache-Control', 'private, no-store').json({ session: publicSession(row), messages: messages.map(publicMessage),
      sources: Object.fromEntries(Object.entries(resolved).map(([slot, s]) => [slot, { kind: s.kind, id: s.id, label: s.label }])) })
  }))
  router.delete('/creator-tools/studio/sessions/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req, 'id')
    await query(database().from('studio_sessions').delete().eq('id', row.id))
    res.json({ ok: true })
  }))
  // Student edits: brief, attachments, chosen options, edited script/caption, memo, title.
  router.patch('/creator-tools/studio/sessions/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const body = req.body || {}, patch = { updated_at: new Date().toISOString() }
    if (typeof body.brief === 'string') patch.brief = text(body.brief, 8000)
    if (typeof body.memo === 'string') patch.memo = text(body.memo, 4000)
    if (typeof body.title === 'string') patch.title = text(body.title, 80)
    if (Array.isArray(body.attachments)) patch.attachments = body.attachments.slice(0, 5).map(a => ({ name: text(a?.name, 120), content: text(a?.content, 6000) })).filter(a => a.name)
    for (const field of ['thumbnail', 'hook', 'script', 'caption']) {
      const change = body[field]
      if (!change || !row[field]) continue
      const next = { ...row[field] }
      const pick = field === 'thumbnail' || field === 'hook'
      if (pick && Number.isInteger(change.restore) && row[field].history?.[change.restore]) {
        const v = row[field].history[change.restore].value
        next.history = remember(row[field], currentPick(field, row[field]), pickNote(row[field]))
        if (Number.isInteger(v.option) && row[field].options?.[v.option]) Object.assign(next, { chosen: v.option, custom: null, applied: null })
        else Object.assign(next, { custom: v.text, applied: v.applied ? { text: v.text, onScreen: v.onScreen || '', summary: v.summary || '' } : null })
        patch[field] = next; continue
      }
      // Switching away from the cover or first line in use keeps it in 저장 내역 (typing keeps only the version typing replaced).
      if (pick) {
        const was = row[field], typed = was.custom && !pickApplied(was)
        if ((Number.isInteger(change.chosen) && (change.chosen !== was.chosen || was.custom)) || (typeof change.custom === 'string' && change.custom.trim() && !typed)) next.history = remember(was, currentPick(field, was), pickNote(was))
      }
      if (Number.isInteger(change.restore) && row[field].history?.[change.restore]) {
        const entry = row[field].history[change.restore]
        next.history = remember(row[field], field === 'script' ? currentScript(row[field]) : currentCaption(row[field]), '되돌리기 전')
        next.edited = entry.value
        patch[field] = next; continue
      }
      if (Number.isInteger(change.chosen) && row[field].options?.[change.chosen]) {
        if ((field === 'script' || field === 'caption') && (change.chosen !== row[field].chosen || row[field].edited)) next.history = remember(row[field], field === 'script' ? currentScript(row[field]) : currentCaption(row[field]), row[field].edited ? '직접 고친 버전' : optionName(row[field].chosen ?? 0))
        next.chosen = change.chosen; if ('custom' in next) next.custom = null; if ('edited' in next) next.edited = null }
      if (typeof change.custom === 'string' && 'custom' in next) next.custom = text(change.custom, 200) || null
      // Picking an option or typing one's own replaces a chat-applied version.
      if ((Number.isInteger(change.chosen) || typeof change.custom === 'string') && next.applied) next.applied = null
      if (field === 'script' && Array.isArray(change.edited)) next.edited = change.edited.map(l => ({ part: ['hook', 'body', 'cta'].includes(l?.part) ? l.part : 'body', spoken: text(l?.spoken, 400), onScreen: text(l?.onScreen, 60), seconds: Math.max(1, Math.min(180, Math.round(Number(l?.seconds) || 3))) })).filter(l => l.spoken).slice(0, 24)
      if (field === 'caption' && change.edited && typeof change.edited === 'object') next.edited = { text: text(change.edited.text, 2200), hashtags: (Array.isArray(change.edited.hashtags) ? change.edited.hashtags : []).map(t => text(t, 40).replace(/^#+/, '')).filter(Boolean).slice(0, 8) }
      patch[field] = next
    }
    if (Array.isArray(body.placeholders)) patch.placeholders = body.placeholders.map(p => text(p, 120)).filter(Boolean).slice(0, 20)
    const updated = await query(database().from('studio_sessions').update(patch).eq('id', row.id).select('*').single())
    res.json({ session: publicSession(updated) })
  }))
  // Confirm the topic (from a proposal, a 훅ai-ready topic, or typed by the student) and open the thumbnail stage.
  router.post('/creator-tools/studio/sessions/:id/topic', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const t = req.body?.topic || {}
    const topic = { title: text(t.title, 120), angle: text(t.angle, 200), promise: text(t.promise, 200), facts: (Array.isArray(t.facts) ? t.facts : []).map(f => text(f, 200)).filter(Boolean).slice(0, 12),
      audience: text(t.audience, 120), category: SUCCESS_REEL_CATEGORIES.includes(t.category) ? t.category : '기타',
      // A topic taken straight from the student's text drops answers given for an earlier topic.
      answers: t.fromBrief ? [] : row.topic?.answers || [], brief: text(row.brief, 8000),
      // Research done while the topic was being found carries over, unless the student rewrote what the reel is about.
      ...(row.topic?.research ? { research: row.topic.research } : {}) }
    if (topic.title.length < 2) fail('TOPIC_REQUIRED', '주제를 한 줄로 적어주세요.')
    await query(database().from('studio_sessions').update({ topic, title: row.title || topic.title, updated_at: new Date().toISOString() }).eq('id', row.id))
    await query(database().from('studio_topics').insert({ user_id: req.auth.userId, session_id: row.id, topic: topic.title, category: topic.category }))
    await addMessage(row.id, req.auth.userId, 'hookai', 'thumbnail', STAGE_OPENERS.thumbnail)
    const session = await startStage(deps(), { ...row, topic, title: row.title || topic.title }, 'thumbnail', { force: true })
    res.json({ session: publicSession(session) })
  }))
  // Move to a stage (generating it on first visit) or regenerate the current one.
  router.post('/creator-tools/studio/sessions/:id/stage', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const stage = STAGE_ORDER.includes(req.body?.stage) ? req.body.stage : nextStage(row.stage)
    if (stage === 'topic') { await query(database().from('studio_sessions').update({ stage, updated_at: new Date().toISOString() }).eq('id', row.id)); return res.json({ session: publicSession({ ...row, stage }) }) }
    if (stage === 'done') { await query(database().from('studio_sessions').update({ stage, updated_at: new Date().toISOString() }).eq('id', row.id)); await addMessage(row.id, req.auth.userId, 'hookai', 'done', STAGE_OPENERS.done); return res.json({ session: publicSession({ ...row, stage }) }) }
    const force = req.body?.regenerate === true
    if (row.ask && row.ask.stage !== stage) await query(database().from('studio_sessions').update({ ask: null }).eq('id', row.id))
    if (!row[stage] && STAGE_OPENERS[stage] && row.stage !== stage) await addMessage(row.id, req.auth.userId, 'hookai', stage, STAGE_OPENERS[stage])
    const session = await startStage(deps(), row, stage, { force })
    res.json({ session: publicSession(session) })
  }))
  router.post('/creator-tools/studio/sessions/:id/chat', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const content = text(req.body?.text, 4000)
    if (!content) fail('MESSAGE_REQUIRED', '메시지를 적어주세요.')
    const history = await query(database().from('studio_messages').select('*').eq('session_id', row.id).order('created_at', { ascending: true }).limit(200))
    const mine = await addMessage(row.id, req.auth.userId, 'user', row.stage, content)
    if (row.ask && row.ask.stage === row.stage) {
      const { reply } = await answerAsk(deps(), row, content)
      const theirs = await addMessage(row.id, req.auth.userId, 'hookai', row.stage, reply.content, reply.meta)
      return res.json({ messages: [publicMessage(mine), publicMessage(theirs)] })
    }
    // 훅ai answers in the background and the screen polls the conversation, so a long revision never hits a request
    // timeout. A failed answer is saved as 훅ai's message (meta.failed), so the screen always gets an answer to show.
    void (async () => {
      try {
        const reply = await chat(deps(), row, history, content)
        if (row.stage === 'topic' && !reply.meta.topic && !reply.meta.proposals?.length) {
          const answers = [...(row.topic?.answers || []), { q: history.filter(m => m.role === 'hookai').at(-1)?.content || '', a: content }].slice(-6)
          await query(database().from('studio_sessions').update({ topic: { ...(row.topic || {}), answers }, updated_at: new Date().toISOString() }).eq('id', row.id))
        }
        await addMessage(row.id, req.auth.userId, 'hookai', row.stage, reply.content, reply.meta)
      } catch (error) {
        console.error('[studio-chat]', error?.code || 'FAILED')
        await addMessage(row.id, req.auth.userId, 'hookai', row.stage, '앗, 이번 답은 만들지 못했어요. 같은 말을 한 번만 다시 보내주세요.', { failed: true }).catch(() => {})
      }
    })()
    res.status(202).json({ messages: [publicMessage(mine)], pending: true })
  }))
  // ----- 주제 찾기 -----
  // Files dropped into the conversation (notes, product pages, screenshots) are read into text here, under the studio's
  // own access check, so trial accounts can attach too.
  const materialTries = new Map()
  router.post('/creator-tools/studio/materials', (req, res, next) => uploadMaterials.array('files', 5)(req, res, error => next(error ? Object.assign(new Error('파일은 최대 5개, 파일당 10MB까지 올릴 수 있어요.'), { code: 'INVALID_SUPPORTING_FILES', statusCode: 400, exposeMessage: true }) : undefined)), asyncHandler(async (req, res) => {
    enabled(req)
    const now = Date.now(), recent = (materialTries.get(req.auth.userId) || []).filter(t => t > now - 3600000)
    if (recent.length >= 30) fail('TOO_MANY_REQUESTS', '잠시 후 다시 올려주세요.', 429)
    materialTries.set(req.auth.userId, [...recent, now])
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    res.json({ items: await extractSupportingMaterials(req.files, { userId: req.auth.userId, signal: controller.signal, readingContext: '주제 찾기 대화에 수강생이 올린 자료' }) })
  }))
  const ideaAttachments = value => (Array.isArray(value) ? value : []).map(a => ({ name: text(a?.name, 120), content: text(a?.content, 6000) })).filter(a => a.name && a.content).slice(0, 5)
  // The conversation shows attachment names; their text stays on the server for 훅ai.
  const publicIdeaMessage = row => ({ ...publicMessage(row), meta: { ...row.meta, attachments: (row.meta?.attachments || []).map(a => ({ name: a.name })) } })
  const addIdeaMessage = (threadId, userId, role, content, meta = {}) =>
    query(database().from('studio_idea_messages').insert({ thread_id: threadId, user_id: userId, role, content, meta }).select('*').single())
  const ownedThread = async req => {
    const row = await query(database().from('studio_idea_threads').select('*').eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).maybeSingle())
    if (!row) fail('THREAD_NOT_FOUND', '대화를 찾을 수 없어요.', 404)
    return row
  }
  const publicThread = row => ({ id: row.id, title: row.title, category: row.category, createdAt: row.created_at, updatedAt: row.updated_at })
  const publicSaved = row => ({ id: row.id, threadId: row.thread_id, title: row.title, angle: row.angle, promise: row.promise, why: row.why, materials: row.materials, facts: row.facts,
    category: row.category, reels: row.reels, memo: row.memo, sessionId: row.session_id, createdAt: row.created_at })
  // 훅ai answers in the background, like the plan chat; the page checks the conversation until the answer is in.
  const answerIdea = (thread, userId, content) => {
    void (async () => {
      try {
        const history = await query(database().from('studio_idea_messages').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true }).limit(200))
        const reply = await ideaReply(deps(), thread, history, content)
        await addIdeaMessage(thread.id, userId, 'hookai', reply.content, reply.meta)
        await query(database().from('studio_idea_threads').update({ category: reply.category, updated_at: new Date().toISOString() }).eq('id', thread.id))
      } catch (error) {
        console.error('[studio-ideas]', error?.code || 'FAILED')
        await addIdeaMessage(thread.id, userId, 'hookai', '앗, 이번 답은 만들지 못했어요. 같은 말을 한 번만 다시 보내주세요.', { failed: true }).catch(() => {})
      }
    })()
  }
  router.get('/creator-tools/studio/ideas', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database()
    const [threads, saved] = await Promise.all([
      query(db.from('studio_idea_threads').select('*').eq('user_id', req.auth.userId).order('updated_at', { ascending: false }).limit(30)),
      query(db.from('studio_saved_topics').select('*').eq('user_id', req.auth.userId).order('created_at', { ascending: false }).limit(200)),
    ])
    res.set('Cache-Control', 'private, no-store').json({ threads: threads.map(publicThread), saved: saved.map(publicSaved) })
  }))
  router.post('/creator-tools/studio/ideas/threads', asyncHandler(async (req, res) => {
    enabled(req)
    const attachments = ideaAttachments(req.body?.attachments)
    const content = text(req.body?.text, 4000) || (attachments.length ? `자료 ${attachments.length}개를 올렸어요` : '')
    if (!content) fail('MESSAGE_REQUIRED', '이야기를 적어주세요.')
    const thread = await query(database().from('studio_idea_threads').insert({ user_id: req.auth.userId, title: (text(req.body?.text, 60) || attachments[0]?.name || content).slice(0, 60) }).select('*').single())
    const mine = await addIdeaMessage(thread.id, req.auth.userId, 'user', content, attachments.length ? { attachments } : {})
    answerIdea(thread, req.auth.userId, content)
    res.status(202).json({ thread: publicThread(thread), messages: [publicIdeaMessage(mine)], pending: true })
  }))
  router.get('/creator-tools/studio/ideas/threads/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const thread = await ownedThread(req)
    const messages = await query(database().from('studio_idea_messages').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true }).limit(200))
    res.set('Cache-Control', 'private, no-store').json({ thread: publicThread(thread), messages: messages.map(publicIdeaMessage) })
  }))
  router.post('/creator-tools/studio/ideas/threads/:id/chat', asyncHandler(async (req, res) => {
    enabled(req)
    const thread = await ownedThread(req)
    const attachments = ideaAttachments(req.body?.attachments)
    const content = text(req.body?.text, 4000) || (attachments.length ? `자료 ${attachments.length}개를 올렸어요` : '')
    if (!content) fail('MESSAGE_REQUIRED', '이야기를 적어주세요.')
    const mine = await addIdeaMessage(thread.id, req.auth.userId, 'user', content, attachments.length ? { attachments } : {})
    answerIdea(thread, req.auth.userId, content)
    res.status(202).json({ messages: [publicIdeaMessage(mine)], pending: true })
  }))
  router.delete('/creator-tools/studio/ideas/threads/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const thread = await ownedThread(req)
    await query(database().from('studio_idea_threads').delete().eq('id', thread.id))
    res.json({ ok: true })
  }))
  // 주제 보관함: a topic card the student keeps, with what they told 훅ai and the research behind it.
  router.post('/creator-tools/studio/ideas/saved', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database(), c = req.body?.card || {}
    const title = text(c.title, 120)
    if (title.length < 2) fail('TOPIC_REQUIRED', '저장할 주제를 확인해주세요.')
    let thread = null, facts = []
    if (req.body?.threadId) {
      thread = await query(db.from('studio_idea_threads').select('*').eq('id', uuid(req.body.threadId)).eq('user_id', req.auth.userId).maybeSingle())
      if (thread) facts = (await query(db.from('studio_idea_messages').select('content,meta').eq('thread_id', thread.id).eq('role', 'user').order('created_at', { ascending: true }).limit(20)))
        .flatMap(m => [text(m.content, 600), ...(m.meta?.attachments || []).map(a => `올린 자료 「${text(a.name, 80)}」: ${text(a.content, 800)}`)]).filter(Boolean)
    }
    const reels = (Array.isArray(c.reels) ? c.reels : []).filter(r => /^[A-Za-z0-9_-]{5,40}$/.test(String(r?.id || ''))).slice(0, 3).map(r => ({ id: r.id, username: text(r.username, 40), views: Number(r.views) || null }))
    const row = await query(db.from('studio_saved_topics').insert({ user_id: req.auth.userId, thread_id: thread?.id || null, title, angle: text(c.angle, 240), promise: text(c.promise, 240), why: text(c.why, 400),
      materials: (Array.isArray(c.materials) ? c.materials : []).map(m => text(m, 160)).filter(Boolean).slice(0, 6), facts,
      category: SUCCESS_REEL_CATEGORIES.includes(c.category) ? c.category : thread?.category || null, reels, research: thread?.research || null }).select('*').single())
    res.status(201).json({ saved: publicSaved(row) })
  }))
  router.patch('/creator-tools/studio/ideas/saved/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const patch = { updated_at: new Date().toISOString() }
    if (typeof req.body?.memo === 'string') patch.memo = text(req.body.memo, 2000)
    if (typeof req.body?.title === 'string' && text(req.body.title, 120).length >= 2) patch.title = text(req.body.title, 120)
    const row = await query(database().from('studio_saved_topics').update(patch).eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).select('*').maybeSingle())
    if (!row) fail('TOPIC_NOT_FOUND', '저장한 주제를 찾을 수 없어요.', 404)
    res.json({ saved: publicSaved(row) })
  }))
  router.delete('/creator-tools/studio/ideas/saved/:id', asyncHandler(async (req, res) => {
    enabled(req)
    await query(database().from('studio_saved_topics').delete().eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId))
    res.json({ ok: true })
  }))
  // A saved topic becomes a plan that starts at the cover: what the student said and the research carry over.
  router.post('/creator-tools/studio/ideas/saved/:id/plan', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database()
    const saved = await query(db.from('studio_saved_topics').select('*').eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).maybeSingle())
    if (!saved) fail('TOPIC_NOT_FOUND', '저장한 주제를 찾을 수 없어요.', 404)
    const brief = [saved.title, saved.angle && `각도: ${saved.angle}`, saved.promise && `시청자가 얻는 것: ${saved.promise}`,
      saved.facts?.length ? `주제를 찾으며 내가 한 말:\n${saved.facts.map(f => `- ${f}`).join('\n')}` : '', saved.memo && `메모: ${saved.memo}`].filter(Boolean).join('\n').slice(0, 8000)
    const style = await query(db.from('studio_styles').select('card').eq('user_id', req.auth.userId).maybeSingle())
    const research = saved.research ? { ...saved.research, brief: brief.slice(0, 3000) } : undefined
    const topic = { title: saved.title, angle: saved.angle, promise: saved.promise, facts: [], audience: '', category: saved.category || '기타', answers: [], brief, ...(research ? { research } : {}), categoryChecked: Boolean(saved.category) }
    const row = await query(db.from('studio_sessions').insert({ user_id: req.auth.userId, mode: 'topic', sources: {}, brief, title: saved.title, topic, style_snapshot: style?.card || null }).select('*').single())
    await query(db.from('studio_topics').insert({ user_id: req.auth.userId, session_id: row.id, topic: saved.title, category: topic.category }))
    await query(db.from('studio_saved_topics').update({ session_id: row.id, updated_at: new Date().toISOString() }).eq('id', saved.id))
    await addMessage(row.id, req.auth.userId, 'hookai', 'thumbnail', STAGE_OPENERS.thumbnail)
    const session = await startStage(deps(), row, 'thumbnail', { force: true })
    res.status(201).json({ session: publicSession(session) })
  }))

  // Apply a 훅ai proposal to the current stage.
  router.post('/creator-tools/studio/sessions/:id/apply', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const msg = await query(database().from('studio_messages').select('*').eq('id', uuid(req.body?.messageId)).eq('session_id', row.id).maybeSingle())
    const p = msg?.meta?.proposal
    if (!p || (p.stage !== row.stage && row.stage !== 'done') || !row[p.stage]) fail('PROPOSAL_NOT_FOUND', '적용할 제안을 찾을 수 없어요.', 404)
    const patch = { updated_at: new Date().toISOString() }
    if (p.stage === 'script') patch.script = { ...row.script, edited: p.lines, history: remember(row.script, currentScript(row.script), `훅ai 수정 전 · ${p.summary || ''}`) }
    else if (p.stage === 'caption') patch.caption = { ...row.caption, edited: { text: p.text, hashtags: p.hashtags }, history: remember(row.caption, currentCaption(row.caption), `훅ai 수정 전 · ${p.summary || ''}`) }
    // Applying a chat revision makes it the version in use; the screen shows it on top and folds the original 3 options away.
    else if (p.stage === 'thumbnail') patch.thumbnail = { ...row.thumbnail, custom: p.text, applied: { text: p.text, summary: p.summary || '' }, history: remember(row.thumbnail, currentPick('thumbnail', row.thumbnail), pickNote(row.thumbnail)) }
    else if (p.stage === 'hook') patch.hook = { ...row.hook, custom: p.text, applied: { text: p.text, onScreen: p.onScreen || '', summary: p.summary || '' }, history: remember(row.hook, currentPick('hook', row.hook), pickNote(row.hook)) }
    const updated = await query(database().from('studio_sessions').update(patch).eq('id', row.id).select('*').single())
    res.json({ session: publicSession(updated) })
  }))

  // ----- 내 레퍼런스 -----
  router.get('/creator-tools/studio/references', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database()
    const mine = await query(db.from('creator_reel_user_analyses').select('shortcode,tags,created_at').eq('user_id', req.auth.userId).order('created_at', { ascending: false }).limit(500))
    const codes = mine.map(r => r.shortcode)
    const reels = codes.length ? await query(db.from('creator_success_reels').select('shortcode,username,views,posted_at,caption,caption_ko,category,thumbnail_path,analysis_status,analysis_requests,analysis,source,title,visible,owner_user_id').in('shortcode', codes)) : []
    const paths = reels.map(r => r.thumbnail_path).filter(Boolean)
    const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)) : []
    const urls = new Map(signed.filter(i => i.signedUrl).map(i => [i.path, i.signedUrl]))
    const byCode = new Map(reels.map(r => [r.shortcode, r]))
    res.set('Cache-Control', 'private, no-store').json({ references: mine.flatMap(m => { const r = byCode.get(m.shortcode); if (!r) return []
      if (!r.visible && r.owner_user_id !== req.auth.userId) return []
      return [{ kind: 'reel', id: r.shortcode, username: r.username, views: r.views, postedAt: r.posted_at, caption: r.caption_ko || r.caption, category: r.category, thumbnailUrl: urls.get(r.thumbnail_path) || null, source: r.source, title: r.title, permalink: r.source && r.source !== 'upload-link' && r.source.startsWith('upload') ? null : `https://www.instagram.com/reel/${r.shortcode}/`,
        analysisStatus: r.analysis_status, analysisRequests: r.analysis_requests || 0, tags: m.tags || [], addedAt: m.created_at,
        summary: r.analysis?.overview?.summary || null, hookType: r.analysis?.hook?.category || null, format: r.analysis?.structure?.category || null }] }) })
  }))
  router.patch('/creator-tools/studio/references/:shortcode', asyncHandler(async (req, res) => {
    enabled(req)
    const tags = (Array.isArray(req.body?.tags) ? req.body.tags : []).filter(t => TAGS.includes(t))
    await query(database().from('creator_reel_user_analyses').update({ tags }).eq('user_id', req.auth.userId).eq('shortcode', String(req.params.shortcode)))
    res.json({ tags })
  }))
  router.delete('/creator-tools/studio/references/:shortcode', asyncHandler(async (req, res) => {
    enabled(req)
    await query(database().from('creator_reel_user_analyses').delete().eq('user_id', req.auth.userId).eq('shortcode', String(req.params.shortcode)))
    res.json({ ok: true })
  }))

  // ----- 내 레퍼런스 직접 추가: 인스타그램 링크 · 영상 파일 · 대본 텍스트 -----
  const uploadQuota = async userId => {
    const since = new Date(Date.now() - 86400000).toISOString()
    const rows = await query(database().from('creator_success_reels').select('shortcode').eq('owner_user_id', userId).gte('first_collected_at', since).limit(UPLOADS_PER_DAY + 1))
    if (rows.length >= UPLOADS_PER_DAY) fail('UPLOAD_LIMIT', `레퍼런스 직접 추가는 하루 ${UPLOADS_PER_DAY}개까지예요.`, 429)
  }
  const uploadAccount = async (db, userId) => {
    const username = `up_${userId.replace(/-/g, '').slice(0, 12)}`
    await query(db.from('creator_reel_accounts').upsert({ username, profile: { upload: true }, last_seen_at: new Date().toISOString() }, { onConflict: 'username', ignoreDuplicates: true }))
    return username
  }
  const storeThumbnail = async (db, shortcode, dataUrl) => {
    const [, type, data] = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/) || []
    if (!type) return null
    const path = `${shortcode}.${type.split('/')[1].replace('jpeg', 'jpg')}`
    const { error } = await db.storage.from(THUMBNAIL_BUCKET).upload(path, Buffer.from(data, 'base64'), { contentType: type, upsert: true })
    return error ? null : path
  }
  const startAnalysis = (shortcode, userId) => requestReelAnalysis({ ...deps(), schedule: undefined }, shortcode, Date.now(), userId)

  // Reads the reel behind a link (account, counts, caption, cover) into its row. Throws when the link can't be read.
  // A caption or cover the row already has is kept when the link returns none.
  const fillFromLink = async (db, shortcode, url, priority = LOOKUP_PRIORITY.student) => {
    const providers = createProviders({ db, redis: sharedRedis(), job: { id: null, user_id: null }, signal: AbortSignal.timeout(180000) })
    const media = await providers.instagramReel(url, undefined, priority)
    const username = String(media.username || '').replace(/^@/, '').toLowerCase()
    if (!/^[a-zA-Z0-9_.]{1,30}$/.test(username)) fail('LINK_UNAVAILABLE', '이 릴스의 계정 정보를 읽지 못했어요.', 422)
    await query(db.from('creator_reel_accounts').upsert({ username, profile: { fromLink: true }, last_seen_at: new Date().toISOString() }, { onConflict: 'username', ignoreDuplicates: true }))
    const image = media.thumbnailUrl ? await readPublicImage(media.thumbnailUrl, AbortSignal.timeout(20000)).catch(() => null) : null
    const thumbnailPath = image ? await storeThumbnail(db, shortcode, image) : null
    await query(db.from('creator_success_reels').update({ username, views: media.views ?? 0, likes: media.likes, comments: media.comments,
      posted_at: media.postedAt || new Date().toISOString(), ...(media.caption ? { caption: media.caption } : {}), ...(thumbnailPath ? { thumbnail_path: thumbnailPath } : {}) }).eq('shortcode', shortcode))
    // The link fetch already paid for the video URL; keep it for the analysis download.
    if (media.videoUrl) await sharedRedis().set(`success-reel-video:${shortcode}`, media.videoUrl, 'EX', 3600).catch(() => {})
    return { thumbnail: Boolean(thumbnailPath) }
  }
  // Bright Data takes a minute or more, so the row is created at once and filled in the background;
  // the student watches the same analysis tracker as for any other reel.
  const importLink = async (shortcode, url, userId) => {
    const db = database()
    try {
      await fillFromLink(db, shortcode, url)
    } catch (error) {
      const text = error?.exposeMessage ? error.message : '영상을 가져오지 못했어요. 링크를 확인하고 다시 시도해주세요.'
      await query(db.from('creator_success_reels').update({ analysis_status: 'failed', analysis_error: text, analysis_updated_at: new Date().toISOString() }).eq('shortcode', shortcode)).catch(() => {})
      return
    }
    await runReelAnalysis(deps(), shortcode)
  }
  // 추천 릴스: links 지영 or the client hand over join 성공 릴스 with a '추천' tag, whatever their views or age.
  // New links are read one after another in the background; the Mac mini collector refreshes counts and covers later.
  const recommendLink = async (shortcode, url) => {
    const db = database()
    try {
      const { thumbnail } = await fillFromLink(db, shortcode, url, LOOKUP_PRIORITY.recommend)
      if (thumbnail) await query(db.from('creator_success_reels').update({ visible: true }).eq('shortcode', shortcode))
    } catch (error) {
      console.error('[recommend-link]', shortcode, error?.code || 'LINK_FAILED')
      // A link Instagram no longer shows (deleted or made private) is marked once, so restarts do not retry it.
      // LOOKUP_BLOCKED (the Mac mini's Instagram is limited) says nothing about the link, so it is left for a later run.
      if (['LINK_DELETED', 'LINK_PRIVATE', 'LINK_UNAVAILABLE'].includes(error?.code)) await query(db.from('creator_success_reels')
        .update({ analysis_status: 'failed', analysis_error: '인스타에서 볼 수 없는 링크예요(삭제·비공개).', analysis_updated_at: new Date().toISOString() }).eq('shortcode', shortcode)).catch(() => {})
    }
  }
  // The background queue lives in memory, so a deploy drops it; after a restart the unread 추천 links are queued again.
  if (process.env.NODE_ENV !== 'test') setTimeout(async () => {
    try {
      const db = database()
      const pending = await query(db.from('creator_success_reels').select('shortcode').eq('recommended', true).eq('username', 'recommended').neq('analysis_status', 'failed').limit(300))
      for (const { shortcode } of pending) schedule(`recommend:${shortcode}`, () => recommendLink(shortcode, `https://www.instagram.com/reel/${shortcode}/`), 1)
    } catch (error) { console.error('[recommend-resume]', error?.code || 'FAILED') }
  }, 30000).unref?.()
  // 영상 편집: speech-to-text mishears words; with the plan's script 훅ai fixes only the misheard words and keeps every cue's timing.
  const fixSchema = { type: 'object', additionalProperties: false, required: ['cues'], properties: { cues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'text'], properties: { i: { type: 'integer' }, text: { type: 'string' } } } } } }
  router.post('/creator-tools/studio/media/:id/fix-subtitles', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database(), media = await ownedMedia(db, uuid(req.params.id), req.auth.userId)
    const cues = Array.isArray(media.manifest?.subtitles) ? media.manifest.subtitles : []
    if (!cues.length) fail('NO_SUBTITLES', '고칠 자막이 없어요.', 409)
    const plan = await planContextFor(db, req.auth.userId, uuid(req.body?.planId))
    if (!plan.script.length && !plan.hook) fail('NO_SCRIPT', '이 기획안에는 아직 대본이 없어요.', 409)
    const providers = deps().makeProviders(AbortSignal.timeout(120000))
    const fieldTerms = ((await fieldKnowledge(db, plan.category))?.terms || []).map(t => t.word)
    const raw = await providers.json('studio-fix-subtitles', `${HOOKAI_SYSTEM}\n\n음성 받아쓰기로 만든 자막(cues)을 학생이 기획한 대본(script)과 견주어, 잘못 들려서 틀린 단어(제품명·고유명사·분야 용어·맞춤법·띄어쓰기)만 고칩니다. fieldTerms는 이 분야에서 자주 쓰는 말이라, 받아쓰기가 비슷한 소리의 다른 말로 적었는지 가릴 때 참고합니다. 학생이 실제로 대본과 다르게 말한 부분은 말한 그대로 둡니다. 자막을 합치거나 나누지 말고, 받은 i마다 고친 text 하나를 돌려줍니다. 고칠 것이 없으면 원래 text 그대로.`,
      { script: [plan.hook, ...plan.script].filter(Boolean), fieldTerms, cues: cues.map((c, i) => ({ i, text: c.text })) }, [], fixSchema)
    const fixed = new Map((Array.isArray(raw?.cues) ? raw.cues : []).map(c => [c.i, String(c.text || '').trim().slice(0, 500)]))
    const subtitles = cues.map((c, i) => ({ ...c, text: fixed.get(i) || c.text }))
    res.json({ subtitles, changed: subtitles.filter((c, i) => c.text !== cues[i].text).length })
  }))

  // 훅ai's daily study: what it knows per field and the latest runs (admins only), and a manual run for checking.
  router.get('/creator-tools/studio/knowledge', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '관리자만 볼 수 있어요.', 404)
    const db = database()
    const fields = await query(db.from('creator_field_knowledge').select('category,knowledge,reel_count,built_at').order('built_at', { ascending: false }))
    const runs = await query(db.from('creator_study_runs').select('day,started_at,finished_at,stats,error').order('started_at', { ascending: false }).limit(10))
    res.json({ fields, runs })
  }))
  router.post('/creator-tools/studio/knowledge/study', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '관리자만 실행할 수 있어요.', 404)
    const limit = Math.max(0, Math.min(60, Number(req.body?.limit ?? 10)))
    schedule('daily-study:manual', () => studyOnce(deps(), { limit }), 1)
    res.status(202).json({ started: true, limit })
  }))
  if (process.env.NODE_ENV !== 'test') { startDailyStudy(deps()); startDemoRefresh() }
  // Client trial links (admins only): create one, list them, turn one off.
  router.post('/creator-tools/studio/trial-links', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '관리자만 만들 수 있어요.', 404)
    const origin = String(process.env.CLIENT_ORIGIN || 'https://www.hookai.kr').split(',')[0].trim().replace(/\/$/, '')
    res.status(201).json(await createDemoLink(database(), { label: text(req.body?.label, 60) || '클라이언트 체험', days: req.body?.days, createdBy: req.auth.userId, origin }))
  }))
  router.get('/creator-tools/studio/trial-links', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '관리자만 볼 수 있어요.', 404)
    res.json({ links: await query(database().from('creator_demo_links').select('id,label,expires_at,revoked_at,last_used_at,created_at').order('created_at', { ascending: false })) })
  }))
  router.post('/creator-tools/studio/trial-links/:id/revoke', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '관리자만 끌 수 있어요.', 404)
    await query(database().from('creator_demo_links').update({ revoked_at: new Date().toISOString() }).eq('id', uuid(req.params.id)))
    await refreshDemoUsers()
    res.json({ ok: true })
  }))
  // Re-judge every listed reel's field and reference fit after the judging rule changes (admins only), 30 per call.
  router.post('/creator-tools/studio/rejudge-reels', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '관리자만 실행할 수 있어요.', 404)
    const db = database()
    const rows = (await query(db.from('creator_success_reels').select('shortcode,username,caption,source').eq('visible', true).neq('caption', '').order('views', { ascending: false }).limit(2000)))
      .filter(row => !String(row.source || '').startsWith('upload-'))
    schedule('rejudge-reels', async () => {
      for (let i = 0; i < rows.length; i += 30) await classifyReelCategories(db, deps().makeProviders(AbortSignal.timeout(180000)), rows.slice(i, i + 30)).catch(error => console.error('[rejudge-reels]', error?.code || 'FAILED'))
    }, 3)
    res.status(202).json({ started: true, reels: rows.length })
  }))

  router.post('/creator-tools/studio/recommended', asyncHandler(async (req, res) => {
    if (!canRecommend(req.auth.userId)) fail('FEATURE_DISABLED', '추천 릴스는 관리자만 추가할 수 있어요.', 404)
    const db = database()
    // items: [{ url, title }] — title is the cover copy written above the link (a proven success cover); links: plain URLs.
    const items = [...(Array.isArray(req.body?.items) ? req.body.items : []), ...(Array.isArray(req.body?.links) ? req.body.links.map(url => ({ url })) : [])].slice(0, 200)
    const result = { added: [], updated: [], invalid: [] }
    const seen = new Set()
    for (const item of items) {
      const raw = item?.url
      const title = text(item?.title, 80) || null
      const url = instagramPostUrl(String(raw || '').trim())
      const shortcode = url ? new URL(url).pathname.split('/')[2] : null
      if (!shortcode) { result.invalid.push(String(raw || '').slice(0, 200)); continue }
      if (seen.has(shortcode)) continue
      seen.add(shortcode)
      const existing = await query(db.from('creator_success_reels').select('shortcode,thumbnail_path').eq('shortcode', shortcode).maybeSingle())
      if (existing) {
        await query(db.from('creator_success_reels').update({ recommended: true, ...(title ? { cover_title: title } : {}), ...(existing.thumbnail_path ? { visible: true } : {}) }).eq('shortcode', shortcode))
        result.updated.push(shortcode)
        if (!existing.thumbnail_path) schedule(`recommend:${shortcode}`, () => recommendLink(shortcode, url), 1)
        continue
      }
      await query(db.from('creator_reel_accounts').upsert({ username: 'recommended', profile: { recommended: true }, last_seen_at: new Date().toISOString() }, { onConflict: 'username', ignoreDuplicates: true }))
      await query(db.from('creator_success_reels').insert({ shortcode, username: 'recommended', views: 0, posted_at: new Date().toISOString(), caption: '', source: 'recommended', recommended: true, cover_title: title, visible: false }))
      result.added.push(shortcode)
      schedule(`recommend:${shortcode}`, () => recommendLink(shortcode, url), 1)
    }
    res.status(201).json(result)
  }))

  router.post('/creator-tools/studio/references/link', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database(), userId = req.auth.userId
    const url = instagramPostUrl(String(req.body?.url || '').trim())
    if (!url) fail('LINK_INVALID', '인스타그램 릴스 링크를 넣어주세요. 예) https://www.instagram.com/reel/XXXX/')
    const shortcode = new URL(url).pathname.split('/')[2]
    const existing = await query(db.from('creator_success_reels').select('shortcode,visible,owner_user_id').eq('shortcode', shortcode).maybeSingle())
    if (!existing) {
      await uploadQuota(userId)
      const now = new Date().toISOString()
      await query(db.from('creator_success_reels').upsert({ shortcode, username: await uploadAccount(db, userId), views: 0, posted_at: now, caption: '', source: 'upload-link',
        owner_user_id: userId, visible: false, analysis_status: 'running', analysis_error: null, analysis_updated_at: now }, { onConflict: 'shortcode' }))
      await query(db.from('creator_reel_user_analyses').upsert({ user_id: userId, shortcode, created_at: now }))
      schedule(`analysis:${shortcode}`, () => importLink(shortcode, url, userId))
      res.status(201).json({ shortcode, status: 'running' })
      return
    }
    if (!existing.visible && existing.owner_user_id !== userId) {
      // Someone else's private link: make it theirs too so it appears in their library.
      await query(db.from('creator_success_reels').update({ owner_user_id: userId }).eq('shortcode', shortcode))
    }
    const result = await startAnalysis(shortcode, userId)
    res.status(201).json({ shortcode, status: result.status })
  }))

  router.post('/creator-tools/studio/references/text', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database(), userId = req.auth.userId
    const body = text(req.body?.text, 12000), title = text(req.body?.title, 80) || body.split(/\n/)[0].slice(0, 40)
    if (body.length < 20) fail('TEXT_TOO_SHORT', '대본을 20자 이상 넣어주세요.')
    await uploadQuota(userId)
    const shortcode = `up_${randomUUID().replace(/-/g, '').slice(0, 24)}`
    const username = await uploadAccount(db, userId)
    await query(db.from('creator_success_reels').insert({ shortcode, username, views: 0, posted_at: new Date().toISOString(), caption: '', source: 'upload-text', source_text: body, title, owner_user_id: userId, visible: false }))
    const result = await startAnalysis(shortcode, userId)
    res.status(201).json({ shortcode, title, status: result.status })
  }))

  router.post('/creator-tools/studio/references/video', (req, res, next) => uploadVideo.single('video')(req, res, error => next(error ? fail('VIDEO_TOO_LARGE', '영상은 150MB 이하로 올려주세요.') : undefined)), asyncHandler(async (req, res) => {
    enabled(req)
    const db = database(), userId = req.auth.userId
    const file = req.file
    if (!file) fail('VIDEO_REQUIRED', '영상 파일을 골라주세요.')
    try {
      if (!/^video\//.test(file.mimetype)) fail('NOT_VIDEO', '영상 파일만 올릴 수 있어요.')
      await uploadQuota(userId)
      const signal = AbortSignal.timeout(120000)
      await probeVideo(file.path, signal, { allowSilent: true })
      const shortcode = `up_${randomUUID().replace(/-/g, '').slice(0, 24)}`
      const title = text(req.body?.title, 80) || String(file.originalname || '내 영상').replace(/\.[^.]+$/, '').slice(0, 40)
      const storagePath = `studio-uploads/${userId}/${shortcode}.mp4`
      const { error } = await db.storage.from(BUCKET).upload(storagePath, await readFile(file.path), { contentType: file.mimetype, upsert: true })
      if (error) fail('UPLOAD_FAILED', '영상을 저장하지 못했어요. 다시 시도해주세요.', 502)
      const frame = join(tmpdir(), `${shortcode}.jpg`)
      let thumbnailPath = null
      try { await ff(['-ss', '0.5', '-i', file.path, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5', frame], signal); thumbnailPath = await storeThumbnail(db, shortcode, `data:image/jpeg;base64,${(await readFile(frame)).toString('base64')}`) } catch { /* no cover */ } finally { await rm(frame, { force: true }) }
      const username = await uploadAccount(db, userId)
      await query(db.from('creator_success_reels').insert({ shortcode, username, views: 0, posted_at: new Date().toISOString(), caption: '', source: 'upload-video', source_path: storagePath, title, owner_user_id: userId, visible: false, thumbnail_path: thumbnailPath }))
      const result = await startAnalysis(shortcode, userId)
      res.status(201).json({ shortcode, title, status: result.status })
    } finally { await rm(file.path, { force: true }) }
  }))

  // ----- 내 공식 -----
  router.get('/creator-tools/studio/formulas', asyncHandler(async (req, res) => {
    enabled(req)
    const rows = await query(database().from('studio_formulas').select('id,kind,title,spec,example,source,created_at').eq('user_id', req.auth.userId).order('created_at', { ascending: false }).limit(300))
    res.set('Cache-Control', 'private, no-store').json({ formulas: rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, spec: r.spec, example: r.example, source: r.source, createdAt: r.created_at })) })
  }))
  router.post('/creator-tools/studio/formulas', asyncHandler(async (req, res) => {
    enabled(req)
    const kind = TAGS.includes(req.body?.kind) ? req.body.kind : fail('KIND_REQUIRED', '공식 종류를 골라주세요.')
    let draft
    if (req.body?.sessionId) {
      const session = await query(database().from('studio_sessions').select('*').eq('id', uuid(req.body.sessionId)).eq('user_id', req.auth.userId).maybeSingle())
      if (!session) fail('SESSION_NOT_FOUND', '기획안을 찾을 수 없어요.', 404)
      const resolved = await resolveSources(database(), req.auth.userId, session.sources).catch(() => ({}))
      draft = formulaFromSession(session, resolved, kind)
      if (!draft) fail('FORMULA_EMPTY', '이 단계가 아직 완성되지 않았어요.', 409)
      draft.source = { sessionId: session.id, topic: session.topic?.title || null }
    } else if (typeof req.body?.shortcode === 'string') {
      const code = /^[A-Za-z0-9_-]{5,40}$/.test(req.body.shortcode) ? req.body.shortcode : fail('REEL_NOT_FOUND', '확인할 수 없는 릴스입니다.', 404)
      const reel = await query(database().from('creator_success_reels').select('shortcode,username,caption,visible,owner_user_id,analysis,analysis_status').eq('shortcode', code).maybeSingle())
      if (!reel || !(reel.visible || reel.owner_user_id === req.auth.userId)) fail('REEL_NOT_FOUND', '확인할 수 없는 릴스입니다.', 404)
      if (reel.analysis_status !== 'ready') fail('SOURCE_NOT_READY', '아직 분석이 끝나지 않은 릴스예요.', 409)
      draft = formulaFromReel(reel, kind)
      if (!draft) fail('FORMULA_EMPTY', '이 릴스 분석에는 저장할 내용이 없어요.', 409)
    } else if (req.body?.libraryId) {
      const entry = await libraryEntry(database(), kind, String(req.body.libraryId))
      if (!entry) fail('SOURCE_NOT_FOUND', '공식 사전 항목을 찾을 수 없어요.', 404)
      draft = { title: entry.title, spec: kind === 'hook' ? { type: entry.type, formula: entry.formula } : { format: entry.format, segments: entry.segments, ...(entry.lines ? { lines: entry.lines } : {}) }, example: entry.example || entry.summary, source: { libraryId: entry.id } }
    } else fail('SOURCE_REQUIRED', '저장할 내용이 없어요.')
    const title = text(req.body?.title, 80) || draft.title
    const row = await query(database().from('studio_formulas').insert({ user_id: req.auth.userId, kind, title, spec: draft.spec, example: draft.example || '', source: draft.source || {} }).select('id,kind,title,spec,example,source,created_at').single())
    res.status(201).json({ formula: { id: row.id, kind: row.kind, title: row.title, spec: row.spec, example: row.example, source: row.source, createdAt: row.created_at } })
  }))
  router.delete('/creator-tools/studio/formulas/:id', asyncHandler(async (req, res) => {
    enabled(req)
    await query(database().from('studio_formulas').delete().eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId))
    res.json({ ok: true })
  }))

  // ----- 공식 사전 (with live examples from analyzed success reels) -----
  router.get('/creator-tools/studio/library', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database()
    const rows = await query(db.from('creator_success_reels').select('shortcode,username,views,thumbnail_path,analysis').eq('visible', true).eq('analysis_status', 'ready').order('views', { ascending: false }).limit(400))
    // Examples are the reels 훅ai's daily study filed under each entry; a reel it has not filed yet falls back to the analysis type.
    const filed = new Map((await query(db.from('creator_reel_formulas').select('shortcode,hook_id,structure_id')).catch(() => [])).map(m => [m.shortcode, m]))
    const library = await libraryEntries(db)
    const paths = rows.map(r => r.thumbnail_path).filter(Boolean)
    const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)) : []
    const urls = new Map(signed.filter(i => i.signedUrl).map(i => [i.path, i.signedUrl]))
    // Entries from course material name their own example reels; they come first, shown from 성공 릴스 when the reel is
    // there and otherwise as a link to Instagram.
    const curatedCodes = [...new Set(library.structures.flatMap(s => s.template ? s.examples || [] : []))]
    const curatedRows = curatedCodes.length ? await query(db.from('creator_success_reels').select('shortcode,username,views,thumbnail_path,analysis').in('shortcode', curatedCodes)) : []
    const extraPaths = curatedRows.map(r => r.thumbnail_path).filter(p => p && !urls.has(p))
    if (extraPaths.length) for (const i of await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(extraPaths, 3600))) if (i.signedUrl) urls.set(i.path, i.signedUrl)
    const curated = new Map(curatedRows.map(r => [r.shortcode, r]))
    const example = r => ({ id: r.shortcode, username: r.username, views: r.views, thumbnailUrl: urls.get(r.thumbnail_path) || null, hook: r.analysis?.hook?.spokenHook || null, formula: r.analysis?.hook?.formula || null })
    const named = code => curated.has(code) ? example(curated.get(code)) : { id: code, username: null, views: null, thumbnailUrl: null, hook: null, formula: null, instagramUrl: `https://www.instagram.com/reel/${code}/` }
    res.set('Cache-Control', 'private, max-age=300').json({
      hooks: library.hooks.map(h => { const hits = rows.filter(r => filed.has(r.shortcode) ? filed.get(r.shortcode).hook_id === h.id : !h.learned && r.analysis?.hook?.category === h.type); return { ...h, count: hits.length, examples: hits.slice(0, 8).map(example) } }),
      structures: library.structures.map(s => {
        const own = (s.template ? s.examples || [] : []).map(named)
        // A template is matched only by the daily study's filing, never by the broad analysis type.
        const hits = rows.filter(r => !own.some(o => o.id === r.shortcode) && (filed.has(r.shortcode) ? filed.get(r.shortcode).structure_id === s.id : !s.learned && !s.template && r.analysis?.structure?.category === s.format))
        return { ...s, count: own.length + hits.length, examples: [...own, ...hits.slice(0, 8).map(example)] }
      }),
    })
  }))

  // ----- 내 말투 -----
  router.get('/creator-tools/studio/style', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database()
    const [style, topics] = await Promise.all([
      query(db.from('studio_styles').select('description,choices,samples,card,updated_at').eq('user_id', req.auth.userId).maybeSingle()),
      query(db.from('studio_topics').select('id,topic,category,created_at').eq('user_id', req.auth.userId).order('created_at', { ascending: false }).limit(20)),
    ])
    res.set('Cache-Control', 'private, no-store').json({ style: style ? { description: style.description, choices: style.choices, samples: style.samples, card: style.card, updatedAt: style.updated_at } : null,
      topics: topics.map(t => ({ id: t.id, topic: t.topic, category: t.category, createdAt: t.created_at })) })
  }))
  router.put('/creator-tools/studio/style', asyncHandler(async (req, res) => {
    enabled(req)
    const description = text(req.body?.description, 2000), samples = text(req.body?.samples, 8000)
    const choices = req.body?.choices && typeof req.body.choices === 'object' ? Object.fromEntries(Object.entries(req.body.choices).slice(0, 12).map(([k, v]) => [text(k, 40), text(String(v ?? ''), 60)])) : {}
    const card = description || samples || Object.keys(choices).length ? await buildStyleCard(deps(), { description, choices, samples }) : null
    const row = await query(database().from('studio_styles').upsert({ user_id: req.auth.userId, description, choices, samples, card, updated_at: new Date().toISOString() }).select('description,choices,samples,card,updated_at').single())
    res.json({ style: { description: row.description, choices: row.choices, samples: row.samples, card: row.card, updatedAt: row.updated_at } })
  }))
  router.delete('/creator-tools/studio/topics/:id', asyncHandler(async (req, res) => {
    enabled(req)
    await query(database().from('studio_topics').delete().eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId))
    res.json({ ok: true })
  }))
}
