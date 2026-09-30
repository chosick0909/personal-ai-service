import { join } from 'node:path'
import { referenceAnalysisSchema, referenceAnalysisInstructions, validateReferenceAnalysis } from './reference-analysis.js'
import { fail } from './domain.js'
import { downloadPublicMedia } from './network.js'
import { ownedMedia } from './store.js'
import { workspace, downloadStored, probeVideo, transcribeFile } from './media.js'

// Protect written numerals verbatim, including non-Latin decimal digits.
const digits = /\p{Decimal_Number}+(?:[.,٫٬]\p{Decimal_Number}+)*/gu
const translationSchema = { type:'object', additionalProperties:false, required:['text'], properties:{ text:{type:'string'} } }
const quoteList = { type:'array', items:{type:'string'} }
const translationReviewSchema = { type:'object', additionalProperties:false,
  required:['verdict','meaningVerdict','sourceQuotes','translatedQuotes','reason'], properties:{
    verdict:{type:'string',enum:['equivalent','changed','uncertain']},
    meaningVerdict:{type:'string',enum:['equivalent','changed','uncertain']},
    sourceQuotes:quoteList, translatedQuotes:quoteList, reason:{type:'string'},
  } }
function contentChanged() { fail('TRANSLATION_CONTENT_CHANGED', '원문의 의미를 보존한 번역을 완성하지 못했습니다. 다시 시도해주세요.', 422) }
function numberChanged() { fail('TRANSLATION_NUMBER_CHANGED', '번역 중 수치가 달라졌거나 의미를 확인하지 못해 중단했습니다.', 422) }
function checkedRows(source, translated, maxTextLength = 2000) {
  if (!Array.isArray(translated) || translated.length !== source.length) fail('TRANSLATION_INVALID', '번역 문장 수가 원문과 다릅니다.', 422)
  for (const [index, row] of translated.entries()) {
    if (!row || row.id !== source[index].id || typeof row.text !== 'string' || !row.text.trim() || row.text.length > maxTextLength) fail('TRANSLATION_INVALID', '번역 결과를 확인하지 못했습니다.', 422)
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
// Strict subtitle-alignment validator retained for existing callers/tests.
// Link-import translation does not use subtitle counts as an acceptance criterion.
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
function protectNumbers(segments, maxTextLength = 2000) {
  const values = new Map()
  const protectedSegments = segments.map((segment, segmentIndex) => ({ ...segment,
    text: segment.text.replace(digits, value => {
      const token = `__HOOKAINUM${letterId(values.size)}__`
      values.set(token, { value, segmentIndex })
      return token
    }) }))
  return { protectedSegments, restore(translated) {
    const seen = new Set()
    const restored = checkedRows(segments, translated, maxTextLength).map((segment, segmentIndex) => {
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
    const result = checkedRows(segments, restored, maxTextLength)
    // Verbal quantities may legitimately become digits; only the independent review can approve them.
    checkWrittenNumbers(segments, result, true)
    return result
  } }
}
async function reviewTranslationMeaning(providers, language, source, translated) {
  // Preserve the existing operation/model override and budget accounting. The
  // independent review now checks meaning as well as quantities, never line counts.
  const review = await providers.json('verify-reference-numbers',
    `원문과 한국어 번역을 독립적으로 대조하세요. 문장 수, 줄 수, 구간 수는 판정 기준이 아닙니다. 자연스럽게 합치거나 나눈 번역은 허용합니다.
meaningVerdict: 원문의 핵심 주장, 조건, 부정, 대상, 행동, 훅/전개/설득 순서가 보존되고 누락·오역·새 조언·성과·경험 추가가 없으면 equivalent, 의미가 달라졌으면 changed, 판단 불가면 uncertain. 요약은 번역이 아닙니다. 사실 검증이나 원문 주장에 대한 동의가 아니라 번역의 충실성을 판단하세요.
verdict: 모든 숫자와 말로 표현된 수량을 비교하세요. 언어·문자 체계에 관계없이 개수, 횟수, 기간, 날짜, 가격·통화, 단위, 비율, 범위, 배수, 제품명의 숫자까지 포함합니다. 수량 의미가 같으면 equivalent입니다. 단위 변경·환산·새 수치 추가·수량 누락은 changed입니다. 숫자가 같아도 적용 대상·조건·횟수나 단위가 바뀌면 changed입니다. 말로 쓴 수량이 숫자가 되는 것은 의미가 같으면 허용합니다. 수량이 없으면 equivalent, 근거 부족은 uncertain입니다.
sourceQuotes와 translatedQuotes에 판정에 사용한 정확한 부분 문자열을 각각 하나 이상 넣고 reason에 근거를 짧게 적으세요. 원문 전체를 반복하지 말고 인용 합계는 각 언어 500자 이내로 하세요. 원문에 없는 근거를 만들거나 추측하여 승인하지 마세요.`,
    { language, source:source.text, translation:translated.text }, [], translationReviewSchema)
  if (!review || !['equivalent','changed','uncertain'].includes(review.verdict)
      || !['equivalent','changed','uncertain'].includes(review.meaningVerdict)
      || typeof review.reason !== 'string' || !review.reason.trim()) contentChanged()
  for (const [quotes,text] of [[review.sourceQuotes,source.text],[review.translatedQuotes,translated.text]]) {
    if (!Array.isArray(quotes) || !quotes.length
        || quotes.some(q => typeof q !== 'string' || !q.trim() || !text.includes(q))) contentChanged()
  }
  if (review.verdict !== 'equivalent') numberChanged()
  if (review.meaningVerdict !== 'equivalent') contentChanged()
}

function translationPassages(subtitles) {
  if (!Array.isArray(subtitles) || !subtitles.length
      || subtitles.some(row => !row || typeof row.text !== 'string' || !row.text.trim())) {
    fail('TRANSLATION_INVALID', '번역할 원문을 확인하지 못했습니다.', 422)
  }
  let remaining = subtitles.map(row => row.text.trim()).join('\n')
  if (remaining.length > 20000) fail('REFERENCE_LENGTH', '추출 가능한 음성 대본을 확인하지 못했습니다.', 422)
  const passages = []
  // Small transcripts are translated as a whole. Bound long inputs by text size,
  // independent of how Whisper happened to segment the audio. No text is dropped.
  while (remaining.length) {
    let end = Math.min(3000, remaining.length)
    if (end < remaining.length) {
      const boundary = Math.max(remaining.lastIndexOf('\n',end - 1), remaining.lastIndexOf(' ',end - 1))
      if (boundary >= 1500) end = boundary + 1
      else if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
    }
    passages.push({ id:`passage-${passages.length}`, text:remaining.slice(0,end) })
    remaining = remaining.slice(end)
  }
  return passages
}
async function translatePassage(providers, language, passage, context) {
  const instruction = '영상 원문을 한국어로 자연스럽고 정확하게 번역하세요. source 전체를 번역하며 요약하지 마세요. 원문의 줄은 음성 전사 구간일 뿐 문장 경계가 아닙니다. 한국어 문장 수와 줄 수는 달라도 됩니다. 문맥에 맞게 문장을 합치거나 나누세요. 핵심 내용·조건·부정·대상·행동, 후킹과 전개·설득 순서는 보존하세요. 인명·브랜드명·상품명 보존. 원문에 없는 조언·성과·수량·경험 추가 금지. JSON {text:한국어 번역 전체}. context는 이해를 위한 앞뒤 원문이며 번역에 추가하지 마세요. __HOOKAINUM...__ 자리표시자는 반드시 문자 하나까지 그대로 유지하세요. 말로 표현된 수량은 한국어 단어나 숫자로 자연스럽게 옮기되 수량·단위·사용 횟수·제품명 의미를 바꾸지 마세요.'
  const protectedInput = protectNumbers([passage], 12000)
  const input = { language, source:protectedInput.protectedSegments[0].text, context }
  let previousTranslation, correction
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await providers.json(attempt ? 'translate-reference-correction' : 'translate-reference',
      attempt ? `${instruction} ${correction}` : instruction,
      attempt ? { ...input, previousTranslation } : input, [], translationSchema)
    previousTranslation = typeof response?.text === 'string' ? response.text : null
    try {
      // One document returned by the model; no model-generated list/count/IDs.
      if (!previousTranslation?.trim() || previousTranslation.length > 12000) contentChanged()
      const result = protectedInput.restore([{ id:passage.id, text:previousTranslation }])[0]
      await reviewTranslationMeaning(providers, language, passage, result)
      return result
    } catch (error) {
      if (!['TRANSLATION_NUMBER_CHANGED','TRANSLATION_CONTENT_CHANGED','TRANSLATION_INVALID'].includes(error.code) || attempt) throw error
      correction = error.code === 'TRANSLATION_NUMBER_CHANGED'
        ? '이전 번역의 수량·단위·횟수 또는 자리표시자가 원문과 다릅니다. 빠짐없이 원문과 같은 의미로 바로잡으세요.'
        : '이전 번역에서 원문 의미 보존을 확인하지 못했습니다. 핵심 내용·조건·부정·대상·행동의 누락·추가·오역 없이 원문 전체를 다시 번역하세요. 문장 수는 맞출 필요 없습니다.'
    }
  }
}
export async function translateSegments(providers, language, subtitles) {
  const passages = translationPassages(subtitles), translated = []
  for (const [index, passage] of passages.entries()) {
    const context = { before:passages[index - 1]?.text.slice(-500) || '', after:passages[index + 1]?.text.slice(0,500) || '' }
    translated.push(await translatePassage(providers, language, passage, context))
  }
  return translated
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
  const startedAt = Date.now()
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
  // Publish only validated original/translation fields. The job remains running:
  // completion and usage are still committed once by creator_complete_job.
  const transcriptResult = await checkpoint('referenceTranscriptV1', async () => ({
    sourceLanguage: transcript.language, originalTranscript: originalText,
    translatedTranscript: translatedText, extractedAt: new Date().toISOString(),
  }))
  let analysis = null
  if (process.env.CREATOR_LINK_ANALYSIS !== 'off' && !ctx.signal?.aborted) {
    try {
      await stage('analyzing_reference')
      const raw = await checkpoint('referenceAnalysisV1', async () => {
        // Leave time for the existing 90-second request and transcript persistence.
        // Worker termination / database outages cannot be recovered by this catch.
        const deadline = Date.parse(ctx.job?.deadline_at)
        const remaining = Math.min(startedAt + 15 * 60000, Number.isFinite(deadline) ? deadline : Infinity) - Date.now()
        if (remaining <= 105000 || ctx.signal?.aborted) return null
        const result = await providers.json('reference-analysis', referenceAnalysisInstructions,
          { script: translatedText, sourceLanguage: transcript.language }, [], referenceAnalysisSchema)
        return validateReferenceAnalysis(result, translatedText)
      })
      analysis = validateReferenceAnalysis(raw, translatedText)
    } catch (error) {
      // Never log provider messages, request bodies, model output or arbitrary error codes.
      const code = error?.status === 400 ? 'ANALYSIS_REQUEST_REJECTED'
        : error?.name === 'SyntaxError' ? 'ANALYSIS_INVALID_JSON' : 'ANALYSIS_UNAVAILABLE'
      console.warn('[creator-reference-analysis]', code)
    }
  }
  await stage('saving_transcript')
  return { ...transcriptResult, analysisStatus: analysis ? 'ready' : 'unavailable', ...(analysis ? { analysis } : {}) }
}
