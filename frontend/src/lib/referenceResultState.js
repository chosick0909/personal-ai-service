// Missing metadata is not evidence that speech transcription was performed.
export function resolveReferenceSourceMode(reference = {}) {
  const mode = reference.sourceMode || reference.source_mode
  if (mode === 'topic_only' || mode === 'script_text') return mode
  const brief = reference.topicBrief || reference.topic_brief || {}
  if (reference.mime_type === 'application/x-hookai-topic'
    || (reference.fileName || reference.original_filename) === '주제만으로 기획'
    || (brief.inputBrief && brief.contentBrief)) return 'topic_only'
  return mode === 'video' ? 'video' : 'unknown'
}

export function getReferenceResultState(reference = {}, scripts = []) {
  const sourceMode = resolveReferenceSourceMode(reference)
  const processing = ['processing', 'uploading'].includes(reference.status)
  const hasTranscript = Boolean(String(reference.transcript || '').trim())
  const noDrafts = scripts.length === 0
  const transcriptionFailed = sourceMode === 'video' && !processing && noDrafts
    && (!hasTranscript || reference.transcriptQuality?.level === 'low')
  const unavailable = !processing && noDrafts
  const message = transcriptionFailed
    ? '영상에서 대본을 충분히 추출하지 못했습니다. 자막이나 대본을 직접 입력해 분석해 주세요.'
    : reference.errorMessage || (sourceMode === 'topic_only'
      ? '주제 기반 대본 생성을 완료하지 못했습니다. 입력한 주제로 다시 시도해 주세요.'
      : '대본 생성 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
  return { sourceMode, processing, hasTranscript, transcriptionFailed, unavailable, message }
}
