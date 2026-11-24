import test from 'node:test'
import assert from 'node:assert/strict'
import { generateCarouselStage, applyCarouselPatch, normalizeSlides, normalizeDesign, chosenCover, chosenBody, nextCarouselStage, normalizeCarouselSources, resolveCarouselSources, publicCarousel } from '../src/creator-tools/studio/carousel.js'
import { carouselMakerEnabled } from '../src/creator-tools/studio/access.js'
import { IMAGE_TIERS, generateImage, monthlyAllowance, storeImage, designImages } from '../src/creator-tools/studio/carousel-images.js'
import { CAROUSEL_TEMPLATES, slideOverflows, slideLength, MAX_CAROUSEL_SLIDES } from '../../shared/carousel-templates.mjs'

const BRIEF = '퇴근 후 2시간으로 구움과자 주문 제작을 시작한 이야기. 집 오븐으로 시작했다.'
const TOPIC = { title: '퇴근 후 구움과자 주문 제작', category: '부업', categoryChecked: true, brief: BRIEF, requests: [], research: { subject: '구움과자 주문 제작', facts: ['집 오븐으로 시작했다'], viewerQuestions: [], avoid: [], brief: BRIEF } }
// A carousel row, the tables the engine reads and the model's answers by operation.
function setup({ row = {}, answers = {}, reels = {} } = {}) {
  const carousel = { id: 'c1', user_id: 'u1', stage: 'cover', brief: BRIEF, sources: {}, topic: TOPIC, cover: null, body: null, slides: null, design: null, caption: null, style_snapshot: null, ...row }
  const calls = []
  const db = { from: table => { let patch = null; const api = { select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api, single: () => api, maybeSingle: () => api, update: p => { patch = p; return api },
    then: resolve => { if (table === 'studio_carousels' && patch) Object.assign(carousel, patch)
      resolve({ data: table === 'studio_carousels' ? carousel : table === 'creator_success_reels' ? reels.row || null : null, error: null }) } }; return api } }
  const makeProviders = () => ({ json: async (operation, prompt, input) => { calls.push({ operation, prompt, input }); const answer = answers[operation]; return typeof answer === 'function' ? answer(input, calls.filter(c => c.operation === operation).length) : answer } })
  return { carousel, db, calls, deps: { db, makeProviders } }
}
const coverAnswer = { plan: { terms: [{ word: '구움과자', meaning: '오븐에 구워 만드는 과자' }], purpose: '퇴근 후 구움과자 주문 제작을 시작한 경험을 나눈다', quotes: ['집 오븐으로 시작했다'], reader: '부업을 찾는 직장인', promise: '집에 있는 것으로 시작하는 법' },
  options: [{ label: '결과 약속', kicker: '퇴근 후 2시간', text: '집 오븐으로 시작한 주문 제작', why: '시작 장벽이 낮아 보여서' }, { label: '없는 원칙', kicker: '', text: '오븐부터 사지 마세요', why: '뒤집어서' }], check: { unprovidedFacts: [] }, placeholders: [] }

test('the carousel maker is open to the listed accounts only, until it is opened to all', () => {
  const me = '15c6e788-7d77-4954-be5d-200c2c410dad', other = '00000000-0000-4000-8000-000000000001'
  assert.equal(carouselMakerEnabled(me, {}), true)
  assert.equal(carouselMakerEnabled(other, {}), false)
  assert.equal(carouselMakerEnabled(other, { CREATOR_CAROUSEL_MAKER_IDS: ` ${other} ` }), true)
  assert.equal(carouselMakerEnabled(other, { CREATOR_CAROUSEL_MAKER_IDS: 'all' }), true)
  assert.equal(carouselMakerEnabled(other, { CREATOR_CAROUSEL_MAKER_IDS: 'all', CREATOR_STUDIO2_ENABLED: 'false' }), false)
})

test('cover titles: three at most, each under a known principle, and a quote the student never wrote sends the draft back once', async () => {
  const { deps, calls } = setup({ answers: { 'studio-carousel-cover': (_input, n) => n === 1 ? { ...coverAnswer, plan: { ...coverAnswer.plan, quotes: ['월 300만 원을 벌었다'] } } : coverAnswer } })
  const out = await generateCarouselStage(deps, { ...setup().carousel }, 'cover')
  assert.equal(calls.length, 2)
  assert.match(calls[1].prompt, /원문에 없는 구절/)
  assert.deepEqual(out.value.options.map(o => [o.label, o.kicker, o.text]), [['결과 약속', '퇴근 후 2시간', '집 오븐으로 시작한 주문 제작'], ['', '', '오븐부터 사지 마세요']])
  assert.ok(out.value.options[0].hint)
  assert.equal(out.value.plan.promise, '집에 있는 것으로 시작하는 법')
  assert.match(calls[0].prompt, /캐러셀/)
  assert.equal(calls[0].input.topic.title, TOPIC.title)
})

test('the body is written as units in reading order; a request to redo it travels with the version it replaces', async () => {
  const cover = { options: coverAnswer.options, chosen: 0, custom: null }
  const body = { options: [{ label: '순서대로', why: '처음인 사람', units: [{ text: '오븐은 집에 있는 걸로.\n처음 석 달은 그걸로 충분했어요.' }, { text: '   ' }, { text: '주문은 지인 세 명에게서 시작.' }], closing: '저장해 두고 시작할 때 다시 보세요' }, { label: '한 줄뿐', why: '', units: [{ text: '하나' }], closing: '' }],
    check: { unprovidedFacts: [], referenceTraces: [], swipeRisks: [] }, placeholders: ['[첫 달 주문 수]'] }
  const { deps, calls, carousel } = setup({ row: { cover }, answers: { 'studio-carousel-body': body } })
  const out = await generateCarouselStage(deps, carousel, 'body', { note: '더 짧게' })
  assert.equal(out.value.options.length, 1, 'an option too short to be a body is dropped')
  assert.deepEqual(out.value.options[0].units.map(u => u.text), ['오븐은 집에 있는 걸로.\n처음 석 달은 그걸로 충분했어요.', '주문은 지인 세 명에게서 시작.'])
  assert.deepEqual(out.placeholders, ['[첫 달 주문 수]'])
  assert.equal(calls[0].input.cover.text, '집 오븐으로 시작한 주문 제작')
  assert.equal(calls[0].input.revision.request, '더 짧게')
  await assert.rejects(generateCarouselStage(setup().deps, setup().carousel, 'body'), { code: 'STAGE_ORDER' })
})

test('slides: the cover and last slide frame the body, letters are counted in code, and a slide over the limit is sent back once', async () => {
  const cover = { options: coverAnswer.options, chosen: 0, custom: null }
  const body = { options: [{ label: '순서대로', units: [{ text: '하나' }, { text: '둘' }], closing: '저장해 두세요' }], chosen: 0, edited: null }
  const long = '가'.repeat(60)
  const answer = (input, n) => ({ template: 'split', templateWhy: '두 가지를 맞세우는 글', last: { heading: '', text: '저장해 두세요' }, weak: [{ slide: 2, why: '다음 장을 넘길 이유가 없음' }, { slide: 9, why: '없는 장' }],
    slides: n === 1 ? [{ heading: '', text: `${long}\n아래 줄`, image: '오븐 앞 손' }, { heading: '', text: '위 줄\n**아래** 줄', image: '' }] : [{ heading: '', text: '짧게\n아래 줄', image: '오븐 앞 손' }, { heading: '', text: '위 줄\n**아래** 줄', image: '' }] })
  const { deps, calls, carousel } = setup({ row: { cover, body }, answers: { 'studio-carousel-slides': answer } })
  const out = await generateCarouselStage(deps, carousel, 'slides')
  assert.equal(calls.length, 2)
  assert.match(calls[1].prompt, /2번째 장이 고른 틀의 한도/)
  assert.equal(calls[1].input.currentTemplate, 'split')
  assert.deepEqual(out.value.items.map(s => [s.role, s.heading, s.text]), [['cover', '집 오븐으로 시작한 주문 제작', '퇴근 후 2시간'], ['body', '', '짧게\n아래 줄'], ['body', '', '위 줄\n**아래** 줄'], ['last', '', '저장해 두세요']])
  assert.equal(out.value.template, 'split')
  assert.deepEqual(out.value.weak.map(w => w.why), ['다음 장을 넘길 이유가 없음'])
  assert.equal(out.value.weak[0].id, out.value.items[2].id)
  assert.equal(calls[0].input.templates.length, CAROUSEL_TEMPLATES.length)
  // A template the student picked themselves is kept when the slides are split again.
  const kept = setup({ row: { cover, body, slides: { items: out.value.items, template: 'note', templateChosen: true } }, answers: { 'studio-carousel-slides': answer } })
  const again = await generateCarouselStage(kept.deps, kept.carousel, 'slides')
  assert.equal(again.value.template, 'note')
  assert.equal(kept.calls[0].input.currentTemplate, 'note')
})

test('slide text: unclosed emphasis markers are dropped, the cover comes first and the last slide last, at most twenty', () => {
  const items = normalizeSlides([{ role: 'body', text: '하나 **둘' }, { role: 'last', text: '끝' }, { role: 'cover', heading: '표지' }, { role: 'body', heading: '', text: '' }, ...Array.from({ length: 25 }, (_, i) => ({ role: 'body', text: `장 ${i}` }))])
  assert.equal(items[0].role, 'cover')
  assert.equal(items.at(-1).role, 'last')
  assert.equal(items[1].text, '하나 둘')
  assert.equal(items.length, MAX_CAROUSEL_SLIDES)
  assert.equal(new Set(items.map(s => s.id)).size, items.length)
  assert.equal(slideLength('**굵게** 두 줄\n글'), 8, 'markers and line breaks are not letters')
  assert.equal(slideOverflows('split', { role: 'body', heading: '', text: '위\n가운데\n아래' }), true, 'three lines in a two-line template')
  assert.equal(slideOverflows('note', { role: 'body', heading: '소제목', text: '위\n가운데\n아래' }), false)
})

test('the student\'s edits: a cover of their own reaches the cover slide, slides keep their cover and last slide, a design keeps only this plan\'s slides', () => {
  const row = { cover: { options: coverAnswer.options, chosen: 0, custom: null }, body: { options: [{ units: [{ text: '하나' }], closing: '끝' }], chosen: 0, edited: null },
    slides: { items: [{ id: 'aaa', role: 'cover', heading: '집 오븐으로 시작한 주문 제작', text: '' }, { id: 'bbb', role: 'body', heading: '', text: '하나' }, { id: 'ccc', role: 'last', heading: '', text: '끝' }], template: 'note', weak: [{ id: 'bbb', why: '약함' }] }, design: null, caption: null }
  const typed = applyCarouselPatch(row, { cover: { custom: '오븐부터 사면 안 되는 이유', customKicker: '구움과자 창업' } })
  assert.deepEqual(chosenCover({ cover: typed.cover }), { text: '오븐부터 사면 안 되는 이유', kicker: '구움과자 창업' })
  assert.deepEqual(typed.slides.items[0], { id: 'aaa', role: 'cover', heading: '오븐부터 사면 안 되는 이유', text: '구움과자 창업' })
  assert.throws(() => applyCarouselPatch(row, { slides: { items: [{ id: 'bbb', role: 'body', text: '하나' }] } }), { code: 'SLIDES_INVALID' })
  const split = applyCarouselPatch(row, { slides: { items: [row.slides.items[0], { role: 'body', text: '새 장' }, row.slides.items[2]], template: 'card' } })
  assert.equal(split.slides.template, 'card')
  assert.equal(split.slides.templateChosen, true)
  assert.deepEqual(split.slides.weak, [], 'a note about a slide that is gone goes with it')
  const image = '11111111-1111-4111-8111-111111111111'
  const design = applyCarouselPatch(row, { design: { template: 'nope', ratio: '3:4', colors: { accent: '#ff4d3d', text: 'red' }, handle: '@bake.note', slides: { bbb: { image: { id: image, x: 2, zoom: 9 } }, zzz: { image: { id: image } } } } }).design
  assert.deepEqual(design, { template: 'dark-accent', ratio: '3:4', colors: { accent: '#FF4D3D' }, fonts: {}, handle: '@bake.note', profileImage: null, slides: { bbb: { image: { id: image, x: 1, y: 0.5, zoom: 4 }, image2: null } } })
  assert.deepEqual(chosenBody({ body: applyCarouselPatch(row, { body: { edited: { units: [{ text: '고친 글' }, { text: '' }], closing: '저장' } } }).body }), { units: [{ text: '고친 글' }], closing: '저장' })
  assert.equal(nextCarouselStage('slides'), 'design')
  assert.equal(nextCarouselStage('done'), 'done')
  assert.equal(normalizeDesign({}, []).template, 'dark-accent')
})

test('references: a carousel lends its slide order and its design; a reel lends its flow but not a design', async () => {
  assert.deepEqual(normalizeCarouselSources({ structure: { id: 'DCwhbm9zkSn' }, design: { id: '../x' }, hook: { id: 'DCwhbm9zkSn' } }), { structure: { id: 'DCwhbm9zkSn' } })
  const carousel = { shortcode: 'Card0001', username: 'maker', caption: '원문 캡션', visible: true, analysis_status: 'ready', source: 'collector',
    analysis: { kind: 'carousel', structure: { category: '리스트', description: '번호 순서', analysis: '번호가 넘기게 함', slides: [{ n: 1, role: 'cover', text: '표지 글', turn: '질문' }] }, design: { frame: '위 사진 아래 글', colors: ['#FFFFFF'] }, caption: { firstLine: '질문' } } }
  const { db } = setup({ reels: { row: carousel } })
  const resolved = await resolveCarouselSources(db, 'u1', { structure: { id: 'Card0001' }, design: { id: 'Card0001' }, caption: { id: 'Card0001' } })
  assert.equal(resolved.structure.excerpt.kind, 'carousel')
  assert.deepEqual(resolved.structure.excerpt.slides, [{ n: 1, role: 'cover', turn: '질문', text: '표지 글' }])
  assert.equal(resolved.design.excerpt.frame, '위 사진 아래 글')
  assert.equal(resolved.caption.excerpt.original, '원문 캡션')
  assert.equal(resolved.structure.permalink, 'https://www.instagram.com/p/Card0001/')
  const reel = { ...carousel, analysis: { structure: { category: '문제-해결', steps: [{ role: 'hook', purpose: '멈추게 함', quote: '원문 문장' }] } } }
  const other = setup({ reels: { row: reel } })
  const fromReel = await resolveCarouselSources(other.db, 'u1', { structure: { id: 'Reel0001' } })
  assert.deepEqual(fromReel.structure.excerpt.steps, [{ role: 'hook', purpose: '멈추게 함' }], 'the reel\'s own sentences are not sent')
  await assert.rejects(resolveCarouselSources(other.db, 'u1', { design: { id: 'Reel0001' } }), { code: 'SOURCE_NOT_CAROUSEL' })
  assert.equal(publicCarousel({ id: 'c1', stage: 'cover', topic: TOPIC, job_status: 'idle' }).topic.research.subject, '구움과자 주문 제작')
})

test('an AI image counts against the month only once it is in hand; the request never asks the model to draw letters', async () => {
  const counts = new Map(), sent = []
  const redis = { get: async key => counts.get(key) ?? null, multi: () => { const ops = []; const m = { incrby: (key, n) => { ops.push(() => counts.set(key, (Number(counts.get(key)) || 0) + n)); return m }, expire: () => m, exec: async () => { ops.forEach(run => run()) } }; return m } }
  const providers = { call: async (_provider, _operation, fn) => fn() }
  const fetcher = async (url, options) => { sent.push({ url, body: options?.body ? JSON.parse(options.body) : null, auth: options?.headers?.Authorization })
    return url.startsWith('https://fal.run/') ? { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://v3.fal.media/files/a.jpg' }] }) } : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }
  const env = { FAL_KEY: 'test-only', CREATOR_CAROUSEL_IMAGE_ALLOWANCE: '6' }
  const made = await generateImage({ providers, redis, env, fetcher }, 'u1', { tier: 'economy', shape: '4:5', prompt: 'a warm kitchen' })
  assert.equal(made.bytes.length, 3)
  assert.equal(made.used, 1)
  assert.equal(sent[0].url, `https://fal.run/${IMAGE_TIERS.economy.endpoint}`)
  assert.deepEqual(sent[0].body.image_size, { width: 1080, height: 1350 })
  assert.match(sent[0].body.prompt, /no text, no letters/)
  assert.equal(sent[0].auth, 'Key test-only')
  await generateImage({ providers, redis, env, fetcher }, 'u1', { tier: 'standard', shape: 'half', prompt: 'a face' })
  assert.equal(sent[2].body.aspect_ratio, '3:2')
  assert.equal([...counts.values()][0], 6)
  await assert.rejects(generateImage({ providers, redis, env, fetcher }, 'u1', { tier: 'economy', shape: '4:5', prompt: 'x' }), { code: 'IMAGE_ALLOWANCE' })
  const refused = async url => url.startsWith('https://fal.run/') ? { ok: false, status: 422, json: async () => ({ detail: 'content_policy_violation' }) } : null
  await assert.rejects(generateImage({ providers, redis: { ...redis, get: async () => 0 }, env, fetcher: refused }, 'u2', { tier: 'economy', shape: '4:5', prompt: 'x' }), { code: 'IMAGE_REFUSED' })
  await assert.rejects(generateImage({ providers, redis, env: {}, fetcher }, 'u1', { tier: 'economy', shape: '4:5', prompt: 'x' }), { code: 'IMAGE_NOT_CONFIGURED' })
  assert.equal(monthlyAllowance({}), 300)
})

test('the library keeps one copy of the same file, stops at its limit, and an AI image placed in a design becomes kept', async () => {
  const rows = [], uploads = []
  const db = { storage: { from: () => ({ upload: async (path, body, options) => { uploads.push([path, body.length, options.contentType]); return { error: null } }, createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `https://signed/${path}` })), error: null }) }) },
    from: () => { const filters = []; let patch = null, inserted = null, head = false, one = false
      const match = r => filters.every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v)
      const api = { select: (_columns, options) => { head = Boolean(options?.head); return api }, eq: (k, v) => { filters.push([k, v]); return api }, in: (k, v) => { filters.push([k, v]); return api },
        maybeSingle: () => { one = true; return api }, single: () => { one = true; return api },
        insert: r => { inserted = { created_at: '2026-11-24T00:00:00Z', ...r }; rows.push(inserted); return api }, update: p => { patch = p; return api },
        then: resolve => { const found = rows.filter(match); if (patch) found.forEach(r => Object.assign(r, patch))
          resolve(head ? { count: found.length, data: null, error: null } : { data: inserted || (one ? found[0] || null : found), error: null }) } }
      return api } }
  const first = await storeImage(db, 'u1', { bytes: Buffer.from('photo'), type: 'image/jpeg', thumb: Buffer.from('t'), source: 'upload', width: 2160, height: 1440 })
  assert.match(first.path, /^u1\/[0-9a-f-]{36}\.jpg$/)
  assert.equal(uploads.length, 2)
  const again = await storeImage(db, 'u1', { bytes: Buffer.from('photo'), type: 'image/jpeg', source: 'upload' })
  assert.equal(again.duplicate, true)
  assert.equal(rows.length, 1)
  await assert.rejects(storeImage(db, 'u1', { bytes: Buffer.from('x'), type: 'image/gif', source: 'upload' }), { code: 'IMAGE_TYPE' })
  const ai = await storeImage(db, 'u1', { bytes: Buffer.from('made'), type: 'image/jpeg', source: 'ai', tier: 'economy', prompt: 'a kitchen', kept: false })
  assert.equal(ai.kept, false)
  const images = await designImages(db, 'u1', { slides: { s1: { image: { id: ai.id }, image2: null } } })
  assert.deepEqual(images[ai.id], { url: `https://signed/${ai.path}`, ai: true })
  assert.equal(rows.find(r => r.id === ai.id).kept, true)
})
