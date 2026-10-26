import { useEffect, useRef, useState } from 'react'
import { Upload as Tus } from 'tus-js-client'
import { UploadCloud, Film, ArrowRight, Clock3, CheckCircle2, TriangleAlert, LoaderCircle } from 'lucide-react'
import { useStudio } from '../context'
import { studio, when } from '../api'
import HookLoader from '../HookLoader'
import VideoProject from './VideoProject'

// 영상 편집 (Studio 2): upload once, and 훅ai checks the video against the plan, suggests cuts and builds the subtitles in one pass.
const STAGES = [['reading_video', '영상 읽는 중'], ['transcribing', '말 받아쓰는 중'], ['reviewing_content', '훅ai가 영상 보는 중'], ['finding_safe_cuts', '자를 곳 찾는 중']]
const MAX_BYTES = 300 * 1024 * 1024
const TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const active = job => job && ['queued', 'running'].includes(job.status)
const chosen = f => !f ? null : f.custom ? f.custom : f.options?.[f.chosen ?? 0] ?? null
const planCaption = s => { const c = s?.caption?.edited || chosen(s?.caption); return c ? `${c.text || ''}${c.hashtags?.length ? `\n\n${c.hashtags.map(t => `#${t}`).join(' ')}` : ''}` : '' }

function StartForm({ onStarted }) {
  const { toast } = useStudio()
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [plans, setPlans] = useState([])
  const [planId, setPlanId] = useState('')
  const [caption, setCaption] = useState('')
  const [rights, setRights] = useState(false)
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)
  const uploadRef = useRef(null)
  useEffect(() => { studio.sessions().then(d => setPlans((d.sessions || []).filter(s => ['script', 'filming', 'caption', 'done'].includes(s.stage)))).catch(() => {}) }, [])
  useEffect(() => () => { void uploadRef.current?.abort() }, [])
  const pickPlan = async id => {
    setPlanId(id)
    if (!id) return
    try { const d = await studio.session(id); const text = planCaption(d.session); if (text && !caption.trim()) setCaption(text) } catch { /* the caption stays as typed */ }
  }
  const choose = f => {
    if (!f) return
    if (!TYPES.includes(f.type) || f.size > MAX_BYTES) return toast({ kind: 'failed', title: '올릴 수 없는 영상이에요', body: '300MB 이하 MP4·MOV·WebM 영상(5분 이하)을 골라주세요.' })
    setFile(f)
  }
  const start = async () => {
    if (!file || !rights || busy) return
    setBusy(true)
    try {
      const project = await studio.createMedia({ filename: file.name, size: file.size, mimeType: file.type, clientUploadId: crypto.randomUUID(), rightsConfirmed: true, purpose: 'media-analyze' })
      if (!project.job) {
        setProgress(0)
        await new Promise((resolve, reject) => {
          const upload = new Tus(file, { endpoint: project.upload.endpoint, chunkSize: 6 * 1024 * 1024, retryDelays: [0, 2000, 5000, 10000, 20000], removeFingerprintOnSuccess: true,
            fingerprint: async () => `creator-${project.id}`, headers: { 'x-signature': project.upload.token },
            metadata: { bucketName: project.upload.bucket, objectName: project.upload.path, contentType: file.type, cacheControl: '3600' },
            onProgress: (sent, total) => setProgress(Math.round(sent / total * 100)), onError: reject, onSuccess: resolve })
          uploadRef.current = upload
          upload.findPreviousUploads().then(prev => { if (prev[0]) upload.resumeFromPreviousUpload(prev[0]); upload.start() }).catch(reject)
        })
      }
      const job = await studio.analyzeMedia(project.id, { feedbackCaption: caption, ...(planId ? { planId } : {}) })
      onStarted(job)
    } catch (e) { toast({ kind: 'failed', title: '영상을 보내지 못했어요', body: e.message }) } finally { setBusy(false); setProgress(null) }
  }
  return <section className="st-card st-stack st-ve-start">
    <div><h3>찍은 영상을 올려주세요</h3><p className="st-muted">훅ai가 영상을 보고 고칠 점을 알려주고, 자를 곳과 자막까지 한 번에 준비해요.</p></div>
    <label className={`st-ve-drop${drag ? ' is-drag' : ''}${file ? ' has-file' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]) }}>
      {file ? <Film size={40} /> : <UploadCloud size={40} />}
      <strong>{file ? file.name : '여기를 눌러 영상 고르기'}</strong>
      <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)}MB · 다른 영상으로 바꾸려면 다시 누르세요` : '또는 영상 파일을 여기로 끌어다 놓으세요 · MP4·MOV·WebM · 5분 이하 · 300MB 이하'}</span>
      <input type="file" accept={TYPES.join(',')} onChange={e => choose(e.target.files?.[0])} aria-label="영상 파일" />
    </label>
    <div className="st-field"><label>어떤 기획안으로 찍었나요? <small>고르면 기획한 대본과 비교해서 점검하고, 자막 오타도 대본으로 고칠 수 있어요</small></label>
      <select className="st-input" value={planId} onChange={e => pickPlan(e.target.value)}>
        <option value="">기획안 없이 점검하기</option>
        {plans.map(p => <option key={p.id} value={p.id}>{p.title || '제목 없는 기획안'}</option>)}
      </select></div>
    <div className="st-field"><label>올릴 캡션 <small>선택 · 적으면 캡션도 함께 봐드려요</small></label>
      <textarea className="st-textarea" style={{ minHeight: 110 }} value={caption} onChange={e => setCaption(e.target.value)} maxLength={5000} placeholder="인스타그램에 함께 올릴 글을 붙여 넣어 주세요" /></div>
    <label className="st-ve-consent"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} />직접 찍었거나 편집할 권한이 있는 영상이에요</label>
    <button type="button" className="st-btn st-btn-primary st-btn-lg" disabled={!file || !rights || busy} onClick={start}>
      {busy ? <><LoaderCircle size={20} className="st-spin" />{progress !== null ? `영상 올리는 중 ${progress}%` : '보내는 중…'}</> : <>훅ai에게 점검받기<ArrowRight size={20} /></>}</button>
    <p className="st-muted st-small">원본 영상은 24시간, 완성 영상은 7일 동안 보관돼요. 나만 볼 수 있어요.</p>
  </section>
}

function RecentList({ onOpen }) {
  const [jobs, setJobs] = useState(null)
  useEffect(() => { studio.jobs().then(d => setJobs((d.jobs || []).filter(j => j.purpose === 'studio'))).catch(() => setJobs([])) }, [])
  if (!jobs?.length) return null
  return <section className="st-card st-stack"><h3><Clock3 size={20} style={{ verticalAlign: -3 }} /> 최근에 점검한 영상</h3>
    <div className="st-ve-recent">{jobs.slice(0, 8).map(j => <button type="button" key={j.id} onClick={() => onOpen(j)}>
      {j.status === 'completed' ? <CheckCircle2 size={20} className="st-ve-ok" /> : j.status === 'failed' ? <TriangleAlert size={20} className="st-ve-bad" /> : <LoaderCircle size={20} className="st-spin" />}
      <span><strong>{j.plan?.title || '기획안 없이 올린 영상'}</strong><small>{when(j.createdAt)} · {j.status === 'completed' ? '점검 끝' : j.status === 'failed' ? '실패' : '점검 중'}</small></span><ArrowRight size={18} /></button>)}</div>
  </section>
}

function Progress({ job, onDone }) {
  const [current, setCurrent] = useState(job)
  useEffect(() => {
    let timer, alive = true
    const poll = async () => { try { const next = await studio.job(job.id); if (!alive) return; setCurrent(next); if (active(next)) timer = setTimeout(poll, 3000); else onDone(next) } catch { if (alive) timer = setTimeout(poll, 6000) } }
    timer = setTimeout(poll, 1500)
    return () => { alive = false; clearTimeout(timer) }
  }, [job.id, onDone])
  const index = Math.max(0, STAGES.findIndex(([id]) => id === current.stage))
  return <HookLoader title="훅ai가 영상을 보는 중" stages={STAGES.map(([, label]) => label)} stageIndex={index} startedAt={current.createdAt} note="보통 1~3분 걸려요. 이 화면을 떠나도 계속 진행되고, '최근에 점검한 영상'에서 다시 열 수 있어요." />
}

export default function EditPage({ jobId }) {
  const { go } = useStudio()
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { if (!jobId) return; studio.job(jobId).then(setJob).catch(e => setError(e.message)) }, [jobId])
  const open = j => go('edit', { job: j.id })
  if (jobId && error) return <div className="st-error" role="alert">{error}</div>
  if (jobId && !job) return <p className="st-muted">불러오는 중…</p>
  if (jobId && active(job)) return <Progress job={job} onDone={setJob} />
  if (jobId && job.status === 'failed') return <section className="st-card st-stack"><h3>점검하지 못했어요</h3><p>{job.error?.message || '잠시 후 다시 시도해주세요.'}</p><button type="button" className="st-btn" onClick={() => go('edit')}>다른 영상 올리기</button></section>
  if (jobId && job.status === 'completed') return <VideoProject job={job} />
  return <div className="st-stack" style={{ maxWidth: 920 }}>
    <StartForm onStarted={open} />
    <RecentList onOpen={open} />
  </div>
}
