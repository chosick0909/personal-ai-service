// What a carousel plan holds, as the screens read it: the version in use at each stage, and the design made drawable.
export const chosenCover = c => !c ? null : c.cover?.custom ? { text: c.cover.custom, kicker: c.cover.customKicker || '' } : c.cover?.options?.[c.cover.chosen ?? 0] || null
export const chosenBody = c => !c?.body ? null : c.body.edited || c.body.options?.[c.body.chosen ?? 0] || null
export const chosenCaption = c => !c?.caption ? null : c.caption.edited || c.caption.options?.[c.caption.chosen ?? 0] || null
// Emphasis markers are for the design; plain text shows the words only.
export const plain = text => String(text || '').replace(/\*\*/g, '')
const ROLE_NAME = { cover: '표지', body: '본문', last: '마지막 장' }
export const slidesText = items => items.map((s, i) => `[${i + 1}장${s.role === 'body' ? '' : ` · ${ROLE_NAME[s.role]}`}]\n${[plain(s.heading), plain(s.text)].filter(Boolean).join('\n')}`).join('\n\n')
// The plan keeps image ids; the drawing code wants links. `images` maps one to the other (signed links, an hour each).
export function drawable(design, images) {
  const link = v => v?.id && images[v.id]?.url ? { src: images[v.id].url, x: v.x, y: v.y, zoom: v.zoom } : null
  return { ...design, profileImage: link(design.profileImage)?.src || null, slides: Object.fromEntries(Object.entries(design.slides || {}).map(([id, s]) => [id, { image: link(s.image), image2: link(s.image2), move: s.move || null }])) }
}
export const aiSlideIds = (design, images) => Object.entries(design.slides || {}).filter(([, s]) => [s.image, s.image2].some(v => v?.id && images[v.id]?.ai)).map(([id]) => id)
