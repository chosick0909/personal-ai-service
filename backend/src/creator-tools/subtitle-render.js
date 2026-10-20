import { captionLayout } from '../../../shared/subtitle-layout.mjs'
const stamp = t => { const n=Math.round(t*100); return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}` }
// ASS commands must never be accepted from edited subtitle text.
const escape = text => text.replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝').replace(/\r/g,'').replace(/\n/g,'\\N')
export function subtitleAss(cues, width, height, preset) {
  const borderStyle = preset === 'box' ? 3 : 1
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Pretendard,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,${borderStyle},3,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  return header + cues.map(cue=>{
    const s=captionLayout(cue.text,width,preset)
    const outline=s.box?width*.012:s.outline*width
    const commands=`\\an5\\pos(${width/2},${Math.round(height*s.y)})\\fs${s.fontSize.toFixed(2)}\\i${s.italic?1:0}\\c${s.box?'&H000000&':'&HFFFFFF&'}\\3c${s.box?'&HFFFFFF&':'&H000000&'}\\bord${outline.toFixed(2)}\\shad0`
    // BorderStyle is per style, so declare one fixed style per preset in header.
    return `Dialogue: 0,${stamp(cue.start)},${stamp(cue.end)},Default,,0,0,0,,{${commands}}${escape(s.text)}`
  }).join('\n')+'\n'
}
