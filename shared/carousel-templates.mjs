// The carousel templates' facts both sides need: the server uses them to split a plan into slides that fit, the
// browser to lay the slides out (frontend/src/studio/carousel/templates.js adds colours, fonts and drawing).
// limits: how much text still reads well (checked by drawing every template at its limit, with a photo where the
// slide can carry one). lineChars: letters that fit on one line of a body slide at its usual size (measured on the
// drawn slide), so a line written within it is not broken again. images: photo slots per slide by role.
export const CAROUSEL_TEMPLATES = [
  { id: 'dark-accent', name: '검정 + 포인트 색', description: '주장·노하우처럼 한마디가 센 글',
    images: { cover: 1, body: 0, last: 0 }, imageRequired: false,
    limits: { cover: { heading: 24 }, body: { heading: 16, text: 110, lines: 6, lineChars: 15 }, last: { text: 40 } } },
  { id: 'split', name: '위아래 반반', description: '오해와 진실, 전과 후처럼 두 가지를 맞세우는 글',
    images: { cover: 1, body: 2, last: 1 }, imageRequired: true,
    limits: { cover: { heading: 20 }, body: { heading: 0, text: 44, lines: 2, lineChars: 19 }, last: { text: 36 } } },
  { id: 'note', name: '흰 배경 노트', description: '정보·팁을 번호 붙여 정리하는 글',
    images: { cover: 0, body: 1, last: 0 }, imageRequired: false,
    limits: { cover: { heading: 26 }, body: { heading: 18, text: 140, lines: 7, lineChars: 26 }, last: { text: 44 } } },
  { id: 'photo-center', name: '배경 그림 + 가운데 글', description: '에세이·감성 글처럼 한 장에 몇 줄만 두는 글',
    images: { cover: 1, body: 1, last: 1 }, imageRequired: true,
    limits: { cover: { heading: 22 }, body: { heading: 14, text: 80, lines: 5, lineChars: 18 }, last: { text: 36 } } },
  { id: 'blog', name: '블로그 글형', description: '긴 노하우·후기처럼 문단으로 풀어 쓰는 글',
    images: { cover: 0, body: 1, last: 0 }, imageRequired: false,
    limits: { cover: { heading: 30 }, body: { heading: 20, text: 150, lines: 7, lineChars: 28 }, last: { text: 48 } } },
  { id: 'card', name: '짧은 글 카드형', description: '한마디, 이어 쓰는 짧은 글',
    images: { cover: 0, body: 0, last: 0 }, imageRequired: false,
    limits: { cover: { heading: 28 }, body: { heading: 0, text: 120, lines: 6, lineChars: 18 }, last: { text: 44 } } },
]
export const CAROUSEL_TEMPLATE_IDS = CAROUSEL_TEMPLATES.map(t => t.id)
export const carouselTemplate = id => CAROUSEL_TEMPLATES.find(t => t.id === id) || CAROUSEL_TEMPLATES[0]
export const CAROUSEL_RATIOS = { '4:5': [1080, 1350], '3:4': [1080, 1440] }
// The small line above the cover title stays on one line in every template up to this many letters.
export const COVER_KICKER_LIMIT = 18
// A cover title is written before a template is chosen: this many letters fit most templates' covers in two lines.
export const COVER_TITLE_LIMIT = 24
// Instagram allows twenty images in one post.
export const MAX_CAROUSEL_SLIDES = 20
// Text length as the student sees it: emphasis markers and line breaks are not letters.
export const slideLength = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().length
// Written lines of a body slide that the slide would have to break again (a few letters over still fit: the drawing
// shrinks the text a little to keep a written line whole).
export const longLines = (templateId, slide) => { const limit = carouselTemplate(templateId).limits.body
  return slide.role === 'body' ? String(slide.text || '').split('\n').filter(line => slideLength(line) > limit.lineChars + 3) : [] }
export const slideOverflows = (templateId, slide) => {
  const limit = carouselTemplate(templateId).limits[slide.role === 'cover' ? 'cover' : slide.role === 'last' ? 'last' : 'body']
  if (slide.role === 'cover') return slideLength(slide.heading) > limit.heading || slideLength(slide.text) > COVER_KICKER_LIMIT
  if (slide.role === 'last') return slideLength(slide.text) > limit.text
  return slideLength(slide.text) > limit.text || String(slide.text || '').split('\n').filter(l => l.trim()).length > limit.lines || (limit.heading > 0 && slideLength(slide.heading) > limit.heading)
}
