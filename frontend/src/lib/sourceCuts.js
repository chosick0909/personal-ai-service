// Recommendations use original source time, while the editor may reorder or
// duplicate clips. Subtract the interval union from EACH current occurrence.
export function subtractSourceRanges(clips, ranges, makeId) {
  const union=[]
  for(const r of [...ranges].filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.start>=0&&r.end>r.start).sort((a,b)=>a.start-b.start)) {
    const last=union.at(-1)
    if(last && r.start<=last.end) last.end=Math.max(last.end,r.end)
    else union.push({start:r.start,end:r.end})
  }
  return clips.flatMap(clip=>{
    let fragments=[{start:clip.start,end:clip.end}]
    for(const r of union) fragments=fragments.flatMap(f=>r.end<=f.start||r.start>=f.end?[f]:[
      ...(r.start>f.start?[{start:f.start,end:r.start}]:[]),...(r.end<f.end?[{start:r.end,end:f.end}]:[]),
    ])
    // Do not silently discard short speech fragments. The editor's validation
    // rejects too-short clips before preview/apply; the source stays intact.
    return fragments.map((f,i)=>({...clip,...f,id:i?makeId():clip.id}))
  })
}

// A recommendation's duplicate must still survive in the CURRENT edit, not
// merely somewhere in the original upload. Keep each cue intact in one clip.
export function preservesRetainedSpeech(clips, recommendations) {
  return recommendations.every(item=>item.action!=='remove' || (Array.isArray(item.retainedRanges) && item.retainedRanges.length>0
    && item.retainedRanges.every(r=>Number.isFinite(r.start) && Number.isFinite(r.end) && r.end>r.start
      && clips.some(c=>c.start<=r.start && c.end>=r.end))))
}
