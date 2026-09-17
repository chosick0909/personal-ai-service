import { useEffect, useReducer, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Download, Film, FolderPlus, Pause, Play, Plus, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2, Volume2, VolumeX, X, ZoomIn, ZoomOut, Brackets, PanelLeftClose, PanelRightClose, Captions } from 'lucide-react'
import { durationOf, editHistory, locateTime, MIN_CLIP, projectCaptions, removeRange, splitClip, timelineRows, timeLabel, toSrt } from '../lib/demoTimeline'
import './DemoVideoEditor.css'

const sample = { id: 'sample', name: '꽃 촬영 · 샘플 영상.mp4', url: '/demo/editor-sample.mp4', poster: '/demo/editor-sample.jpg', duration: 5.055 }
const uid = () => crypto.randomUUID()
const clipFrom = asset => ({ id: uid(), assetId: asset.id, start: 0, end: asset.duration })
const startingProject = { clips: [{ id: 'sample-clip', assetId: sample.id, start: 0, end: sample.duration }], captions: [] }
function downloadFile(name, value, type) {
  const url = URL.createObjectURL(new Blob([value], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function inspectVideo(url, name, id) {
  return new Promise((resolve, reject) => {
    const media = document.createElement('video')
    media.preload = 'metadata'
    const finish = (error, asset) => {
      clearTimeout(timer)
      media.onloadedmetadata = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      if (error) reject(error)
      else resolve(asset)
    }
    const timer = setTimeout(() => finish(new Error('영상 정보를 읽지 못했습니다. 다른 MP4 파일을 선택해주세요.')), 15000)
    media.onloadedmetadata = () => {
      if (!Number.isFinite(media.duration) || media.duration < MIN_CLIP) return finish(new Error('편집 가능한 길이의 영상이 아닙니다.'))
      finish(null, { id, name, url, duration: media.duration })
    }
    media.onerror = () => finish(new Error('이 브라우저에서 재생할 수 없는 형식입니다. H.264 MP4 파일을 선택해주세요.'))
    media.src = url
  })
}
function IconButton({ title, children, ...props }) {
  return <button type="button" className="ve-icon" title={title} aria-label={title} {...props}>{children}</button>
}

export default function DemoVideoEditor({ initialVideo, onDetailChange }) {
  const [detail, setDetail] = useState(false)
  const [assets, setAssets] = useState([sample])
  const [history, dispatch] = useReducer(editHistory, { past: [], present: startingProject, future: [] })
  const project = history.present
  const [selectedId, setSelectedId] = useState('sample-clip')
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [activeAsset, setActiveAsset] = useState(sample)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [marks, setMarks] = useState({ start: null, end: null })
  const [suggestions, setSuggestions] = useState([])
  const [checked, setChecked] = useState([false, false])
  const [applied, setApplied] = useState(false)
  const [reviewLocked, setReviewLocked] = useState(false)
  const [trimStart, setTrimStart] = useState('0')
  const [trimEnd, setTrimEnd] = useState(String(sample.duration))
  const [captionText, setCaptionText] = useState('')
  const [showCaptions, setShowCaptions] = useState(true)
  const [subtitleMode, setSubtitleMode] = useState(false)
  const player = useRef(null)
  const input = useRef(null)
  const projectRef = useRef(project)
  const assetsRef = useRef(assets)
  const activeRef = useRef(sample.id)
  const indexRef = useRef(0)
  const playingRef = useRef(false)
  const pendingSeek = useRef(null)
  const captionStop = useRef(null)
  const objectUrls = useRef([])
  const mounted = useRef(true)
  const raf = useRef(null)
  projectRef.current = project
  assetsRef.current = assets
  const clips = project.clips
  const rows = timelineRows(clips)
  const duration = durationOf(clips)
  const selected = rows.find(row => row.id === selectedId)
  const selectedAsset = assets.find(asset => asset.id === selected?.assetId)
  const selectedIndex = clips.findIndex(clip => clip.id === selectedId)
  const sourceAtPlayhead = selected ? selected.start + playhead - selected.offset : 0
  const canCut = selected && sourceAtPlayhead - selected.start >= MIN_CLIP && selected.end - sourceAtPlayhead >= MIN_CLIP
  const projectedCues = projectCaptions(clips, project.captions)
  const visibleCue = projectedCues.find(cue => playhead >= cue.start && playhead < cue.end)

  function pause() {
    playingRef.current = false
    setPlaying(false)
    player.current?.pause()
  }
  function startPlayback() {
    const result = player.current?.play()
    result?.catch(() => { if (mounted.current) { pause(); setError('재생을 시작하지 못했습니다. 재생 버튼을 다시 누르거나 다른 영상 파일을 선택해주세요.') } })
  }
  function seek(time, resume = playingRef.current) {
    const located = locateTime(projectRef.current.clips, time)
    if (!located) { pause(); setPlayhead(0); return }
    const asset = assetsRef.current.find(item => item.id === located.assetId)
    if (!asset) return
    indexRef.current = located.index
    setPlayhead(located.time)
    playingRef.current = resume
    setPlaying(resume)
    pendingSeek.current = located.sourceTime
    if (activeRef.current !== asset.id) {
      activeRef.current = asset.id
      setActiveAsset(asset)
    } else if (player.current?.readyState >= 1) {
      player.current.currentTime = located.sourceTime
      pendingSeek.current = null
      if (resume) startPlayback()
      else player.current.pause()
    }
  }
  function togglePlay() {
    captionStop.current = null
    setError('')
    if (playingRef.current) pause()
    else seek(playhead >= duration - 0.03 ? 0 : playhead, true)
  }
  function syncPlayback() {
    const media = player.current
    const currentRows = timelineRows(projectRef.current.clips)
    const row = currentRows[indexRef.current]
    if (!media || !row || pendingSeek.current !== null || media.seeking) return
    if (playingRef.current && captionStop.current !== null && row.offset + media.currentTime - row.start >= captionStop.current) {
      const end = captionStop.current
      captionStop.current = null
      pause()
      seek(end, false)
      return
    }
    if (playingRef.current && media.currentTime >= row.end - 0.018) {
      const next = currentRows[indexRef.current + 1]
      if (next) seek(next.offset, true)
      else { pause(); setPlayhead(durationOf(projectRef.current.clips)) }
    } else if (playingRef.current) {
      setPlayhead(row.offset + Math.max(0, Math.min(row.duration, media.currentTime - row.start)))
    }
  }
  const syncRef = useRef(syncPlayback)
  syncRef.current = syncPlayback
  useEffect(() => {
    const tick = () => { syncRef.current(); raf.current = requestAnimationFrame(tick) }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; objectUrls.current.forEach(url => URL.revokeObjectURL(url)) }
  }, [])
  useEffect(() => { onDetailChange(detail) }, [detail, onDetailChange])
  useEffect(() => {
    let cancelled = false
    const initialize = asset => {
      if (cancelled) return
      const next = { clips: [clipFrom(asset)], captions: [] }
      assetsRef.current = [asset]
      setAssets([asset])
      dispatch({ type: 'reset', project: next })
      projectRef.current = next
      setSelectedId(next.clips[0].id)
      activeRef.current = asset.id
      setActiveAsset(asset)
      pendingSeek.current = 0
      setSuggestions([
        { start: 0, end: Math.min(1.2, asset.duration * 0.12), label: '도입부 공백', reason: '첫 장면에 바로 진입하는 편집 예시' },
        { start: asset.duration * 0.48, end: asset.duration * 0.58, label: '설명 사이 긴 쉼', reason: '전개 속도를 높이는 삭제 구간 예시' },
      ])
    }
    if (initialVideo) {
      setImporting(true)
      inspectVideo(initialVideo.url, initialVideo.name, 'uploaded').then(initialize).catch(e => { if (!cancelled) { setError(e.message); initialize(sample) } }).finally(() => { if (!cancelled) setImporting(false) })
    } else initialize(sample)
    return () => { cancelled = true }
  }, [initialVideo])
  useEffect(() => {
    pause()
    const nextId = clips.some(clip => clip.id === selectedId) ? selectedId : clips[0]?.id
    setSelectedId(nextId ?? null)
    setMarks({ start: null, end: null })
    seek(Math.min(playhead, duration), false)
    // Edit decisions are the playback source of truth, including undo/redo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  useEffect(() => { setTrimStart((selected?.start ?? 0).toFixed(3)); setTrimEnd((selected?.end ?? 0).toFixed(3)) }, [selected?.id, selected?.start, selected?.end])
  useEffect(() => {
    if (!exportOpen) return
    const previous = document.activeElement
    const dialog = document.querySelector('.ve-export-dialog')
    const buttons = [...dialog.querySelectorAll('button:not(:disabled)')]
    buttons[0]?.focus()
    function key(event) {
      if (event.key === 'Escape') setExportOpen(false)
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [exportOpen])

  function commit(nextClips, text, captions = project.captions) {
    pause()
    setError('')
    dispatch({ type: 'edit', project: { clips: nextClips, captions } })
    setMessage(text)
  }
  function applySuggestions() {
    let next = clips
    suggestions.filter((_, i) => checked[i]).sort((a, b) => b.start - a.start).forEach(cut => { next = removeRange(next, cut.start, cut.end, uid) })
    commit(next, '선택한 구간을 삭제했습니다. 재생하면 남은 구간이 이어집니다.')
    setApplied(true)
  }
  async function importFiles(fileList) {
    if (!fileList.length) return
    setImporting(true)
    setError('')
    let added = 0
    try {
      for (const file of [...fileList]) {
        const url = URL.createObjectURL(file)
        objectUrls.current.push(url)
        const asset = await inspectVideo(url, file.name, uid())
        if (!mounted.current) return
        setAssets(items => [...items, asset])
        added++
      }
      setMessage(`${added}개 영상을 가져왔습니다. + 버튼으로 타임라인에 추가하세요.`)
    } catch (e) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setImporting(false) }
  }
  function reorder(direction) {
    const next = [...clips]
    const other = selectedIndex + direction
    if (other < 0 || other >= clips.length) return
    ;[next[selectedIndex], next[other]] = [next[other], next[selectedIndex]]
    commit(next, '클립 순서를 변경했습니다.')
  }
  function trim(side) {
    if (!canCut) return
    commit(clips.map(clip => clip.id === selectedId ? { ...clip, [side === 'before' ? 'start' : 'end']: sourceAtPlayhead } : clip), side === 'before' ? '선택 클립의 재생 위치 앞부분을 잘랐습니다.' : '선택 클립의 재생 위치 뒷부분을 잘랐습니다.')
  }
  function saveTrim() {
    const start = Number(trimStart), end = Number(trimEnd)
    if (!selected || trimStart.trim() === '' || trimEnd.trim() === '' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > selectedAsset.duration || end - start < MIN_CLIP) return setError('시작·끝은 원본 영상 범위 안에서, 0.08초 이상 간격으로 지정해주세요.')
    commit(clips.map(clip => clip.id === selectedId ? { ...clip, start, end } : clip), '클립의 시작·끝 시간을 적용했습니다.')
  }
  function addCaption() {
    if (!selected || !captionText.trim()) return
    const cue = { id: uid(), assetId: selected.assetId, start: selected.start, end: selected.end, text: captionText.trim() }
    commit(clips, '선택 클립 구간에 자막을 추가했습니다.', [...project.captions, cue])
    setCaptionText('')
  }
  function generateExampleCaptions() {
    const used = new Set(clips.map(clip => clip.assetId))
    const missing = assets.filter(asset => used.has(asset.id) && !project.captions.some(cue => cue.assetId === asset.id))
    const sentences = ['첫 장면에서 시선을 모아보세요.', '가까이에서 디테일을 보여줍니다.', '마지막 장면은 여유 있게 마무리해요.']
    const added = missing.flatMap(asset => sentences.map((text, i) => ({ id: uid(), assetId: asset.id, start: asset.duration*i/3, end: asset.duration*(i+1)/3, text, originalText: text })))
    if (added.length) commit(clips, '예시 자막을 불러왔습니다. 실제 음성 인식 결과가 아닙니다.', [...project.captions, ...added])
    else setMessage('기존 자막을 유지합니다. 아래 문장을 직접 수정할 수 있습니다.')
    setSubtitleMode(true)
    setShowCaptions(true)
  }
  function updateCue(id, patch) {
    commit(clips, '자막 수정 내용을 미리보기와 SRT에 반영했습니다.', project.captions.map(cue => cue.id === id ? { ...cue, ...patch } : cue))
  }
  function splitCue(cue) {
    const middle = (cue.start + cue.end) / 2
    if (cue.end - cue.start < MIN_CLIP*2) return
    const words = cue.text.split(/\s+/)
    const at = Math.ceil(words.length/2)
    const left = words.slice(0,at).join(' '), right = words.slice(at).join(' ') || left
    commit(clips, '자막을 두 구간으로 나눴습니다. 영상은 잘리지 않습니다.', project.captions.flatMap(item => item.id === cue.id ? [{ ...item, end: middle, text: left }, { ...item, id: uid(), start: middle, text: right }] : [item]))
  }
  const captionRows = projectCaptions(clips, project.captions)
  const subtitlePanel = <section className="ve-transcript-panel">
    <header><div><h2>문장별 자막 편집</h2><p>예시 전사문 · 실제 음성 인식은 연결하지 않았습니다.</p></div><span className="ct-badge">{captionRows.length}개 구간</span></header>
    <div className="ve-transcript-actions"><button onClick={generateExampleCaptions} disabled={!clips.length}><Captions size={16}/>자동자막 생성 시연</button><label><input type="checkbox" checked={showCaptions} onChange={e=>setShowCaptions(e.target.checked)}/>영상에 자막 표시</label></div>
    {!captionRows.length && <div className="ve-subtitle-empty"><Captions size={30}/><p>자동자막 생성 시연을 누르면 문장별 예시 자막이 표시됩니다.</p></div>}
    <div className="ve-transcript-list">{captionRows.map((projected,i)=>{
      const cue = project.captions.find(item=>item.id===projected.id)
      const asset = assets.find(item=>item.id===cue.assetId)
      const next = [...project.captions].filter(item=>item.assetId===cue.assetId&&item.start>=cue.end&&item.id!==cue.id).sort((a,b)=>a.start-b.start)[0]
      return <SubtitleRow key={`${cue.id}-${i}`} cue={cue} number={i+1} projected={projected} asset={asset} active={visibleCue?.id===cue.id} onSave={patch=>updateCue(cue.id,patch)} onError={setError} onPlay={()=>{seek(projected.start,true);captionStop.current=projected.end}} onSplit={()=>splitCue(cue)} onDelete={()=>commit(clips,'자막만 삭제했습니다. 영상은 유지됩니다.',project.captions.filter(item=>item.id!==cue.id))} onMerge={next?()=>commit(clips,'다음 자막과 합쳤습니다.',project.captions.filter(item=>item.id!==next.id).map(item=>item.id===cue.id?{...item,end:next.end,text:`${item.text}\n${next.text}`}:item)):null}/>
    })}</div>
  </section>

  const playerView = <div className="ve-preview">
    <div className="ve-preview-heading"><span><Play size={13}/>프로그램 미리보기</span><span>{duration.toFixed(2)}초 · {clips.length}개 클립</span></div>
    <div className="ve-canvas">
      <video ref={player} src={activeAsset.url} poster={activeAsset.poster} playsInline muted={muted} preload="auto" aria-label="편집 영상 미리보기" onLoadedMetadata={() => {
        const located = locateTime(projectRef.current.clips, playhead)
        const sourceTime = pendingSeek.current ?? (located?.assetId === activeRef.current ? located.sourceTime : 0)
        player.current.currentTime = sourceTime
        pendingSeek.current = null
        if (playingRef.current) startPlayback()
      }} onEnded={() => {
        if (!playingRef.current) return
        const next = timelineRows(projectRef.current.clips)[indexRef.current + 1]
        if (next) seek(next.offset, true)
        else { pause(); setPlayhead(durationOf(projectRef.current.clips)) }
      }} onError={() => { pause(); setError('영상 재생에 실패했습니다. 다른 MP4 파일을 가져와주세요.') }}/>
      {!clips.length && <div className="ve-empty-canvas"><Film size={34}/><strong>타임라인이 비어 있습니다</strong><span>실행 취소하거나 미디어에서 영상을 추가하세요.</span></div>}
      {showCaptions && visibleCue && <span className="ve-caption-overlay">{visibleCue.text}</span>}
    </div>
    <div className="ve-player-controls"><span className="ve-time">{timeLabel(playhead, true)} <small>/ {timeLabel(duration, true)}</small></span><div><IconButton title="처음으로" onClick={()=>seek(0,false)} disabled={!clips.length}><SkipBack size={16}/></IconButton><IconButton title={playing?'일시정지':'재생'} onClick={togglePlay} disabled={!clips.length||importing}>{playing?<Pause size={20}/>:<Play size={20}/>}</IconButton><IconButton title="끝으로" onClick={()=>seek(duration,false)} disabled={!clips.length}><SkipForward size={16}/></IconButton></div><IconButton title={muted?'소리 켜기':'음소거'} onClick={()=>setMuted(value=>!value)}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</IconButton></div>
    <input className="ve-scrubber" type="range" min="0" max={duration||0.01} step="0.01" value={Math.min(playhead,duration)} aria-label="재생 위치" disabled={!clips.length} onChange={e=>seek(Number(e.target.value),false)}/>
  </div>
  return <section className={`ve-editor ${detail?'ve-detailed':'ve-review'}`}>
    <div className="ve-workflow"><span className={!detail?'is-active':''}><b>1</b>AI 컷 제안</span><ChevronRight size={16}/><span className={detail?'is-active':''}><b>2</b>상세 편집</span><span className="ve-local-badge">내 기기에서 편집 · 업로드 없음</span></div>
    <input ref={input} className="ve-file-input" type="file" multiple accept="video/*" aria-label="편집 영상 추가" onChange={e=>{importFiles(e.target.files);e.target.value=''}}/>
    {error && <div className="ve-error" role="alert">{error}<IconButton title="오류 닫기" onClick={()=>setError('')}><X size={15}/></IconButton></div>}
    {importing && <div className="ve-message" role="status">영상 정보를 읽고 있습니다.</div>}
    {!detail ? <>
      <div className="ve-review-grid">{playerView}<section className="ve-suggestions">
        <header><h2>잘라내면 좋은 구간</h2><span className="ct-badge">AI 제안 · 시연</span></header>
        <p>{reviewLocked?'상세 편집 내용을 유지하고 있습니다. 구간 변경은 상세 편집에서 계속할 수 있습니다.':'아래 구간은 분석 결과의 예시입니다. 체크한 구간은 실제 미리보기에서 제외됩니다.'}</p>
        {suggestions.map((cut,i)=><article key={i} className={checked[i]?'is-checked':''}><label><input type="checkbox" checked={checked[i]} disabled={applied||reviewLocked} onChange={e=>setChecked(items=>items.map((v,n)=>n===i?e.target.checked:v))}/><span><strong>{cut.label}</strong><small>{cut.reason}</small></span></label><div><span>{timeLabel(cut.start,true)} → {timeLabel(cut.end,true)}</span><IconButton title={`${cut.label} 구간 재생`} disabled={applied||reviewLocked} onClick={()=>seek(cut.start,true)}><Play size={14}/></IconButton></div></article>)}
        <div className="ve-cut-total"><span>제안에서 선택한 길이</span><strong>{suggestions.reduce((sum,cut,i)=>sum+(checked[i]?cut.end-cut.start:0),0).toFixed(2)}초</strong></div>
        <button className="ct-primary" disabled={applied||reviewLocked||!checked.some(Boolean)||importing} onClick={applySuggestions}><Trash2 size={16}/>{reviewLocked?'상세 편집 결과 반영됨':applied?'선택 구간 삭제 완료':'선택 구간 삭제'}</button>
        {applied&&!reviewLocked&&<button onClick={()=>{dispatch({type:'undo'});setApplied(false);setMessage('AI 컷 적용을 되돌렸습니다.')}}><Undo2 size={16}/>삭제 되돌리기</button>}
      </section></div>
      <footer className="ve-review-footer"><span>{applied?'삭제 결과를 이어서 상세 편집할 수 있습니다.':'선택 구간을 삭제하거나 원본 그대로 상세 편집할 수 있습니다.'}</span><button className="ct-primary" disabled={importing} onClick={()=>{pause();setDetail(true)}}>상세 편집<ArrowRight size={17}/></button></footer>
    </> : <>
      <header className="ve-project-bar"><button onClick={()=>{pause();setDetail(false);setReviewLocked(history.past.length>0)}}><ArrowLeft size={15}/>컷 제안 보기</button><div><strong>릴스 편집 프로젝트</strong><span>로컬 편집 · {clips.length}개 클립 · {duration.toFixed(2)}초</span></div><button className="ct-primary" onClick={()=>{pause();setExportOpen(true)}}><Download size={15}/>내보내기</button></header>
      <nav className="ve-edit-modes" aria-label="편집 방식"><button aria-pressed={!subtitleMode} onClick={()=>setSubtitleMode(false)}><Scissors size={16}/>영상 편집</button><button aria-pressed={subtitleMode} onClick={()=>setSubtitleMode(true)}><Captions size={16}/>자막 편집</button><button className="ct-primary" onClick={generateExampleCaptions} disabled={!clips.length}><Captions size={16}/>자동자막 생성 시연</button></nav>
      <div className={subtitleMode?'ve-subtitle-layout':'ve-standard-layout'}>
      <div className="ve-edit-grid"><aside className="ve-media"><header><h3><FolderPlus size={17}/>미디어</h3><IconButton title="영상 가져오기" disabled={importing} onClick={()=>input.current.click()}><Plus size={17}/></IconButton></header>{assets.map(asset=><article key={asset.id}>{asset.poster?<img src={asset.poster} alt="샘플 영상 미리보기"/>:<video src={asset.url} preload="metadata" muted playsInline aria-label={`${asset.name} 썸네일`}/>}<strong title={asset.name}>{asset.name}</strong><footer><small>{timeLabel(asset.duration,true)}</small><IconButton title={`${asset.name} 타임라인에 추가`} onClick={()=>{const clip=clipFrom(asset);commit([...clips,clip],'영상을 타임라인 끝에 이어붙였습니다.');setSelectedId(clip.id)}}><Plus size={16}/></IconButton></footer></article>)}<button className="ve-import" disabled={importing} onClick={()=>input.current.click()}><UploadIcon/>영상 가져오기</button><p>추가한 영상은 타임라인 순서대로 이어서 재생됩니다.</p></aside>
      {playerView}
      {subtitleMode && subtitlePanel}
      <aside className="ve-inspector"><header><h3>클립 속성</h3><span>{selectedIndex>=0?`클립 ${selectedIndex+1}`:'선택 없음'}</span></header>{selected ? <><p className="ve-asset-name">{selectedAsset?.name}</p><div className="ve-duration-label"><span>선택 길이</span><strong>{selected.duration.toFixed(2)}초</strong></div><label>원본 시작 (초)<input type="number" min="0" max={selectedAsset?.duration} step="0.01" value={trimStart} onChange={e=>setTrimStart(e.target.value)}/></label><label>원본 끝 (초)<input type="number" min="0" max={selectedAsset?.duration} step="0.01" value={trimEnd} onChange={e=>setTrimEnd(e.target.value)}/></label><button onClick={saveTrim}><Check size={15}/>시간 적용</button><h3>이어붙이는 순서</h3><div className="ve-order"><button disabled={selectedIndex===0} onClick={()=>reorder(-1)}><ChevronLeft size={15}/>앞으로</button><button disabled={selectedIndex===clips.length-1} onClick={()=>reorder(1)}>뒤로<ChevronRight size={15}/></button></div><h3><Captions size={16}/>자막</h3><label className="ve-check"><input type="checkbox" checked={showCaptions} onChange={e=>setShowCaptions(e.target.checked)}/>자막 미리보기</label><label>선택 클립에 넣을 문장<textarea aria-label="클립 자막 문장" value={captionText} onChange={e=>setCaptionText(e.target.value)} placeholder="자막을 입력하세요"/></label><button disabled={!captionText.trim()} onClick={addCaption}><Plus size={15}/>자막 추가</button>{project.captions.filter(cue=>cue.assetId===selected.assetId&&cue.start<selected.end&&cue.end>selected.start).map(cue=><div className="ve-cue-edit" key={cue.id}><input aria-label={`자막 수정 ${cue.id}`} value={cue.text} onChange={e=>commit(clips,'자막을 수정했습니다.',project.captions.map(v=>v.id===cue.id?{...v,text:e.target.value}:v))}/><IconButton title="자막 삭제" onClick={()=>commit(clips,'자막을 삭제했습니다.',project.captions.filter(v=>v.id!==cue.id))}><X size={14}/></IconButton></div>)}</> : <p>타임라인에서 편집할 클립을 선택하세요.</p>}</aside></div>
      </div>
      <section className="ve-timeline"><div className="ve-toolbar"><div className="ve-tool-group"><IconButton title="실행 취소" disabled={!history.past.length} onClick={()=>dispatch({type:'undo'})}><Undo2 size={17}/></IconButton><IconButton title="다시 실행" disabled={!history.future.length} onClick={()=>dispatch({type:'redo'})}><Redo2 size={17}/></IconButton></div><div className="ve-tool-group"><button disabled={!canCut} onClick={()=>commit(splitClip(clips,selectedId,sourceAtPlayhead,uid()),'재생 위치에서 클립을 분할했습니다.')}><Scissors size={16}/>분할</button><button disabled={!canCut} onClick={()=>trim('before')}><PanelLeftClose size={16}/>앞부분 자르기</button><button disabled={!canCut} onClick={()=>trim('after')}><PanelRightClose size={16}/>뒷부분 자르기</button><IconButton title="선택 클립 삭제" disabled={!selected} onClick={()=>commit(clips.filter(clip=>clip.id!==selectedId),'선택 클립을 삭제했습니다.')}><Trash2 size={16}/></IconButton></div><div className="ve-zoom"><IconButton title="타임라인 축소" disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={16}/></IconButton><span>{Math.round(zoom*100)}%</span><IconButton title="타임라인 확대" disabled={zoom>=4} onClick={()=>setZoom(z=>Math.min(4,z+.5))}><ZoomIn size={16}/></IconButton></div></div>
      <div className="ve-range-tools"><Brackets size={16}/><button disabled={!clips.length} onClick={()=>setMarks(value=>({...value,start:playhead}))}>삭제 시작 지정</button><span>{marks.start===null?'--:--':timeLabel(marks.start,true)}</span><button disabled={!clips.length} onClick={()=>setMarks(value=>({...value,end:playhead}))}>삭제 끝 지정</button><span>{marks.end===null?'--:--':timeLabel(marks.end,true)}</span><button disabled={marks.start===null||marks.end===null||marks.end<=marks.start} onClick={()=>commit(removeRange(clips,marks.start,marks.end,uid),'지정한 구간을 삭제하고 앞뒤를 이어붙였습니다.')}><Trash2 size={14}/>구간 삭제</button></div>
      <div className="ve-tracks"><div className="ve-track-labels"><span>타임라인</span><span><Film size={16}/>영상</span><span><Captions size={16}/>자막</span><span><Volume2 size={16}/>원본 소리</span></div><div className="ve-track-scroll"><div className="ve-track-content" style={{width:`${zoom*100}%`,minWidth:520}}><div className="ve-ruler">{Array.from({length:11},(_,i)=><button key={i} onClick={()=>seek(duration*i/10,false)}>{timeLabel(duration*i/10,true)}</button>)}</div><div className="ve-video-track">{rows.map((clip,i)=>{const asset=assets.find(a=>a.id===clip.assetId);return <button key={clip.id} className={`ve-clip ${selectedId===clip.id?'is-selected':''}`} aria-pressed={selectedId===clip.id} aria-label={`클립 ${i+1} 선택`} style={{width:`${clip.duration/duration*100}%`,backgroundImage:asset.poster?`linear-gradient(#261e3c77,#261e3c77),url("${asset.poster}")`:undefined}} onClick={e=>{setSelectedId(clip.id);const rect=e.currentTarget.getBoundingClientRect();const ratio=e.detail===0?0:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));seek(clip.offset+clip.duration*ratio,false)}}><span>{i+1} · {asset.name}</span><small>{clip.duration.toFixed(2)}초</small></button>})}</div><div className="ve-caption-track">{projectedCues.map((cue,i)=><button key={`${cue.id}-${i}`} title={cue.text} style={{left:`${cue.start/(duration||1)*100}%`,width:`${(cue.end-cue.start)/(duration||1)*100}%`}} onClick={()=>seek(cue.start,false)}>{cue.text}</button>)}</div><div className="ve-audio-track">{rows.map(clip=><div key={clip.id} style={{width:`${clip.duration/duration*100}%`}}><Volume2 size={13}/><span>원본 오디오</span></div>)}</div>{clips.length>0&&<div className="ve-playhead" style={{left:`${Math.min(100,playhead/duration*100)}%`}}><span/></div>}{marks.start!==null&&marks.end!==null&&marks.end>marks.start&&<div className="ve-range-mark" style={{left:`${marks.start/duration*100}%`,width:`${(marks.end-marks.start)/duration*100}%`}}/>}</div></div></div><footer><span>{selected?`클립 ${selectedIndex+1} 선택 · 원본 ${timeLabel(selected.start,true)} ~ ${timeLabel(selected.end,true)}`:'클립을 추가해주세요'}</span><span>총 {timeLabel(duration,true)}</span></footer></section>
    </>}
    {message && <p className="ve-message" role="status"><Check size={14}/>{message}</p>}
    {exportOpen && <div className="ve-export-backdrop" onClick={()=>setExportOpen(false)}><section className="ve-export-dialog" role="dialog" aria-modal="true" aria-label="편집 내보내기" onClick={e=>e.stopPropagation()}><header><h2>편집 결과 내보내기</h2><IconButton title="내보내기 닫기" onClick={()=>setExportOpen(false)}><X size={18}/></IconButton></header><p>{clips.length}개 클립 · {duration.toFixed(2)}초 · 자막 {projectedCues.length}개</p><p>시연에서는 편집 결정 목록과 자막 파일을 저장합니다. 최종 MP4 렌더링과 CapCut 프로젝트 변환은 실행하지 않습니다.</p><button className="ct-primary" onClick={()=>downloadFile('HookAI-edit-decisions.json',JSON.stringify({version:1,duration,assets:assets.map(({id,name,duration})=>({id,name,duration})),clips,captions:projectedCues},null,2),'application/json')}><Download size={16}/>편집 목록 JSON</button><button disabled={!projectedCues.length} onClick={()=>downloadFile('HookAI-edited-subtitles.srt',toSrt(projectedCues),'text/plain;charset=utf-8')}><Download size={16}/>편집 자막 SRT</button></section></div>}
  </section>
}
function UploadIcon() { return <FolderPlus size={17}/> }

function SubtitleRow({ cue, projected, asset, number, active, onSave, onError, onPlay, onSplit, onMerge, onDelete }) {
  const [text, setText] = useState(cue.text)
  const [start, setStart] = useState(cue.start.toFixed(3))
  const [end, setEnd] = useState(cue.end.toFixed(3))
  useEffect(()=>{setText(cue.text);setStart(cue.start.toFixed(3));setEnd(cue.end.toFixed(3))},[cue.text,cue.start,cue.end])
  function saveTime() {
    const a=Number(start), b=Number(end)
    if(!start.trim()||!end.trim()||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>asset.duration+0.0005||b-a<MIN_CLIP){onError('자막 시작·끝 시간을 영상 범위 안에서 지정해주세요.');return}
    onSave({start:a,end:Math.min(b,asset.duration)})
  }
  return <article className={`ve-subtitle-row${active?' is-active':''}`}>
    <header><strong>{String(number).padStart(2,'0')}</strong><button onClick={onPlay} title="이 자막 구간 재생"><Play size={14}/>{timeLabel(projected.start,true)} → {timeLabel(projected.end,true)}</button><span>{asset.name}</span></header>
    <div className="ve-original-words"><span>전사 예시</span><p>{cue.originalText||cue.text}</p></div>
    <label className="ve-subtitle-text"><Captions size={16}/><textarea aria-label={`자막 ${number} 문장`} value={text} onChange={e=>setText(e.target.value)} onBlur={()=>{if(text!==cue.text)onSave({text})}}/></label>
    <footer><label>원본 시작<input aria-label={`자막 ${number} 시작`} type="number" step="0.01" min="0" value={start} onChange={e=>setStart(e.target.value)}/></label><label>원본 끝<input aria-label={`자막 ${number} 끝`} type="number" step="0.01" min="0" value={end} onChange={e=>setEnd(e.target.value)}/></label><IconButton title={`자막 ${number} 시간 적용`} onClick={saveTime}><Check size={14}/></IconButton><div className="ve-subtitle-operations"><button onClick={onSplit} disabled={cue.end-cue.start<MIN_CLIP*2}><Scissors size={13}/>나누기</button><button onClick={onMerge} disabled={!onMerge}>다음과 합치기</button><IconButton title={`자막 ${number} 삭제`} onClick={onDelete}><Trash2 size={14}/></IconButton></div></footer>
  </article>
}
