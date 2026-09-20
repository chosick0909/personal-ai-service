import { useEffect, useRef, useState } from 'react'
import { Bookmark, ExternalLink, Search, Scissors, Link, X, Sun, Moon, MessageSquare, RefreshCw, ArrowLeft, ArrowRight, SlidersHorizontal, Clock3, UploadCloud, Info, FileVideo, CheckCircle2, Copy, LayoutDashboard } from 'lucide-react'
import { Upload } from 'tus-js-client'
import { creatorRequest, safeInstagramHref } from '../lib/creatorApi'
import { creatorStudioPath } from '../lib/creatorRoutes'
import { useAppState } from '../store/AppState'
import { safeGetStorageItem, safeSetStorageItem, safeRemoveStorageItem } from '../lib/safeStorage'
import './CreatorTools.css'
import CreatorMediaEditor from './CreatorMediaEditor'
import hookLogo from '../Logo_1.webp'

const tools = [
  { id: 'reference-accounts', label: '계정 인사이트', title: '내 주제에 맞는 계정 인사이트', note: '카테고리·조건별 공개 계정 분석', icon: Search },
  { id: 'import-link', label: '링크 분석', title: '릴스 원문 대본 추출', note: '원문 추출·한국어 해석', icon: Link },
  { id: 'media-analyze', label: '컷편집·자막', title: '영상은 간결하게, 자막은 정확하게', note: '삭제 구간과 자막 직접 편집', icon: Scissors },
  { id: 'feedback', label: '영상·캡션 피드백', title: '게시 전, 한 번 더 완성도 높이기', note: '영상·캡션의 개선점 확인', icon: MessageSquare },
]
const stages = { verifying_public_accounts: '공개 프로필·최근 게시물 확인 중', verifying_reach: '50만 이상 조회 콘텐츠 확인 중', reviewing_content: '영상 표본·캡션 분석 중', queued: '작업 대기 중', finding_accounts: '카테고리 상위 계정 검색 중', expanding_account_search: '조건에 맞는 계정을 찾도록 검색 범위 확대 중', ranking_accounts: '선택 조건 적합도 비교 중',
  expanding_keywords: '키워드 후보 구성 중', checking_official_sources: '공식 데이터 확인 중', collecting_video: '영상 가져오는 중',
  reading_video: '영상 확인 중', transcribing: '음성·시간 정보 분석 중', translating: '한국어 번역 중',
  saving_transcript: '추출 결과 저장 중', finding_safe_cuts: '침묵 구간 분석 중',
  rendering: '선택한 컷 적용 중', packaging: '내보내기 파일 준비 중', completed: '완료', failed: '실패', retrying: '다시 처리 중' }
const checkedAt = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR') : '확인되지 않음'
const active = (job) => job && ['queued','running'].includes(job.status)

function IconButton({ title, children, ...props }) {
  return <button type="button" className="ct-icon" title={title} aria-label={title} {...props}>{children}</button>
}
function Field({ label, value, onChange, multiline, ...props }) {
  const Component = multiline ? 'textarea' : 'input'
  return <label className="ct-field"><span>{label}</span><Component value={value} onChange={(event) => onChange(event.target.value)} {...props} /></label>
}
function SelectField({ label, value, onChange, options, required = false }) {
  return <label className="ct-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
    {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
  </select></label>
}
function AccountResults({ result, preferences, onPreference }) {
  const excluded = new Set(preferences.filter((p) => p.preference === 'excluded').map((p) => p.username))
  const accounts = (result.accounts || []).filter((a) => !excluded.has(a.username))
  return <section className="ct-results">
    {accounts.length === 0 && <div className="ct-empty"><Search size={28}/><strong>개인 크리에이터 여부, 팔로워 범위, 50만 이상 조회 콘텐츠가 모두 확인된 계정을 찾지 못했습니다.</strong></div>}
    {accounts.map((account) => <article className="ct-account" key={account.username}>
      <header><a href={safeInstagramHref(account.profileUrl) || undefined} target="_blank" rel="noreferrer">@{account.username} <ExternalLink size={15} /></a><span>선택 조건 적합도 {Number.isFinite(account.matchScore)?account.matchScore:'확인되지 않음'}</span>
        <IconButton title="저장" aria-pressed={preferences.some((p) => p.username === account.username && p.preference === 'saved')}
          onClick={() => onPreference(account.username, preferences.some((p) => p.username === account.username && p.preference === 'saved') ? null : 'saved')}><Bookmark size={18} /></IconButton>
        <IconButton title="결과에서 제외" onClick={() => onPreference(account.username, 'excluded')}><X size={18} /></IconButton></header>
      <ul>{account.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
      {account.referencePoints?.length > 0 && <h3>기획 포인트 살펴보기</h3>}
      {account.referencePoints.map((point, i) => <p key={i}>{point}</p>)}
      {account.relaxedConditions?.length > 0 && <p className="ct-muted">일부 조건 차이 · {account.relaxedConditions.join(' · ')}</p>}
      <div className="ct-tags"><span>개인 크리에이터 확인</span><span>얼굴 노출 {({visible:'확인됨',hidden:'비공개형',mixed:'일부 등장',unknown:'확인되지 않음'})[account.faceVisibility] || '확인되지 않음'}</span><span>언어 {({ko:'한국어',en:'영어',ja:'일본어',unknown:'확인되지 않음'})[account.contentLanguage] || '확인되지 않음'}</span></div>
      <div className="ct-links">{safeInstagramHref(account.viralMedia?.permalink) && <a href={safeInstagramHref(account.viralMedia.permalink)} target="_blank" rel="noreferrer">50만+ 조회 콘텐츠 <ExternalLink size={14} /></a>}{account.exampleMedia.map((media, i) => safeInstagramHref(media.permalink) && media.permalink !== account.viralMedia?.permalink ? <a key={i} href={safeInstagramHref(media.permalink)} target="_blank" rel="noreferrer">공개 콘텐츠 {i + 1} <ExternalLink size={14} /></a> : null)}</div>
      <div className="ct-tags"><span>팔로워 {Number.isFinite(account.followers) ? account.followers.toLocaleString() : '확인되지 않음'}</span><span>확인된 최고 조회수 {Number.isFinite(account.maxViews) ? account.maxViews.toLocaleString() : '확인되지 않음'}</span><span>계정 게시물 {Number.isFinite(account.postsCount) ? account.postsCount.toLocaleString() : '확인되지 않음'}</span></div>
    </article>)}
  </section>
}
function KeywordResults({ result }) {
  const rows = result.keywords || []
  return <section className="ct-results">
    <div className="ct-section-heading"><h2>추천 키워드 <span>{rows.length}</span></h2><span className="ct-badge">AI 추천 후보</span></div>
    <div className="ct-table-scroll"><table className="ct-table"><thead><tr><th>넓은 키워드</th><th>콘텐츠 방향</th><th>연관 키워드</th><th>게시물 수</th><th>출처·확인 시각·검증</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.keyword}><th scope="row">#{r.keyword.replace(/\s/g, '')}</th><td>{r.purpose}</td><td><div className="ct-tags">{r.relatedKeywords.map(k => <span key={k}>{k}</span>)}</div></td><td>{r.countStatus === 'verified' && Number.isFinite(r.postCount) ? r.postCount.toLocaleString() : <span className="ct-muted">확인되지 않음</span>}</td><td>{safeInstagramHref(r.sourceUrl) ? <a href={safeInstagramHref(r.sourceUrl)} target="_blank" rel="noreferrer">표본 게시물 <ExternalLink size={14} /></a> : <span className="ct-muted">AI 추천 후보 · 통계 미연결</span>}<br/><small>{checkedAt(r.measuredAt)} · {r.countStatus==='verified'?'게시물 수 검증됨':'게시물 수 확인 불가 · 상승세 미확인'}</small></td></tr>)}</tbody>
    </table></div>
    {!rows.some(r=>r.countStatus==='verified' && Number.isFinite(r.postCount)) && <p className="ct-muted">공식 수치가 확인된 키워드가 없습니다.</p>}
    <p className="ct-source-note"><Info size={15} />실시간 상승세와 전체 게시물 수는 아직 검증되지 않았습니다.</p>
  </section>
}

export default function CreatorTools() {
  const { currentUser, currentAccount } = useAppState()
  return <CreatorWorkspace key={`${currentUser?.id || 'guest'}:${currentAccount?.id || 'none'}`} />
}
function CreatorWorkspace() {
  const { currentUser, currentAccount, accounts, selectAccount } = useAppState()
  const [theme, setTheme] = useState(() => safeGetStorageItem('hookai-tools-theme') || 'dark')
  const [caption, setCaption] = useState('')
  const submitting = useRef(false)
  const [features, setFeatures] = useState({})
  const [referenceCategories, setReferenceCategories] = useState([])
  const [trendCategories, setTrendCategories] = useState([])
  const [readiness, setReadiness] = useState({})
  const [mode, setMode] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('tab') || 'reference-accounts'
    return requested === 'recent-jobs' || tools.some(tool => tool.id === requested) ? requested : 'reference-accounts'
  })
  const [brief, setBrief] = useState({ category: '', region: 'KR', faceVisibility: 'any', accountSize: 'any', contentLanguage: 'ko',
    trendGoal:'education', audienceLevel:'beginner', keywordScope:'balanced', contentStructure:'howto' })
  const [url, setUrl] = useState('')
  const [rights, setRights] = useState(false)
  const [file, setFile] = useState(null)
  const [jobs, setJobs] = useState([])
  const [job, setJob] = useState(null)
  const [media, setMedia] = useState(null)
  const [preferences, setPreferences] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const uploadReceipt = useRef(null)
  const [uploadProgress, setUploadProgress] = useState(null)
  const uploadRef = useRef(null)
  const requestKey = useRef(null)
  const pendingReceipt = useRef(null)
  const alive = useRef(true)
  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    creatorRequest('/creator-tools/capabilities', { signal: controller.signal }).then(async (data) => {
      setFeatures({ ...data.features, feedback: data.features['media-analyze'] })
      setReferenceCategories(data.referenceCategories || data.categories || [])
      setTrendCategories(data.trendCategories || data.referenceCategories || data.categories || [])
      setReadiness({ ...(data.readiness || {}), feedback: data.readiness?.['media-analyze'] })
      const initial = new URLSearchParams(window.location.search).get('tab')
      if (initial !== 'recent-jobs' && !tools.some(t=>t.id===initial)) setMode('reference-accounts')
      const history = await creatorRequest('/creator-tools/jobs', { signal: controller.signal })
      if (controller.signal.aborted) return
      const visibleJobs = history.jobs.filter(item => item.kind !== 'trend-keywords' && (!item.accountId || item.accountId === currentAccount?.id))
      setJobs(visibleJobs)
      const resumeId = new URLSearchParams(window.location.search).get('job')
      if (resumeId) {
        const resumed = visibleJobs.find(item => item.id === resumeId)
        if (resumed) await loadJob(resumed)
      }
      if (data.features['reference-accounts']) {
        const saved = await creatorRequest('/discovery/account-preferences', { signal: controller.signal }); setPreferences(saved.preferences)
      }
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message) })
    return () => { alive.current = false; controller.abort(); void uploadRef.current?.abort() }
    // loadJob is event logic; this effect only resets for identity/connectivity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentAccount?.id, connectionAttempt])
  useEffect(() => {
    const back = () => { const tab = new URLSearchParams(window.location.search).get('tab'); setMode(tab==='recent-jobs'||tools.some(t=>t.id===tab)?tab:'reference-accounts'); setJob(null); setMedia(null); setRights(false) }
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back)
  }, [])
  useEffect(() => {
    if (!jobId || !['queued','running'].includes(jobStatus)) return
    const controller = new AbortController()
    let timer, attempts = 0
    async function poll() {
      try {
        const next = await creatorRequest(`/creator-tools/jobs/${jobId}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        const completedMedia = next.status === 'completed' && next.result?.projectId
          ? await creatorRequest(`/media-projects/${next.result.projectId}`, { signal: controller.signal }) : null
        if (controller.signal.aborted) return
        if (completedMedia) setMedia(completedMedia)
        if (['completed','failed'].includes(next.status) && pendingReceipt.current) { safeRemoveStorageItem(pendingReceipt.current); requestKey.current=null }
        setJob(next); setJobs((rows) => rows.map((row) => row.id === next.id ? next : row)); attempts = 0; setError('')
        if (next.status === 'failed') { if (uploadReceipt.current) safeRemoveStorageItem(uploadReceipt.current); requestKey.current = null; setError(next.error?.message || '작업을 완료하지 못했습니다.') }
        if (active(next)) timer = setTimeout(poll, 3000)
      } catch {
        if (controller.signal.aborted) return
        attempts += 1
        setError('상태 확인 연결이 지연되고 있습니다. 작업은 서버에서 계속됩니다.')
        if (attempts < 8) timer = setTimeout(poll, Math.min(30000, attempts * 5000))
      }
    }
    timer = setTimeout(poll, 1500)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [jobId, jobStatus])
  function formChanged(patch) { setBrief((b) => ({ ...b, ...patch })); requestKey.current = null }
  async function loadJob(item) {
    if (busy) return
    setBusy(true); setError(''); setMedia(null)
    try {
      const latest = await creatorRequest(`/creator-tools/jobs/${item.id}`)
      if (!alive.current) return
      const nextMedia = latest.result?.projectId ? await creatorRequest(`/media-projects/${latest.result.projectId}`) : null
      if (!alive.current) return
      const targetMode = item.purpose === 'feedback' ? 'feedback' : item.kind.startsWith('media-') ? 'media-analyze' : item.kind
      setMode(targetMode); setJob(latest)
      setJobs((rows) => rows.map((row) => row.id === latest.id ? latest : row))
      setMedia(nextMedia)
      const nextUrl = new URL(window.location.href); nextUrl.searchParams.set('tab',targetMode); nextUrl.searchParams.set('job',latest.id); window.history.replaceState({},'',nextUrl)
    } catch (e) { if (alive.current) setError(e.message) }
    finally { if (alive.current) setBusy(false) }
  }
  async function submit(event) {
    event.preventDefault(); if (submitting.current || busy || active(job)) return; submitting.current = true; setBusy(true); setError(''); setJob(null); setMedia(null)
    requestKey.current ||= crypto.randomUUID()
    let uploadFingerprint = null
    try {
      const signature = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({mode,brief,url,caption,preferences}))))).map(b=>b.toString(16).padStart(2,'0')).join('')
      const pendingKey = `hookai-tools-request:${currentUser?.id}:${currentAccount?.id}:${signature}`
      requestKey.current = safeGetStorageItem(pendingKey) || requestKey.current
      pendingReceipt.current = pendingKey
      safeSetStorageItem(pendingKey, requestKey.current)
      let next
      if (['media-analyze','feedback'].includes(mode)) {
        if (!rights) throw new Error('이번 자료의 분석·편집 권한을 확인해주세요.')
        if (!file) throw new Error('영상을 선택해주세요.')
        if (file.size > 300 * 1024 * 1024 || !['video/mp4','video/quicktime','video/webm'].includes(file.type)) throw new Error('300MB 이하 MP4·MOV·WebM 영상을 선택해주세요.')
        const fingerprint = `hookai-upload:${currentUser?.id}:${mode}:${signature}:${file.name}:${file.size}:${file.lastModified}`
        uploadFingerprint = fingerprint
        uploadReceipt.current = fingerprint
        const clientUploadId = safeGetStorageItem(fingerprint) || crypto.randomUUID()
        safeSetStorageItem(fingerprint, clientUploadId)
        const project = await creatorRequest('/media-projects', { method: 'POST', body: { filename: file.name, size: file.size, mimeType: file.type, clientUploadId, rightsConfirmed: rights } })
        if (project.job) {
          next = project.job
        } else {
          setUploadProgress(0)
          await new Promise((resolve, reject) => {
            const upload = new Upload(file, { endpoint: project.upload.endpoint, chunkSize: 6 * 1024 * 1024,
              retryDelays: [0, 2000, 5000, 10000, 20000], removeFingerprintOnSuccess: true,
              fingerprint: async () => `creator-${project.id}`, headers: { 'x-signature': project.upload.token },
              metadata: { bucketName: project.upload.bucket, objectName: project.upload.path, contentType: file.type, cacheControl: '3600' },
              onProgress: (sent, total) => { if (alive.current) setUploadProgress(Math.round(sent / total * 100)) },
              onError: reject, onSuccess: resolve })
            uploadRef.current = upload
            upload.findPreviousUploads().then((previous) => { if (previous[0]) upload.resumeFromPreviousUpload(previous[0]); upload.start() }).catch(reject)
          })
          next = await creatorRequest(`/media-projects/${project.id}/analyze`, { method: 'POST', body: { rightsConfirmed: rights, ...(mode === 'feedback' ? { feedbackCaption: caption } : {}) } })
        }
        // Keep the upload receipt for refresh/retry deduplication; expiry is enforced by the server.
      } else if (mode === 'import-link') {
        next = await creatorRequest('/reference-videos/import-link', { method: 'POST', body: { url, rightsConfirmed: rights,
          clientImportId: requestKey.current, accountId: currentAccount?.id } })
      } else {
        const discoveryBrief = mode === 'reference-accounts' ? { category:brief.category, faceVisibility:brief.faceVisibility,
          accountSize:brief.accountSize, contentLanguage:brief.contentLanguage }
          : { category:brief.category, trendGoal:brief.trendGoal, audienceLevel:brief.audienceLevel, keywordScope:brief.keywordScope,
            contentStructure:brief.contentStructure, contentLanguage:brief.contentLanguage }
        next = await creatorRequest(`/discovery/${mode}`, { method: 'POST', body: { ...discoveryBrief, clientRequestId: requestKey.current,
          excludeAccounts: preferences.filter((p) => p.preference === 'excluded').map((p) => p.username) } })
      }
      if (alive.current) {
        setRights(false)
        if (['completed','failed'].includes(next.status)) safeRemoveStorageItem(pendingKey)
        const nextUrl = new URL(window.location.href); nextUrl.searchParams.set('job',next.id); window.history.replaceState({},'',nextUrl)
        setJob(next); setJobs((rows) => [next, ...rows.filter((r) => r.id !== next.id)])
        if (next.status === 'failed') { if (uploadReceipt.current) safeRemoveStorageItem(uploadReceipt.current); requestKey.current = null; setError(next.error?.message || '작업을 완료하지 못했습니다.') }
        if (next.status === 'completed' && next.result?.projectId) setMedia(await creatorRequest(`/media-projects/${next.result.projectId}`))
      }
    } catch (e) {
      if (uploadFingerprint && ['MEDIA_EXPIRED', 'UPLOAD_CLOSED'].includes(e.code)) safeRemoveStorageItem(uploadFingerprint)
      if (alive.current) setError(e.message)
    }
    finally { submitting.current = false; if (alive.current) { setBusy(false); setUploadProgress(null) } }
  }
  async function retryJob() {
    if (submitting.current || busy || job?.status !== 'failed') return
    submitting.current=true;setBusy(true);setError('')
    const receipt=`hookai-tools-retry:${currentUser?.id}:${job.id}`
    const id=safeGetStorageItem(receipt)||crypto.randomUUID();safeSetStorageItem(receipt,id)
    try {
      const next=await creatorRequest(`/creator-tools/jobs/${job.id}/retry`,{method:'POST',body:{clientRequestId:id,rightsConfirmed:rights,confirmed:true}})
      if (!alive.current) return
      setJob(next);setRights(false);setJobs(items=>[next,...items.filter(v=>v.id!==next.id)])
      const nextUrl=new URL(window.location.href);nextUrl.searchParams.set('job',next.id);window.history.replaceState({},'',nextUrl)
    } catch(e){if(alive.current)setError(e.message)} finally{submitting.current=false;if(alive.current)setBusy(false)}
  }
  async function preference(name, value) {
    try { await creatorRequest(`/discovery/account-preferences/${name}`, { method: 'PUT', body: { preference: value } }); setPreferences((rows) => [...rows.filter((r) => r.username !== name), ...(value ? [{ username: name, preference: value }] : [])]); requestKey.current = null }
    catch (e) { setError(e.message) }
  }
  async function save(draft) {
    setBusy(true); setError('')
    try { const result = await creatorRequest(`/media-projects/${media.id}/edit-manifest`, { method: 'PATCH', body: { revision: media.revision, manifest: draft } }); setMedia((m) => ({ ...m, ...result, downloadUrl: null, outputExpiresAt: null })); return true }
    catch (e) { setError(e.message); return false } finally { setBusy(false) }
  }
  async function render() {
    setBusy(true); setError('')
    try {
      const next = await creatorRequest(`/media-projects/${media.id}/render`, { method: 'POST', body: { revision: media.revision, confirmed: true } })
      setJob(next); setJobs((rows) => [next, ...rows.filter((row) => row.id !== next.id)])
      if (next.status === 'completed') setMedia(await creatorRequest(`/media-projects/${media.id}`))
    }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function copyTranscript(value, label) {
    const fallback = () => {
      const field = document.createElement('textarea')
      field.value = value; field.readOnly = true; field.style.position = 'fixed'; field.style.opacity = '0'
      document.body.appendChild(field); field.select()
      const copied = document.execCommand('copy'); field.remove()
      if (!copied) throw new Error('COPY_FAILED')
    }
    try {
      if (navigator.clipboard?.writeText) {
        await Promise.race([navigator.clipboard.writeText(value), new Promise((_, reject) => setTimeout(() => reject(new Error('COPY_TIMEOUT')), 1200))])
      } else fallback()
      setError(''); setCopyNotice(`${label}을 복사했습니다.`)
    } catch {
      try { fallback(); setError(''); setCopyNotice(`${label}을 복사했습니다.`) }
      catch { setError('클립보드에 복사하지 못했습니다. 브라우저 권한을 확인해주세요.') }
    }
  }
  const historyMode = mode === 'recent-jobs'
  const CurrentIcon = historyMode ? Clock3 : (tools.find(tool => tool.id === mode) || tools[0]).icon
  const currentTool = historyMode ? { label:'최근 작업', title:'최근 작업 내역' } : tools.find(tool => tool.id === mode) || tools[0]
  const isMedia = ['media-analyze','feedback'].includes(mode)
  function changeMode(id) { setMode(id); setJob(null); setMedia(null); setError(''); setRights(false); requestKey.current=null; window.history.pushState({}, '', `${creatorStudioPath(window.location.pathname)}?tab=${id}`) }
  return <main className="creator-tools ct-live" data-theme={theme}>
    <div className="ct-topbar"><a className="ct-brand" href="/creatorstudio"><img src={hookLogo} alt="" />HookAI <span>CREATOR WORKSPACE</span></a><div className="ct-row"><span className="ct-live-user">{currentAccount?.name || '내 계정'}</span><a className="ct-back" href="/analyze"><ArrowLeft size={16} />대본 작업실</a><IconButton title={theme==='dark'?'라이트 모드로 전환':'다크 모드로 전환'} onClick={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);safeSetStorageItem('hookai-tools-theme',next)}}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</IconButton></div></div>
    <aside className="ct-studio-sidebar"><p>WORKSPACE</p><button type="button" aria-current={!historyMode?'page':undefined}><LayoutDashboard size={18}/>크리에이터 스튜디오</button><button type="button" aria-current={historyMode?'page':undefined} onClick={()=>changeMode('recent-jobs')}><Clock3 size={18}/>최근 작업 <span className="ct-sidebar-count">{jobs.length}</span></button><div/><p>CREATOR TOOLS</p>{tools.map((tool)=><button type="button" key={tool.id} disabled={busy} aria-current={mode===tool.id?'page':undefined} onClick={()=>changeMode(tool.id)}><tool.icon size={17}/>{tool.label}</button>)}{accounts?.length>0&&<label className="ct-sidebar-account"><span>작업 계정</span><select aria-label="작업 계정" value={currentAccount?.id||''} disabled={busy} onChange={e=>selectAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name||a.id}</option>)}</select></label>}</aside>
    <div className="ct-workspace">
    <header className="ct-header"><div><div className="ct-eyebrow">WORKSPACE / CREATOR STUDIO <span className="ct-badge">Beta</span></div><h1>크리에이터 스튜디오</h1><p>콘텐츠 인사이트부터 영상 편집과 게시 전 점검까지.</p></div></header>
    {!historyMode&&<nav className="ct-tabs" aria-label="콘텐츠 도구">{tools.map((tool) => <button type="button" key={tool.id} disabled={busy}
      aria-current={mode === tool.id ? 'page' : undefined} onClick={() => changeMode(tool.id)}><tool.icon size={20} /><strong>{tool.label}</strong><small>{tool.note}</small></button>)}</nav>
    }
    <div className="ct-work-heading"><div><span className="ct-badge">{currentTool.label}</span><h2>{currentTool.title}</h2></div><span className="ct-muted">{currentAccount?.name||'내 계정'} · Instagram Reels</span></div>
    {historyMode ? <section className="ct-history ct-history-page"><div className="ct-section-heading"><h2><Clock3 size={19}/>전체 작업 <span>{jobs.length}</span></h2><span className="ct-muted">최신 작업부터 표시합니다.</span></div>{jobs.length===0&&<div className="ct-empty"><Clock3 size={28}/><strong>최근 작업이 없습니다.</strong></div>}{jobs.map((item)=><button type="button" key={item.id} disabled={busy} onClick={()=>loadJob(item)}><span className="ct-job-title">{item.kind.startsWith('media-')?<FileVideo size={18}/>:<Search size={18}/>} {item.purpose==='feedback'?'영상·캡션 피드백':tools.find(t=>t.id===item.kind)?.label||'영상 내보내기'}</span><time>{new Date(item.createdAt).toLocaleString('ko-KR')}</time><span className={`ct-status ct-status-${(job?.id===item.id?job:item).status}`}>{(job?.id===item.id?job:item).status==='completed'&&<CheckCircle2 size={14}/>} {stages[(job?.id===item.id?job:item).status]||'처리 중'}</span><ArrowRight size={16}/></button>)}</section> : <div className="ct-work-layout"><div className="ct-main-flow">
    <div className="ct-section-heading"><h2><SlidersHorizontal size={19} />{isMedia ? '원본 영상' : mode === 'import-link' ? '분석할 콘텐츠' : '콘텐츠 조건'}</h2><span className="ct-badge ct-badge-neutral">{isMedia ? 'MP4 · MOV · WebM' : 'Instagram'}</span></div>
    <form onSubmit={submit} className="ct-form">
      {mode === 'reference-accounts' && <div className="ct-fields ct-fields-two"><SelectField label="카테고리" value={brief.category} onChange={category=>formChanged({category})} required options={[["","카테고리 선택"],...referenceCategories.map(category=>[category,category])]}/><SelectField label="얼굴 노출" value={brief.faceVisibility} onChange={faceVisibility=>formChanged({faceVisibility})} options={[["any","상관없음"],["visible","얼굴 자주 등장"],["mixed","얼굴 일부 등장"],["hidden","얼굴 비공개"]]}/><SelectField label="계정 규모" value={brief.accountSize} onChange={accountSize=>formChanged({accountSize})} options={[["any","상관없음"],["10k_50k","1만~5만"],["50k_100k","5만~10만"],["100k_200k","10만~20만"],["over_200k","20만 이상"]]}/><SelectField label="콘텐츠 언어" value={brief.contentLanguage} onChange={contentLanguage=>formChanged({contentLanguage})} options={[["any","상관없음"],["ko","한국어"],["en","영어"],["ja","일본어"]]}/></div>}
      {mode === 'trend-keywords' && <div className="ct-fields ct-fields-two"><SelectField label="카테고리" value={brief.category} onChange={category=>formChanged({category})} required options={[["","카테고리 선택"],...trendCategories.map(category=>[category,category])]}/><SelectField label="콘텐츠 목적" value={brief.trendGoal} onChange={trendGoal=>formChanged({trendGoal})} options={[["education","정보 전달"],["problem_solving","문제 해결"],["comparison","비교"],["review","후기"],["purchase","구매 검토"],["news","새 소식"]]}/><SelectField label="시청자 단계" value={brief.audienceLevel} onChange={audienceLevel=>formChanged({audienceLevel})} options={[["beginner","입문자"],["experienced","경험자"],["ready_to_buy","구매 직전"]]}/><SelectField label="키워드 범위" value={brief.keywordScope} onChange={keywordScope=>formChanged({keywordScope})} options={[["broad","넓은 키워드"],["balanced","넓은·구체 혼합"],["specific","구체 키워드"]]}/><SelectField label="콘텐츠 구성" value={brief.contentStructure} onChange={contentStructure=>formChanged({contentStructure})} options={[["howto","사용법"],["checklist","체크리스트"],["mistakes","실수·주의점"],["comparison","비교"],["review","후기"],["case_study","사례"]]}/><SelectField label="키워드 언어" value={brief.contentLanguage} onChange={contentLanguage=>formChanged({contentLanguage})} options={[["ko","한국어"],["en","영어"],["ja","일본어"]]}/></div>}
      {mode === 'import-link' && <><Field label="인스타그램 영상 링크" type="url" value={url} onChange={(value) => { setUrl(value); setRights(false); requestKey.current = null }} required /><label className="ct-consent"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} required />직접 제작했거나 분석 권한이 있는 영상입니다.</label>{!currentAccount?.id && <p className="ct-muted">링크 대본을 저장할 계정을 선택해주세요.</p>}</>}
      {mode==='reference-accounts' && <p className="ct-muted">공개 개인 크리에이터의 주제와 전달 방식을 비교해 내 콘텐츠 방향을 살펴봅니다. 개인 크리에이터 여부, 선택한 팔로워 범위, 수집된 공개 게시물 중 조회수 50만 이상 콘텐츠 보유 여부는 필수 조건입니다.</p>}
      {mode==='import-link' && <p className="ct-muted">전달 방식이 궁금한 공개 Instagram 콘텐츠의 링크를 입력하세요. 수집 불가 시 파일·대본으로 이어서 작업할 수 있습니다.</p>}
      {isMedia && <><label className="ct-upload"><UploadCloud size={34} strokeWidth={1.5} /><strong>{file ? file.name : '편집할 영상 선택'}</strong><span>MP4, MOV, WebM · 최대 5분 · 300MB</span><input aria-label="영상 파일" type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => { setFile(e.target.files?.[0] || null); setRights(false); requestKey.current = null }} required /></label><p className="ct-muted">원본·미리보기 24시간 · 원본 포함 ZIP 7일 보관</p><label className="ct-consent"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)} required/>직접 제작했거나 분석·편집 권한이 있는 영상입니다.</label></>}
      {mode === 'feedback' && <Field label="게시할 캡션" value={caption} onChange={value=>{setCaption(value);requestKey.current=null}} required maxLength={5000} multiline/>}
      {!features[mode] && <p role="status" className="ct-notice">이 계정에는 아직 공개되지 않은 기능입니다.</p>}
      {readiness[mode]?.ready === false && <p role="status" className="ct-notice"><Info size={17} />{readiness[mode].message}</p>}
      <div className="ct-form-footer"><span className="ct-muted">{mode === 'trend-keywords' ? '실시간 통계 미연결 · AI 후보 추천' : mode === 'import-link' ? '원문 전사 · 해외 영상 한국어 해석' : isMedia ? '원본 보존 · 이용자별 비공개' : '선택한 카테고리·조건 기준'}</span><div className="ct-row">{uploadProgress !== null && <span>업로드 {uploadProgress}%</span>}<button className="ct-primary" type="submit" disabled={busy || active(job) || !features[mode] || readiness[mode]?.ready === false || (mode === 'import-link' && !currentAccount?.id)}>{busy ? '요청 중…' : mode === 'feedback' ? '영상·캡션 분석' : mode === 'media-analyze' ? '영상 분석' : mode === 'import-link' ? '대본 텍스트 추출' : mode === 'reference-accounts' ? '계정 인사이트 보기' : '키워드 찾기'}<ArrowRight size={17} /></button></div></div>
    </form>
    {error && <div role="alert" className="ct-error">{error}{!job && <button type="button" onClick={()=>{setError('');setConnectionAttempt(v=>v+1)}}>연결 다시 확인</button>}{job && <IconButton title="상태 다시 확인" onClick={() => loadJob(job)}><RefreshCw size={17} /></IconButton>}</div>}
    {job?.status === 'failed' && <div className="ct-row"><button type="button" disabled={busy || (['import-link','media-analyze'].includes(job.kind) && !rights)} onClick={retryJob}>실패한 작업 다시 요청</button>{['import-link','media-analyze'].includes(job.kind) && <span className="ct-muted">위의 자료 이용 권한을 다시 확인한 뒤 재시도해주세요.</span>}</div>}
    {active(job) && <div role="status" className="ct-progress"><span className="ct-pulse" />{stages[job.stage] || '작업 처리 중'}<small>시작 {new Date(job.createdAt).toLocaleTimeString('ko-KR')}</small></div>}
    {job?.status === 'completed' && job.kind === 'reference-accounts' && <AccountResults result={job.result} preferences={preferences} onPreference={preference} />}
    {job?.status === 'completed' && job.kind === 'trend-keywords' && <KeywordResults result={job.result} />}
    {job?.status === 'completed' && job.kind === 'import-link' && <section className="ct-results"><div className="ct-section-heading"><h2>추출된 대본</h2><span className="ct-badge">{job.result.sourceLanguage}</span></div>{copyNotice && <p role="status" className="ct-copy-notice">{copyNotice}</p>}<div className="ct-transcripts"><article><header><h3>원문</h3><button type="button" aria-label="원문 복사" onClick={()=>copyTranscript(job.result.originalTranscript,'원문')}><Copy size={16}/>복사</button></header><p>{job.result.originalTranscript}</p></article><article><header><h3>한국어 해석</h3><button type="button" aria-label="한국어 해석 복사" onClick={()=>copyTranscript(job.result.translatedTranscript,'한국어 해석')}><Copy size={16}/>복사</button></header><p>{job.result.translatedTranscript}</p></article></div></section>}
    {mode === 'import-link' && <p className="ct-muted ct-link-support-note">현재 Instagram 공개 개별 영상 링크만 지원합니다. 국내·해외 언어를 감지해 한국어로 번역합니다. 다른 플랫폼, 비공개·삭제·로그인 필요 영상은 파일 또는 대본 입력을 사용해주세요.</p>}
    {mode === 'import-link' && <button className="ct-link-upload-switch" type="button" onClick={() => changeMode('media-analyze')}>파일 업로드로 전환</button>}
    {job?.result?.feedback && <FeedbackResults result={job.result.feedback} media={media} onRefresh={async()=>{try{setMedia(await creatorRequest(`/media-projects/${media.id}`))}catch(e){setError(e.message)}}}/>}
    {media && mode !== 'feedback' && <CreatorMediaEditor key={media.id} media={media} onSave={save} onRender={render} onRefresh={async()=>{try{setMedia(await creatorRequest(`/media-projects/${media.id}`))}catch(e){setError(e.message)}}} busy={busy || active(job)} renderEnabled={features['media-render']} />}
    {mode === 'reference-accounts' && preferences.length > 0 && <details className="ct-preferences"><summary>저장·제외한 계정 ({preferences.length})</summary>{preferences.map((p) => <div className="ct-row" key={p.username}><a href={`https://www.instagram.com/${p.username}/`} target="_blank" rel="noreferrer">@{p.username}</a><span>{p.preference === 'saved' ? '저장됨' : '제외됨'}</span><IconButton title="해제" onClick={() => preference(p.username, null)}><X size={16} /></IconButton></div>)}</details>}
    {!job && !media && <div className="ct-empty"><CurrentIcon size={28} strokeWidth={1.4} /><strong>{isMedia ? '아직 선택한 영상이 없습니다' : '아직 선택한 결과가 없습니다'}</strong></div>}
    </div></div>}
    </div>
  </main>
}

function FeedbackResults({ result, media, onRefresh }) {
  const player = useRef(null)
  const stop = useRef(null)
  const names = {hook:'훅',flow:'흐름',subtitles:'자막 가독성',information:'정보 전달',cta:'CTA 연결'}
  const evidence = {transcript:'음성 전사',frame:'영상 표본',caption:'입력 캡션',unverified:'확인되지 않음'}
  return <section className="ct-results"><h2>영상·캡션 피드백</h2>{media?.previewUrl && <div className="ct-feedback-preview"><video ref={player} src={media.previewUrl} controls playsInline onTimeUpdate={()=>{if(stop.current!==null && player.current.currentTime>=stop.current){player.current.pause();stop.current=null}}}/><button type="button" onClick={onRefresh}>미리보기 링크 갱신</button></div>}<p className="ct-muted">{result.scope}</p>{result.findings.map((f,i)=><article className="ct-account" key={i}><div className="ct-row"><h3>{names[f.area]}</h3><span className="ct-badge">{evidence[f.evidence]}</span><span>{f.start===null?'구간 확인 없음':`${f.start.toFixed(2)}–${f.end.toFixed(2)}초`}</span>{f.start!==null && media?.previewUrl && <button type="button" onClick={()=>{player.current.currentTime=f.start;stop.current=f.end;void player.current.play().catch(()=>{})}}>문제 구간 재생</button>}</div><p><strong>{f.problem}</strong></p><p>{f.reason}</p><blockquote>수정 예시: {f.example}</blockquote></article>)}<p className="ct-muted ct-feedback-guidance">단, 조회수나 성과를 예측하는 기능보다는, 콘텐츠의 완성도를 높이기 위한 참고용 피드백으로 활용해주세요.</p></section>
}
