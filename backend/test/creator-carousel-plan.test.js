import test from 'node:test'
import assert from 'node:assert/strict'
import { companionPlan, normalizeCarouselSources } from '../src/creator-tools/studio/carousel.js'

const PLAN_ID = '3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f'
const SESSION = { id: PLAN_ID, title: '퇴근 후 구움과자', topic: { title: '퇴근 후 구움과자 주문 제작' },
  thumbnail: { options: [{ text: '퇴근 후 2시간' }], chosen: 0, custom: '오븐 하나로 시작' },
  hook: { options: [{ spoken: '저는 퇴근하고 과자를 굽습니다' }], chosen: 0 },
  script: { options: [{ lines: [{ part: 'hook', spoken: '저는 퇴근하고 과자를 굽습니다' }, { part: 'body', spoken: '첫 달 주문은 [주문 수]건이었어요' }] }], chosen: 0, edited: null },
  caption: { options: [{ text: '퇴근 후 2시간의 기록', hashtags: ['부업'] }], chosen: 0 } }
function db(rows) {
  const asked = []
  return { asked, from: table => { const filters = {}; const api = { select: () => api, eq: (k, v) => { filters[k] = v; return api }, maybeSingle: () => api,
    then: resolve => { asked.push({ table, ...filters }); resolve({ data: rows.find(r => r.id === filters.id && r.user_id === filters.user_id) || null, error: null }) } }; return api } }
}

test('a carousel source list keeps the reel plan it was started from, and only a real plan id', () => {
  assert.deepEqual(normalizeCarouselSources({ structure: { id: 'ABCdef_12' }, plan: { id: PLAN_ID.toUpperCase() } }), { structure: { id: 'ABCdef_12' }, plan: { id: PLAN_ID } })
  assert.deepEqual(normalizeCarouselSources({ plan: { id: 'not-a-plan' } }), {})
  assert.deepEqual(normalizeCarouselSources(null), {})
})

test('the reel plan is read as the student has it now, and only from their own plans', async () => {
  const rows = [{ ...SESSION, user_id: 'u1' }]
  const plan = await companionPlan(db(rows), { user_id: 'u1', sources: { plan: { id: PLAN_ID } } })
  assert.equal(plan.id, PLAN_ID)
  assert.equal(plan.input.thumbnail, '오븐 하나로 시작', 'the cover copy the student wrote wins over the option')
  assert.equal(plan.input.firstLine, '저는 퇴근하고 과자를 굽습니다')
  assert.deepEqual(plan.input.script, ['저는 퇴근하고 과자를 굽습니다', '첫 달 주문은 [주문 수]건이었어요'])
  assert.equal(plan.input.caption, '퇴근 후 2시간의 기록')
  assert.match(plan.input.note, /같은 이야기/)
  assert.ok(plan.text.includes('첫 달 주문은'), 'its words count as the student\'s own when quoted')
  const edited = await companionPlan(db([{ ...SESSION, user_id: 'u1', script: { ...SESSION.script, edited: [{ spoken: '고친 대본' }] } }]), { user_id: 'u1', sources: { plan: { id: PLAN_ID } } })
  assert.deepEqual(edited.input.script, ['고친 대본'])
  assert.equal(await companionPlan(db(rows), { user_id: 'someone-else', sources: { plan: { id: PLAN_ID } } }), null)
  assert.equal(await companionPlan(db(rows), { user_id: 'u1', sources: {} }), null)
})
