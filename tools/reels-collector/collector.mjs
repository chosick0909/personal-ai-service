#!/usr/bin/env node
// HookAI success-reels collector for the client's Mac mini.
// Uses its own Chrome data folder, separate from every personal Chrome profile.
// Read-only on Instagram: it only opens pages. It never follows, likes, comments or downloads videos.
import { chromium } from 'playwright-core'
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = join(homedir(), 'hookai-collector')
const PROFILE = join(HOME, 'chrome-profile')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const pause = (min, max) => sleep(min + Math.random() * (max - min))
const BLOCKED = /\/(challenge|checkpoint|accounts\/suspended|accounts\/login)/

async function openBrowser() {
  await mkdir(PROFILE, { recursive: true })
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: false, chromiumSandbox: true, locale: 'ko-KR', viewport: { width: 1280, height: 900 },
  })
}
const loggedIn = async context => (await context.cookies('https://www.instagram.com'))
  .some(cookie => cookie.name === 'sessionid' && cookie.value)

async function login() {
  const context = await openBrowser()
  const page = context.pages()[0] || await context.newPage()
  await page.goto('https://www.instagram.com/accounts/login/')
  console.log('열린 Chrome 창에서 인스타 수집 계정으로 로그인하세요. 로그인이 확인되면 창이 자동으로 닫힙니다. (최대 10분)')
  for (let i = 0; i < 120; i += 1) {
    if (await loggedIn(context)) {
      console.log('✅ 로그인 확인됨')
      await sleep(3000)
      await context.close()
      return
    }
    await sleep(5000)
  }
  console.log('❌ 10분 안에 로그인이 확인되지 않았습니다. 다시 실행해주세요.')
  await context.close()
  process.exitCode = 1
}

// Fields we need for the archive. The probe reports where each one appears.
const FIELDS = new Set(['play_count', 'ig_play_count', 'view_count', 'video_view_count', 'video_play_count',
  'taken_at', 'taken_at_timestamp', 'like_count', 'comment_count', 'code', 'shortcode', 'image_versions2',
  'display_url', 'thumbnail_src', 'music_info', 'original_sound_info', 'follower_count', 'edge_followed_by',
  'biography', 'external_url', 'is_private', 'category_name', 'product_type', 'media_type'])
function scan(value, found, path = '', depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) { value.slice(0, 3).forEach(item => scan(item, found, `${path}[]`, depth + 1)); return }
  for (const [key, child] of Object.entries(value)) {
    if (FIELDS.has(key) && !found[key]) found[key] = `${path}.${key}`
    scan(child, found, `${path}.${key}`, depth + 1)
  }
}
function viralCount(value, depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + viralCount(item, depth + 1), 0)
  const views = Math.max(...['play_count', 'ig_play_count', 'video_view_count', 'view_count']
    .map(key => Number.isFinite(value[key]) ? value[key] : 0))
  const own = (value.code || value.shortcode) && views >= 500000 ? 1 : 0
  return own + Object.values(value).reduce((sum, child) => sum + viralCount(child, depth + 1), 0)
}

// Instagram GraphQL bodies may be prefixed or streamed as several JSON documents.
function parseBodies(text) {
  const clean = text.replace(/^for \(;;\);/, '').trim()
  try { return [JSON.parse(clean)] } catch { /* Try line-delimited documents. */ }
  return clean.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
}
function summarize(body) {
  const found = {}
  scan(body, found)
  const roots = body?.data && typeof body.data === 'object' ? Object.keys(body.data).slice(0, 3) : []
  return { found, roots, viral: viralCount(body) }
}

async function probe(keyword, account) {
  const context = await openBrowser()
  const page = context.pages()[0] || await context.newPage()
  let step = 'home'
  const report = []
  const add = (source, name, body) => {
    const { found, roots, viral } = summarize(body)
    if (Object.keys(found).length) report.push({ step, source, name, roots, viral, fields: Object.keys(found), sample: found })
  }
  page.on('response', async response => {
    const url = response.url()
    if (!/^https:\/\/www\.instagram\.com\/(api\/|graphql)/.test(url)) return
    try {
      const request = response.request()
      const form = new URLSearchParams(request.postData() || '')
      const name = form.get('fb_api_req_friendly_name') || url.split('?')[0].replace('https://www.instagram.com', '')
      for (const body of parseBodies(await response.text())) add('xhr', name, body)
    } catch { /* Body unavailable. */ }
  })
  // Data embedded in the first HTML response never appears as a separate request.
  const inline = async () => {
    const texts = await page.$$eval('script[type="application/json"]', nodes => nodes.map(node => node.textContent || ''))
    for (const text of texts) if (/view_count|play_count|taken_at/.test(text)) for (const body of parseBodies(text)) add('html', 'inline-json', body)
  }
  // The same JSON endpoints Instagram's own web page uses, called from the logged-in page.
  const api = async (name, path, init = {}) => {
    step = name
    const result = await page.evaluate(async ({ path, init }) => {
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ''
      const response = await fetch(path, { credentials: 'include', ...init,
        headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest', ...(init.headers || {}) } })
      return { status: response.status, text: await response.text() }
    }, { path, init })
    if (result.status !== 200) { report.push({ step, error: `HTTP ${result.status}` }); return null }
    const body = parseBodies(result.text)[0]
    if (body) add('api', path.split('?')[0], body)
    return body
  }
  const visit = async (name, url) => {
    step = name
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await pause(6000, 9000)
    if (BLOCKED.test(page.url())) throw new Error(`인스타가 확인 화면으로 보냈습니다: ${page.url()}`)
    await inline()
    for (let i = 0; i < 3; i += 1) { await page.mouse.wheel(0, 2000); await pause(3000, 5000) }
  }
  try {
    await visit('home', 'https://www.instagram.com/')
    if (!(await loggedIn(context))) throw new Error('로그인이 안 돼 있습니다. 먼저 login을 실행하세요.')
    await visit('keyword', `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`)
    await visit('reels-tab', `https://www.instagram.com/${account}/reels/`)
    const profile = await api('api-profile', `/api/v1/users/web_profile_info/?username=${encodeURIComponent(account)}`)
    const userId = profile?.data?.user?.id
    await pause(3000, 5000)
    if (userId) await api('api-clips', '/api/v1/clips/user/', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `target_user_id=${userId}&page_size=12&include_feed_video=true` })
    await pause(3000, 5000)
    await api('api-search', `/api/v1/fbsearch/web/top_serp/?enable_metadata=true&query=${encodeURIComponent(keyword)}`)
  } catch (error) {
    report.push({ step, error: error.message })
    console.log(`⚠️ ${error.message}`)
  }
  await context.close()
  await writeFile(join(HOME, 'probe-report.json'), JSON.stringify(report, null, 2))
  console.log('===== HookAI 탐색 결과 v2 (이 아래를 전부 복사해서 보내주세요) =====')
  for (const item of report) {
    if (item.error) { console.log(`[${item.step}] 오류: ${item.error}`); continue }
    console.log(`[${item.step}] ${item.source} ${item.name} | ${item.roots.join(',')} | 50만+ ${item.viral}개 | ${item.fields.join(' ')}`)
  }
  console.log(`===== 끝 (응답 ${report.length}개) =====`)
}

// ---------- Daily collection ----------
const MIN_VIEWS = 500000
const MAX_AGE_DAYS = 90
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
// Instagram media ids embed the upload time, so no extra page is opened for dates.
function postedAt(code) {
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code || '')) return null
  const id = [...code].reduce((value, char) => value * 64n + BigInt(ALPHABET.indexOf(char)), 0n)
  return new Date(Number(id >> 23n) + 1314220021721)
}
const num = value => Number.isSafeInteger(value) && value >= 0 ? value : null
// Walk any captured Instagram JSON and merge every media object by its shortcode.
function collectMedia(value, media, depth = 0) {
  if (depth > 14 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(item => collectMedia(item, media, depth + 1)); return }
  if (typeof value.code === 'string' && (value.image_versions2 || value.play_count !== undefined || value.view_count !== undefined)) {
    const previous = media.get(value.code) || {}
    const owner = value.user?.username || value.owner?.username || previous.owner
    const candidates = value.image_versions2?.candidates || []
    const thumb = [...candidates].sort((a, b) => (a.width || 0) - (b.width || 0)).find(c => (c.width || 0) >= 300) || candidates.at(-1)
    const music = value.clips_metadata?.music_info?.music_asset_info
    const sound = value.clips_metadata?.original_sound_info
    media.set(value.code, {
      code: value.code, owner,
      views: Math.max(num(value.play_count) || 0, num(value.ig_play_count) || 0, num(value.view_count) || 0, previous.views || 0) || null,
      likes: num(value.like_count) ?? previous.likes ?? null, comments: num(value.comment_count) ?? previous.comments ?? null,
      caption: (typeof value.caption?.text === 'string' ? value.caption.text : previous.caption) || '',
      audio: (music ? `${music.display_artist || ''} · ${music.title || ''}`.replace(/^ · | · $/g, '') : sound?.original_audio_title) || previous.audio || null,
      thumbnailUrl: thumb?.url || previous.thumbnailUrl || null,
      clip: value.product_type === 'clips' || value.media_type === 2 || previous.clip || false,
    })
  }
  for (const child of Object.values(value)) collectMedia(child, media, depth + 1)
}
function findProfile(value, username, depth = 0) {
  if (depth > 14 || value === null || typeof value !== 'object') return null
  if (!Array.isArray(value) && value.username === username && ('follower_count' in value || 'biography' in value)) return value
  for (const child of Object.values(value)) { const found = findProfile(child, username, depth + 1); if (found) return found }
  return null
}

// Accounts Instagram suggests next to an approved creator ("비슷한 계정") are the
// richest source of new candidates, so they are queued for the following days.
function findSuggested(value, found = new Set(), inside = false, depth = 0) {
  if (depth > 14 || value === null || typeof value !== 'object') return found
  if (inside && !Array.isArray(value) && typeof value.username === 'string') found.add(value.username.toLowerCase())
  for (const [key, child] of Object.entries(value)) findSuggested(child, found, inside || /chaining|suggested/i.test(key), depth + 1)
  return found
}
const QUEUE = () => join(HOME, 'queue.json')
async function loadQueue() {
  try { const rows = JSON.parse(await readFile(QUEUE(), 'utf8')); return Array.isArray(rows) ? rows : [] } catch { return [] }
}
async function saveQueue(rows) { await writeFile(QUEUE(), JSON.stringify(rows.slice(0, 1500))) }

async function loadConfig() {
  try { return JSON.parse(await readFile(join(HOME, 'config.json'), 'utf8')) } catch { return null }
}
async function api(config, method, path, body) {
  const response = await fetch(`${config.server}/api/creator-ingest${path}`, { method,
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`서버 ${response.status}: ${data?.error?.message || data?.message || ''}`)
  return data
}
async function log(line) {
  const stamp = new Date().toISOString()
  console.log(line)
  await mkdir(join(HOME, 'logs'), { recursive: true })
  await appendFile(join(HOME, 'logs', `${stamp.slice(0, 10)}.log`), `${stamp} ${line}\n`)
}

async function collect(dry, dryKeywords) {
  const config = dry ? null : await loadConfig()
  if (!dry && !config?.server) throw new Error('config.json이 없습니다. 설치 안내를 확인하세요.')
  const plan = dry
    ? { keywords: (dryKeywords.length ? dryKeywords : ['피부관리', 'skincare routine']).map(keyword => ({ keyword, region: /[가-힣]/.test(keyword) ? 'domestic' : 'overseas' })), maxAccounts: 5, skipAccounts: [] }
    : await api(config, 'GET', '/success-reels/plan')
  const run = dry ? null : await api(config, 'POST', '/success-reels/runs')
  const stats = { keywords: 0, accounts: 0, qualified: 0, saved: 0, eligible: 0, errors: 0 }
  const skip = new Set(plan.skipAccounts)
  const context = await openBrowser()
  const page = context.pages()[0] || await context.newPage()
  let bodies = []
  page.on('response', async response => {
    if (!/^https:\/\/www\.instagram\.com\/(api\/|graphql)/.test(response.url())) return
    try { bodies.push(...parseBodies(await response.text())) } catch { /* Body unavailable. */ }
  })
  // keepScrolling() decides after each scroll whether older pages are still worth loading.
  const visit = async (url, scrolls, keepScrolling = () => true) => {
    bodies = []
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await pause(6000, 9000)
    if (BLOCKED.test(page.url())) throw Object.assign(new Error(`인스타 확인 화면: ${page.url()}`), { blocked: true })
    const inline = await page.$$eval('script[type="application/json"]', nodes => nodes.map(node => node.textContent || '')).catch(() => [])
    for (const text of inline) if (/"code"/.test(text)) bodies.push(...parseBodies(text))
    for (let i = 0; i < scrolls && keepScrolling(bodies); i += 1) { await page.mouse.wheel(0, 2200); await pause(3000, 5000) }
    return bodies
  }
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400000)
  // Keep loading a reels tab until the oldest reel seen is older than 3 months.
  const reachesCutoff = captured => {
    const media = new Map()
    captured.forEach(body => collectMedia(body, media))
    const dates = [...media.keys()].map(postedAt).filter(Boolean)
    return !dates.length || Math.min(...dates) >= cutoff.getTime()
  }
  const queue = dry ? [] : await loadQueue()
  const queued = new Set(queue.map(row => row.username))
  let fatal = null
  try {
    await visit('https://www.instagram.com/', 0)
    if (!(await loggedIn(context))) throw Object.assign(new Error('수집 전용 크롬의 인스타 로그인이 풀렸습니다. login을 다시 실행하세요.'), { blocked: true })
    // 1) Keyword searches find candidate accounts; views are verified on each reels tab.
    // Order: weekly revisits of approved accounts, then queued suggestions, then keyword finds.
    const candidates = new Map()
    for (const username of plan.recheckAccounts || []) candidates.set(username, '재방문')
    for (const row of queue) if (!skip.has(row.username) && !candidates.has(row.username)) candidates.set(row.username, row.source)
    // Keyword finds are interleaved one account per keyword, so every category gets
    // reels-tab visits even when the daily account limit is smaller than the finds.
    const perKeyword = []
    for (const { keyword, region } of plan.keywords) {
      const media = new Map()
      for (const body of await visit(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`, 3)) collectMedia(body, media)
      stats.keywords += 1
      const owners = [...new Set([...media.values()].sort((a, b) => (b.views || 0) - (a.views || 0))
        .map(item => item.owner?.toLowerCase()).filter(owner => owner && !skip.has(owner)))]
      perKeyword.push({ source: `${region === 'overseas' ? '해외' : '국내'} 키워드:${keyword}`, owners })
      await log(`키워드 "${keyword}": 후보 계정 ${owners.length}개`)
      await pause(8000, 15000)
    }
    for (let i = 0; perKeyword.some(k => i < k.owners.length); i += 1) {
      for (const { source, owners } of perKeyword) if (owners[i] && !candidates.has(owners[i])) candidates.set(owners[i], source)
    }
    // 2) Each account's reels tab gives play counts, likes, comments and thumbnails.
    for (const [username, source] of [...candidates].slice(0, plan.maxAccounts)) {
      try {
        const captured = await visit(`https://www.instagram.com/${username}/reels/`, 8, reachesCutoff)
        const suggested = new Set()
        captured.forEach(body => findSuggested(body, suggested))
        suggested.delete(username)
        const media = new Map()
        let profile = null
        for (const body of captured) { collectMedia(body, media); profile ||= findProfile(body, username) }
        if (!profile || profile.is_private) { await log(`@${username}: 프로필 없음 또는 비공개, 건너뜀`); continue }
        const reels = [...media.values()].filter(item => (!item.owner || item.owner.toLowerCase() === username) && item.clip && item.views)
          .slice(0, 120).map(({ code, views, likes, comments, caption, audio, thumbnailUrl }) => ({ shortcode: code, views, likes, comments, caption, audio, thumbnailUrl }))
        const hits = reels.filter(r => r.views >= MIN_VIEWS && postedAt(r.shortcode) >= new Date(Date.now() - MAX_AGE_DAYS * 86400000))
        stats.accounts += 1
        stats.qualified += hits.length
        const account = { username, fullName: profile.full_name || '', biography: profile.biography || '',
          followers: num(profile.follower_count) ?? num(profile.edge_followed_by?.count), externalUrl: profile.external_url || null,
          isPrivate: profile.is_private === true, isVerified: profile.is_verified === true, categoryName: profile.category_name || '' }
        if (dry) {
          const huge = account.followers >= 5000000 ? ' ← 초대형 계정, 실제 수집 때 제외' : ''
          await log(`@${username} (팔로워 ${account.followers ?? '?'}): 릴스 ${reels.length}개 중 50만+·3개월 ${hits.length}개, 추천 계정 ${suggested.size}개${huge}`)
          for (const hit of hits) await log(`   ${hit.shortcode} 조회 ${hit.views} 좋아요 ${hit.likes} 댓글 ${hit.comments} 날짜 ${postedAt(hit.shortcode).toISOString().slice(0, 10)} 썸네일 ${hit.thumbnailUrl ? '있음' : '없음'} 음원 ${hit.audio || '-'}`)
        } else {
          const result = await api(config, 'POST', '/success-reels/accounts', { account, reels, source })
          stats.saved += result.saved || 0
          if (result.eligible) {
            if (hits.length) stats.eligible += 1
            for (const name of suggested) if (!skip.has(name) && !queued.has(name)) { queued.add(name); queue.push({ username: name, source: `추천 계정:@${username}` }) }
          }
          await log(hits.length ? `@${username}: 50만+ ${hits.length}개, 저장 ${result.saved}, ${result.eligible ? '공개' : `비공개(${result.reason})`}`
            : `@${username}: 50만+ 없음`)
        }
      } catch (error) {
        if (error.blocked) throw error
        stats.errors += 1
        await log(`@${username}: 오류 ${error.message}`)
      }
      queue.splice(0, queue.length, ...queue.filter(row => row.username !== username))
      await pause(20000, 40000)
    }
  } catch (error) {
    fatal = error.message
    await log(`⚠️ 수집 중단: ${error.message}`)
  }
  await context.close()
  if (!dry) await saveQueue(queue)
  stats.queued = queue.length
  await log(`완료: ${JSON.stringify(stats)}`)
  if (run) await api(config, 'PATCH', `/success-reels/runs/${run.id}`, { stats, error: fatal }).catch(() => {})
  if (fatal) process.exitCode = 1
}

const [command, ...args] = process.argv.slice(2)
if (command === 'login') await login()
else if (command === 'probe') await probe(args[0] || '피부관리', args[1] || 'ojirapper_')
else if (command === 'collect') await collect(args[0] === '--dry', args.slice(1))
else console.log('사용법: node collector.mjs login | probe [키워드] [계정] | collect [--dry 키워드...]  (--dry는 서버 심사 없이 숫자만 확인)')
