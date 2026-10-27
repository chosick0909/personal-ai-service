import { useEffect, useRef, useState } from 'react'
import { Mic, Square, LoaderCircle } from 'lucide-react'
import { apiFetch, parseApiResponse, createApiError } from '../lib/api'

const MAX_SECONDS = 170
const pickType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || ''

// 말로 입력: records until the student presses again (pauses never cut it off), then the server writes it down.
// The browser's own speech recognition stopped at the first pause, so only a word or two ever came through.
export default function VoiceButton({ onText, onError }) {
  const [state, setState] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef(null)
  const timer = useRef(null)
  useEffect(() => () => { clearInterval(timer.current); recorder.current?.stream.getTracks().forEach(t => t.stop()) }, [])
  const send = async blob => {
    setState('reading')
    try {
      const form = new FormData(); form.append('audio', blob, 'voice')
      const response = await apiFetch('/api/creator-tools/studio/voice', { method: 'POST', body: form, timeoutMs: 120000 })
      const payload = await parseApiResponse(response)
      if (!response.ok) throw createApiError(response, payload, '말을 글로 옮기지 못했어요.')
      onText(payload.text)
    } catch (e) { onError(e.message) } finally { setState('idle') }
  }
  const stop = () => { clearInterval(timer.current); if (recorder.current?.state === 'recording') recorder.current.stop() }
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return onError('이 브라우저는 녹음이 안 돼요. 크롬이나 사파리 최신 버전에서 써 주세요.')
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { return onError('마이크를 쓸 수 있게 허용해 주세요. 주소창 옆 자물쇠 아이콘에서 마이크를 ‘허용’으로 바꾸면 돼요.') }
    const type = pickType()
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' })
      if (blob.size < 1000) { setState('idle'); return onError('녹음된 소리가 너무 짧아요. 버튼을 누르고 말한 뒤, 다 말하면 한 번 더 눌러 주세요.') }
      send(blob)
    }
    recorder.current = rec
    rec.start(1000)
    setSeconds(0); setState('recording')
    timer.current = setInterval(() => setSeconds(s => { if (s + 1 >= MAX_SECONDS) stop(); return s + 1 }), 1000)
  }
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  if (state === 'recording') return <button type="button" className="st-btn st-voice is-recording" onClick={stop}><Square size={16} fill="currentColor" />다 말했어요 · {clock}</button>
  if (state === 'reading') return <button type="button" className="st-btn st-voice" disabled><LoaderCircle size={18} className="st-spin" />글로 옮기는 중…</button>
  return <button type="button" className="st-btn st-voice" onClick={start}><Mic size={18} />말로 입력</button>
}
