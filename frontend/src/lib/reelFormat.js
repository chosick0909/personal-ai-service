export const PART = { hook: '훅', body: '본문', cta: 'CTA' }

export function compactCount(value) {
  if (!Number.isFinite(value)) return '-'
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}억`
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}만`
  return value.toLocaleString('ko-KR')
}
export const day = value => value ? new Date(value).toISOString().slice(0, 10) : ''

export function planText(plan, hookIndex = 0) {
  const hook = plan.hooks?.[hookIndex]
  const script = plan.script.map(line => line.part === 'hook' && hook ? { ...line, spoken: hook.spoken, onScreen: hook.onScreen || line.onScreen } : line)
  return [`■ ${plan.title}`, '',
    ...(plan.thumbnailTitles?.length ? ['[썸네일 제목]', ...plan.thumbnailTitles.map((t, i) => `${i + 1}. ${t.text}`), ''] : []),
    '[대본]', ...script.map(l => `${PART[l.part]} (${l.seconds}초) ${l.spoken}${l.onScreen ? `\n   자막: ${l.onScreen}` : ''}`), '',
    '[스토리보드]', ...plan.storyboard.map(s => `#${s.scene} (${s.seconds}초) ${s.shot} / ${s.action}${s.onScreen ? ` / 자막: ${s.onScreen}` : ''}${s.spoken ? `\n   대사: ${s.spoken}` : ''}`), '',
    '[촬영 가이드]', `장소: ${plan.filming.location}`, `준비물: ${plan.filming.props.join(', ')}`, `카메라: ${plan.filming.camera}`, `조명: ${plan.filming.lighting}`, `편집: ${plan.filming.editing}`,
    ...plan.filming.checklist.map(c => `- ${c}`), '',
    '[캡션]', plan.caption.text, plan.caption.hashtags.map(t => `#${t}`).join(' ')].join('\n')
}
