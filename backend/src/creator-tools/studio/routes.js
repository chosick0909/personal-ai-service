import Redis from 'ioredis'
import { asyncHandler } from '../../lib/errors.js'
import { fail, uuid } from '../domain.js'
import { database, query } from '../store.js'
import { redisConnection } from '../queue.js'
import { createProviders } from '../providers.js'
import { studio2Enabled } from './access.js'
import { HOOK_LIBRARY, STRUCTURE_LIBRARY } from './library.js'
import { STAGE_OPENERS, STAGE_ORDER, nextStage } from './persona.js'
import { SLOTS, resolveSources, openerMessage, chat, startStage, formulaFromSession, buildStyleCard, answerAsk } from './engine.js'
import { THUMBNAIL_BUCKET } from '../success-reels.js'
import { SUCCESS_REEL_CATEGORIES } from '../categories.js'

let redis
const sharedRedis = () => { if (!redis) { redis = new Redis({ ...redisConnection(), maxRetriesPerRequest: 1 }); redis.on('error', () => {}) } return redis }
const deps = () => ({ db: database(), redis: sharedRedis(), makeProviders: signal => createProviders({ db: database(), redis: sharedRedis(), job: { id: null, user_id: null }, signal }) })
const TAGS = ['hook', 'structure', 'filming', 'caption']
const text = (value, max) => typeof value === 'string' ? value.normalize('NFC').trim().slice(0, max) : ''

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
    const opener = await openerMessage(deps(), row).catch(() => ({ content: '어떤 릴스를 만들어볼까요? 담고 싶은 내용을 편하게 적어주세요.', meta: { chips: ['주제 제안해줘'] } }))
    const msg = await addMessage(row.id, req.auth.userId, 'hookai', 'topic', opener.content, opener.meta)
    res.status(201).json({ session: publicSession(row), messages: [publicMessage(msg)] })
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
      if (Number.isInteger(change.chosen) && row[field].options?.[change.chosen]) { next.chosen = change.chosen; if ('custom' in next) next.custom = null; if ('edited' in next) next.edited = null }
      if (typeof change.custom === 'string' && 'custom' in next) next.custom = text(change.custom, 200) || null
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
      audience: text(t.audience, 120), category: SUCCESS_REEL_CATEGORIES.includes(t.category) ? t.category : '기타', answers: row.topic?.answers || [] }
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
    const reply = await chat(deps(), row, history, content)
    if (row.stage === 'topic' && !reply.meta.topic && !reply.meta.proposals?.length) {
      const answers = [...(row.topic?.answers || []), { q: history.filter(m => m.role === 'hookai').at(-1)?.content || '', a: content }].slice(-6)
      await query(database().from('studio_sessions').update({ topic: { ...(row.topic || {}), answers }, updated_at: new Date().toISOString() }).eq('id', row.id))
    }
    const theirs = await addMessage(row.id, req.auth.userId, 'hookai', row.stage, reply.content, reply.meta)
    res.json({ messages: [publicMessage(mine), publicMessage(theirs)] })
  }))
  // Apply a 훅ai proposal to the current stage.
  router.post('/creator-tools/studio/sessions/:id/apply', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const msg = await query(database().from('studio_messages').select('*').eq('id', uuid(req.body?.messageId)).eq('session_id', row.id).maybeSingle())
    const p = msg?.meta?.proposal
    if (!p || p.stage !== row.stage) fail('PROPOSAL_NOT_FOUND', '적용할 제안을 찾을 수 없어요.', 404)
    const patch = { updated_at: new Date().toISOString() }
    if (p.stage === 'script') patch.script = { ...row.script, edited: p.lines }
    else if (p.stage === 'caption') patch.caption = { ...row.caption, edited: { text: p.text, hashtags: p.hashtags } }
    else if (p.stage === 'thumbnail') patch.thumbnail = { ...row.thumbnail, custom: p.text }
    else if (p.stage === 'hook') { const options = [...(row.hook?.options || [])]; options.unshift({ spoken: p.text, onScreen: p.onScreen || '', type: '기타', why: p.summary || '훅ai 수정안' }); patch.hook = { ...row.hook, options: options.slice(0, 4), chosen: 0, custom: null } }
    const updated = await query(database().from('studio_sessions').update(patch).eq('id', row.id).select('*').single())
    res.json({ session: publicSession(updated) })
  }))

  // ----- 내 레퍼런스 -----
  router.get('/creator-tools/studio/references', asyncHandler(async (req, res) => {
    enabled(req)
    const db = database()
    const mine = await query(db.from('creator_reel_user_analyses').select('shortcode,tags,created_at').eq('user_id', req.auth.userId).order('created_at', { ascending: false }).limit(500))
    const codes = mine.map(r => r.shortcode)
    const reels = codes.length ? await query(db.from('creator_success_reels').select('shortcode,username,views,posted_at,caption,caption_ko,category,thumbnail_path,analysis_status,analysis_requests,analysis').in('shortcode', codes)) : []
    const paths = reels.map(r => r.thumbnail_path).filter(Boolean)
    const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)) : []
    const urls = new Map(signed.filter(i => i.signedUrl).map(i => [i.path, i.signedUrl]))
    const byCode = new Map(reels.map(r => [r.shortcode, r]))
    res.set('Cache-Control', 'private, no-store').json({ references: mine.flatMap(m => { const r = byCode.get(m.shortcode); if (!r) return []
      return [{ kind: 'reel', id: r.shortcode, username: r.username, views: r.views, postedAt: r.posted_at, caption: r.caption_ko || r.caption, category: r.category, thumbnailUrl: urls.get(r.thumbnail_path) || null,
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
    } else if (req.body?.libraryId) {
      const entry = kind === 'hook' ? HOOK_LIBRARY.find(h => h.id === req.body.libraryId) : STRUCTURE_LIBRARY.find(s => s.id === req.body.libraryId)
      if (!entry) fail('SOURCE_NOT_FOUND', '공식 사전 항목을 찾을 수 없어요.', 404)
      draft = { title: entry.title, spec: kind === 'hook' ? { type: entry.type, formula: entry.formula } : { format: entry.format, segments: entry.segments }, example: entry.example || entry.summary, source: { libraryId: entry.id } }
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
    const paths = rows.map(r => r.thumbnail_path).filter(Boolean)
    const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)) : []
    const urls = new Map(signed.filter(i => i.signedUrl).map(i => [i.path, i.signedUrl]))
    const example = r => ({ id: r.shortcode, username: r.username, views: r.views, thumbnailUrl: urls.get(r.thumbnail_path) || null, hook: r.analysis?.hook?.spokenHook || null, formula: r.analysis?.hook?.formula || null })
    res.set('Cache-Control', 'private, max-age=300').json({
      hooks: HOOK_LIBRARY.map(h => { const hits = rows.filter(r => r.analysis?.hook?.category === h.type); return { ...h, count: hits.length, examples: hits.slice(0, 4).map(example) } }),
      structures: STRUCTURE_LIBRARY.map(s => { const hits = rows.filter(r => r.analysis?.structure?.category === s.format); return { ...s, count: hits.length, examples: hits.slice(0, 4).map(example) } }),
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
