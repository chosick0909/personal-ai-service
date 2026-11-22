import test from 'node:test'
import assert from 'node:assert/strict'
import { carouselAnalysisSchema, validateCarouselAnalysis, carouselSlides, runCarouselAnalysis } from '../src/creator-tools/success-carousel-analysis.js'
import { runReelAnalysis } from '../src/creator-tools/success-reel-analysis.js'
import { lookupResult, MAX_SLIDES } from '../src/creator-tools/instagram-lookup.js'
import { isCarousel, postUrl } from '../src/creator-tools/success-reels.js'

const CDN = n => `https://scontent.cdninstagram.com/slide-${n}.jpg`
const answer = count => ({
  overview: { summary: '정보형 캐러셀. 다섯 가지를 한 장씩 보여 준다.', topic: '주말 독서', ideaSeed: '한 장에 한 권', uniqueAngle: '읽는 순서를 정해 준다', evidence: ['판매 순위'] },
  cover: { title: '주말에 읽을 책 5권', formula: '[때]에 [할 것] [숫자]', visual: '사진 위 큰 글씨', analysis: '숫자가 끝을 약속한다', apply: ['때를 정한다'] },
  structure: { category: '리스트', description: '한 장에 하나씩', analysis: '번호가 다음 장을 부른다', apply: ['번호를 붙인다'],
    slides: Array.from({ length: count }, (_, i) => ({ n: i + 1, role: i === 0 ? 'cover' : i === count - 1 ? 'cta' : 'method', text: `${i + 1}번 글`, turn: i === count - 1 ? '없음' : '번호' })) },
  design: { frame: '위 사진, 아래 글', background: '흰색', emphasis: '색 띠', textAmount: '3줄', imageUse: '책 표지 사진', colors: ['#ffffff', '검정', '#FF3B30'], guide: ['여백을 넓게'] },
  closing: { text: '저장해 두세요', cta: '저장', analysis: '다시 볼 이유를 준다' },
  caption: { firstLine: '질문', structure: '세 줄', cta: '저장 유도', hashtags: '5개', analysis: '표지를 받친다' },
  category: '기타', region: 'domestic',
})

// One carousel row, a slide cache and the calls made, standing in for the database, Redis and the model.
function setup({ slides = [CDN(1), CDN(2), CDN(3)], cached = true, lookups = [] } = {}) {
  const row = { shortcode: 'Card0001', caption: '', likes: 1200, comments: 30, category: null, region: null, analysis: { kind: 'carousel', slideCount: slides.length }, analysis_status: 'running' }
  const db = { from: () => { let patch = null; const api = { select: () => api, eq: () => api, single: () => api, maybeSingle: () => api, update: p => { patch = p; return api },
    then: resolve => { if (patch) Object.assign(row, patch); resolve({ data: patch ? null : { ...row, kind: row.analysis?.kind }, error: null }) } }; return api } }
  const store = new Map(cached ? [['success-carousel-slides:Card0001', JSON.stringify(slides)]] : [])
  const redis = { get: async key => store.get(key) ?? null, set: async (key, value) => { store.set(key, value) }, del: async key => { store.delete(key) } }
  const calls = []
  const makeProviders = () => ({
    instagramReel: async url => { calls.push(['lookup', url]); return lookups.shift() || { slides, caption: '인스타 캡션' } },
    json: async (operation, _prompt, input, frames, schema) => { calls.push(['json', operation, input, frames.map(f => f.label), schema]); return answer(frames.length) },
  })
  return { row, db, redis, store, calls, makeProviders }
}

test('the Mac mini may report a carousel\'s slide images: only Instagram image links, at most twenty', () => {
  const many = Array.from({ length: 25 }, (_, i) => CDN(i))
  assert.equal(lookupResult({ slides: many }).slides.length, MAX_SLIDES)
  assert.deepEqual(lookupResult({ slides: [CDN(1), 'https://evil.example/x.jpg', 'http://scontent.cdninstagram.com/plain.jpg', 5] }).slides, [CDN(1)])
  assert.deepEqual(lookupResult({ videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }).slides, [])
  assert.equal(postUrl('Card0001', true), 'https://www.instagram.com/p/Card0001/')
  assert.equal(postUrl('Reel0001'), 'https://www.instagram.com/reel/Reel0001/')
})

test('a carousel analysis keeps one entry per slide in order, drops colours that are not colour codes, and refuses an answer that skipped most slides', () => {
  const raw = answer(5)
  raw.structure.slides = [raw.structure.slides[4], raw.structure.slides[0], raw.structure.slides[2], { n: 9, role: 'method', text: '없는 장', turn: '' }]
  const analysis = validateCarouselAnalysis(raw, 5)
  assert.deepEqual(analysis.structure.slides.map(s => [s.n, s.role, s.text]), [[1, 'cover', '1번 글'], [2, 'other', ''], [3, 'method', '3번 글'], [4, 'other', ''], [5, 'cta', '5번 글']])
  assert.deepEqual(analysis.design.colors, ['#FFFFFF', '#FF3B30'])
  assert.equal(analysis.closing.cta, '저장')
  raw.structure.slides = raw.structure.slides.slice(0, 2)
  assert.equal(validateCarouselAnalysis(raw, 5), null)
  assert.equal(validateCarouselAnalysis({ ...answer(3), overview: { summary: '', topic: '' } }, 3), null)
  assert.deepEqual(carouselAnalysisSchema.required.slice(0, 6), ['overview', 'cover', 'structure', 'design', 'closing', 'caption'])
})

test('a carousel is analysed from every slide image in order, with the slide links the link fetch just read', async () => {
  const { row, db, redis, calls, makeProviders } = setup()
  await runCarouselAnalysis({ db, redis, makeProviders, readImage: async url => `data:image/jpeg;base64,${Buffer.from(url).toString('base64')}` }, 'Card0001')
  assert.deepEqual(calls.map(c => c[0]), ['json'])
  const [, operation, input, labels] = calls[0]
  assert.equal(operation, 'studio-carousel-analysis')
  assert.deepEqual(labels, ['1장', '2장', '3장'])
  assert.deepEqual(input, { caption: '', slideCount: 3, metrics: { likes: 1200, comments: 30 } })
  assert.equal(row.analysis_status, 'ready')
  assert.ok(isCarousel(row.analysis))
  assert.equal(row.analysis.slideCount, 3)
  assert.equal(row.analysis.cover.title, '주말에 읽을 책 5권')
  assert.equal(row.analysis.structure.slides.length, 3)
  assert.equal(row.region, 'domestic')
  assert.equal(row.category, null)
})

test('with no slide links kept, the Mac mini reads the post again; a slide image that will not load gets one fresh read, then the analysis fails rather than skip a slide', async () => {
  const first = setup({ cached: false })
  assert.deepEqual((await carouselSlides({ providers: first.makeProviders(), redis: first.redis }, 'Card0001')).urls, [CDN(1), CDN(2), CDN(3)])
  assert.deepEqual(first.calls, [['lookup', 'https://www.instagram.com/p/Card0001/']])
  assert.ok(first.store.has('success-carousel-slides:Card0001'))

  const expired = setup({ slides: ['https://scontent.cdninstagram.com/old-1.jpg', 'https://scontent.cdninstagram.com/old-2.jpg'], lookups: [{ slides: [CDN(1), CDN(2)], caption: '새 캡션' }] })
  await runCarouselAnalysis({ db: expired.db, redis: expired.redis, makeProviders: expired.makeProviders, readImage: async url => { if (url.includes('old-2')) throw new Error('410'); return 'data:image/jpeg;base64,AAAA' } }, 'Card0001')
  assert.deepEqual(expired.calls.map(c => c[0]), ['lookup', 'json'])
  assert.equal(expired.row.analysis_status, 'ready')
  assert.equal(expired.row.caption, '새 캡션')

  const dead = setup()
  await runCarouselAnalysis({ db: dead.db, redis: dead.redis, makeProviders: dead.makeProviders, readImage: async url => { if (url.endsWith('slide-2.jpg')) throw new Error('410'); return 'data:image/jpeg;base64,AAAA' } }, 'Card0001')
  assert.equal(dead.row.analysis_status, 'failed')
  assert.match(dead.row.analysis_error, /캐러셀 이미지/)
  assert.ok(!dead.calls.some(c => c[0] === 'json'))
  assert.deepEqual(dead.row.analysis, { kind: 'carousel', slideCount: 3 })
})

test('an analysis request for a carousel row runs the carousel analysis, not the video one', async () => {
  const { row, db, redis, calls, makeProviders } = setup()
  // The real image reader refuses these made-up links, so the run ends as a failed carousel analysis:
  // enough to see which analysis was chosen, without the network.
  await runReelAnalysis({ db, redis, makeProviders }, 'Card0001')
  assert.equal(row.analysis_status, 'failed')
  assert.match(row.analysis_error, /캐러셀 이미지/)
  assert.ok(isCarousel(row.analysis))
  assert.ok(!calls.some(c => c[0] === 'json'))
})
