// Instagram's /reel(s)/ viewer can advance to an unrelated recommended reel.
// Keep the exact shortcode, but open the fixed post detail instead.
export function referenceContentHref(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)
      || url.port || url.username || url.password) return null
    const match = url.pathname.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)\/?$/)
    return match ? `https://www.instagram.com/p/${match[1]}/` : null
  } catch { return null }
}
