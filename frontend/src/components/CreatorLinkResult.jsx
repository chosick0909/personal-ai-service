import { Copy } from 'lucide-react'
import { hasKoreanTranslation } from '../lib/referenceTranslation'

export default function CreatorLinkResult({ job, onCopy, copyNotice }) {
  const result = job?.result
  if (job?.kind !== 'import-link' || !result?.originalTranscript) return null
  const pending = ['queued', 'running'].includes(job.status) && result.analysisStatus === 'pending'
  const unavailable = result.analysisStatus === 'unavailable' ||
    (result.analysisStatus === 'pending' && !pending)
  return <section className="ct-results">
    <div className="ct-section-heading"><h2>추출된 대본</h2><span className="ct-badge">{result.sourceLanguage}</span></div>
    {copyNotice && <p role="status" className="ct-copy-notice">{copyNotice}</p>}
    <div className="ct-transcripts">
      <article><header><h3>원문</h3><button type="button" aria-label="원문 복사" onClick={() => onCopy(result.originalTranscript, '원문')}><Copy size={16}/>복사</button></header><p>{result.originalTranscript}</p></article>
      {hasKoreanTranslation(result) && <article><header><h3>한국어 해석</h3><button type="button" aria-label="한국어 해석 복사" onClick={() => onCopy(result.translatedTranscript, '한국어 해석')}><Copy size={16}/>복사</button></header><p>{result.translatedTranscript}</p></article>}
    </div>
    {pending && <div className="ct-analysis-pending" role="status" aria-live="polite">
      <span className="ct-analysis-spinner" aria-hidden="true" />
      <div><strong>훅AI가 대본의 후킹 포인트를 분석 중이에요</strong><p className="ct-muted">대본을 먼저 읽어보세요. 분석이 끝나면 아래에 이어서 보여드릴게요.</p></div>
    </div>}
    {result.analysisStatus === 'ready' && <ReferenceAnalysisResults analysis={result.analysis} onCopy={onCopy}/>}
    {unavailable && <p role="status" className="ct-notice">{job.status === 'cancelled' ? '분석을 중단했습니다. 추출된 대본은 계속 확인하고 복사할 수 있습니다.' : '대본은 추출했지만 이번에는 분석을 완료하지 못했습니다. 추출된 대본은 계속 확인하고 복사할 수 있습니다.'}</p>}
    {result.analysisStatus === 'ready' && <p className="ct-muted">조회수 등 성과 데이터가 아니라 대본을 근거로 한 분석입니다.</p>}
  </section>
}

const analysisHookLabels = { question:'질문형', loss_aversion:'손실회피형', myth_busting:'통념반박형', result_first:'결과 먼저', empathy:'공감형', curiosity:'호기심형', other:'기타' }
const analysisRoleLabels = { hook:'훅', problem:'문제 제기', empathy:'공감', evidence:'근거', method:'방법', twist:'반전', cta:'CTA', other:'기타' }
function ReferenceAnalysisResults({ analysis, onCopy }) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return null
  const safeText = value => typeof value === 'string' ? value : ''
  const entries = (value, fields, limit) => Array.isArray(value) ? value.filter(item => item && fields.every(field => typeof item[field] === 'string')).slice(0, limit) : []
  const label = (labels, key) => typeof key === 'string' && Object.hasOwn(labels, key) ? labels[key] : '기타'
  const summary = safeText(analysis.summary)
  const hook = { quote:safeText(analysis.hook?.quote), type:label(analysisHookLabels, analysis.hook?.type), why:safeText(analysis.hook?.why) }
  const structure = entries(analysis.structure, ['role','quote','purpose'], 6)
  const reasons = entries(analysis.reasons, ['point','quote'], 4)
  const apply = entries(analysis.apply, ['step','example'], 4)
  const guidance = '아래는 내 주제에 맞게 빈칸을 채우는 문장 틀입니다. 실제 경험·근거가 있는 내용만 넣으세요.'
  const scope = '조회수 등 성과 데이터가 아니라 대본을 근거로 한 분석입니다.'
  const copyText = [summary && `한 줄 요약\n${summary}`, `후킹 분석 · ${hook.type}\n“${hook.quote}”\n${hook.why}`,
    '구조 분석', ...structure.map((row, i) => `${i+1}. ${label(analysisRoleLabels, row.role)}\n“${row.quote}”\n${row.purpose}`),
    '이 콘텐츠가 잘 된 이유', ...reasons.map(row => `${row.point}\n“${row.quote}”`),
    '내 콘텐츠에 적용하기', guidance, ...apply.map((row, i) => `${i+1}. ${row.step}\n${row.example}`), scope].filter(Boolean).join('\n\n')
  return <div className="ct-reference-analysis">
    {summary && <article className="ct-account"><h2>한 줄 요약</h2><p>{summary}</p></article>}
    <article className="ct-account"><div className="ct-section-heading"><h2>후킹 분석</h2><span className="ct-badge">{hook.type}</span></div><blockquote>{hook.quote}</blockquote>{hook.why && <p>{hook.why}</p>}</article>
    <article className="ct-account"><h2>구조 분석</h2><ol>{structure.map((row, i) => <li key={i}><span className="ct-badge">{label(analysisRoleLabels, row.role)}</span><blockquote>{row.quote}</blockquote><p>{row.purpose}</p></li>)}</ol></article>
    {reasons.length > 0 && <article className="ct-account"><h2>이 콘텐츠가 잘 된 이유</h2>{reasons.map((row, i) => <div key={i}><p>{row.point}</p><blockquote>{row.quote}</blockquote></div>)}</article>}
    <article className="ct-account"><h2>내 콘텐츠에 적용하기</h2><p className="ct-muted">{guidance}</p><ol>{apply.map((row, i) => <li key={i}><h3>{row.step}</h3><p>{row.example}</p></li>)}</ol></article>
    <div className="ct-row"><button type="button" onClick={() => onCopy(copyText, '분석 내용')}><Copy size={16}/>분석 결과 복사</button></div>
  </div>
}

