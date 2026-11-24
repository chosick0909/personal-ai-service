import { fail } from '../domain.js'
import { generateImage, storeImage } from './carousel-images.js'

// 총정리 한 장: one tall image that sums the carousel up. This is the only place the image model draws the words
// itself, so the words are fixed first (the student confirms them), then the picture is read back and compared.
const str = { type: 'string' }
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = items => ({ type: 'array', items })
const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''
export const SHEET_LIMITS = { title: 28, subtitle: 40, sections: 7, heading: 22, lines: 3, line: 40, footer: 30 }

export function normalizeSheet(raw) {
  const sections = (Array.isArray(raw?.sections) ? raw.sections : []).map(s => ({ heading: clean(s?.heading, SHEET_LIMITS.heading),
    lines: (Array.isArray(s?.lines) ? s.lines : []).map(l => clean(l, SHEET_LIMITS.line)).filter(Boolean).slice(0, SHEET_LIMITS.lines) })).filter(s => s.heading || s.lines.length).slice(0, SHEET_LIMITS.sections)
  return { title: clean(raw?.title, SHEET_LIMITS.title), subtitle: clean(raw?.subtitle, SHEET_LIMITS.subtitle), sections, footer: clean(raw?.footer, SHEET_LIMITS.footer) }
}
// Every piece of text the picture must carry, in reading order.
export const sheetLines = sheet => [sheet.title, sheet.subtitle, ...sheet.sections.flatMap(s => [s.heading, ...s.lines]), sheet.footer].filter(Boolean)

const draftSchema = obj({ title: str, subtitle: str, sections: arr(obj({ heading: str, lines: arr(str) })), footer: str })
const draftPrompt = `확정된 캐러셀(slides)을 세로로 긴 이미지 한 장에 정리할 글로 간추립니다. 저장해 두고 다시 꺼내 보는 요약표가 목적입니다.
- 내용은 slides에 있는 것만 씁니다. 새 사실·숫자·혜택을 더하지 않고, slides의 숫자와 고유한 표현은 그대로 둡니다.
- title: 무엇을 정리한 표인지 한눈에 알 수 있는 제목(${SHEET_LIMITS.title}자 이내). subtitle: 누구를 위한 정리인지 또는 기준이 되는 조건 한 줄(없으면 빈 문자열).
- sections: 캐러셀의 흐름을 따라 ${SHEET_LIMITS.sections}개 이내. heading은 그 묶음의 이름(${SHEET_LIMITS.heading}자 이내), lines는 그 묶음의 핵심을 ${SHEET_LIMITS.lines}줄 이내로, 한 줄은 ${SHEET_LIMITS.line}자 이내의 끊어 읽히는 말로 씁니다. 문장을 길게 잇지 않습니다.
- footer: 계정 이름이나 저장을 권하는 짧은 한 줄(${SHEET_LIMITS.footer}자 이내, 없으면 빈 문자열).
- 웹 주소, 전화번호, 기관 이름은 slides에 있더라도 넣지 않습니다.`
export async function draftSheet(providers, row) {
  if (!row.slides?.items?.length) fail('STAGE_ORDER', '슬라이드를 먼저 나눠주세요.', 409)
  const raw = await providers.json('studio-carousel-sheet-draft', draftPrompt, { topic: row.topic?.title || '', handle: row.design?.handle || '', slides: row.slides.items.map(s => ({ role: s.role, heading: clean(s.heading, 80), text: clean(s.text, 600) })) }, [], draftSchema)
  const sheet = normalizeSheet(raw)
  if (!sheet.title || !sheet.sections.length) fail('SHEET_EMPTY', '정리할 글을 만들지 못했어요. 다시 시도해주세요.', 422)
  return sheet
}

// The request names every line to draw and forbids anything else that looks like information.
export function sheetPrompt(sheet, colors = {}) {
  const body = sheet.sections.map((s, i) => `섹션 ${i + 1}\n  소제목: "${s.heading}"\n${s.lines.map(l => `  - "${l}"`).join('\n')}`).join('\n')
  return `세로 9:16 비율의 한국어 인포그래픽 한 장을 디자인해 주세요. 인스타그램에 올려 저장해 두고 보는 요약표입니다.
디자인: 깔끔하고 신뢰감 있는 편집 디자인. 여백이 넉넉하고, 제목이 가장 크고, 섹션마다 같은 틀이 반복되어 한눈에 구조가 보이게 합니다. 섹션은 번호나 단순한 선 아이콘으로 구분합니다.${colors.background ? ` 배경색은 ${colors.background},` : ''}${colors.accent ? ` 포인트 색은 ${colors.accent}로 합니다.` : ''}
아래 따옴표 안의 글자를 한 글자도 바꾸지 말고, 빠뜨리지 말고, 적힌 순서대로 그대로 넣습니다. 따옴표 자체는 그리지 않습니다.
제목: "${sheet.title}"${sheet.subtitle ? `\n부제: "${sheet.subtitle}"` : ''}
${body}${sheet.footer ? `\n맨 아래 작은 글씨: "${sheet.footer}"` : ''}
금지: 위에 적힌 것 외의 글자·숫자·문장을 추가하지 않습니다. 로고, 기관 마크, 인증 마크, QR 코드, 웹 주소, 전화번호, 사람 얼굴, 실제 브랜드를 넣지 않습니다. 같은 줄을 두 번 쓰지 않습니다.`
}

const checkSchema = obj({ lines: arr(obj({ expected: str, found: str, exact: { type: 'boolean' } })), extras: arr(str) })
const checkPrompt = `이미지에 그려진 글자를 읽어, 넣기로 한 글(expected)과 대조합니다. 판단하지 말고 보이는 글자를 그대로 읽습니다.
- lines: expected의 각 줄에 대해, 이미지에서 그 줄에 해당하는 글자를 found에 보이는 그대로 옮기고(없으면 빈 문자열), 글자가 완전히 같으면 exact를 true로 합니다. 띄어쓰기와 줄바꿈 위치의 차이는 같은 것으로 봅니다.
- extras: expected에 없는데 이미지에 그려진 글(문장, 숫자, 웹 주소, 기관 이름, QR 코드나 로고가 있으면 그 사실)을 적습니다. 섹션 번호와 장식 기호는 적지 않습니다.`
const same = (a, b) => clean(a, 200).replace(/\s+/g, '') === clean(b, 200).replace(/\s+/g, '')
// What the picture got wrong, as the student should hear it. Empty when every line is there and nothing was added.
export async function checkSheet(providers, dataUrl, sheet) {
  const expected = sheetLines(sheet)
  const raw = await providers.json('studio-carousel-sheet-check', checkPrompt, { expected }, [{ label: '만든 이미지', url: dataUrl }], checkSchema)
  const read = Array.isArray(raw?.lines) ? raw.lines : []
  // The comparison is done here, letter by letter: the reader's own "exact" is not taken on trust.
  const wrong = expected.filter(line => { const hit = read.find(r => same(r?.expected, line)); return !hit || !same(hit.found, line) }).map(line => { const hit = read.find(r => same(r?.expected, line)); return hit?.found ? `"${line}" → "${clean(hit.found, 80)}"로 그려짐` : `"${line}" 빠짐` })
  const extras = (Array.isArray(raw?.extras) ? raw.extras : []).map(e => clean(e, 80)).filter(Boolean).slice(0, 5).map(e => `넣지 않은 글이 그려짐: ${e}`)
  return [...wrong, ...extras].slice(0, 10)
}

// One sheet: drawn, read back, and drawn once more when the words came out wrong. The better of the two is kept and
// what is still wrong is told to the student, who decides whether to use it.
export async function makeSheet({ db, redis, providers, env, fetcher }, userId, raw, { colors = {}, check = checkSheet } = {}) {
  const sheet = normalizeSheet(raw)
  if (!sheet.title || !sheet.sections.length) fail('SHEET_EMPTY', '제목과 내용을 한 묶음 이상 적어주세요.', 422)
  const prompt = sheetPrompt(sheet, colors)
  const attempt = async extra => {
    const made = await generateImage({ providers, redis, env, fetcher }, userId, { tier: 'infographic', shape: 'sheet', prompt: extra ? `${prompt}\n앞서 만든 이미지에서 다음이 틀렸습니다. 이번에는 반드시 바로잡습니다: ${extra}` : prompt })
    const problems = await check(providers, `data:${made.type};base64,${made.bytes.toString('base64')}`, sheet).catch(() => ['글자를 다시 읽어 확인하지 못했어요. 직접 한 번 읽어 봐 주세요.'])
    return { made, problems }
  }
  let best = await attempt('')
  if (best.problems.length) { const again = await attempt(best.problems.join(' / ')).catch(() => null); if (again && again.problems.length < best.problems.length) best = again }
  const row = await storeImage(db, userId, { bytes: best.made.bytes, type: best.made.type, source: 'ai', tier: 'infographic', prompt, width: best.made.width, height: best.made.height, kept: true })
  return { row, sheet, problems: best.problems, ai: { used: best.made.used, allowance: best.made.allowance } }
}
