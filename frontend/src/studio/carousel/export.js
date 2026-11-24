// Turns slides into PNG files in the browser: one PNG, or every slide in one ZIP. No libraries — the PNG text
// chunk and the (uncompressed) ZIP container are written by hand.
import { drawSlide, prepare } from './render'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes, seed = 0) {
  let c = (seed ^ 0xffffffff) >>> 0
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const latin1 = text => Uint8Array.from(text, ch => ch.charCodeAt(0) & 0xff)

function textChunk(keyword, value) {
  const data = latin1(`${keyword}\0${value}`)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(latin1('tEXt'), 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

// Adds tEXt chunks right after IHDR (the first chunk: 8 signature bytes + 25).
function withPngText(png, entries) {
  const at = 33
  const chunks = Object.entries(entries).map(([keyword, value]) => textChunk(keyword, value))
  const out = new Uint8Array(png.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  out.set(png.subarray(0, at), 0)
  let offset = at
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  out.set(png.subarray(at), offset)
  return out
}

const AI_LABEL = { Software: 'HookAI', Comment: 'Contains AI-generated imagery' }

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했어요')), 'image/png')
  })
}

async function renderBlob(canvas, slide, index, total, design, assets, aiGenerated) {
  drawSlide(canvas, { slide, index, total, design, assets })
  const blob = await canvasBlob(canvas)
  if (!aiGenerated) return blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return new Blob([withPngText(bytes, AI_LABEL)], { type: 'image/png' })
}

// One slide as a PNG Blob. `assets` is what `prepare` returned; without it the slide's own are loaded here.
export async function slideBlob(slide, index, total, design, assets, { aiGenerated = false } = {}) {
  const ready = assets || await prepare([slide], design)
  return renderBlob(document.createElement('canvas'), slide, index, total, design, ready, aiGenerated)
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

// A ZIP with every file stored as it is (PNG is already compressed). files: [{ name, bytes }]
function zipStore(files) {
  const encoder = new TextEncoder()
  const { time, day } = dosTime(new Date())
  const parts = []
  const directory = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.bytes)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // names are UTF-8
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, day, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, file.bytes.length, true)
    lv.setUint32(22, file.bytes.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, day, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, file.bytes.length, true)
    cv.setUint32(24, file.bytes.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    parts.push(local, file.bytes)
    directory.push(central)
    offset += local.length + file.bytes.length
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, directorySize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, end], { type: 'application/zip' })
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

const safeName = name => String(name || 'carousel').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'carousel'
const fileNumber = index => String(index + 1).padStart(2, '0')

// Every slide as 01.png, 02.png, … inside one ZIP download. Resolves with the ZIP Blob.
export async function downloadSlides(slides, design, { name = 'carousel', aiSlideIds = [] } = {}) {
  const assets = await prepare(slides, design)
  const ai = new Set(aiSlideIds)
  const canvas = document.createElement('canvas')
  const files = []
  for (let index = 0; index < slides.length; index += 1) {
    const blob = await renderBlob(canvas, slides[index], index, slides.length, design, assets, ai.has(slides[index].id))
    files.push({ name: `${fileNumber(index)}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  const zip = zipStore(files)
  saveBlob(zip, `${safeName(name)}.zip`)
  return zip
}

// One slide as a PNG download. opts: { name, aiGenerated }
export async function downloadSlide(slide, index, total, design, { name = 'carousel', aiGenerated = false } = {}) {
  const blob = await slideBlob(slide, index, total, design, null, { aiGenerated })
  saveBlob(blob, `${safeName(name)}-${fileNumber(index)}.png`)
  return blob
}
