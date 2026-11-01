// YouTube links as references. The Mac mini (a home connection YouTube does not treat as a bot) downloads the video
// and uploads the file; from there it is analyzed like a video the student uploaded.
export const YOUTUBE_MAX_SECONDS = 180
export const YOUTUBE_PREFIX = 'yt_'

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
// The 11-character video id from a Shorts, watch, live, embed or youtu.be link; null for anything else.
export function youtubeVideoId(input) {
  let url
  try { url = new URL(String(input || '').trim()) } catch { return null }
  if (!['https:', 'http:'].includes(url.protocol) || !HOSTS.has(url.hostname) || url.port || url.username || url.password) return null
  const [first, second] = url.pathname.split('/').filter(Boolean)
  const id = url.hostname === 'youtu.be' ? first
    : first === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'live', 'embed'].includes(first) ? second : null
  return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null
}
export const youtubeShortcode = id => `${YOUTUBE_PREFIX}${id}`
export const isYoutubeShortcode = shortcode => String(shortcode || '').startsWith(YOUTUBE_PREFIX)
export const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`
export const youtubeVideoPath = shortcode => `studio-uploads/youtube/${shortcode}.mp4`
