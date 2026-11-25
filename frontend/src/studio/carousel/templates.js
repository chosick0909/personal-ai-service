// Carousel templates as data. What both the server and the browser must agree on (ids, names, photo slots, text
// limits) lives in shared/carousel-templates.mjs; this file adds what only drawing needs: colours and fonts.
import { CAROUSEL_RATIOS, CAROUSEL_TEMPLATES } from '../../../../shared/carousel-templates.mjs'

export const RATIOS = CAROUSEL_RATIOS

const GOOGLE = spec => `https://fonts.googleapis.com/css2?family=${spec}&display=swap`

// Only OFL fonts served from a CDN. `weights` are the weights the family really ships (a template asks for a role,
// not a number, so a one-weight font never gets a faked bold); `scale` evens out fonts that draw small for their size.
export const FONTS = [
  { key: 'pretendard', label: '프리텐다드', family: 'Pretendard Variable',
    css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
    weights: { regular: 500, bold: 700, heavy: 800 }, scale: 1 },
  { key: 'noto-sans', label: '노토 산스', family: 'Noto Sans KR', css: GOOGLE('Noto+Sans+KR:wght@400;700;900'),
    weights: { regular: 400, bold: 700, heavy: 900 }, scale: 1 },
  { key: 'noto-serif', label: '노토 세리프 (명조)', family: 'Noto Serif KR', css: GOOGLE('Noto+Serif+KR:wght@500;700;900'),
    weights: { regular: 500, bold: 700, heavy: 900 }, scale: 1 },
  { key: 'nanum-myeongjo', label: '나눔명조', family: 'Nanum Myeongjo', css: GOOGLE('Nanum+Myeongjo:wght@400;700;800'),
    weights: { regular: 400, bold: 700, heavy: 800 }, scale: 1 },
  { key: 'gowun-batang', label: '고운바탕', family: 'Gowun Batang', css: GOOGLE('Gowun+Batang:wght@400;700'),
    weights: { regular: 400, bold: 700, heavy: 700 }, scale: 1.02 },
  { key: 'black-han-sans', label: '검은고딕', family: 'Black Han Sans', css: GOOGLE('Black+Han+Sans'),
    weights: { regular: 400, bold: 400, heavy: 400 }, scale: 1.04 },
  { key: 'gaegu', label: '개구', family: 'Gaegu', css: GOOGLE('Gaegu:wght@400;700'),
    weights: { regular: 400, bold: 700, heavy: 700 }, scale: 1.16 },
]

export const fontOf = key => FONTS.find(f => f.key === key) || FONTS[0]

const LOOKS = {
  'dark-accent': { colors: { background: '#0E0E10', text: '#FFFFFF', accent: '#FF4D3D' }, fonts: { heading: 'pretendard', body: 'pretendard' } },
  split: { colors: { background: '#101010', text: '#FFFFFF', accent: '#FFD84D' }, fonts: { heading: 'pretendard', body: 'pretendard' } },
  note: { colors: { background: '#FFFFFF', text: '#1B1B1B', accent: '#FFE14D' }, fonts: { heading: 'noto-serif', body: 'pretendard' } },
  'photo-center': { colors: { background: '#17171A', text: '#FFFFFF', accent: '#F3DFB8' }, fonts: { heading: 'gowun-batang', body: 'gowun-batang' } },
  blog: { colors: { background: '#FFFFFF', text: '#212529', accent: '#12B886' }, fonts: { heading: 'pretendard', body: 'pretendard' } },
  card: { colors: { background: '#FFFFFF', text: '#15171A', accent: '#4C6EF5' }, fonts: { heading: 'pretendard', body: 'pretendard' } },
  'photo-dark': { colors: { background: '#1E1E1E', text: '#FFFFFF', accent: '#F9DD5B' }, fonts: { heading: 'pretendard', body: 'pretendard' } },
  'grid-memo': { colors: { background: '#F7F7F4', text: '#1A1A1A', accent: '#1A1A1A' }, fonts: { heading: 'noto-serif', body: 'gowun-batang' } },
  'list-card': { colors: { background: '#000000', text: '#FFFFFF', accent: '#A3161C' }, fonts: { heading: 'pretendard', body: 'pretendard' } },
}

export const TEMPLATES = CAROUSEL_TEMPLATES.map(t => ({ ...t, ...(LOOKS[t.id] || LOOKS['dark-accent']) }))

export const templateOf = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0]
