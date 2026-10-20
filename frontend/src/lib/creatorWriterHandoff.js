import { hasKoreanTranslation } from './referenceTranslation.js'
export function koreanTranscriptForWriter(result = {}) {
  result = result && typeof result === 'object' ? result : {}
  if (hasKoreanTranslation(result)) return result.translatedTranscript.trim()
  if (/^(ko(?:[-_].*)?|kor|korean|한국어|한국말)$/i.test(String(result.sourceLanguage || '').trim())) {
    return String(result.originalTranscript || '').trim()
  }
  return ''
}
