import { join } from 'node:path'
import { fail } from './domain.js'
import { downloadPublicMedia } from './network.js'
import { workspace, probeVideo, transcribeFile } from './media.js'

export function validateTranslation(source, translated) {
  if (!Array.isArray(translated) || translated.length !== source.length) fail('TRANSLATION_INVALID', '번역 문장 수가 원문과 다릅니다.', 422)
  return translated.map((row, index) => {
    if (row.id !== source[index].id || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000) fail('TRANSLATION_INVALID', '번역 결과를 확인하지 못했습니다.', 422)
    const numbers = (source[index].text.match(/\d+(?:[.,]\d+)*/g) || []).sort()
    const actual = (row.text.match(/\d+(?:[.,]\d+)*/g) || []).sort()
    if (JSON.stringify(numbers) !== JSON.stringify(actual)) fail('TRANSLATION_NUMBER_CHANGED', '번역 중 수치가 달라져 생성을 중단했습니다.', 422)
    return { ...source[index], text: row.text.trim() }
  })
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
    text: segment.text.replace(/\d+(?:[.,]\d+)*/g, (value) => {
      const token = `__HOOKAINUM${letterId(segmentIndex)}${letterId(values.size)}__`
      values.set(token, { value, segmentIndex })
      return token
    }) }))
  return { protectedSegments, restore(translated) {
    const seen = new Set()
    const restored = translated.map((segment, segmentIndex) => {
      const expected = [...values.entries()].filter(([, item]) => item.segmentIndex === segmentIndex)
      let text = segment.text
      for (const raw of text.match(/\d+(?:[.,]\d+)*/g) || []) {
        const match = expected.find(([, item]) => item.value === raw)
        if (!match || !text.includes(match[0])) fail('TRANSLATION_NUMBER_CHANGED', '번역 중 수치가 달라져 생성을 중단했습니다.', 422)
        text = text.replace(raw, '')
      }
      text = text.replace(/__HOOKAINUM[A-Z]+__/g, (token) => {
      const item = values.get(token)
      if (!item || seen.has(token)) fail('TRANSLATION_NUMBER_CHANGED', '번역 중 수치가 달라져 생성을 중단했습니다.', 422)
      seen.add(token)
      return item.value
      })
      return { ...segment, text }
    })
    if (seen.size !== values.size) fail('TRANSLATION_NUMBER_CHANGED', '번역 중 수치가 달라져 생성을 중단했습니다.', 422)
    return restored
  } }
}
export async function translateSegments(providers, language, subtitles) {
  const instruction = '영상 원문을 한국어로 번역하세요. 문장 순서와 훅/전개를 유지. 인명, 브랜드명, 상품명은 원문 표기 보존. 원문에 없는 조언·성과 추가 금지. JSON {segments:[{id,text}]}. 모든 원문 구간을 같은 순서와 id로 반환. __HOOKAINUM...__ 자리표시자는 반드시 같은 문장에 문자 하나까지 그대로 유지하고, 응답 text에 다른 0-9 숫자를 쓰지 마세요.'
  const protectedInput = protectNumbers(subtitles)
  const input = { language, segments: protectedInput.protectedSegments }
  const checked = (segments) => validateTranslation(subtitles, protectedInput.restore(segments))
  const first = await providers.json('translate-reference', instruction, input)
  try { return checked(first.segments) }
  catch (error) {
    if (error.code !== 'TRANSLATION_NUMBER_CHANGED') throw error
    const corrected = await providers.json('translate-reference-correction',
      `${instruction} 이전 번역에서 숫자 자리표시자가 누락되거나 달라졌습니다. 자리표시자를 이동·중복·해석하지 말고 원래 문장에 그대로 복사하세요.`, input)
    return checked(corrected.segments)
  }
}
export async function importLink(ctx) {
  const { job, providers, checkpoint, stage, signal } = ctx
  await stage('collecting_video')
  const transcript = await checkpoint('transcript', async () => workspace(async (directory) => {
    const media = await providers.brightData(job.input.url, checkpoint)
    const path = join(directory, 'download.mp4')
    await downloadPublicMedia(media.videoUrl, path, signal)
    const info = await probeVideo(path, signal)
    await stage('transcribing')
    return { ...await transcribeFile(ctx, path, info.duration), duration: info.duration }
  }))
  await stage('translating')
  const translated = await checkpoint('translation', async () => {
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
