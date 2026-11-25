// Carousel templates as data. What both the server and the browser must agree on (ids, names, photo slots, text
// limits) lives in shared/carousel-templates.mjs; this file adds what only drawing needs: colours and fonts.
import { CAROUSEL_RATIOS, CAROUSEL_TEMPLATES } from '../../../../shared/carousel-templates.mjs'

export const RATIOS = CAROUSEL_RATIOS

const GOOGLE = spec => `https://fonts.googleapis.com/css2?family=${spec}&display=swap`

const NAVER = path => `https://hangeul.pstatic.net/hangeul_static/webfont/${path}.woff2`

// Only fonts under the SIL Open Font License (free for commercial use and web embedding), served from a CDN: Google
// Fonts, the Pretendard author's release, or Naver's own webfont server. `css` is a stylesheet to load; `faces` lists
// one file per weight for families published that way. `weights` are the weights the family really ships (a template
// asks for a role, not a number, so a one-weight font never gets a faked bold); `scale` evens out fonts that draw
// small for their size. `group` sorts the picker. The choice follows what the 추천 carousels use (checked by eye on
// all fourteen, 2026-11-25): mostly plain gothic in several weights, serif for magazine and quote titles.
export const FONTS = [
  { key: 'pretendard', label: '프리텐다드', group: '고딕', family: 'Pretendard Variable',
    css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
    weights: { regular: 500, bold: 700, heavy: 800 }, scale: 1 },
  { key: 'noto-sans', label: '노토 산스', group: '고딕', family: 'Noto Sans KR', css: GOOGLE('Noto+Sans+KR:wght@400;700;900'),
    weights: { regular: 400, bold: 700, heavy: 900 }, scale: 1 },
  { key: 'ibm-plex', label: 'IBM 플렉스 산스', group: '고딕', family: 'IBM Plex Sans KR', css: GOOGLE('IBM+Plex+Sans+KR:wght@400;600;700'),
    weights: { regular: 400, bold: 600, heavy: 700 }, scale: 1 },
  { key: 'nanum-square-round', label: '나눔스퀘어라운드', group: '고딕', family: 'NanumSquareRound HookAI',
    faces: { 400: NAVER('NanumSquareRound/NanumSquareRoundR'), 700: NAVER('NanumSquareRound/NanumSquareRoundB'), 800: NAVER('NanumSquareRound/NanumSquareRoundEB') },
    weights: { regular: 400, bold: 700, heavy: 800 }, scale: 1 },
  { key: 'gowun-dodum', label: '고운돋움', group: '고딕', family: 'Gowun Dodum', css: GOOGLE('Gowun+Dodum'),
    weights: { regular: 400, bold: 400, heavy: 400 }, scale: 1.02 },
  { key: 'black-han-sans', label: '검은고딕', group: '제목용', family: 'Black Han Sans', css: GOOGLE('Black+Han+Sans'),
    weights: { regular: 400, bold: 400, heavy: 400 }, scale: 1.04 },
  { key: 'do-hyeon', label: '도현', group: '제목용', family: 'Do Hyeon', css: GOOGLE('Do+Hyeon'),
    weights: { regular: 400, bold: 400, heavy: 400 }, scale: 1.06 },
  { key: 'noto-serif', label: '노토 세리프 (명조)', group: '명조', family: 'Noto Serif KR', css: GOOGLE('Noto+Serif+KR:wght@500;700;900'),
    weights: { regular: 500, bold: 700, heavy: 900 }, scale: 1 },
  { key: 'maru-buri', label: '마루 부리', group: '명조', family: 'MaruBuri HookAI',
    faces: { 400: NAVER('MaruBuri/MaruBuri-Regular'), 600: NAVER('MaruBuri/MaruBuri-SemiBold'), 700: NAVER('MaruBuri/MaruBuri-Bold') },
    weights: { regular: 400, bold: 600, heavy: 700 }, scale: 1 },
  { key: 'nanum-myeongjo', label: '나눔명조', group: '명조', family: 'Nanum Myeongjo', css: GOOGLE('Nanum+Myeongjo:wght@400;700;800'),
    weights: { regular: 400, bold: 700, heavy: 800 }, scale: 1 },
  { key: 'hahmlet', label: '함렛', group: '명조', family: 'Hahmlet', css: GOOGLE('Hahmlet:wght@400;700;900'),
    weights: { regular: 400, bold: 700, heavy: 900 }, scale: 1 },
  { key: 'gowun-batang', label: '고운바탕', group: '명조', family: 'Gowun Batang', css: GOOGLE('Gowun+Batang:wght@400;700'),
    weights: { regular: 400, bold: 700, heavy: 700 }, scale: 1.02 },
  { key: 'song-myung', label: '송명', group: '명조', family: 'Song Myung', css: GOOGLE('Song+Myung'),
    weights: { regular: 400, bold: 400, heavy: 400 }, scale: 1.04 },
  { key: 'gaegu', label: '개구', group: '손글씨', family: 'Gaegu', css: GOOGLE('Gaegu:wght@400;700'),
    weights: { regular: 400, bold: 700, heavy: 700 }, scale: 1.16 },
]
export const FONT_GROUPS = [...new Set(FONTS.map(f => f.group))]

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
