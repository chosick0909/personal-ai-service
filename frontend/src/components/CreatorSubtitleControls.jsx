import { useEffect, useRef, useState } from 'react'
import { captionLayout, captionWords, wordBoundaries } from '../../../shared/subtitle-layout.mjs'

export function SubtitleSplitControls({ cue, words, sourceTime, onSplit, disabled }) {
  const boundaries = wordBoundaries(cue, words)
  const [choice, setChoice] = useState(null)
  const selection = choice && boundaries.find(b=>b.after===choice.after)
  const selected = selection ? { ...selection, at: choice.at } : boundaries[Math.floor(boundaries.length/2)]
  const valid = selected && selected.at-cue.start >= .08-1e-8 && cue.end-selected.at >= .08-1e-8
  return <div className="ve-word-split">
    <p>나눌 단어 뒤를 선택하고 분할 시간을 정하세요.</p>
    <div className="ve-word-boundaries" aria-label="자막 분할 단어 선택">{captionWords(cue.text).map((word,i)=><span key={i}>{word}{boundaries.some(b=>b.after===i+1)&&<button type="button" aria-label={`‘${word}’ 뒤에서 분할`} aria-pressed={selected?.after===i+1} onClick={()=>setChoice({after:i+1,at:boundaries.find(b=>b.after===i+1).at})}>│</button>}</span>)}</div>
    {selected ? <><p className="ve-split-preview">{selected.left}<b> / </b>{selected.right}</p><label>분할 시간 (원본 초)<input aria-label="자막 분할 시간" type="number" step="0.01" min={cue.start+.08} max={cue.end-.08} value={Number.isFinite(selected.at)?Number(selected.at.toFixed(3)):''} onChange={e=>setChoice({after:selected.after,at:e.target.value===''?NaN:Number(e.target.value)})}/></label>
    <button type="button" disabled={!Number.isFinite(sourceTime)||sourceTime-cue.start<.08||cue.end-sourceTime<.08} onClick={()=>{const nearest=boundaries.reduce((a,b)=>Math.abs(b.at-sourceTime)<Math.abs(a.at-sourceTime)?b:a);setChoice({after:nearest.after,at:sourceTime})}}>현재 재생 위치로 지정</button>
    <button type="button" disabled={disabled||!valid} onClick={()=>onSplit(selected.after,selected.at)}>선택한 위치에서 자막 분할</button><small>{selected.exact?'단어 발화 시간 기준':'시간은 추정값입니다. 재생하며 조정할 수 있습니다.'}</small></> : <p>한 단어인 자막은 단어 중간을 나누지 않습니다.</p>}
  </div>
}
export function CreatorSubtitleOverlay({ videoRef, cue, preset }) {
  const [box,setBox] = useState(null)
  const host = useRef(null)
  useEffect(()=>{
    const video=videoRef.current, container=host.current?.parentElement
    if (!video||!container) return
    const measure=()=>{
      if (!video.videoWidth||!video.videoHeight) return
      const ratio=Math.min(container.clientWidth/video.videoWidth,container.clientHeight/video.videoHeight)
      const width=video.videoWidth*ratio,height=video.videoHeight*ratio
      setBox({width,height,left:(container.clientWidth-width)/2,top:(container.clientHeight-height)/2})
    }
    measure(); video.addEventListener('loadedmetadata',measure)
    const observer=new ResizeObserver(measure);observer.observe(container)
    return ()=>{video.removeEventListener('loadedmetadata',measure);observer.disconnect()}
  },[videoRef])
  const layout=box&&cue?captionLayout(cue.text,box.width,preset):null
  return <div ref={host} className="ve-subtitle-stage" style={box||{visibility:'hidden'}}>{layout&&<span className={`ve-reel-caption${layout.box?' is-box':''}`} style={{top:`${layout.y*100}%`,fontSize:layout.fontSize,fontStyle:layout.italic?'italic':'normal',WebkitTextStroke:layout.box?0:`${box.width*layout.outline*2}px black`}}>{layout.text}</span>}</div>
}
