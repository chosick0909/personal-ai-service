import { query } from '../store.js'
import { fail } from '../domain.js'

const chosen = f => !f ? null : f.custom ? f.custom : f.options?.[f.chosen ?? 0] ?? null
const text = v => typeof v === 'string' ? v : v?.text || v?.spoken || ''

// What the student planned for a video (cover, first line, script, caption), for checking and subtitling the filmed video.
export async function planContextFor(db, userId, sessionId) {
  const row = await query(db.from('studio_sessions').select('id,title,topic,thumbnail,hook,script,caption').eq('id', sessionId).eq('user_id', userId).maybeSingle())
  if (!row) fail('PLAN_NOT_FOUND', '기획안을 찾을 수 없어요.', 404)
  const lines = row.script?.edited || chosen(row.script)?.lines || []
  const caption = row.caption?.edited || chosen(row.caption)
  return {
    id: row.id,
    title: String(row.title || row.topic?.title || '').slice(0, 200),
    thumbnail: text(chosen(row.thumbnail)).slice(0, 200),
    hook: text(chosen(row.hook)).slice(0, 400),
    script: lines.map(l => String(l?.spoken || '').slice(0, 400)).filter(Boolean).slice(0, 40),
    caption: caption ? `${caption.text || ''}${caption.hashtags?.length ? `\n\n${caption.hashtags.map(t => `#${t}`).join(' ')}` : ''}`.slice(0, 5000) : '',
  }
}
