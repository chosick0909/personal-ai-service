// Draws one carousel slide onto a canvas. Everything is plain Canvas 2D: text wrapping, auto-fit, emphasis and the
// twenty-seven layouts (nine templates × cover / body / last). `prepare` loads fonts and photos first so that
// `drawSlide` can stay synchronous.
import { FONTS, RATIOS, fontOf, templateOf } from './templates'

/* ───────────────────────── colour ───────────────────────── */

function parseColor(value) {
  const s = String(value || '').trim()
  let m = s.match(/^#([0-9a-f]{3})$/i)
  if (m) return [...m[1]].map(h => parseInt(h + h, 16))
  m = s.match(/^#([0-9a-f]{6})/i)
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}
const css = (c, a = 1) => a >= 1 ? `rgb(${c.map(v => Math.round(v)).join(',')})` : `rgba(${c.map(v => Math.round(v)).join(',')},${a})`
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const luminance = c => {
  const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const INK = [20, 20, 22]
const PAPER = [255, 255, 255]
// The readable ink on top of a filled colour.
const onColor = c => luminance(c) > 0.4 ? INK : PAPER
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/* ───────────────────────── assets ───────────────────────── */

const MAX_IMAGE_SIDE = 2400
const IMAGE_CACHE_SIZE = 80
const imageCache = new Map() // src → Promise<CanvasImageSource | null>

async function decodeImage(src) {
  try {
    const response = await fetch(src)
    if (!response.ok) throw new Error(`image ${response.status}`)
    let bitmap = await createImageBitmap(await response.blob())
    const side = Math.max(bitmap.width, bitmap.height)
    if (side > MAX_IMAGE_SIDE) {
      const k = MAX_IMAGE_SIDE / side
      const small = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * k), resizeHeight: Math.round(bitmap.height * k), resizeQuality: 'high' })
      bitmap.close()
      bitmap = small
    }
    return bitmap
  } catch { /* a server without CORS headers for fetch may still allow an anonymous <img> */ }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src })
    return img
  } catch {
    return null
  }
}

function loadImage(src) {
  if (!imageCache.has(src)) {
    const pending = decodeImage(src).then(image => {
      if (!image && imageCache.get(src) === pending) imageCache.delete(src) // a failure may be temporary: try again next time
      return image
    })
    imageCache.set(src, pending)
    if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value)
  }
  return imageCache.get(src)
}

const sheets = new Map() // stylesheet url → Promise
function loadSheet(url) {
  if (!sheets.has(url)) {
    sheets.set(url, new Promise(resolve => {
      const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find(link => link.href === url)
      if (existing?.sheet) return resolve()
      const link = existing || document.createElement('link')
      link.addEventListener('load', resolve, { once: true })
      link.addEventListener('error', resolve, { once: true })
      if (!existing) { link.rel = 'stylesheet'; link.href = url; document.head.appendChild(link) }
    }))
  }
  return sheets.get(url)
}

const loadedGlyphs = new Map() // "family|weight" → Set of characters already asked for
async function loadGlyphs(font, weight, characters) {
  const key = `${font.family}|${weight}`
  const seen = loadedGlyphs.get(key) || new Set()
  loadedGlyphs.set(key, seen)
  const need = characters.filter(ch => !seen.has(ch))
  if (!need.length) return
  try {
    // The Korean webfonts are split into unicode-range subsets, so the text itself decides which files load.
    await document.fonts.load(`${weight} 48px "${font.family}"`, need.join(''))
    need.forEach(ch => seen.add(ch))
  } catch { /* the slide falls back to the next font in the stack */ }
}

const FURNITURE = '0123456789 /@._-…'
const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))

function fontsOf(design) {
  const template = templateOf(design?.template)
  const pick = slot => FONTS.find(f => f.key === design?.fonts?.[slot]) || fontOf(template.fonts[slot])
  return { heading: pick('heading'), body: pick('body') }
}

async function loadFonts(slides, design) {
  const fonts = fontsOf(design)
  const text = slides.map(s => `${s?.heading || ''}${s?.text || ''}`).join('') + (design?.handle || '') + FURNITURE
  const characters = [...new Set(text.replace(/[*\s]/g, ''))]
  const families = [...new Set([fonts.heading, fonts.body])]
  await Promise.all(families.map(font => loadSheet(font.css)))
  await Promise.all(families.flatMap(font => [...new Set(Object.values(font.weights))].map(weight => loadGlyphs(font, weight, characters))))
}

// Loads what the slides need. Never throws: a font that fails falls back, a photo that fails becomes null and the
// slide draws its placeholder.
export async function prepare(slides, design) {
  const list = (Array.isArray(slides) ? slides : [slides]).filter(Boolean)
  const sources = new Set()
  if (design?.profileImage) sources.add(typeof design.profileImage === 'string' ? design.profileImage : design.profileImage.src)
  for (const slide of list) {
    const entry = design?.slides?.[slide.id]
    if (entry?.image?.src) sources.add(entry.image.src)
    if (entry?.image2?.src) sources.add(entry.image2.src)
  }
  sources.delete(undefined)
  const images = new Map()
  await Promise.all([
    Promise.race([loadFonts(list, design).catch(() => {}), timeout(8000)]),
    ...[...sources].map(async src => { images.set(src, await loadImage(src)) }),
  ])
  return { images }
}

/* ───────────────────────── text ───────────────────────── */

const FALLBACK_STACK = '"Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif'
const fontCss = (font, weight, size) => `${weight} ${size}px "${font.family}", ${FALLBACK_STACK}`
const setSpacing = (ctx, value) => { if ('letterSpacing' in ctx) ctx.letterSpacing = value }

// "본문 **강조** 글\n둘째 줄" → paragraphs → words → runs. A word keeps its runs together when it wraps.
function tokenize(text) {
  let source = String(text ?? '').replace(/\r/g, '')
  if ((source.split('**').length - 1) % 2) { // a marker left open would highlight everything after it
    const at = source.lastIndexOf('**')
    source = source.slice(0, at) + source.slice(at + 2)
  }
  let em = false
  return source.split('\n').map(line => {
    const words = []
    let word = null
    let gapEm = false
    line.split('**').forEach((part, i) => {
      if (i) em = !em
      for (const ch of part) {
        if (/\s/.test(ch)) {
          if (word) { words.push(word); word = null }
          gapEm = em
          continue
        }
        if (!word) { word = { segs: [], gapEm }; gapEm = false }
        const last = word.segs[word.segs.length - 1]
        if (last && last.em === em) last.t += ch
        else word.segs.push({ t: ch, em })
      }
    })
    if (word) words.push(word)
    return words
  })
}

// Greedy wrap at spaces; a word longer than the whole line breaks by character. An emphasised span of several
// words ("**세 가지만**") moves to the next line as a whole when it fits on one line but not in the room left.
function wrapWords(words, maxWidth, measure, spaceWidth) {
  const widths = words.map(word => word.segs.reduce((sum, seg) => sum + measure(seg.t, seg.em), 0))
  // joined[i]: word i continues the emphasised span of word i - 1
  const joined = words.map((word, i) => i > 0 && word.gapEm && word.segs[0].em && words[i - 1].segs[words[i - 1].segs.length - 1].em)
  const spanWidth = start => {
    let total = widths[start]
    for (let i = start + 1; i < words.length && joined[i]; i += 1) total += spaceWidth + widths[i]
    return total
  }
  const lines = []
  let line = []
  let width = 0
  let broken = false
  let splitSpans = 0
  const flush = () => { lines.push(line); line = []; width = 0 }
  words.forEach((word, index) => {
    const wordWidth = widths[index]
    const startsSpan = !joined[index] && joined[index + 1]
    const need = startsSpan ? spanWidth(index) : wordWidth
    if (line.length && width + spaceWidth + (need <= maxWidth ? need : wordWidth) > maxWidth) {
      if (joined[index]) splitSpans += 1
      flush()
    }
    if (wordWidth <= maxWidth) {
      const space = line.length > 0
      word.segs.forEach((seg, i) => line.push({ t: seg.t, em: seg.em, space: space && i === 0, gapEm: i === 0 && word.gapEm, first: i === 0 }))
      width += (space ? spaceWidth : 0) + wordWidth
      return
    }
    broken = true
    for (const seg of word.segs) {
      let piece = null
      for (const ch of seg.t) {
        const charWidth = measure(ch, seg.em)
        if (line.length && width + charWidth > maxWidth) { flush(); piece = null }
        if (!piece) { piece = { t: '', em: seg.em, space: false, gapEm: false, first: line.length === 0 }; line.push(piece) }
        piece.t += ch
        width += charWidth
      }
    }
  })
  if (line.length) lines.push(line)
  return { lines, broken, splitSpans }
}

const wordsIn = line => line.filter(piece => piece.first).length
// A narrower wrap is acceptable when it needs no more lines and breaks no more emphasised spans than the greedy one.
const noWorse = (attempt, greedy) => !attempt.broken && attempt.lines.length <= greedy.lines.length && attempt.splitSpans <= greedy.splitSpans

// Same number of lines, but as even as they can be — no single word left alone on the last line.
function balanceWords(words, maxWidth, measure, spaceWidth, greedy) {
  let low = maxWidth * 0.35
  let high = maxWidth
  let best = null
  for (let i = 0; i < 10; i += 1) {
    const middle = (low + high) / 2
    const attempt = wrapWords(words, middle, measure, spaceWidth)
    if (noWorse(attempt, greedy)) { best = attempt; high = middle } else low = middle
  }
  return best
}

// Running text stays ragged, but its last line should not be one lonely word: narrow the measure just enough to
// bring a second word down, if that costs no extra line.
function fixOrphan(words, maxWidth, measure, spaceWidth, greedy) {
  if (wordsIn(greedy.lines[greedy.lines.length - 1]) > 1) return null
  for (let k = 0.97; k >= 0.7; k -= 0.03) {
    const attempt = wrapWords(words, maxWidth * k, measure, spaceWidth)
    if (!noWorse(attempt, greedy)) continue
    if (wordsIn(attempt.lines[attempt.lines.length - 1]) > 1) return attempt
  }
  return null
}

function compose(ctx, paragraphs, o, size, balance) {
  const normal = fontCss(o.font, o.weight, size)
  const strong = fontCss(o.font, o.em?.weight ?? o.weight, size)
  const spacing = `${((o.ls || 0) * size).toFixed(2)}px`
  setSpacing(ctx, spacing)
  const cache = new Map()
  const measure = (t, em) => {
    const key = (em ? '1' : '0') + t
    let width = cache.get(key)
    if (width === undefined) { ctx.font = em ? strong : normal; width = ctx.measureText(t).width; cache.set(key, width) }
    return width
  }
  const spaceWidth = measure(' ', false)
  const lineHeight = Math.round(size * o.lh)
  const wrapped = paragraphs.map(words => {
    if (!words.length) return null
    const greedy = wrapWords(words, o.w, measure, spaceWidth)
    if (!balance || greedy.lines.length < 2 || greedy.broken) return greedy
    const even = balance === true || greedy.lines.length <= 3
    return (even ? balanceWords(words, o.w, measure, spaceWidth, greedy) : fixOrphan(words, o.w, measure, spaceWidth, greedy)) || greedy
  })
  // Lines the writer broke by hand run tight; once one of them has to wrap, a little air keeps them apart.
  const written = wrapped.filter(Boolean)
  const gap = Math.max(o.paraGap || 0, written.length > 1 && written.some(paragraph => paragraph.lines.length > 1) ? o.wrapGap || 0 : 0)
  const rows = []
  let broken = false
  for (const paragraph of wrapped) {
    if (!paragraph) { if (rows.length) rows.push({ gap: lineHeight * 0.55 }); continue }
    if (rows.length && !rows[rows.length - 1].gap && gap) rows.push({ gap: lineHeight * gap })
    broken = broken || paragraph.broken
    for (const line of paragraph.lines) rows.push(finishLine(line, measure, spaceWidth))
  }
  while (rows.length && rows[rows.length - 1].gap) rows.pop()
  setSpacing(ctx, '0px')
  return { rows, size, lineHeight, normal, strong, spacing, broken, measure, spaceWidth, wraps: written.reduce((sum, paragraph) => sum + paragraph.lines.length - 1, 0), written: written.length }
}

function finishLine(line, measure, spaceWidth) {
  let x = 0
  let previous = null
  const pieces = line.map(part => {
    if (part.space) x += spaceWidth
    const piece = { t: part.t, em: part.em, x, w: measure(part.t, part.em), join: Boolean(previous?.em && part.em && (!part.space || part.gapEm)) }
    x += piece.w
    previous = part
    return piece
  })
  return { pieces, width: x }
}

const heightOf = layout => layout.rows.reduce((sum, row) => sum + (row.gap ?? layout.lineHeight), 0)
const linesOf = layout => layout.rows.filter(row => !row.gap).length
// How far the text may shrink (as a share of the size that fits) to keep hand-made line breaks unwrapped.
const KEEP_LINES_SHRINK = 0.82
const EMPTY_TEXT = { height: 0, lines: 0, size: 0, width: 0, overflow: false, draw() {} }

// Fits `text` into a box `o.w` wide and at most `o.h` tall / `o.maxLines` long: tries the largest size first and
// steps down to the smallest; below that the text is cut with an ellipsis and `overflow` is reported.
// `o.balance`: true evens out every paragraph; 'short' evens those of two or three lines and, in longer running
// text, only rescues a lonely last word. `o.keepLines`: when the writer's own line breaks would all hold at a
// slightly smaller size, that size is used instead of letting them wrap. `o.wrapGap`: see `compose`.
function layoutText(ctx, text, options) {
  const paragraphs = tokenize(text)
  if (!paragraphs.some(words => words.length)) return EMPTY_TEXT
  let o = options
  const scale = o.font.scale || 1
  const largest = Math.round(o.size[0] * scale)
  const smallest = Math.min(largest, Math.round(o.size[1] * scale))
  const maxHeight = o.h ?? Infinity
  const maxLines = o.maxLines ?? Infinity
  const fits = layout => !layout.broken && heightOf(layout) <= maxHeight + 0.5 && linesOf(layout) <= maxLines
  let size
  let layout
  const shrinkToFit = () => {
    size = largest
    layout = compose(ctx, paragraphs, o, size, false)
    while (!fits(layout) && size > smallest) {
      size = Math.max(smallest, size - Math.max(1, Math.round(size * 0.03)))
      layout = compose(ctx, paragraphs, o, size, false)
    }
  }
  shrinkToFit()
  if (!fits(layout) && o.wrapGap) { // the air between wrapped lines is a nicety: it never costs the text its place
    o = { ...options, wrapGap: 0 }
    shrinkToFit()
  }
  if (o.keepLines && fits(layout) && layout.written > 1 && layout.wraps) {
    const floor = Math.max(smallest, Math.round(size * KEEP_LINES_SHRINK))
    for (let smaller = size - 1; smaller >= floor; smaller -= 1) {
      const attempt = compose(ctx, paragraphs, o, smaller, false)
      if (!attempt.wraps && fits(attempt)) { size = smaller; layout = attempt; break }
    }
  }
  let overflow = false
  if (o.balance && fits(layout)) layout = compose(ctx, paragraphs, o, size, o.balance)
  if (heightOf(layout) > maxHeight + 0.5 || linesOf(layout) > maxLines) {
    overflow = true
    truncate(layout, maxHeight, maxLines, o.w)
  }
  const height = heightOf(layout)
  const width = layout.rows.reduce((widest, row) => Math.max(widest, row.width || 0), 0)
  return { height, width, size, lines: linesOf(layout), overflow, draw: (x, y, align) => paintText(ctx, layout, o, x, y, align || o.align) }
}

function truncate(layout, maxHeight, maxLines, maxWidth) {
  const kept = []
  let height = 0
  let lines = 0
  for (const row of layout.rows) {
    const rowHeight = row.gap ?? layout.lineHeight
    if (!row.gap && lines >= maxLines) break
    if (kept.length && height + rowHeight > maxHeight + 0.5) break
    kept.push(row)
    height += rowHeight
    if (!row.gap) lines += 1
  }
  while (kept.length && kept[kept.length - 1].gap) kept.pop()
  const last = kept[kept.length - 1]
  if (last && kept.length < layout.rows.length) {
    const ellipsis = '…'
    const tail = last.pieces[last.pieces.length - 1]
    tail.t += ellipsis
    const remeasure = () => { tail.w = layout.measure(tail.t, tail.em); last.width = tail.x + tail.w }
    remeasure()
    while (last.width > maxWidth && tail.t.length > 2) { tail.t = tail.t.slice(0, -2) + ellipsis; remeasure() }
  }
  layout.rows = kept
}

function glyphBox(ctx, font, size) {
  ctx.font = font
  const m = ctx.measureText('한글')
  const ascent = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : size * 0.8
  const descent = m.actualBoundingBoxDescent > -size ? Math.max(0, m.actualBoundingBoxDescent) : size * 0.1
  return { ascent, descent }
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function paintText(ctx, layout, o, x, y, align = 'left') {
  const k = align === 'center' ? 0.5 : align === 'right' ? 1 : 0
  const { size, lineHeight } = layout
  const style = o.em?.style
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  setSpacing(ctx, layout.spacing)
  const { ascent, descent } = glyphBox(ctx, layout.normal, size)
  const baselineIn = (lineHeight + ascent - descent) / 2 // Hangul sits optically centred in its line
  // First every band, then every glyph, so a band never covers the line above it.
  if (style === 'band' || style === 'marker') {
    const padX = size * (style === 'band' ? 0.1 : 0.05)
    const top = style === 'band' ? -ascent - size * 0.09 : -ascent * 0.4
    const bottom = descent + size * (style === 'band' ? 0.09 : 0.1)
    ctx.fillStyle = o.em.bg
    let rowY = y
    for (const row of layout.rows) {
      if (row.gap) { rowY += row.gap; continue }
      const left = x + (o.w - row.width) * k
      const base = rowY + baselineIn
      let start = null
      row.pieces.forEach((piece, i) => {
        if (piece.em && !piece.join) start = piece.x
        const next = row.pieces[i + 1]
        if (piece.em && !(next?.em && next.join)) {
          roundedRect(ctx, left + start - padX, base + top, piece.x + piece.w - start + padX * 2, bottom - top, size * 0.05)
          ctx.fill()
        }
      })
      rowY += lineHeight
    }
  }
  if (o.shadow) { ctx.shadowColor = o.shadow.color; ctx.shadowBlur = o.shadow.blur; ctx.shadowOffsetY = o.shadow.y || 0 }
  let rowY = y
  for (const row of layout.rows) {
    if (row.gap) { rowY += row.gap; continue }
    const left = x + (o.w - row.width) * k
    for (const piece of row.pieces) {
      ctx.font = piece.em ? layout.strong : layout.normal
      ctx.fillStyle = piece.em ? (o.em?.color || o.color) : o.color
      ctx.fillText(piece.t, left + piece.x, rowY + baselineIn)
    }
    rowY += lineHeight
  }
  ctx.restore()
}

/* ───────────────────────── shapes ───────────────────────── */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const pad2 = n => String(n).padStart(2, '0')

// Cover-crop: `x`/`y` say which part of the photo stays visible, `zoom` enlarges beyond the fill size.
function drawPhoto(ctx, photo, x, y, w, h, radius = 0) {
  const { img } = photo
  const iw = img.width || img.naturalWidth
  const ih = img.height || img.naturalHeight
  if (!iw || !ih) return
  const scale = Math.max(w / iw, h / ih) * photo.zoom
  const sw = w / scale
  const sh = h / scale
  ctx.save()
  if (radius) { roundedRect(ctx, x, y, w, h, radius); ctx.clip() }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (iw - sw) * photo.x, (ih - sh) * photo.y, sw, sh, x, y, w, h)
  ctx.restore()
}

// An empty photo slot: a soft gradient with a faint picture mark.
function drawPlaceholder(ctx, x, y, w, h, from, to, mark, radius = 0, markAt = 0.5) {
  ctx.save()
  roundedRect(ctx, x, y, w, h, radius)
  ctx.clip()
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h)
  gradient.addColorStop(0, css(from))
  gradient.addColorStop(1, css(to))
  ctx.fillStyle = gradient
  ctx.fillRect(x, y, w, h)
  const s = Math.min(w, h) * (markAt === 0.5 ? 0.15 : 0.085)
  const cx = x + w / 2
  const cy = y + h * markAt
  ctx.strokeStyle = css(mark, 0.2)
  ctx.fillStyle = css(mark, 0.2)
  ctx.lineWidth = Math.max(3, s * 0.07)
  ctx.lineJoin = 'round'
  roundedRect(ctx, cx - s, cy - s * 0.78, s * 2, s * 1.56, s * 0.2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx - s * 0.48, cy - s * 0.3, s * 0.17, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.78, cy + s * 0.52)
  ctx.lineTo(cx - s * 0.18, cy - s * 0.02)
  ctx.lineTo(cx + s * 0.14, cy + s * 0.26)
  ctx.lineTo(cx + s * 0.42, cy + s * 0.02)
  ctx.lineTo(cx + s * 0.8, cy + s * 0.52)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawArrow(ctx, right, y, length, color, weight = 5) {
  const head = Math.min(18, length * 0.3)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = weight
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(right - length, y)
  ctx.lineTo(right, y)
  ctx.moveTo(right - head, y - head)
  ctx.lineTo(right, y)
  ctx.lineTo(right - head, y + head)
  ctx.stroke()
  ctx.restore()
}

/* ───────────────────────── slide environment ───────────────────────── */

function environment(canvas, { slide, index = 0, total = 1, design, assets }) {
  const template = templateOf(design?.template)
  const [W, H] = RATIOS[design?.ratio] || RATIOS['4:5']
  if (canvas.width !== W) canvas.width = W
  if (canvas.height !== H) canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const colour = key => parseColor(design?.colors?.[key]) || parseColor(template.colors[key])
  const c = { bg: colour('background'), text: colour('text'), accent: colour('accent') }
  const fonts = fontsOf(design)
  const entry = design?.slides?.[slide?.id] || {}
  const moves = entry.move || {}
  const lookup = src => (src && assets?.images?.get(src)) || null
  const e = {
    ctx, W, H, M: 84, template, c, fonts, index, total,
    slide: { heading: String(slide?.heading || '').trim(), text: String(slide?.text || '').trim() },
    handle: String(design?.handle || '').trim(),
    overflow: false,
    boxes: {}, // where the slide's title and text were drawn, for the free-editing overlay
    onAccent: onColor(c.accent),
    // The accent as a text colour: pulled towards the text colour when it would vanish into the background.
    accentInk: contrast(c.accent, c.bg) < 2.2 ? mix(c.accent, c.text, 0.55) : c.accent,
    muted: t => mix(c.text, c.bg, t),
    pic(key) {
      const item = entry[key]
      const img = lookup(item?.src)
      return img ? { img, x: clamp(item.x ?? 0.5, 0, 1), y: clamp(item.y ?? 0.5, 0, 1), zoom: Math.max(1, Number(item.zoom) || 1) } : null
    },
    profile() {
      const src = typeof design?.profileImage === 'string' ? design.profileImage : design?.profileImage?.src
      const img = lookup(src)
      return img ? { img, x: design.profileImage.x ?? 0.5, y: design.profileImage.y ?? 0.5, zoom: Math.max(1, Number(design.profileImage.zoom) || 1) } : null
    },
    // A block of wrapped text. `slot` picks the heading or body font, `weight` a role that font really has.
    text(value, { slot = 'body', weight = 'regular', em, ...rest }) {
      const font = fonts[slot]
      let emphasis = em
      if (em) {
        const strong = font.weights[em.weight] ?? font.weights[weight]
        emphasis = { ...em, weight: strong }
        // Bold-only emphasis needs a bolder weight to exist; otherwise the accent colour carries it.
        if (em.style === 'bold' && strong === font.weights[weight]) emphasis.color = css(e.accentInk)
      }
      // 자유 편집: the slide's own title or text may have been dragged elsewhere and made larger or smaller. A larger
      // size gets a taller box too, so it is not shrunk straight back to fit.
      const key = value && value === e.slide.heading ? 'heading' : value && value === e.slide.text ? 'text' : null
      const move = key ? moves[key] : null
      const scale = move ? clamp(Number(move.scale) || 1, 0.6, 1.6) : 1
      const base = { ...rest, font, weight: font.weights[weight], em: emphasis }
      const layout = layoutText(ctx, value, base)
      // The rest of the slide is laid out around the block as the template placed it, so moving or resizing one
      // block never pushes the others; the resized block is drawn from the same corner.
      const shown = scale === 1 ? layout : layoutText(ctx, value, { ...base, size: rest.size.map(v => v * scale), ...(rest.h ? { h: rest.h * Math.max(1, scale) } : {}) })
      if (shown.overflow) e.overflow = true
      if (!key || !layout.height) return layout
      const dx = (Number(move?.x) || 0) * W, dy = (Number(move?.y) || 0) * H
      return { ...layout, draw: (x, y, align) => { shown.draw(x + dx, y + dy, align); e.boxes[key] = { x: x + dx, y: y + dy, w: rest.w ?? shown.width, h: shown.height } } }
    },
    // One short line (handle, counter). `y` is the vertical centre. Returns the drawn width.
    line(value, { slot = 'body', weight = 'bold', size, color, x, y, align = 'left', maxWidth = Infinity, ls = 0 }) {
      if (!value) return 0
      const font = fonts[slot]
      const px = Math.round(size * (font.scale || 1))
      const fontString = fontCss(font, font.weights[weight], px)
      ctx.save()
      setSpacing(ctx, `${(ls * px).toFixed(2)}px`)
      const { ascent, descent } = glyphBox(ctx, fontString, px)
      let shown = String(value)
      let width = ctx.measureText(shown).width
      while (width > maxWidth && shown.length > 2) { shown = `${shown.slice(0, -2)}…`; width = ctx.measureText(shown).width }
      ctx.fillStyle = color
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.fillText(shown, align === 'center' ? x - width / 2 : align === 'right' ? x - width : x, y + (ascent - descent) / 2)
      ctx.restore()
      return width
    },
    lineWidth(value, { slot = 'body', weight = 'bold', size }) {
      const font = fonts[slot]
      ctx.save()
      ctx.font = fontCss(font, font.weights[weight], Math.round(size * (font.scale || 1)))
      const width = ctx.measureText(String(value)).width
      ctx.restore()
      return width
    },
    fill(color, x = 0, y = 0, w = W, h = H) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) },
    round(color, x, y, w, h, r) { roundedRect(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill() },
    // A photo slot: the photo, or — only when the template needs photos to make sense — a placeholder.
    // `markAt` moves the placeholder's picture mark off the centre when text sits there.
    photo(key, x, y, w, h, { radius = 0, placeholder = template.imageRequired, markAt = 0.5 } = {}) {
      const photo = e.pic(key)
      if (photo) { drawPhoto(ctx, photo, x, y, w, h, radius); return true }
      if (!placeholder) return false
      const dark = luminance(c.bg) < 0.4
      const from = dark ? mix(c.bg, PAPER, 0.3) : mix(c.bg, INK, 0.05)
      const to = dark ? mix(c.bg, PAPER, 0.12) : mix(c.bg, INK, 0.16)
      drawPlaceholder(ctx, x, y, w, h, mix(from, c.accent, 0.08), mix(to, c.accent, 0.12), dark ? PAPER : INK, radius, markAt)
      return true
    },
    // Profile circle: the profile photo, or a neutral person mark.
    avatar(cx, cy, r) {
      const photo = e.profile()
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      if (photo) drawPhoto(ctx, photo, cx - r, cy - r, r * 2, r * 2)
      else {
        e.fill(css(mix(c.bg, c.accent, 0.22)), cx - r, cy - r, r * 2, r * 2)
        ctx.fillStyle = css(mix(c.bg, c.accent, 0.62))
        ctx.beginPath()
        ctx.arc(cx, cy - r * 0.18, r * 0.36, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(cx, cy + r * 0.92, r * 0.68, r * 0.56, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    },
    // A rounded pill with one line in it. Returns its width.
    pill(value, { x, y, h, padX, fill, stroke, color, size, slot = 'body', weight = 'bold', align = 'left', maxWidth = W - 168 }) {
      if (!value) return 0
      const textWidth = Math.min(e.lineWidth(value, { slot, weight, size }), maxWidth - padX * 2)
      const width = textWidth + padX * 2
      const left = align === 'center' ? x - width / 2 : x
      roundedRect(ctx, left, y, width, h, h / 2)
      if (fill) { ctx.fillStyle = fill; ctx.fill() }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke() }
      e.line(value, { slot, weight, size, color, x: left + padX, y: y + h / 2, maxWidth: textWidth + 1 })
      return width
    },
    // Position as dots (the current one is a longer pill); long carousels fall back to "3 / 15".
    dots(x, y, { on, off, align = 'left' }) {
      if (total > 12) return e.line(`${index + 1} / ${total}`, { size: 26, color: on, x, y, align })
      const d = 12
      const gap = 12
      const long = 40
      const width = (total - 1) * (d + gap) + long
      let left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
      for (let i = 0; i < total; i += 1) {
        const w = i === index ? long : d
        e.round(i === index ? on : off, left, y - d / 2, w, d, d / 2)
        left += w + gap
      }
      return width
    },
  }
  return e
}

// Lays blocks out top to bottom inside [top, bottom]; `bias` 0 = top, 0.5 = centred, 1 = bottom.
function stack(blocks, x, top, bottom, bias = 0.5) {
  const list = blocks.filter(Boolean)
  const total = list.reduce((sum, block) => sum + block.h, 0)
  let y = top + Math.max(0, bottom - top - total) * bias
  for (const block of list) { block.draw?.(x, y); y += block.h }
}
const space = h => ({ h })
const textBlock = (layout, align) => layout.height ? { h: layout.height, draw: (x, y) => layout.draw(x, y, align) } : null
// [heading, 36, text] → blocks. A gap whose neighbour is missing is dropped; between two blocks the widest gap wins.
function blocks(...items) {
  const out = []
  let pendingGap = 0
  for (const item of items) {
    if (typeof item === 'number') { pendingGap = out.length ? Math.max(pendingGap, item) : 0; continue }
    if (!item) continue
    if (pendingGap) out.push(space(pendingGap))
    pendingGap = 0
    out.push(item)
  }
  return out
}
const heightOfBlocks = list => list.reduce((sum, block) => sum + block.h, 0)
// A photo that shares a column with text: the text is laid out first and the photo takes the room that is left,
// never smaller than `least` nor larger than `most` (both as a share of the slide height).
const sharedPhotoHeight = (room, H, least, most) => Math.round(clamp(room, H * least, H * most))

// A cover's `text` is its kicker: one small line above the title. Nothing is drawn when the slide has none.
const kicker = (e, options) => e.text(e.slide.text, { weight: 'bold', size: [40, 32], lh: 1.4, maxLines: 2, ...options })

/* ───────────────────────── 1. dark-accent ───────────────────────── */

const darkBand = e => ({ style: 'band', bg: css(e.c.accent), color: css(e.onAccent), weight: 'heavy' })

function darkTopRow(e) {
  const { W, M } = e
  const y = M + 20
  const width = e.line(pad2(e.index + 1), { slot: 'heading', weight: 'heavy', size: 40, color: css(e.accentInk), x: M, y })
  e.line(`/ ${pad2(e.total)}`, { size: 26, color: css(e.muted(0.55)), x: M + width + 14, y: y + 3 })
  e.line(e.handle, { size: 26, color: css(e.muted(0.55)), x: W - M, y: y + 3, align: 'right', maxWidth: 520 })
}

function darkProgress(e) {
  const { W, H, M, c } = e
  const y = H - M - 6
  e.round(css(e.muted(0.84)), M, y, W - M * 2, 6, 3)
  e.round(css(c.accent), M, y, (W - M * 2) * clamp((e.index + 1) / e.total, 0, 1), 6, 3)
}

const darkAccent = {
  cover(e) {
    const { ctx, W, H, M, c, slide } = e
    e.fill(css(c.bg))
    if (e.photo('image', 0, 0, W, H)) {
      e.fill(css(c.bg, 0.5))
      const shade = ctx.createLinearGradient(0, H * 0.28, 0, H)
      shade.addColorStop(0, css(c.bg, 0))
      shade.addColorStop(1, css(c.bg, 0.94))
      e.fill(shade, 0, H * 0.28, W, H * 0.72)
    }
    e.fill(css(c.accent), M, M, 96, 14)
    e.line(e.handle, { size: 28, color: css(e.muted(0.3)), x: W - M, y: M + 7, align: 'right', maxWidth: 560 })
    const w = W - M * 2
    const bottom = H - M - 96
    const kick = kicker(e, { w, color: css(e.accentInk), em: { style: 'color', color: css(c.text) } })
    const gap = kick.height ? 30 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [152, 84], lh: 1.18, ls: -0.035, w, h: bottom - (M + 110) - kick.height - gap, color: css(c.text), em: darkBand(e), balance: true })
    stack(blocks(textBlock(kick), gap, textBlock(head)), M, M + 110, bottom, 1)
    drawArrow(ctx, W - M, H - M - 14, 72, css(c.accent), 6)
  },
  body(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    darkTopRow(e)
    const w = W - M * 2
    const top = M + 116
    const bottom = H - M - 76
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [50, 40], lh: 1.3, ls: -0.02, w, maxLines: 2, color: css(e.accentInk), em: { style: 'color', color: css(c.text) } })
    const gap = head.height ? 40 : 0
    const body = e.text(slide.text, { weight: 'bold', size: [88, 44], lh: 1.44, ls: -0.02, w, h: bottom - top - head.height - gap, color: css(c.text), em: darkBand(e), balance: 'short', keepLines: true, wrapGap: 0.3 })
    stack(blocks(textBlock(head), gap, textBlock(body)), M, top, bottom, 0.46)
    darkProgress(e)
  },
  last(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    darkTopRow(e)
    const w = W - M * 2
    const top = M + 116
    const bottom = H - M - 76
    const pillHeight = e.handle ? 88 : 0
    const pillGap = e.handle ? 68 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [46, 38], lh: 1.3, w, maxLines: 2, color: css(e.accentInk) })
    const gap = head.height ? 36 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [112, 60], lh: 1.24, ls: -0.03, w, h: bottom - top - head.height - gap - pillHeight - pillGap, color: css(c.text), em: darkBand(e), balance: true })
    const pill = e.handle && { h: pillHeight, draw: (x, y) => e.pill(e.handle, { x, y, h: pillHeight, padX: 40, fill: css(c.accent), color: css(e.onAccent), size: 38 }) }
    stack(blocks(textBlock(head), gap, textBlock(cta), pillGap, pill), M, top, bottom, 0.5)
    darkProgress(e)
  },
}

/* ───────────────────────── 2. split ───────────────────────── */

const overPhoto = { color: 'rgba(0,0,0,0.45)', blur: 28, y: 4 }

function splitCaption(e, value, top, height) {
  const { ctx, W, M, c } = e
  const shade = ctx.createLinearGradient(0, top + height * 0.42, 0, top + height)
  shade.addColorStop(0, css(c.bg, 0))
  shade.addColorStop(1, css(c.bg, 0.86))
  e.fill(shade, 0, top + height * 0.42, W, height * 0.58)
  const caption = e.text(value, { slot: 'heading', weight: 'heavy', size: [74, 42], lh: 1.26, ls: -0.025, w: W - M * 2, maxLines: 2, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true, shadow: overPhoto })
  caption.draw(M, top + height - 64 - caption.height, 'center')
}

const split = {
  cover(e) {
    const { ctx, W, H, M, c, slide } = e
    e.fill(css(c.bg))
    e.photo('image', 0, 0, W, H, { markAt: 0.11 })
    e.fill(css(c.bg, 0.4))
    const shade = ctx.createLinearGradient(0, H * 0.5, 0, H)
    shade.addColorStop(0, css(c.bg, 0))
    shade.addColorStop(1, css(c.bg, 0.6))
    e.fill(shade, 0, H * 0.5, W, H * 0.5)
    const w = W - M * 2
    const kick = kicker(e, { w, color: css(e.accentInk), em: { style: 'color', color: css(c.text) }, balance: true, shadow: overPhoto })
    const bar = { h: 10, draw: (x, y) => e.fill(css(c.accent), W / 2 - 36, y, 72, 10) }
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [136, 76], lh: 1.2, ls: -0.035, w, h: H - 420 - kick.height, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true, shadow: overPhoto })
    stack(blocks(kick.height ? textBlock(kick, 'center') : bar, kick.height ? 32 : 52, textBlock(head, 'center')), M, 170, H - 170, 0.5)
    e.line(e.handle, { size: 28, color: css(c.text, 0.82), x: W / 2, y: H - M - 6, align: 'center', maxWidth: 640 })
  },
  body(e) {
    const { ctx, W, H, c, slide } = e
    e.fill(css(c.bg))
    const seam = 10
    const half = (H - seam) / 2
    const lines = slide.text.split('\n').map(line => line.trim()).filter(Boolean)
    if (lines.length > 2) e.overflow = true
    e.photo('image', 0, 0, W, half, { markAt: 0.36 })
    if (lines[0]) splitCaption(e, lines[0], 0, half)
    e.photo('image2', 0, half + seam, W, half, { markAt: 0.36 })
    if (lines.length > 1) splitCaption(e, lines.slice(1).join(' '), half + seam, half)
    const label = `${e.index + 1} / ${e.total}`
    const width = e.lineWidth(label, { size: 26 }) + 44
    ctx.save()
    e.round(css(c.bg, 0.62), W - 48 - width, 48, width, 52, 26)
    ctx.restore()
    e.line(label, { size: 26, color: css(c.text, 0.92), x: W - 48 - width / 2, y: 74, align: 'center' })
  },
  last(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    const photoHeight = Math.round(H * 0.46)
    e.photo('image', 0, 0, W, photoHeight)
    const w = W - M * 2
    const top = photoHeight + 56
    const bottom = H - M
    const pillHeight = e.handle ? 84 : 0
    const pillGap = e.handle ? 56 : 0
    const head = e.text(slide.heading, { weight: 'bold', size: [40, 34], lh: 1.35, w, maxLines: 2, color: css(e.accentInk), balance: true })
    const gap = head.height ? 28 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [92, 52], lh: 1.26, ls: -0.03, w, h: bottom - top - head.height - gap - pillHeight - pillGap, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true })
    const pill = e.handle && { h: pillHeight, draw: (x, y) => e.pill(e.handle, { x: W / 2, y, h: pillHeight, padX: 40, fill: css(c.accent), color: css(e.onAccent), size: 36, align: 'center' }) }
    stack(blocks(textBlock(head, 'center'), gap, textBlock(cta, 'center'), pillGap, pill), M, top, bottom, 0.5)
  },
}

/* ───────────────────────── 3. note ───────────────────────── */

// A light highlighter is drawn solid; a dark accent is thinned so the ink on top stays readable.
const noteMarker = e => ({ style: 'marker', bg: css(e.c.accent, luminance(e.c.accent) > 0.45 ? 1 : 0.3), weight: 'heavy' })

const note = {
  cover(e) {
    const { ctx, W, H, M, c, slide } = e
    e.fill(css(c.bg))
    e.fill(css(c.text), M, M + 8, 72, 10)
    e.line(e.handle, { size: 28, color: css(e.muted(0.45)), x: W - M, y: M + 13, align: 'right', maxWidth: 560 })
    const w = W - M * 2
    const top = M + 120
    const bottom = H - M - 130
    const kick = kicker(e, { w, color: css(e.muted(0.38)), em: { ...noteMarker(e), weight: 'bold' } })
    const gap = kick.height ? 36 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [124, 72], lh: 1.32, ls: -0.03, w, h: bottom - top - kick.height - gap, color: css(c.text), em: noteMarker(e), balance: true })
    stack(blocks(textBlock(kick), gap, textBlock(head)), M, top, bottom, 0.46)
    e.fill(css(e.muted(0.86)), M, H - M - 76, w, 2)
    e.dots(M, H - M - 22, { on: css(c.text), off: css(e.muted(0.82)) })
    drawArrow(ctx, W - M, H - M - 22, 64, css(c.text), 5)
  },
  body(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    e.dots(M, M + 14, { on: css(c.text), off: css(e.muted(0.82)) })
    e.line(e.handle, { size: 26, color: css(e.muted(0.5)), x: W - M, y: M + 14, align: 'right', maxWidth: 420 })
    const w = W - M * 2
    const top = M + 100
    const bottom = H - M
    const hasPhoto = Boolean(e.pic('image'))
    const photoGap = hasPhoto ? 52 : 0
    const number = { h: 70, draw: (x, y) => e.line(pad2(Math.max(1, e.index)), { slot: 'heading', weight: 'regular', size: 58, color: css(e.muted(0.62)), x, y: y + 30 }) }
    const head = e.text(slide.heading, { slot: 'heading', weight: 'bold', size: [72, 50], lh: 1.34, ls: -0.025, w, maxLines: 3, color: css(c.text), em: noteMarker(e), balance: true })
    const rule = head.height ? { h: 4, draw: (x, y) => e.fill(css(c.text), x, y, 56, 4) } : null
    const fixed = heightOfBlocks(blocks(number, 20, textBlock(head), 40, rule)) + 44
    const room = bottom - top - fixed - photoGap
    const body = e.text(slide.text, { size: [50, 33], lh: 1.64, w, h: room - (hasPhoto ? Math.round(H * 0.17) : 0), color: css(e.muted(0.14)), em: { ...noteMarker(e), weight: 'bold' }, balance: 'short', keepLines: true, wrapGap: 0.3 })
    const photoHeight = hasPhoto ? sharedPhotoHeight(room - body.height, H, 0.17, 0.34) : 0
    const photo = hasPhoto && { h: photoHeight, draw: (x, y) => e.photo('image', x, y, w, photoHeight, { radius: 28 }) }
    stack(blocks(number, 20, textBlock(head), 40, rule, 44, textBlock(body), photoGap, photo), M, top, bottom, hasPhoto ? 0.5 : 0.4)
  },
  last(e) {
    const { ctx, W, H, M, c, slide } = e
    e.fill(css(c.bg))
    e.dots(M, M + 14, { on: css(c.text), off: css(e.muted(0.82)) })
    const w = W - M * 2
    const top = M + 100
    const bottom = H - M
    const head = e.text(slide.heading, { weight: 'bold', size: [40, 34], lh: 1.4, w, maxLines: 2, color: css(e.muted(0.4)) })
    const gap = head.height ? 32 : 0
    const handleHeight = e.handle ? 60 : 0
    const handleGap = e.handle ? 76 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [100, 56], lh: 1.36, ls: -0.03, w, h: bottom - top - head.height - gap - handleHeight - handleGap, color: css(c.text), em: noteMarker(e), balance: true })
    const handle = e.handle && { h: handleHeight, draw: (x, y) => {
      const width = e.line(e.handle, { size: 40, color: css(c.text), x, y: y + 30, maxWidth: w - 120 })
      drawArrow(ctx, x + width + 96, y + 32, 64, css(c.text), 5)
    } }
    stack(blocks(textBlock(head), gap, textBlock(cta), handleGap, handle), M, top, bottom, 0.46)
  },
}

/* ───────────────────────── 4. photo-center ───────────────────────── */

function photoBackdrop(e, darkness) {
  const { ctx, W, H, c } = e
  e.fill(css(c.bg))
  e.photo('image', 0, 0, W, H, { markAt: 0.11 })
  e.fill(css(c.bg, darkness))
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.78)
  edge.addColorStop(0, css(c.bg, 0))
  edge.addColorStop(1, css(c.bg, 0.4))
  e.fill(edge)
}

const photoCenter = {
  cover(e) {
    const { W, H, c, slide } = e
    photoBackdrop(e, 0.5)
    const side = 104
    const w = W - side * 2
    const kick = kicker(e, { slot: 'heading', size: [38, 32], w, color: css(e.accentInk), balance: true, shadow: overPhoto })
    const gap = kick.height ? 36 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [108, 64], lh: 1.4, ls: -0.02, w, h: H - 480 - kick.height - gap, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true, shadow: overPhoto })
    stack(blocks(textBlock(kick, 'center'), gap, { h: 4, draw: (x, y) => e.fill(css(c.accent), W / 2 - 32, y, 64, 4) }, 56, textBlock(head, 'center')), side, 190, H - 190, 0.5)
    e.line(e.handle, { size: 28, color: css(c.text, 0.78), x: W / 2, y: H - 96, align: 'center', maxWidth: 640 })
  },
  body(e) {
    const { W, H, c, slide } = e
    photoBackdrop(e, 0.56)
    const side = 112
    const w = W - side * 2
    const top = 170
    const bottom = H - 190
    const head = e.text(slide.heading, { slot: 'heading', weight: 'bold', size: [40, 32], lh: 1.4, w, maxLines: 2, color: css(e.accentInk), balance: true, shadow: overPhoto })
    const gap = head.height ? 48 : 0
    const body = e.text(slide.text, { size: [60, 38], lh: 1.74, w, h: bottom - top - head.height - gap, color: css(c.text, 0.9), em: { style: 'bold', weight: 'bold', color: css(c.text) }, balance: true, keepLines: true, paraGap: 0.2, shadow: overPhoto })
    stack(blocks(textBlock(head, 'center'), gap, textBlock(body, 'center')), side, top, bottom, 0.5)
    const y = H - 100
    const width = e.line(`${e.index + 1} / ${e.total}`, { size: 26, color: css(c.text, 0.8), x: W / 2, y, align: 'center', ls: 0.04 })
    e.fill(css(c.text, 0.45), W / 2 - width / 2 - 72, y - 1, 48, 2)
    e.fill(css(c.text, 0.45), W / 2 + width / 2 + 24, y - 1, 48, 2)
  },
  last(e) {
    const { W, H, c, slide } = e
    photoBackdrop(e, 0.64)
    const side = 104
    const w = W - side * 2
    const top = 170
    const bottom = H - 170
    const pillHeight = e.handle ? 84 : 0
    const pillGap = e.handle ? 72 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'bold', size: [40, 32], lh: 1.4, w, maxLines: 2, color: css(e.accentInk), balance: true, shadow: overPhoto })
    const gap = head.height ? 40 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [84, 50], lh: 1.46, ls: -0.02, w, h: bottom - top - head.height - gap - pillHeight - pillGap, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true, shadow: overPhoto })
    const pill = e.handle && { h: pillHeight, draw: (x, y) => e.pill(e.handle, { x: W / 2, y, h: pillHeight, padX: 44, stroke: css(c.text, 0.75), color: css(c.text), size: 34, align: 'center' }) }
    stack(blocks(textBlock(head, 'center'), gap, textBlock(cta, 'center'), pillGap, pill), side, top, bottom, 0.5)
  },
}

/* ───────────────────────── 5. blog ───────────────────────── */

function blogCard(e) {
  const { ctx, W, H, c } = e
  const card = { x: 56, y: 110, w: W - 112, h: H - 220, pad: 72 }
  e.fill(css(mix(c.bg, c.text, 0.055)))
  ctx.save()
  ctx.shadowColor = css(c.text, 0.1)
  ctx.shadowBlur = 70
  ctx.shadowOffsetY = 24
  e.round(css(c.bg), card.x, card.y, card.w, card.h, 44)
  ctx.restore()
  return card
}

// Neutral stat chips: plain rounded rectangles, no icons or numbers.
function blogStats(e, right, cy) {
  const chip = { w: 96, h: 44, gap: 14 }
  for (let i = 0; i < 3; i += 1) {
    const x = right - chip.w - i * (chip.w + chip.gap)
    e.round(css(e.muted(0.93)), x, cy - chip.h / 2, chip.w, chip.h, chip.h / 2)
    e.round(css(e.muted(0.8)), x + 18, cy - 7, 14, 14, 7)
    e.round(css(e.muted(0.8)), x + 40, cy - 4, chip.w - 58, 8, 4)
  }
}

const blog = {
  cover(e) {
    const { W, c, slide } = e
    const card = blogCard(e)
    const x = card.x + card.pad
    const w = card.w - card.pad * 2
    const chipTop = card.y + card.pad
    // The kicker is the post's category chip when it fits on one line, otherwise a plain line above the title.
    const category = slide.text.replace(/\*\*/g, '').replace(/\s+/g, ' ')
    const asChip = Boolean(category) && e.lineWidth(category, { size: 30 }) + 64 <= w * 0.62
    if (asChip) e.pill(category, { x, y: chipTop, h: 64, padX: 32, fill: css(mix(c.bg, c.accent, 0.14)), color: css(mix(e.accentInk, c.text, 0.12)), size: 30, maxWidth: w })
    const rowY = card.y + card.h - card.pad - 48
    const divider = rowY - 48 - 44
    e.fill(css(e.muted(0.9)), x, divider, w, 2)
    e.avatar(x + 48, rowY, 48)
    if (e.handle) e.line(e.handle, { size: 34, color: css(c.text), x: x + 120, y: rowY, maxWidth: w - 120 - 360 })
    else e.round(css(e.muted(0.88)), x + 120, rowY - 10, 200, 20, 10)
    blogStats(e, W - card.x - card.pad, rowY)
    const top = asChip ? chipTop + 64 + 48 : chipTop
    const bottom = divider - 48
    const kick = asChip ? null : kicker(e, { size: [36, 30], w, color: css(e.accentInk), em: { style: 'color', color: css(c.text) } })
    const gap = kick?.height ? 30 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [100, 58], lh: 1.3, ls: -0.03, w, h: bottom - top - (kick?.height || 0) - gap, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true })
    stack(blocks(kick && textBlock(kick), gap, textBlock(head)), x, top, bottom, 0.5)
  },
  body(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    const headerY = M + 20
    e.avatar(M + 28, headerY, 28)
    if (e.handle) e.line(e.handle, { size: 28, color: css(e.muted(0.3)), x: M + 74, y: headerY, maxWidth: 560 })
    else e.round(css(e.muted(0.88)), M + 74, headerY - 8, 160, 16, 8)
    e.line(`${e.index + 1} / ${e.total}`, { size: 26, color: css(e.muted(0.5)), x: W - M, y: headerY, align: 'right' })
    e.fill(css(e.muted(0.9)), M, M + 74, W - M * 2, 2)
    const w = W - M * 2
    const top = M + 74 + 64
    const bottom = H - M - 56
    e.fill(css(e.muted(0.9)), M, H - M - 4, w, 2)
    e.round(css(c.accent), M, H - M - 6, w * clamp((e.index + 1) / e.total, 0, 1), 6, 3)
    const hasPhoto = Boolean(e.pic('image'))
    const photoGap = hasPhoto ? 44 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [62, 46], lh: 1.34, ls: -0.025, w, maxLines: 3, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true })
    const gap = head.height ? 40 : 0
    const room = bottom - top - head.height - gap - photoGap
    const body = e.text(slide.text, { size: [46, 31], lh: 1.74, w, h: room - (hasPhoto ? Math.round(H * 0.14) : 0), color: css(e.muted(0.12)), em: { style: 'color', color: css(e.accentInk), weight: 'bold' }, paraGap: 0.16, wrapGap: 0.3, balance: 'short', keepLines: true })
    const photoHeight = hasPhoto ? sharedPhotoHeight(room - body.height, H, 0.14, 0.38) : 0
    const photo = hasPhoto && { h: photoHeight, draw: (x, y) => e.photo('image', x, y, w, photoHeight, { radius: 24 }) }
    stack(blocks(textBlock(head), gap, photo, photoGap, textBlock(body)), M, top, bottom, 0)
  },
  last(e) {
    const { W, c, slide } = e
    const card = blogCard(e)
    const x = card.x + card.pad
    const w = card.w - card.pad * 2
    const top = card.y + card.pad
    const bottom = card.y + card.h - card.pad
    const pillHeight = e.handle ? 88 : 0
    const pillGap = e.handle ? 60 : 0
    const avatar = { h: 152, draw: (left, y) => e.avatar(W / 2, y + 76, 76) }
    const head = e.text(slide.heading, { weight: 'bold', size: [38, 32], lh: 1.4, w, maxLines: 2, color: css(e.muted(0.4)), balance: true })
    const gap = head.height ? 24 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [84, 50], lh: 1.32, ls: -0.03, w, h: bottom - top - 152 - 76 - head.height - gap - pillHeight - pillGap, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true })
    const pill = e.handle && { h: pillHeight, draw: (left, y) => e.pill(e.handle, { x: W / 2, y, h: pillHeight, padX: 44, fill: css(c.accent), color: css(e.onAccent), size: 36, align: 'center', maxWidth: w }) }
    stack(blocks(avatar, 76, textBlock(head, 'center'), gap, textBlock(cta, 'center'), pillGap, pill), x, top, bottom, 0.5)
  },
}

/* ───────────────────────── 6. card ───────────────────────── */

function cardFrame(e) {
  const { ctx, W, H, c } = e
  const card = { x: 60, y: 116, w: W - 120, h: H - 232, pad: 68 }
  e.fill(css(mix(c.bg, c.accent, 0.16)))
  ctx.save()
  ctx.shadowColor = css(mix(c.accent, c.text, 0.6), 0.14)
  ctx.shadowBlur = 64
  ctx.shadowOffsetY = 22
  e.round(css(c.bg), card.x, card.y, card.w, card.h, 52)
  ctx.restore()
  const x = card.x + card.pad
  const w = card.w - card.pad * 2
  const cy = card.y + card.pad + 50
  e.avatar(x + 50, cy, 50)
  if (e.handle) {
    e.line(e.handle.replace(/^@/, ''), { slot: 'heading', weight: 'heavy', size: 38, color: css(c.text), x: x + 126, y: cy - 21, maxWidth: w - 126 })
    e.line(e.handle, { weight: 'regular', size: 28, color: css(e.muted(0.5)), x: x + 126, y: cy + 25, maxWidth: w - 126 })
  } else {
    e.round(css(e.muted(0.86)), x + 126, cy - 30, 220, 20, 10)
    e.round(css(e.muted(0.92)), x + 126, cy + 12, 150, 16, 8)
  }
  const topRule = cy + 50 + 44
  const bottomRule = card.y + card.h - card.pad - 66
  e.fill(css(e.muted(0.9)), x, topRule, w, 2)
  e.fill(css(e.muted(0.9)), x, bottomRule, w, 2)
  const footY = bottomRule + 2 + 44
  e.line(`${e.index + 1} / ${e.total}`, { size: 28, color: css(e.muted(0.5)), x, y: footY })
  if (e.index < e.total - 1) drawArrow(ctx, x + w, footY, 56, css(c.accent), 5)
  return { x, w, top: topRule + 2 + 52, bottom: bottomRule - 52 }
}

const cardAccent = e => ({ style: 'color', color: css(e.accentInk), weight: 'heavy' })

const card = {
  cover(e) {
    const { c, slide } = e
    const box = cardFrame(e)
    const kick = kicker(e, { size: [38, 32], w: box.w, color: css(e.accentInk), em: { style: 'color', color: css(c.text) } })
    const gap = kick.height ? 30 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [100, 58], lh: 1.3, ls: -0.03, w: box.w, h: box.bottom - box.top - kick.height - gap, color: css(c.text), em: cardAccent(e), balance: true })
    stack(blocks(textBlock(kick), gap, textBlock(head)), box.x, box.top, box.bottom, 0.5)
  },
  body(e) {
    const { c, slide } = e
    const box = cardFrame(e)
    const body = e.text(slide.text, { size: [64, 38], lh: 1.56, ls: -0.015, w: box.w, h: box.bottom - box.top, color: css(c.text), em: { ...cardAccent(e), weight: 'bold' }, paraGap: 0.25, wrapGap: 0.3, balance: 'short', keepLines: true })
    stack(blocks(textBlock(body)), box.x, box.top, box.bottom, 0.5)
  },
  last(e) {
    const { c, slide } = e
    const box = cardFrame(e)
    const pillHeight = e.handle ? 84 : 0
    const pillGap = e.handle ? 60 : 0
    const head = e.text(slide.heading, { weight: 'bold', size: [38, 32], lh: 1.4, w: box.w, maxLines: 2, color: css(e.muted(0.42)) })
    const gap = head.height ? 28 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [88, 52], lh: 1.32, ls: -0.03, w: box.w, h: box.bottom - box.top - head.height - gap - pillHeight - pillGap, color: css(c.text), em: cardAccent(e), balance: true })
    const pill = e.handle && { h: pillHeight, draw: (x, y) => e.pill(e.handle, { x, y, h: pillHeight, padX: 40, fill: css(c.accent), color: css(e.onAccent), size: 36, maxWidth: box.w }) }
    stack(blocks(textBlock(head), gap, textBlock(cta), pillGap, pill), box.x, box.top, box.bottom, 0.5)
  },
}

/* ───────────────────────── 7. photo-dark ───────────────────────── */
// After an interview-story account (your._.dot): a photo filling the top of a charcoal page, a short yellow title,
// a few lines of small white text, and the account's mark centred at the foot of every slide.

// A full-bleed photo that darkens towards the bottom, so white text below or over it reads.
function shadedPhoto(e, from = 0.42, strength = 0.92) {
  const { ctx, W, H, c } = e
  if (!e.photo('image', 0, 0, W, H)) return false
  const shade = ctx.createLinearGradient(0, H * from, 0, H)
  shade.addColorStop(0, css(c.bg, 0))
  shade.addColorStop(1, css(c.bg, strength))
  e.fill(shade, 0, H * from, W, H * (1 - from))
  return true
}

// The account's name as a small mark centred at the foot.
const footMark = (e, color) => e.line(e.handle, { weight: 'heavy', size: 28, color, x: e.W / 2, y: e.H - 64, align: 'center', maxWidth: 560 })

const photoDark = {
  cover(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    const hasPhoto = shadedPhoto(e, 0.38, 0.96)
    const w = W - M * 2
    const bottom = H - 150
    const top = hasPhoto ? Math.round(H * 0.5) : M + 120
    const kick = kicker(e, { w, color: css(c.text, 0.88), align: 'center', shadow: hasPhoto ? overPhoto : undefined })
    const gap = kick.height ? 26 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [100, 62], lh: 1.24, ls: -0.03, w, h: bottom - top - kick.height - gap, color: css(c.text), em: { style: 'color', color: css(e.accentInk) }, balance: true, align: 'center', shadow: hasPhoto ? overPhoto : undefined })
    stack(blocks(textBlock(kick, 'center'), gap, textBlock(head, 'center')), M, top, bottom, 1)
    footMark(e, css(c.text, 0.9))
  },
  body(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    const photoHeight = Math.round(H * 0.42)
    const hasPhoto = e.photo('image', 0, 0, W, photoHeight)
    const w = W - M * 2
    const top = hasPhoto ? photoHeight + 64 : M + 80
    const bottom = H - 130
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [56, 42], lh: 1.3, ls: -0.02, w, maxLines: 2, color: css(e.accentInk), balance: true })
    const gap = head.height ? 34 : 0
    const body = e.text(slide.text, { size: [40, 30], lh: 1.66, w, h: bottom - top - head.height - gap, color: css(c.text, 0.86), em: { style: 'bold', weight: 'heavy' }, balance: 'short', keepLines: true, wrapGap: 0.4 })
    stack(blocks(textBlock(head), gap, textBlock(body)), M, top, bottom, hasPhoto ? 0 : 0.4)
    footMark(e, css(c.text, 0.85))
  },
  last(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    const hasPhoto = e.photo('image', 0, 0, W, H)
    if (hasPhoto) e.fill(css(c.bg, 0.62))
    const w = W - M * 2
    const top = M + 80
    const bottom = H - 150
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [56, 42], lh: 1.3, w, maxLines: 2, color: css(e.accentInk), balance: true, align: 'center' })
    const gap = head.height ? 40 : 0
    const cta = e.text(slide.text, { size: [52, 36], lh: 1.6, w, h: bottom - top - head.height - gap, color: css(c.text, 0.92), em: { style: 'bold', weight: 'heavy' }, balance: true, align: 'center' })
    stack(blocks(textBlock(head, 'center'), gap, textBlock(cta, 'center')), M, top, bottom, 0.5)
    footMark(e, css(c.text, 0.9))
  },
}

/* ───────────────────────── 8. grid-memo ───────────────────────── */
// After a quote-collection account (sanman._.jabji): squared notebook paper, the account's name small at the top
// centre, one photo in a thin black frame tucked into an upper corner, the quote in small calm type with room between
// paragraphs, and where it was said in small letters beside it. The cover is a full photo with a serif title.

function gridPaper(e) {
  const { ctx, W, H, c } = e
  e.fill(css(c.bg))
  const step = 40
  ctx.save()
  ctx.strokeStyle = css(mix(c.bg, c.text, luminance(c.bg) > 0.4 ? 0.09 : 0.16))
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = Math.round((W % step) / 2); x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
  for (let y = Math.round((H % step) / 2); y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
  ctx.stroke()
  ctx.restore()
}

// A photo in a thin dark frame.
function framedPhoto(e, x, y, w, h) {
  const border = 4
  e.fill(css(e.c.text), x - border, y - border, w + border * 2, h + border * 2)
  e.photo('image', x, y, w, h, { placeholder: true })
}

const memoTop = e => e.line(e.handle, { slot: 'heading', weight: 'heavy', size: 30, color: css(e.c.text, 0.88), x: e.W / 2, y: 58, align: 'center', maxWidth: 600 })

const gridMemo = {
  cover(e) {
    const { W, H, M, c, slide } = e
    const hasPhoto = Boolean(e.pic('image'))
    if (hasPhoto) {
      e.fill(css(c.text))
      e.photo('image', 0, 0, W, H)
      const shade = e.ctx.createLinearGradient(0, H * 0.4, 0, H)
      shade.addColorStop(0, 'rgba(0,0,0,0)')
      shade.addColorStop(1, 'rgba(0,0,0,0.78)')
      e.fill(shade, 0, H * 0.4, W, H * 0.6)
    } else gridPaper(e)
    const ink = hasPhoto ? css(PAPER) : css(c.text)
    e.line(e.handle, { slot: 'heading', weight: 'bold', size: 28, color: hasPhoto ? css(PAPER, 0.9) : css(c.text, 0.6), x: W - M, y: M, align: 'right', maxWidth: 560 })
    const w = W - M * 2
    const bottom = H - M - 40
    const top = hasPhoto ? Math.round(H * 0.45) : M + 160
    const kick = kicker(e, { slot: 'heading', weight: 'regular', size: [40, 32], w, color: hasPhoto ? css(PAPER, 0.88) : css(c.text, 0.7), shadow: hasPhoto ? overPhoto : undefined })
    const gap = kick.height ? 22 : 0
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [108, 66], lh: 1.24, ls: -0.02, w, h: bottom - top - kick.height - gap, color: ink, balance: true, shadow: hasPhoto ? overPhoto : undefined })
    stack(blocks(textBlock(kick), gap, textBlock(head)), M, top, bottom, hasPhoto ? 1 : 0.5)
  },
  body(e) {
    const { W, H, M, c, slide } = e
    gridPaper(e)
    memoTop(e)
    const w = W - M * 2
    const hasPhoto = Boolean(e.pic('image'))
    // The photo sits in the upper right on odd slides and the upper left on even ones, as a notebook page would.
    const photoW = Math.round(W * 0.42)
    const photoH = Math.round(photoW * 0.78)
    const photoX = e.index % 2 ? W - M - photoW : M
    const photoY = 130
    if (hasPhoto) framedPhoto(e, photoX, photoY, photoW, photoH)
    const sourceSize = 30
    let top = hasPhoto ? photoY + photoH + 90 : 170
    if (hasPhoto && slide.heading) {
      e.line(slide.heading.replace(/\*\*/g, ''), { size: sourceSize, weight: 'regular', color: css(c.text, 0.75), x: W - M, y: photoY + photoH + 44, align: 'right', maxWidth: w })
      top += 10
    }
    const bottom = H - M - (hasPhoto || !slide.heading ? 0 : 60)
    const quote = e.text(slide.text, { size: [44, 32], lh: 1.78, w, h: bottom - top, color: css(c.text, 0.92), em: { style: 'bold', weight: 'bold' }, balance: 'short', keepLines: true, wrapGap: 0.55 })
    const source = !hasPhoto && slide.heading ? { h: 60, draw: (x, y) => e.line(slide.heading.replace(/\*\*/g, ''), { size: sourceSize, weight: 'regular', color: css(c.text, 0.75), x: W - M, y: y + 34, align: 'right', maxWidth: w }) } : null
    stack(blocks(textBlock(quote), source), M, top, bottom, hasPhoto ? 0 : 0.35)
  },
  last(e) {
    const { W, H, M, c, slide } = e
    const hasPhoto = Boolean(e.pic('image'))
    if (hasPhoto) { e.photo('image', 0, 0, W, H); e.fill('rgba(0,0,0,0.5)') } else gridPaper(e)
    const ink = hasPhoto ? PAPER : c.text
    const w = W - M * 2
    const top = M + 80
    const bottom = H - 170
    const head = e.text(slide.heading, { slot: 'heading', weight: 'regular', size: [40, 32], lh: 1.5, w, maxLines: 2, color: css(ink, 0.8), align: 'center' })
    const gap = head.height ? 28 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [76, 50], lh: 1.4, w, h: bottom - top - head.height - gap, color: css(ink), balance: true, align: 'center', shadow: hasPhoto ? overPhoto : undefined })
    stack(blocks(textBlock(head, 'center'), gap, textBlock(cta, 'center')), M, top, bottom, 0.5)
    e.line(e.handle, { slot: 'heading', weight: 'heavy', size: 32, color: css(ink, 0.9), x: W / 2, y: H - 100, align: 'center', maxWidth: 600 })
  },
}

/* ───────────────────────── 9. list-card ───────────────────────── */
// After an account-curation post (shhseoulmag): a red cover with a cropped photo strip and a big white title; then
// one item per black slide — the series line small at the top centre, a large round picture with the item's name
// beside it, a few lines about it below, a small dot at the foot. The last slide turns white with a follow button.

function listAvatar(e, cx, cy, r) {
  const { ctx, c } = e
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r + 12, 0, Math.PI * 2)
  ctx.strokeStyle = css(c.accent)
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  const drawn = e.photo('image', cx - r, cy - r, r * 2, r * 2, { placeholder: false })
  if (!drawn) e.fill(css(PAPER), cx - r, cy - r, r * 2, r * 2)
  ctx.restore()
  if (!drawn) e.line(String(Math.max(1, e.index)), { slot: 'heading', weight: 'heavy', size: r * 0.9, color: css(INK), x: cx, y: cy, align: 'center' })
}

const listCard = {
  cover(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.accent))
    const ink = e.onAccent
    e.line(e.handle, { size: 28, weight: 'bold', color: css(ink, 0.9), x: M, y: M, maxWidth: 560 })
    const hasPhoto = Boolean(e.pic('image'))
    const stripY = Math.round(H * 0.16)
    const stripH = Math.round(H * 0.28)
    if (hasPhoto) e.photo('image', M + 60, stripY, W - (M + 60) * 2, stripH)
    const w = W - M * 2
    const top = hasPhoto ? stripY + stripH + 80 : M + 200
    const bottom = H - M - 60
    const head = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [120, 72], lh: 1.18, ls: -0.04, w, h: bottom - top - 90, color: css(ink), balance: true })
    const gap = 30
    const kick = kicker(e, { w, color: css(ink, 0.82), weight: 'regular' })
    stack(blocks(textBlock(head), gap, textBlock(kick)), M, top, bottom, 0)
  },
  body(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.bg))
    e.line(e.handle, { size: 28, weight: 'bold', color: css(c.text, 0.9), x: W / 2, y: 62, align: 'center', maxWidth: 700 })
    const r = 118
    const cx = M + r + 12
    const cy = Math.round(H * 0.2) + r
    listAvatar(e, cx, cy, r)
    const nameX = cx + r + 64
    const name = e.text(slide.heading, { slot: 'heading', weight: 'heavy', size: [58, 42], lh: 1.24, ls: -0.02, w: W - M - nameX, maxLines: 2, color: css(c.text), balance: true })
    name.draw(nameX, cy - name.height / 2)
    const top = cy + r + 110
    const bottom = H - 150
    const body = e.text(slide.text, { size: [40, 30], lh: 1.7, w: W - M * 2, h: bottom - top, color: css(c.text, 0.88), em: { style: 'bold', weight: 'heavy' }, balance: 'short', keepLines: true, wrapGap: 0.45 })
    body.draw(M, top)
    e.round(css(c.text), W / 2 - 8, H - 76, 16, 16, 8)
  },
  last(e) {
    const { W, H, M, c, slide } = e
    e.fill(css(c.text))
    const ink = c.bg
    const w = W - M * 2
    const top = M + 80
    const bottom = H - M - 80
    const buttonH = e.handle ? 84 : 0
    const buttonGap = e.handle ? 70 : 0
    const head = e.text(slide.heading, { weight: 'bold', size: [36, 30], lh: 1.4, w, maxLines: 2, color: css(ink, 0.75), align: 'center' })
    const gap = head.height ? 26 : 0
    const cta = e.text(slide.text, { slot: 'heading', weight: 'heavy', size: [88, 54], lh: 1.26, ls: -0.03, w, h: bottom - top - head.height - gap - buttonH - buttonGap, color: css(ink), balance: true, align: 'center' })
    const button = e.handle && { h: buttonH, draw: (x, y) => e.pill(e.handle, { x: W / 2, y, h: buttonH, padX: 48, fill: css(mix(c.text, ink, 0.6)), color: css(c.text), size: 34, align: 'center', maxWidth: w }) }
    stack(blocks(textBlock(head, 'center'), gap, textBlock(cta, 'center'), buttonGap, button), M, top, bottom, 0.5)
  },
}

const LAYOUTS = { 'dark-accent': darkAccent, split, note, 'photo-center': photoCenter, blog, card, 'photo-dark': photoDark, 'grid-memo': gridMemo, 'list-card': listCard }

/* ───────────────────────── entry ───────────────────────── */

// Draws the slide at full resolution. Synchronous: call `prepare` first and pass its result as `assets`.
export function drawSlide(canvas, { slide, index = 0, total = 1, design, assets } = {}) {
  const e = environment(canvas, { slide, index, total, design, assets })
  const layout = LAYOUTS[e.template.id] || darkAccent
  const role = slide?.role === 'cover' || slide?.role === 'last' ? slide.role : 'body'
  e.ctx.save()
  layout[role](e)
  e.ctx.restore()
  return { overflow: e.overflow, boxes: e.boxes }
}
