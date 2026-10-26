import { lookup } from 'node:dns/promises'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Agent, fetch } from 'undici'
import ipaddr from 'ipaddr.js'
import { fail, MAX_BYTES } from './domain.js'

export function publicAddress(address) {
  try {
    const parsed = ipaddr.process(address)
    return parsed.range() === 'unicast'
  } catch { return false }
}
export async function resolvePublicUrl(value, resolver = lookup) {
  let url
  try { url = new URL(value) } catch { fail('UNSAFE_MEDIA_URL', '영상 주소를 확인할 수 없습니다.') }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hostname.endsWith('.local')) {
    fail('UNSAFE_MEDIA_URL', '허용되지 않는 영상 주소입니다.')
  }
  const addresses = await resolver(url.hostname.replace(/^\[|\]$/g, ''), { all: true })
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) fail('UNSAFE_MEDIA_URL', '사설 네트워크 주소는 사용할 수 없습니다.')
  return { url, addresses }
}

// Validate every redirect, then pin the vetted DNS result to prevent rebinding.
export async function downloadPublicMedia(value, destination, signal, limit = MAX_BYTES) {
  let current = value
  for (let hop = 0; hop <= 3; hop += 1) {
    const { url, addresses } = await resolvePublicUrl(current)
    const agent = new Agent({ connect: { lookup: (_host, options, done) => {
      if (options.all) done(null, addresses)
      else done(null, addresses[0].address, addresses[0].family)
    } } })
    try {
      const response = await fetch(url, { dispatcher: agent, redirect: 'manual', signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) fail('MEDIA_DOWNLOAD_FAILED', '영상 주소가 만료되었습니다.', 422)
        current = new URL(location, url).href
        continue
      }
      if (!response.ok) { await response.body?.cancel(); fail('MEDIA_DOWNLOAD_FAILED', '영상에 접근할 수 없습니다. 파일 업로드를 이용해주세요.', 422) }
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('VIDEO_TOO_LARGE', '영상은 300MB 이하로 올려주세요.') }
      const type = response.headers.get('content-type') || ''
      if (!/^(video\/|application\/octet-stream)/i.test(type)) { await response.body?.cancel(); fail('NOT_VIDEO', '다운로드 결과가 영상이 아닙니다.') }
      let size = 0
      const guard = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(size > limit ? new Error('VIDEO_TOO_LARGE') : null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body), guard, createWriteStream(destination, { flags: 'wx' }), { signal })
      return size
    } finally { await agent.close() }
  }
  fail('TOO_MANY_REDIRECTS', '영상 주소 이동 횟수를 초과했습니다.')
}

export async function readPublicImage(value, signal, limit = 2 * 1024 * 1024) {
  let current = value
  for (let hop = 0; hop <= 3; hop += 1) {
    const { url, addresses } = await resolvePublicUrl(current)
    if (!url.hostname.endsWith('.cdninstagram.com')) fail('UNSAFE_IMAGE_URL', '허용되지 않은 이미지 주소입니다.')
    const agent = new Agent({ connect: { lookup: (_host, options, done) => options.all
      ? done(null, addresses) : done(null, addresses[0].address, addresses[0].family) } })
    try {
      const response = await fetch(url, { dispatcher: agent, redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel()
        if (!location) fail('IMAGE_DOWNLOAD_FAILED', '이미지 주소가 만료되었습니다.', 422)
        current = new URL(location, url).href; continue
      }
      if (!response.ok) { await response.body?.cancel(); fail('IMAGE_DOWNLOAD_FAILED', '이미지를 확인할 수 없습니다.', 422) }
      const type = (response.headers.get('content-type') || '').split(';')[0]
      if (!/^image\/(jpeg|png|webp)$/.test(type) || Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel(); fail('IMAGE_INVALID', '분석할 수 없는 이미지입니다.', 422)
      }
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > limit) { await response.body.cancel().catch(() => {}); fail('IMAGE_TOO_LARGE', '이미지 용량을 초과했습니다.', 422) }
        chunks.push(chunk)
      }
      return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`
    } finally { await agent.close() }
  }
  fail('TOO_MANY_REDIRECTS', '이미지 주소 이동 횟수를 초과했습니다.')
}

export async function fetchJson(url, init = {}, signal, maxBytes = 2 * 1024 * 1024) {
  const response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000), redirect: 'error' })
  if (!response.ok) {
    await response.body?.cancel()
    const error = new Error('PROVIDER_HTTP_ERROR')
    error.status = response.status
    throw error
  }
  let body = ''
  const decoder = new TextDecoder()
  for await (const chunk of response.body) {
    body += decoder.decode(chunk, { stream: true })
    if (Buffer.byteLength(body) > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('PROVIDER_RESPONSE_TOO_LARGE') }
  }
  body += decoder.decode()
  return JSON.parse(body)
}

// A public web page a student linked in their brief (a product page, an article), reduced to readable text:
// title, descriptions, product data and the visible body text. Same address checks as media downloads.
export function pageText(html) {
  const meta = name => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1] || ''
  const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  const products = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => { try { return [JSON.parse(m[1])].flat() } catch { return [] } })
    .filter(item => /product/i.test(String(item?.['@type'] || ''))).map(item => [item.name, item.description, item.brand?.name].filter(Boolean).join(' / '))
  const body = decode(html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return [decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim(), decode(meta('og:title')), decode(meta('description')), decode(meta('og:description')), ...products, body]
    .filter(Boolean).filter((part, i, all) => all.indexOf(part) === i).join('\n').slice(0, 6000)
}
export async function readPublicPage(value, signal, limit = 2 * 1024 * 1024) {
  let current = value
  for (let hop = 0; hop <= 3; hop += 1) {
    const { url, addresses } = await resolvePublicUrl(current)
    const agent = new Agent({ connect: { lookup: (_host, options, done) => options.all
      ? done(null, addresses) : done(null, addresses[0].address, addresses[0].family) } })
    try {
      const response = await fetch(url, { dispatcher: agent, redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) HookAI', accept: 'text/html' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel()
        if (!location) fail('PAGE_UNAVAILABLE', '링크를 열 수 없어요.', 422)
        current = new URL(location, url).href; continue
      }
      if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); fail('PAGE_UNAVAILABLE', '링크를 열 수 없어요.', 422) }
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length; chunks.push(chunk)
        if (size > limit) { await response.body.cancel().catch(() => {}); break }
      }
      return pageText(Buffer.concat(chunks).toString('utf8'))
    } finally { await agent.close() }
  }
  fail('TOO_MANY_REDIRECTS', '링크 이동 횟수를 초과했어요.')
}
