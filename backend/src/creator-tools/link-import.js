import { join } from 'node:path'
import { fail } from './domain.js'
import { downloadPublicMedia } from './network.js'
import { ownedMedia } from './store.js'
import { workspace, downloadStored, probeVideo, transcribeFile } from './media.js'

// Protect written numerals verbatim, including non-Latin decimal digits.
const digits = /\p{Decimal_Number}+(?:[.,٫٬]\p{Decimal_Number}+)*/gu
const translationSchema = { type:'object', additionalProperties:false, required:['segments'], properties:{ segments:{
  type:'array', items:{ type:'object', additionalProperties:false, required:['id','text'], properties:{ id:{type:'string'}, text:{type:'string'} } },
} } }
const quoteList = { type:'array', items:{type:'string'} }
const numericReviewSchema = { type:'object', additionalProperties:false, required:['segments'], properties:{ segments:{
  type:'array', items:{ type:'object', additionalProperties:false, required:['id','verdict','sourceQuotes','translatedQuotes','reason'], properties:{
    id:{type:'string'}, verdict:{type:'string',enum:['equivalent','changed','uncertain']},
    sourceQuotes:quoteList, translatedQuotes:quoteList, reason:{type:'string'},
  } },
} } }
function numberChanged() { fail('TRANSLATION_NUMBER_CHANGED', '번역 중 수치가 달라졌거나 의미를 확인하지 못해 중단했습니다.', 422) }
function checkedRows(source, translated) {
  if (!Array.isArray(translated) || translated.length !== source.length) fail('TRANSLATION_INVALID', '번역 문장 수가 원문과 다릅니다.', 422)
  for (const [index, row] of translated.entries()) {
    if (!row || row.id !== source[index].id || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000) fail('TRANSLATION_INVALID', '번역 결과를 확인하지 못했습니다.', 422)
  }
  return translated.map((row,index) => ({ ...source[index], text:row.text.trim() }))
}
function checkWrittenNumbers(source, translated, allowSpokenNumerals = false) {
  for (const [index, row] of translated.entries()) {
    const remaining = row.text.match(digits) || []
    for (const number of source[index].text.match(digits) || []) {
      const found = remaining.indexOf(number)
      if (found < 0) numberChanged()
      remaining.splice(found, 1)
    }
    if (!allowSpokenNumerals && remaining.length) numberChanged()
  }
}
// Strict synchronous validator for callers without an independent semantic review.
export function validateTranslation(source, translated) {
  const result = checkedRows(source, translated)
  checkWrittenNumbers(source, result)
  return result
}
function letterId(value) {
  let result = ''
  for (let current = value; current >= 0; current = Math.floor(current / 26) - 1) {
    result = String.fromCharCode(65 + (current % 26)) + result
    if (current < 26) break
  }
  return result
}
function protectNumbers(segments) {
  const values = new Map()
  const protectedSegments = segments.map((segment, segmentIndex) => ({ ...segment,
    text: segment.text.replace(digits, value => {
      const token = `__HOOKAINUM${letterId(values.size)}__`
      values.set(token, { value, segmentIndex })
      return token
    }) }))
  return { protectedSegments, restore(translated) {
    const seen = new Set()
    const restored = checkedRows(segments, translated).map((segment, segmentIndex) => {
      let text = segment.text
      for (const [token, item] of values) {
        if (item.segmentIndex !== segmentIndex) continue
        // Collapse only a literal echo adjacent to its own placeholder, never a number elsewhere.
        const escaped = item.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        text = text.replace(new RegExp(`${token}${escaped}(?![\\p{Decimal_Number}.,٫٬])`, 'gu'), token)
      }
      text = text.replace(/__HOOKAINUM[A-Z]+__/g, token => {
        const item = values.get(token)
        if (!item || item.segmentIndex !== segmentIndex || seen.has(token)) numberChanged()
        seen.add(token)
        return item.value
      })
      if (/__HOOKAINUM/i.test(text)) numberChanged()
      return { ...segment, text }
    })
    if (seen.size !== values.size) numberChanged()
    const result = checkedRows(segments, restored)
    // Verbal quantities may legitimately become digits; only the independent review can approve them.
    checkWrittenNumbers(segments, result, true)
    return result
  } }
}
async function reviewNumericMeaning(providers, language, source, translated) {
  const review = await providers.json('verify-reference-numbers',
    `원문과 한국어 번역의 수량 의미를 독립적으로 검증하세요. 번역하지 말고 각 구간의 판정만 반환하세요.
모든 숫자와 말로 표현된 수량을 비교하세요. 언어·문자 체계에 관계없이 개수, 횟수, 기간, 날짜, 가격·통화, 단위, 비율, 범위, 배수, 제품명의 숫자까지 포함합니다.
예: five-in-one → 5-in-1, 한 병 → 1병은 의미가 같으면 equivalent입니다. 단위 변경·환산·새 수치 추가·수량 누락은 changed입니다. 숫자가 같아도 사용 횟수나 단위가 바뀌면 changed입니다.
아라비아 숫자의 유무만 비교하지 마세요. 두 달 → 세 달 같은 문자 수량 변경도 changed입니다. 관용구·단수 관사 등은 맥락으로 판단하고 근거가 부족하면 uncertain입니다.
모든 구간을 동일 id/순서로 반환하세요. sourceQuotes와 translatedQuotes에 판단에 사용한 원문/번역의 정확한 부분 문자열을 넣고 reason에 근거를 적으세요. 수량 표현이 없는 구간은 빈 배열을 허용합니다. 추측하여 승인하지 마세요.`,
    { language, segments:source.map((row,index) => ({id:row.id,source:row.text,translation:translated[index].text})) }, [], numericReviewSchema)
  if (!Array.isArray(review?.segments) || review.segments.length !== source.length) numberChanged()
  for (const [index, row] of review.segments.entries()) {
    if (!row || row.id !== source[index].id || row.verdict !== 'equivalent' || typeof row.reason !== 'string' || !row.reason.trim()) numberChanged()
    for (const [quotes,text] of [[row.sourceQuotes,source[index].text],[row.translatedQuotes,translated[index].text]]) {
      if (!Array.isArray(quotes) || quotes.some(q => typeof q !== 'string' || !q.trim() || !text.includes(q))) numberChanged()
      if ((text.match(digits) || []).length && !quotes.length) numberChanged()
    }
  }
}
export async function translateSegments(providers, language, subtitles) {
  const instruction = '영상 원문을 한국어로 번역하세요. 문장 순서와 훅/전개를 유지. 인명, 브랜드명, 상품명 보존. 원문에 없는 조언·성과·수량 추가 금지. JSON {segments:[{id,text}]}. 모든 구간을 같은 순서와 id로 반환. __HOOKAINUM...__ 자리표시자는 반드시 같은 문장에 문자 하나까지 그대로 유지하세요. 말로 표현된 수량은 한국어 단어나 숫자로 자연스럽게 옮기되 수량·단위·사용 횟수·제품명 의미를 바꾸지 마세요.'
  const protectedInput = protectNumbers(subtitles)
  const input = { language, segments:protectedInput.protectedSegments }
  let previousSegments
  // At most two translations and two independent reviews, all through existing provider guards.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await providers.json(attempt ? 'translate-reference-correction' : 'translate-reference',
      attempt ? `${instruction} 이전 결과가 수량 검증을 통과하지 못했습니다. 원문과 대조해 수량·단위·횟수 및 자리표시자의 누락·추가·변경을 바로잡으세요.` : instruction,
      attempt ? { ...input, previousSegments } : input, [], translationSchema)
    previousSegments = response?.segments
    try {
      const result = protectedInput.restore(previousSegments)
      await reviewNumericMeaning(providers, language, subtitles, result)
      return result
    } catch (error) {
      if (error.code !== 'TRANSLATION_NUMBER_CHANGED' || attempt) throw error
    }
  }
}
const importDependencies = { workspace, ownedMedia, downloadStored, probeVideo, transcribeFile }
export async function collectImportTranscript(ctx, dependencies = importDependencies) {
  const { job, providers, stage, signal, db } = ctx
  return dependencies.workspace(async (directory) => {
    const path = join(directory, 'source-video')
    if (job.input.projectId) {
      await stage('reading_video')
      const media = await dependencies.ownedMedia(db, job.input.projectId, job.user_id)
      if (Date.parse(media.original_expires_at) <= Date.now()) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다. 파일을 다시 선택해주세요.', 410)
      await dependencies.downloadStored(db, media.original_path, path, signal)
    } else {
      await stage('collecting_video')
      const media = await providers.brightData(job.input.url, ctx.checkpoint)
      await downloadPublicMedia(media.videoUrl, path, signal)
    }
    const info = await dependencies.probeVideo(path, signal)
    await stage('transcribing')
    return { ...await dependencies.transcribeFile(ctx, path, info.duration), duration: info.duration }
  })
}
export async function importLink(ctx) {
  const { providers, checkpoint, stage } = ctx
  const transcript = await checkpoint('transcript', () => collectImportTranscript(ctx))
  await stage('translating')
  const translated = await checkpoint('translationV2', async () => {
    if (['ko', 'korean'].includes(transcript.language.toLowerCase())) return transcript.subtitles
    return translateSegments(providers, transcript.language, transcript.subtitles)
  })
  const translatedText = translated.map((cue) => cue.text).join('\n')
  const originalText = transcript.subtitles.map((cue) => cue.text).join('\n').trim() || transcript.text.trim()
  if (originalText.length < 2 || translatedText.length < 2 || originalText.length > 20000 || translatedText.length > 20000) {
    fail('REFERENCE_LENGTH', '추출 가능한 음성 대본을 확인하지 못했습니다.', 422)
  }
  await stage('saving_transcript')
  return { sourceLanguage: transcript.language, originalTranscript: originalText, translatedTranscript: translatedText,
    extractedAt: new Date().toISOString() }
}
