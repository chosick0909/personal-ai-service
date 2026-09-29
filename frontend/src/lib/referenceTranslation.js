export function hasKoreanTranslation(source) {
  const language=String(source?.sourceLanguage || '').trim().toLowerCase()
  if (/^(ko(?:[-_].*)?|kor|korean|한국어|한국말)$/.test(language)) return false
  return Boolean(source?.translatedTranscript?.trim()) && source.translatedTranscript.trim() !== source.originalTranscript?.trim()
}
