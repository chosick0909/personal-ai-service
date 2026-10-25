import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { instagramPostUrl } from './reference-quality.js'

const exec = promisify(execFile)
export function playbackUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.port && !u.username && !u.password
      && (u.hostname.endsWith('.cdninstagram.com') || u.hostname.endsWith('.fbcdn.net')) ? u.href : null
  } catch { return null }
}

// Only URLs from an approved catalog record reach the extractor. No cookies,
// user login, paid provider, file download, or arbitrary command arguments.
export function createReferencePlayback({ extract = async url => {
  const { stdout } = await exec('yt-dlp', ['--ignore-config', '--no-playlist', '--skip-download',
    '--dump-single-json', '--no-warnings', '--socket-timeout', '5', '--retries', '0', '--', url],
  { timeout: 9000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 })
  return JSON.parse(stdout)
}, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map()
  let active = 0
  async function resolve(value) {
    const source = instagramPostUrl(value)
    if (!source) return null
    const shortcode = new URL(source).pathname.split('/')[2]
    const key = shortcode
    const cached = cache.get(key)
    if (cached?.expires > now()) return cached.value
    if (pending.has(key)) return pending.get(key)
    // Do not queue unbounded subprocesses behind slow external sites.
    if (active >= 2) return null
    const task = (async () => {
      active++
      let result = null
      try {
        const record = await extract(`https://www.instagram.com/reel/${shortcode}/`)
        // Reject redirections/recommendations to a different post or photo.
        if (String(record.id) !== shortcode || record.is_live || record._type === 'playlist') return null
        const formats = [...(Array.isArray(record.formats) ? record.formats : []), record]
        const video = formats.filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && f.acodec !== 'none'
          && playbackUrl(f.url)).sort((a,b) => (b.height || 0) - (a.height || 0))[0]
        if (video) result = { url: playbackUrl(video.url), caption: typeof record.description === 'string' ? record.description.slice(0, 5000) : '' }
        return result
      } catch { return null }
      finally {
        active--
        // URLs are short-lived; never store them as permanent catalog evidence.
        if (cache.size >= 200) cache.delete(cache.keys().next().value)
        cache.set(key, { value: result, expires: now() + (result ? 5 * 60000 : 60000) })
      }
    })()
    pending.set(key, task)
    try { return await task } finally { pending.delete(key) }
  }
  return { resolve }
}

export const referencePlayback = createReferencePlayback()
