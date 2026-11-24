import { createHash, randomUUID } from 'node:crypto'
import { query } from '../store.js'
import { fail } from '../domain.js'

// 내 이미지 보관함 and AI images for the carousel maker. Photos live in a private bucket; the browser gets signed links.
export const IMAGE_BUCKET = 'studio-images'
export const LIBRARY_LIMIT = 200
const SIGN_SECONDS = 3600

// AI image tiers (see the carousel proposal): economy is the default, standard is for slides where a person's face
// matters, infographic draws a whole summary sheet with its text. `weight` is how much of the monthly allowance one
// image takes; the prices are what fal.ai charged in our own test (2026-11-20).
export const IMAGE_TIERS = {
  economy: { label: '기본', endpoint: 'fal-ai/flux-2/flash', weight: 1,
    body: (prompt, [width, height]) => ({ prompt, image_size: { width, height }, num_images: 1, output_format: 'jpeg' }) },
  standard: { label: '고화질', endpoint: 'google/nano-banana-2.1', weight: 5,
    body: (prompt, _size, aspect) => ({ prompt, aspect_ratio: aspect, resolution: '1K', num_images: 1, output_format: 'jpeg' }) },
  infographic: { label: '총정리 한 장', endpoint: 'openai/gpt-image-2.5/flare/text-to-image', weight: 5,
    body: (prompt, [width, height]) => ({ prompt, image_size: { width, height }, quality: 'high', num_images: 1, output_format: 'jpeg' }) },
}
// Where the image goes decides its shape: a whole slide, or one half of a slide split top and bottom.
export const IMAGE_SHAPES = { '4:5': { size: [1080, 1350], aspect: '4:5' }, '3:4': { size: [1080, 1440], aspect: '3:4' }, half: { size: [1080, 720], aspect: '3:2' }, sheet: { size: [1088, 1936], aspect: '9:16' } }
export const monthlyAllowance = (env = process.env) => Math.max(0, Number(env.CREATOR_CAROUSEL_IMAGE_ALLOWANCE) || 300)
const monthKey = (userId, now = Date.now()) => `carousel-ai:${userId}:${new Date(now + 9 * 3600000).toISOString().slice(0, 7)}`
export async function allowanceUsed(redis, userId, now = Date.now()) { return Number(await redis.get(monthKey(userId, now)).catch(() => 0)) || 0 }

const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const STYLES = { photo: '실제 사진처럼(자연스러운 빛, 꾸미지 않은 순간)', illustration: '손으로 그린 듯한 단순한 일러스트', texture: '글자를 올리기 좋은 질감·무늬 배경(사물 없이)' }
const promptSchema = { type: 'object', additionalProperties: false, required: ['prompt', 'person', 'blocked'], properties: { prompt: { type: 'string' }, person: { type: 'boolean' }, blocked: { type: 'string' } } }
// 훅ai writes the image request so the student only picks a mood. The picture never carries words: the editor puts
// the slide's text on top, where it can still be corrected.
const promptInstructions = `캐러셀 한 장의 배경이나 삽화로 쓸 그림을 이미지 생성 모델에 요청하는 글(prompt)을 영어로 씁니다. 입력: scene(그 장에 어울리는 장면을 한국어로 적은 것), slide(그 장의 글), topic(캐러셀 주제), style(그림의 방식), over(그림 위에 글자가 올라가는지).
- 무엇이 어디에 어떤 빛과 분위기로 있는지 한 장면만 구체적으로 적습니다. slide의 글을 그림으로 설명하려 하지 말고, 그 글을 읽는 사람이 떠올릴 장면 하나를 고릅니다.
- over가 true면 글자가 올라갈 자리가 비도록 구도를 잡습니다(사물은 한쪽이나 아래에, 나머지는 단순하게).
- 그림 안에 글자·숫자·로고·워터마크·화면 UI를 넣지 않습니다.
- 실제 인물, 연예인, 브랜드, 작품, 캐릭터의 이름이나 그것을 알아볼 수 있는 묘사는 쓰지 않습니다. scene이 그런 것을 요구하면 prompt를 비우고 blocked에 수강생에게 보여 줄 한 줄 안내(무엇 때문에 만들 수 없는지, 대신 무엇을 적으면 되는지)를 한국어로 씁니다. 문제가 없으면 blocked는 빈 문자열입니다.
- 한국에서 올리는 게시물이므로 사람·거리·집이 나오면 한국의 모습으로 적습니다.
- person: 사람의 얼굴이 화면에서 크게 보이는 장면이면 true(뒷모습·손·멀리 있는 사람은 false).`
export async function writeImagePrompt(providers, { scene, slide, topic, style, over }) {
  const raw = await providers.json('studio-carousel-image-prompt', promptInstructions, { scene: clean(scene, 300), slide: clean(slide, 400), topic: clean(topic, 200), style: STYLES[style] || STYLES.photo, over: Boolean(over) }, [], promptSchema)
  if (clean(raw?.blocked, 200)) fail('IMAGE_BLOCKED', clean(raw.blocked, 200), 422)
  const prompt = clean(raw?.prompt, 1200)
  if (!prompt) fail('IMAGE_PROMPT_EMPTY', '그림 설명을 만들지 못했어요. 장면을 조금 더 구체적으로 적어 주세요.', 422)
  return { prompt, person: raw?.person === true }
}

// One image from fal.ai. The picture is fetched and kept on our side at once: the provider's link is temporary.
export async function generateImage({ providers, redis, env = process.env, fetcher = fetch }, userId, { tier, shape, prompt }) {
  const spec = IMAGE_TIERS[tier], frame = IMAGE_SHAPES[shape]
  if (!spec || !frame) fail('IMAGE_REQUEST_INVALID', '이미지 요청을 확인해주세요.', 422)
  const key = String(env.FAL_KEY || '').trim()
  if (!key) fail('IMAGE_NOT_CONFIGURED', 'AI 이미지 연결이 아직 준비되지 않았어요.', 503)
  const allowance = monthlyAllowance(env), used = await allowanceUsed(redis, userId)
  if (used + spec.weight > allowance) fail('IMAGE_ALLOWANCE', `이번 달 AI 이미지 한도(${allowance}장)를 다 썼어요. 다음 달 1일에 다시 채워져요.`, 429)
  const text = tier === 'infographic' ? prompt : `${prompt}, no text, no letters, no numbers, no logo, no watermark`
  const result = await providers.call('fal', `studio-carousel-image-${tier}`, async () => {
    const response = await fetcher(`https://fal.run/${spec.endpoint}`, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(spec.body(text, frame.size, frame.aspect)), signal: AbortSignal.timeout(240000) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = JSON.stringify(data || {}).toLowerCase()
      // A request the provider's safety check turned down is not charged; the student is told to describe it differently.
      if (response.status === 422 || /content_policy|safety|prohibited|nsfw/.test(detail)) fail('IMAGE_REFUSED', '이 장면은 AI가 만들지 못했어요. 사람이나 브랜드를 특정하지 않는 표현으로 바꿔 다시 시도해주세요.', 422)
      throw Object.assign(new Error('fal request failed'), { status: response.status })
    }
    const url = data?.images?.[0]?.url
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) fail('IMAGE_EMPTY', '이미지를 받지 못했어요. 다시 시도해주세요.', 502)
    return { url, usage: { images: 1, tier } }
  })
  const file = await fetcher(result.url, { signal: AbortSignal.timeout(60000) })
  if (!file.ok) fail('IMAGE_EMPTY', '이미지를 받지 못했어요. 다시 시도해주세요.', 502)
  const bytes = Buffer.from(await file.arrayBuffer())
  // Counted only once the picture is in hand, so a failed or refused request costs the student nothing.
  const month = monthKey(userId)
  await redis.multi().incrby(month, spec.weight).expire(month, 40 * 86400).exec().catch(() => {})
  return { bytes, type: 'image/jpeg', width: frame.size[0], height: frame.size[1], used: used + spec.weight, allowance }
}

// ---------- library ----------
const ext = type => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[type]
export async function storeImage(db, userId, { bytes, type, thumb = null, source, tier = null, prompt = null, width = null, height = null, kept = true }) {
  if (!ext(type)) fail('IMAGE_TYPE', 'JPG, PNG, WEBP 이미지만 올릴 수 있어요.', 422)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const same = await query(db.from('studio_images').select('*').eq('user_id', userId).eq('sha256', sha256).maybeSingle())
  if (same) { if (kept && !same.kept) await query(db.from('studio_images').update({ kept: true }).eq('id', same.id)); return { ...same, kept: same.kept || kept, duplicate: true } }
  if (kept) {
    const { count } = await db.from('studio_images').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kept', true)
    if ((count || 0) >= LIBRARY_LIMIT) fail('LIBRARY_FULL', `보관함이 가득 찼어요(${LIBRARY_LIMIT}장). 안 쓰는 이미지를 지우고 다시 올려주세요.`, 409)
  }
  const id = randomUUID(), path = `${userId}/${id}.${ext(type)}`, thumbPath = thumb ? `${userId}/${id}-thumb.jpg` : null
  const bucket = db.storage.from(IMAGE_BUCKET)
  const up = await bucket.upload(path, bytes, { contentType: type, upsert: false })
  if (up.error) fail('IMAGE_STORE_FAILED', '이미지를 저장하지 못했어요. 다시 시도해주세요.', 502)
  if (thumb) await bucket.upload(thumbPath, thumb, { contentType: 'image/jpeg', upsert: false }).catch(() => {})
  return query(db.from('studio_images').insert({ id, user_id: userId, source, path, thumb_path: thumbPath, width, height, bytes: bytes.length, sha256, tier, prompt, kept }).select('*').single())
}
export async function signImages(db, rows) {
  const paths = rows.flatMap(r => [r.path, r.thumb_path]).filter(Boolean)
  const signed = paths.length ? await query(db.storage.from(IMAGE_BUCKET).createSignedUrls(paths, SIGN_SECONDS)).catch(() => []) : []
  const urls = new Map(signed.filter(s => s?.signedUrl).map(s => [s.path, s.signedUrl]))
  return rows.map(r => ({ id: r.id, source: r.source, tier: r.tier, kept: r.kept, width: r.width, height: r.height, createdAt: r.created_at, url: urls.get(r.path) || null, thumbUrl: urls.get(r.thumb_path) || urls.get(r.path) || null })).filter(r => r.url)
}
export async function listImages(db, userId, { kept = true } = {}) {
  let request = db.from('studio_images').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(LIBRARY_LIMIT + 60)
  if (kept) request = request.eq('kept', true)
  return signImages(db, await query(request))
}
// The images a design uses, by id, as links the browser can draw. Only the owner's images are returned.
export async function designImages(db, userId, design) {
  const ids = [...new Set([design?.profileImage?.id, ...Object.values(design?.slides || {}).flatMap(s => [s?.image?.id, s?.image2?.id])].filter(Boolean))]
  if (!ids.length) return {}
  const rows = await query(db.from('studio_images').select('*').eq('user_id', userId).in('id', ids))
  // An AI image placed in a design is one the student chose: it stays in the library.
  const chosen = rows.filter(r => !r.kept).map(r => r.id)
  if (chosen.length) await query(db.from('studio_images').update({ kept: true }).in('id', chosen)).catch(() => {})
  return Object.fromEntries((await signImages(db, rows)).map(r => [r.id, { url: r.url, ai: r.source === 'ai' }]))
}
export async function removeImage(db, userId, id) {
  const row = await query(db.from('studio_images').select('id,path,thumb_path').eq('user_id', userId).eq('id', id).maybeSingle())
  if (!row) fail('IMAGE_NOT_FOUND', '이미지를 찾을 수 없어요.', 404)
  await db.storage.from(IMAGE_BUCKET).remove([row.path, row.thumb_path].filter(Boolean)).catch(() => {})
  await query(db.from('studio_images').delete().eq('id', row.id))
}
// AI images nobody chose are removed after a week (see the proposal: retries pile up fastest).
export async function sweepUnkept(db, now = Date.now()) {
  const rows = await query(db.from('studio_images').select('id,path,thumb_path').eq('kept', false).lt('created_at', new Date(now - 7 * 86400000).toISOString()).limit(200))
  if (!rows.length) return 0
  await db.storage.from(IMAGE_BUCKET).remove(rows.flatMap(r => [r.path, r.thumb_path]).filter(Boolean)).catch(() => {})
  await query(db.from('studio_images').delete().in('id', rows.map(r => r.id)))
  return rows.length
}
