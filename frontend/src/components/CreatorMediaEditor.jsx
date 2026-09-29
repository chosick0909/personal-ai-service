import { subtractSourceRanges, preservesRetainedSpeech } from '../lib/sourceCuts'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ArrowLeft, Captions, Check, ChevronRight, Download, Film, Pause, Play, Redo2, RefreshCw, Scissors, SkipBack, SkipForward, Trash2, Undo2, Volume2 } from 'lucide-react'
import { durationOf, editHistory, locateTime, projectCaptions, removeRange, splitClip, timelineRows, timeLabel, toSrt } from '../lib/demoTimeline'
import { diagnoseTempo } from '../lib/tempoDiagnosis'
import './DemoVideoEditor.css'

const uid = () => crypto.randomUUID()
const sourceClips = (media) => {
  if (media.manifest.clips) return media.manifest.clips.map(c => ({ ...c, assetId: 'original' }))
  let clips = [{ id: uid(), assetId: 'original', start: 0, end: Number(media.durationSeconds) }]
  for (const cut of [...media.manifest.cuts].filter(c => c.enabled).sort((a,b) => b.start-a.start)) clips = removeRange(clips, cut.start, cut.end, uid)
  return clips
}
const projectOf = media => ({ ...media.manifest, clips: sourceClips(media) })
const validProject = (p, duration) => p.clips.length > 0 && p.clips.length <= 100 && durationOf(p.clips) >= .5 && durationOf(p.clips) <= 300 && p.clips.every(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end <= duration && c.end-c.start >= .08) && p.subtitles.length <= 500 && p.subtitles.every((c,i) => c.text.trim() && c.text.length <= 500 && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= (i ? p.subtitles[i-1].end : 0) && c.end > c.start && c.end <= duration)

export default function CreatorMediaEditor({ media, onSave, onRender, onRefresh, busy, renderEnabled }) {
  const [history, dispatch] = useReducer(editHistory, media, m => ({ past: [], present: projectOf(m), future: [] }))
  const tempo = useMemo(() => diagnoseTempo(media.manifest.subtitles, media.durationSeconds), [media.manifest.subtitles, media.durationSeconds])
  const draft = history.present
  const [saved, setSaved] = useState(() => JSON.stringify(history.present))
  const [detail, setDetail] = useState(Boolean(media.manifest.clips))
  const [selected, setSelected] = useState(null)
  const [time, setTime] = useState(0)
  const [error, setError] = useState('')
  const [showCaptions, setShowCaptions] = useState(true)
  const [checked, setChecked] = useState([])
  const [cutPreview, setCutPreview] = useState(null)
  const [subtitleMode, setSubtitleMode] = useState(true)
  const video = useRef(null), current = useRef(0), stop = useRef(null)
  const recommendations = [...draft.cuts, ...(media.manifest.hookDiagnosis?.items || []).filter(item=>item.action==='remove')]
  const candidate = useMemo(() => ({...draft, clips: subtractSourceRanges(draft.clips,
    [...draft.cuts, ...(media.manifest.hookDiagnosis?.items || []).filter(item=>item.action==='remove')].filter(c=>checked.includes(c.id)), uid)}), [draft,checked,media.manifest.hookDiagnosis])
  const preview = cutPreview?.base === draft && cutPreview?.selection === checked ? cutPreview.project : null
  const playbackClips = preview?.clips || draft.clips
  const duration = durationOf(playbackClips), rows = timelineRows(playbackClips)
  const removedDuration = durationOf(draft.clips)-durationOf(candidate.clips)
  const preservesSpeech = preservesRetainedSpeech(candidate.clips,recommendations.filter(c=>checked.includes(c.id)))
  const validCandidate = preservesSpeech && validProject(candidate,Number(media.durationSeconds))
  function changeChecked(next) { video.current?.pause(); setCutPreview(null); setChecked(next); current.current=0; setTime(0) }
  function previewCuts() {
    if(!validCandidate || removedDuration<=0) return
    video.current?.pause(); setCutPreview({base:draft,selection:checked,project:candidate}); current.current=0; setTime(0)
    if(video.current) { video.current.currentTime=candidate.clips[0].start; void video.current.play().catch(()=>setError('미리보기를 재생하지 못했습니다.')) }
  }
  const cues = projectCaptions(playbackClips, draft.subtitles.map(c => ({ ...c, assetId: 'original' })))
  const visible = cues.find(c => time >= c.start && time < c.end)
  const dirty = JSON.stringify(draft) !== saved
  const valid = validProject(draft, Number(media.durationSeconds))
  const index = draft.clips.findIndex(c => c.id === selected)
  const clip = draft.clips[index]
  useEffect(() => {
    const guard = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  function edit(next) {
    video.current?.pause(); stop.current = null; setCutPreview(null); setError('')
    dispatch({ type: 'edit', project: next }); current.current = 0; setTime(0)
    if (video.current && next.clips[0]) video.current.currentTime = next.clips[0].start
  }
  function seek(value, play = false, until = null) {
    const loc = locateTime(playbackClips, value)
    if (!loc || !video.current) return
    current.current = loc.index; video.current.currentTime = loc.sourceTime; setTime(value); stop.current = until
    if (play) void video.current.play().catch(() => setError('영상 재생을 시작하지 못했습니다. 미리보기 링크를 갱신해주세요.'))
  }
  function playObservation(range) {
    const loc = rows.find(r => range.start >= r.start && range.start < r.end)
    if (loc) seek(loc.offset + range.start-loc.start, true, loc.offset + Math.min(range.end,loc.end)-loc.start)
    else setError('이미 삭제된 구간입니다. 실행 취소 후 확인해주세요.')
  }
  function tick() {
    const v = video.current, row = rows[current.current]
    if (!v || !row || v.paused || v.seeking) return
    if (v.currentTime >= row.end - .025) {
      if (current.current < rows.length-1) { current.current += 1; v.currentTime = rows[current.current].start; setTime(rows[current.current].offset) }
      else { v.pause(); setTime(duration) }
    } else setTime(Math.max(row.offset, row.offset + v.currentTime-row.start))
    if (stop.current !== null && row.offset + v.currentTime-row.start >= stop.current) { v.pause(); stop.current = null }
  }
  function deleteSelectedClip() {
    if (!clip || draft.clips.length <= 1) return
    const clips = draft.clips.filter(c => c.id !== clip.id)
    const nextSelected = clips[Math.min(index, clips.length - 1)]
    edit({ ...draft, clips })
    setSelected(nextSelected?.id || null)
  }
  function applyCuts() {
    if (!preview || !validCandidate || removedDuration<=0) return
    edit(preview); setChecked([]); setDetail(true)
  }
  function changeCue(i, patch) { edit({ ...draft, subtitles: draft.subtitles.map((c,n) => n===i ? { ...c,...patch } : c) }) }
  function splitCue(i) {
    const c = draft.subtitles[i], words = Array.from(c.text), middle = Math.ceil(words.length/2), at = (c.start+c.end)/2
    if (words.length < 2 || c.end-c.start < .16) return
    edit({ ...draft, subtitles: draft.subtitles.flatMap((v,n) => n===i ? [{ ...c,end:at,text:words.slice(0,middle).join('').trim() },{ ...c,id:uid(),start:at,text:words.slice(middle).join('').trim() }] : [v]) })
  }
  function downloadSrt() {
    const url = URL.createObjectURL(new Blob([toSrt(cues)], {type:'text/plain;charset=utf-8'}))
    const a = document.createElement('a'); a.href=url; a.download='HookAI-subtitles.srt'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function save() {
    if (!valid) return setError('클립·자막 시간을 확인해주세요. 자막은 원본 시간순이며 서로 겹칠 수 없습니다.')
    if (await onSave(draft)) setSaved(JSON.stringify(draft))
  }
  const undo = () => { setCutPreview(null); video.current?.pause(); current.current=0; setTime(0); dispatch({type:'undo'}) }
  const redo = () => { setCutPreview(null); video.current?.pause(); current.current=0; setTime(0); dispatch({type:'redo'}) }
  const playerView = <div className="ve-preview">
    <div className="ve-preview-heading"><span><Play size={13}/>{preview?'삭제 후 미리보기 · 아직 적용 전':'프로그램 미리보기'}</span><span>{duration.toFixed(2)}초 · {playbackClips.length}개 클립</span></div>
    <div className="ve-canvas">{media.previewUrl ? <video ref={video} src={media.previewUrl} playsInline onLoadedMetadata={()=>seek(0)} onTimeUpdate={tick} onPlay={()=>{if(time>=duration)seek(0)}} onEnded={()=>{if(current.current<rows.length-1)seek(rows[current.current+1].offset,true)}} onError={()=>setError('미리보기를 재생하지 못했습니다. 링크 갱신 후 다시 시도해주세요.')} /> : <p>원본 보관 기간이 지났습니다.</p>}{showCaptions&&visible&&<div className="ve-caption-overlay">{visible.text}</div>}</div>
    <div className="ve-player-controls"><span className="ve-time">{timeLabel(time,true)} <small>/ {timeLabel(duration,true)}</small></span><div><button type="button" className="ve-icon" aria-label="처음으로" onClick={()=>seek(0)}><SkipBack size={16}/></button><button type="button" className="ve-icon" aria-label="편집 영상 재생" disabled={!media.previewUrl} onClick={()=>seek(time>=duration?0:time,true)}><Play size={20}/></button><button type="button" className="ve-icon" aria-label="일시 정지" onClick={()=>video.current?.pause()}><Pause size={18}/></button><button type="button" className="ve-icon" aria-label="끝으로" onClick={()=>seek(Math.max(0,duration-.01))}><SkipForward size={16}/></button></div><button type="button" className="ve-icon" aria-label="미리보기·다운로드 링크 갱신" onClick={onRefresh}><RefreshCw size={16}/></button></div>
    <input className="ve-scrubber" aria-label="미리보기 재생 위치" type="range" min="0" max={duration} step="0.01" value={Math.min(time,duration)} onChange={e=>seek(Number(e.target.value))}/>
  </div>
  const hookPanel = <section className="ve-suggestions ct-reference-analysis"><h2>내용 흐름 점검</h2>
    {media.manifest.hookDiagnosis?.status==='ready' ? <>{media.manifest.hookDiagnosis.discardedCount>0 && <p>근거를 확인하지 못한 제안 {media.manifest.hookDiagnosis.discardedCount}개는 제외했습니다.</p>}{!media.manifest.hookDiagnosis.items.length && <p>전사에서 별도 수정 후보를 찾지 못했습니다.</p>}{media.manifest.hookDiagnosis.items.map(item=><article key={item.id}><strong>{item.action==='remove'?'삭제 추천':item.action==='revise'?'수정 필요':'직접 확인'} · {item.area==='hook'?'훅':item.area==='flow'?'흐름':'마무리'}</strong><p>{item.quote}</p><p>{item.reason}</p><button type="button" disabled={!media.previewUrl || Boolean(preview)} onClick={()=>playObservation(item)}>구간 재생</button></article>)}</> : <p>내용 흐름 자동 점검을 완료하지 못했습니다. 자막과 침묵 후보는 그대로 편집할 수 있습니다.</p>}
    <p className="ct-muted">발화 내용에 기반한 제안입니다. 중요한 설명이 빠지지 않는지 미리 듣고 확정하세요.</p></section>
  const tempoPanel = <section className="ve-suggestions ct-reference-analysis"><header><h2>훅·템포 진단</h2><span className="ct-badge">자막 타이밍 기반</span></header>{!tempo.available ? <p>자막 구간을 확인하지 못해 진단할 수 없습니다.</p> : <>
    <p>평균 자막 밀도: 초당 {tempo.averageCharsPerSecond.toFixed(1)}자 · 자막이 있는 구간 기준</p>
    {tempo.delayedStart && <article><p>첫 자막이 {tempo.firstStart.toFixed(1)}초에 시작합니다. 첫 자막을 더 일찍 보여주는 구성도 고려해보세요.</p><button type="button" disabled={!media.previewUrl} onClick={()=>playObservation({start:0,end:Math.min(media.durationSeconds,tempo.firstStart+1)})}>도입 구간 재생</button></article>}
    <article><p>첫 {Math.min(3,media.durationSeconds)}초 자막 분량: 약 {tempo.firstThreeChars.toFixed(1)}자{tempo.firstThreeChars<6?' · 자막으로 전달되는 내용이 적습니다. 도입 구성을 확인해보세요.':''}</p><button type="button" disabled={!media.previewUrl} onClick={()=>playObservation({start:0,end:Math.min(3,media.durationSeconds)})}>첫 자막 구간 재생</button></article>
    <h3>자막 사이 간격</h3>{tempo.gaps.length ? tempo.gaps.map((range,i)=><article key={i}><p>{timeLabel(range.start,true)} → {timeLabel(range.end,true)} · {(range.end-range.start).toFixed(1)}초</p><button type="button" disabled={!media.previewUrl} onClick={()=>playObservation(range)}>자막 간격 {i+1} 재생</button></article>) : <p>자막 사이에 0.7초 이상 간격이 없습니다.</p>}
    <h3>자막 밀도가 낮은 구간</h3><p className="ct-muted">영상 안의 5초 구간별 중앙값과 비교합니다. 실제 소리나 몰입도를 판단하지 않습니다.</p>{tempo.slow.length ? tempo.slow.map((range,i)=><article key={i}><p>{timeLabel(range.start,true)} → {timeLabel(range.end,true)} · 초당 {range.charsPerSecond.toFixed(1)}자</p><button type="button" disabled={!media.previewUrl} onClick={()=>playObservation(range)}>낮은 자막 밀도 구간 {i+1} 재생</button></article>) : <p>비교 기준보다 자막 밀도가 낮은 구간이 없습니다.</p>}
  </>}<p className="ct-muted">실제 시청 이탈 데이터가 아니라 자막 타이밍을 바탕으로 한 점검입니다. 자막이 없는 구간에도 음악·효과음이 있을 수 있습니다. 자르기는 상세 편집에서 직접 선택하세요.</p></section>
  const subtitlePanel = <section className="ve-transcript-panel"><header><div><h2>문장별 자막 편집</h2><p>음성 전사 결과를 문장·시작·끝 시간별로 수정합니다.</p></div><span className="ct-badge">{draft.subtitles.length}개 구간</span></header><div className="ve-transcript-actions"><label><input type="checkbox" checked={showCaptions} onChange={e=>setShowCaptions(e.target.checked)}/>영상에 자막 표시</label></div><div className="ct-subtitles ve-transcript-list">{draft.subtitles.map((c,i)=><article className={`ct-cue ve-subtitle-row${visible?.id===c.id?' is-active':''}`} key={c.id}><header><strong>{String(i+1).padStart(2,'0')}</strong><button type="button" onClick={()=>{const cue=cues.find(v=>v.id===c.id);if(cue)seek(cue.start,true,cue.end);else setError('삭제된 영상 구간의 자막입니다.')}}><Play size={14}/>자막 {i+1} 재생</button><span>{media.originalName}</span></header><label className="ve-subtitle-text"><Captions size={16}/><textarea aria-label={`자막 ${i+1}`} maxLength={500} value={c.text} onChange={e=>changeCue(i,{text:e.target.value})}/></label><footer><label>원본 시작<input aria-label={`자막 ${i+1} 시작 시간`} type="number" min="0" step="0.01" value={c.start} onChange={e=>changeCue(i,{start:Number(e.target.value)})}/></label><label>원본 끝<input aria-label={`자막 ${i+1} 끝 시간`} type="number" min="0" step="0.01" value={c.end} onChange={e=>changeCue(i,{end:Number(e.target.value)})}/></label><Check size={15}/><div className="ve-subtitle-operations"><button type="button" disabled={c.text.trim().length<2||c.end-c.start<.16} onClick={()=>splitCue(i)}><Scissors size={13}/>자막 {i+1} 분할</button><button type="button" disabled={!draft.subtitles[i+1]||c.text.length+(draft.subtitles[i+1]?.text.length||0)+1>500} onClick={()=>edit({...draft,subtitles:draft.subtitles.flatMap((v,n)=>n===i?[{...v,end:draft.subtitles[i+1].end,text:`${v.text} ${draft.subtitles[i+1].text}`}]:n===i+1?[]:[v])})}>다음 자막과 합치기</button><button type="button" className="ve-icon" aria-label={`자막 ${i+1} 삭제`} onClick={()=>edit({...draft,subtitles:draft.subtitles.filter((_,n)=>n!==i)})}><Trash2 size={14}/></button></div></footer></article>)}</div></section>
  return <section className={`ct-media-editor ve-editor ${detail?'ve-detailed':'ve-review'}`}>
    <fieldset disabled={busy} className="ct-editor-fieldset">
      <header className="ve-live-project-title"><div><span>{detail?'상세 편집 프로젝트':'분석 결과'}</span><h2>{media.originalName}</h2></div><small>{draft.clips.length}개 클립 · {durationOf(draft.clips).toFixed(2)}초</small></header>
      <div className="ve-workflow"><span className={!detail?'is-active':''}><b>1</b>AI 컷 제안</span><ChevronRight size={16}/><span className={detail?'is-active':''}><b>2</b>상세 편집</span><span className="ve-local-badge">원본 보존 · 결과는 별도 생성</span></div>
      {!detail ? <>{hookPanel}{tempoPanel}<div className="ve-review-grid">{playerView}<section className="ve-suggestions"><header><h2>잘라내면 좋은 구간</h2><span className="ct-badge">AI 제안</span></header><p>음성 전사와 침묵 길이를 바탕으로 제안합니다. 추천 구간은 한 번에 선택할 수 있고, 삭제는 미리보기 후 직접 확정합니다.</p>{draft.cuts.length===0&&<p>삭제할 긴 침묵 후보가 없습니다. 원본 그대로 상세 편집할 수 있습니다.</p>}{recommendations.map(c=><article className={`ct-cut${checked.includes(c.id)?' is-checked':''}`} key={c.id}><label><input type="checkbox" checked={checked.includes(c.id)} onChange={e=>changeChecked(e.target.checked?[...checked,c.id]:checked.filter(id=>id!==c.id))}/><span><strong>{c.reason}</strong><small>{timeLabel(c.start,true)} → {timeLabel(c.end,true)}</small></span></label><button type="button" className="ve-icon" aria-label="삭제 후보 재생" disabled={!media.previewUrl} onClick={()=>{const loc=rows.find(r=>c.start>=r.start&&c.start<r.end);if(loc)seek(loc.offset+c.start-loc.start,true,loc.offset+Math.min(c.end,loc.end)-loc.start);else setError('이미 삭제된 구간입니다. 실행 취소 후 확인해주세요.')}}><Play size={14}/></button></article>)}<div className="ve-cut-total"><span>선택한 삭제 길이</span><strong>{removedDuration.toFixed(2)}초</strong></div><button type="button" onClick={()=>changeChecked(recommendations.map(c=>c.id))}>추천 구간 한 번에 선택</button><button type="button" disabled={!checked.length||!validCandidate||removedDuration<=0||!media.previewUrl} onClick={previewCuts}>삭제 후 미리보기</button>{preview&&<button type="button" onClick={()=>changeChecked(checked)}>미리보기 닫기</button>}{checked.length>0&&!validCandidate&&<p role="alert">{preservesSpeech?'삭제 후 남는 클립이 너무 짧거나 길이 제한에 맞지 않습니다. 선택을 조정해주세요.':'현재 편집에서는 삭제 후 남겨야 할 설명이 사라집니다. 해당 추천을 해제하거나 실행 취소 후 다시 확인해주세요.'}</p>}<button type="button" className="ct-primary" disabled={!preview||!validCandidate||removedDuration<=0} onClick={applyCuts}><Trash2 size={16}/>선택 구간 삭제</button></section></div><footer className="ve-review-footer"><span>선택 구간을 삭제하거나 현재 편집을 유지하며 상세 편집할 수 있습니다.</span><button type="button" className="ct-primary" onClick={()=>{changeChecked(checked);setDetail(true)}}>상세 편집<ChevronRight size={17}/></button></footer></> : <><header className="ve-project-bar"><button type="button" onClick={()=>setDetail(false)}><ArrowLeft size={15}/>컷 제안 보기</button><div><strong>{media.originalName}</strong><span>{draft.clips.length}개 클립 · {duration.toFixed(2)}초 · 원본 보존</span></div><button type="button" className="ct-primary" disabled={dirty||!valid||!renderEnabled||!media.previewUrl} onClick={onRender}><Download size={15}/>선택한 편집으로 내보내기</button></header><nav className="ve-edit-modes" aria-label="편집 방식"><button type="button" aria-pressed={!subtitleMode} onClick={()=>setSubtitleMode(false)}><Scissors size={16}/>영상 편집</button><button type="button" aria-pressed={subtitleMode} onClick={()=>setSubtitleMode(true)}><Captions size={16}/>자막 편집</button><button type="button" disabled={!history.past.length} onClick={undo}><Undo2 size={16}/>실행 취소</button><button type="button" disabled={!history.future.length} onClick={redo}><Redo2 size={16}/>다시 실행</button></nav><div className={subtitleMode?'ve-subtitle-layout':'ve-standard-layout'}><div className="ve-edit-grid">{!subtitleMode&&<aside className="ve-media"><header><h3><Film size={17}/>미디어</h3></header><article><video src={media.previewUrl} muted playsInline preload="metadata"/><strong>{media.originalName}</strong><footer><small>{timeLabel(Number(media.durationSeconds),true)}</small></footer></article><p>이번 버전은 업로드한 원본 한 개 안의 구간을 편집합니다.</p></aside>}{playerView}{subtitleMode?subtitlePanel:<aside className="ve-inspector"><header><h3>클립 속성</h3><span>{clip?`클립 ${index+1}`:'선택 없음'}</span></header>{clip?<><p className="ve-asset-name">{media.originalName}</p><div className="ve-duration-label"><span>선택 길이</span><strong>{(clip.end-clip.start).toFixed(2)}초</strong></div><label>원본 시작<input aria-label="클립 시작" type="number" min="0" step="0.01" value={clip.start} onChange={e=>edit({...draft,clips:draft.clips.map(c=>c.id===clip.id?{...c,start:Number(e.target.value)}:c)})}/></label><label>원본 끝<input aria-label="클립 끝" type="number" min="0" step="0.01" value={clip.end} onChange={e=>edit({...draft,clips:draft.clips.map(c=>c.id===clip.id?{...c,end:Number(e.target.value)}:c)})}/></label><button type="button" disabled={index===0} onClick={()=>{const next=[...draft.clips];[next[index-1],next[index]]=[next[index],next[index-1]];edit({...draft,clips:next})}}>앞으로 이동</button><button type="button" disabled={index===draft.clips.length-1} onClick={()=>{const next=[...draft.clips];[next[index+1],next[index]]=[next[index],next[index+1]];edit({...draft,clips:next})}}>뒤로 이동</button><button type="button" disabled={duration+clip.end-clip.start>300||draft.clips.length>=100} onClick={()=>edit({...draft,clips:[...draft.clips,{...clip,id:uid()}]})}>선택 클립 이어붙이기</button><button type="button" disabled={draft.clips.length<=1} onClick={()=>edit({...draft,clips:draft.clips.filter(c=>c.id!==clip.id)})}>클립 삭제</button></>:<p>타임라인에서 편집할 클립을 선택하세요.</p>}</aside>}</div></div><section className="ct-timeline ve-timeline"><div className="ve-toolbar"><div className="ve-tool-group"><button type="button" disabled={!clip||time<=rows[index]?.offset+.08||time>=rows[index]?.offset+rows[index]?.duration-.08} onClick={()=>edit({...draft,clips:splitClip(draft.clips,clip.id,clip.start+time-rows[index].offset,uid())})}><Scissors size={16}/>분할</button><button type="button" disabled={!clip||draft.clips.length<=1} onClick={deleteSelectedClip}><Trash2 size={16}/>선택 구간 삭제</button></div><div className="ve-zoom"><span>{timeLabel(time,true)} / {timeLabel(duration,true)}</span></div></div><input aria-label="타임라인 재생 위치" type="range" min="0" max={duration} step="0.01" value={Math.min(time,duration)} onChange={e=>seek(Number(e.target.value))}/><div className="ve-tracks"><div className="ve-track-labels"><span>타임라인</span><span><Film size={16}/>영상</span><span><Captions size={16}/>자막</span><span><Volume2 size={16}/>원본 소리</span></div><div className="ve-track-scroll"><div className="ve-track-content"><div className="ve-ruler">{Array.from({length:6},(_,i)=><button type="button" key={i} onClick={()=>seek(duration*i/5)}>{timeLabel(duration*i/5,true)}</button>)}</div><div className="ct-track ve-video-track">{rows.map((r,i)=><button type="button" className={`ve-clip${selected===r.id?' is-selected':''}`} key={r.id} aria-pressed={selected===r.id} style={{width:`${r.duration/(duration||1)*100}%`}} onClick={()=>{setSelected(r.id);seek(r.offset)}}><span>{i+1} · {media.originalName}</span><small>{r.duration.toFixed(2)}초</small></button>)}</div><div className="ve-caption-track">{cues.map((c,i)=><button type="button" key={`${c.id}-${i}`} style={{left:`${c.start/(duration||1)*100}%`,width:`${(c.end-c.start)/(duration||1)*100}%`}} onClick={()=>seek(c.start)}>{c.text}</button>)}</div><div className="ve-audio-track">{rows.map(r=><div key={r.id} style={{width:`${r.duration/(duration||1)*100}%`}}><Volume2 size={13}/><span>원본 오디오</span></div>)}</div><div className="ve-playhead" style={{left:`${Math.min(100,time/(duration||1)*100)}%`}}><span/></div></div></div></div></section></>}
      {(!valid||error)&&<p role="alert" className="ct-error ve-error">{error||'클립·자막 시간 또는 문장을 확인해주세요. 자막은 겹치지 않는 원본 시간순이어야 합니다.'}</p>}
      <footer className="ct-row ve-live-footer"><button type="button" disabled={!dirty||!valid||Boolean(preview)} onClick={save}>편집 저장</button><button type="button" disabled={!valid||!cues.length||Boolean(preview)} onClick={downloadSrt}>UTF-8 SRT 다운로드</button>{media.downloadUrl&&!dirty&&!busy&&<a className="ct-button" href={media.downloadUrl} download>MP4·SRT·원본 ZIP</a>}<span role="status">{dirty?'저장하지 않은 변경이 있습니다.':'편집 저장됨'}</span></footer>
    </fieldset><p className="ct-muted">내보내기: H.264/AAC MP4 + UTF-8 SRT + 원본 ZIP. 자막은 별도 SRT로 제공되며 영상에 구워 넣지 않습니다. CapCut 프로젝트 형식은 지원하지 않습니다.</p>
  </section>
}
