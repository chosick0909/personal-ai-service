import { referenceContentHref } from './referenceContentLink.js'

// Keep actual post shortcodes; never use the recommendation /reels/ feed.
export function referenceReels(account) {
  const seen = new Set()
  return [...(Array.isArray(account?.exampleMedia) ? account.exampleMedia : []), account?.viralMedia]
    .filter(Boolean).flatMap(media => {
      const href = referenceContentHref(media.permalink)
      if (!href || seen.has(href)) return []
      const isReel = /\/reels?\//.test(new URL(media.permalink).pathname)
        || /^(video|reel|reels)$/i.test(media.contentType || '')
      if (!isReel) return []
      seen.add(href)
      return [{ href, embedUrl: `${href}embed/`, caption: typeof media.caption === 'string' ? media.caption.trim() : '',
        views: Number.isFinite(media.views) && media.views >= 0 ? media.views : null }]
    }).slice(0, 3)
}
