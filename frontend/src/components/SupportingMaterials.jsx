import { useEffect, useRef, useState } from 'react'
import { MATERIAL_ACCEPT, validateMaterialSelection, normalizeSupportingMaterials } from '../../../shared/supporting-materials.mjs'
import { readSupportingFiles } from '../lib/referenceApi'

export default function SupportingMaterials({ items, onChange, onBusyChange, accountId, topic = '', disabled = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const controller = useRef(null)
  const previousAccount = useRef(accountId)
  const run = useRef(0)
  useEffect(() => () => { run.current++; controller.current?.abort() }, [])
  useEffect(() => {
    if (previousAccount.current && previousAccount.current !== accountId) {
      run.current++; controller.current?.abort(); onChange([]); onBusyChange(false); setBusy(false); setError('')
      // Account changes must not carry another account's file context.
    }
    previousAccount.current = accountId
  }, [accountId, onChange, onBusyChange])

  async function addFiles(files) {
    if (busy || disabled || !files.length) return
    const message = validateMaterialSelection([...items, ...files])
    if (message) { setError(message); return }
    const token = ++run.current
    controller.current?.abort(); controller.current = new AbortController()
    setBusy(true); onBusyChange(true); setError('')
    try {
      const result = await readSupportingFiles(files, { signal: controller.current.signal, readingContext: topic })
      if (run.current !== token) return
      const combined = [...items, ...result]
      normalizeSupportingMaterials(combined.filter(item => item.status === 'ready'))
      onChange(combined)
    } catch (failure) {
      if (run.current === token) {
        const errorMessage = failure.message || '참고자료를 읽지 못했어요. 다시 첨부해주세요.'
        onChange([...items, ...files.map(file => ({ name: file.name, size: file.size, status: 'error', error: errorMessage }))])
      }
    } finally {
      if (run.current === token) { setBusy(false); onBusyChange(false) }
      if (input.current) input.current.value = ''
    }
  }
  return <section className="mt-5 rounded-2xl border border-[#453267] bg-[#191422] p-4 text-left" aria-label="대본 참고자료 첨부">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-[#E9D5FF]">참고자료 첨부 <span className="font-normal text-[#9E92AF]">(선택)</span></h3>
        <p className="mt-1 text-xs leading-5 text-[#ADA3BD]">이미지, 문서, 표 자료를 넣으면 이번 주제와 관련된 내용을 대본에 참고해요.</p></div>
      <button type="button" disabled={disabled || busy || items.length >= 5} onClick={() => input.current?.click()} className="shrink-0 rounded-xl border border-[#7852AC] bg-[#38234F] px-4 py-2 text-xs font-semibold text-[#E9D5FF] transition hover:bg-[#493068] disabled:opacity-50">{busy ? '자료 읽는 중…' : '+ 파일 첨부'}</button>
      <input ref={input} type="file" multiple accept={MATERIAL_ACCEPT} className="sr-only" aria-label="참고자료 파일 선택" disabled={disabled || busy} onChange={event => addFiles(Array.from(event.target.files || []))} />
    </div>
    <p className="mt-3 text-[11px] leading-5 text-[#9588A3]">JPG·PNG·WebP · PDF · DOCX·PPTX·XLSX · TXT·MD·CSV<br />최대 5개 · 파일당 10MB · 전체 20MB</p>
    {busy ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-[#D8B4FE]"><span className="h-3 w-3 animate-spin rounded-full border-2 border-[#75588F] border-t-[#E9D5FF]" />참고자료를 읽고 있어요. 완료 후 분석을 시작할 수 있어요.</p> : null}
    <ul className="mt-3 space-y-2">{items.map((item, index) => <li key={`${index}-${item.name}`} className="rounded-xl bg-[#12101A] p-3">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-all text-xs font-medium text-[#E5E7EB]">{item.name}</div><div className={`mt-1 text-[11px] ${item.status === 'error' ? 'text-[#FCA5A5]' : 'text-[#C4B5FD]'}`}>{item.status === 'error' ? item.error : '읽기 완료 · 참고자료로 활용'}</div></div>
        <button type="button" disabled={disabled || busy} onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`${item.name} 제거`} className="text-xs text-[#A99CB7] hover:text-white disabled:opacity-40">제거</button></div>
      {item.content ? <details className="mt-2 text-[11px] text-[#9F93AE]"><summary className="cursor-pointer">읽은 내용 확인</summary><p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap leading-5">{item.content}</p></details> : null}
      {item.warnings?.map((warning, i) => <p key={i} className="mt-2 text-[11px] leading-5 text-[#E5C88E]">{warning}</p>)}
    </li>)}</ul>
    {error ? <p role="alert" className="mt-3 text-xs leading-5 text-[#FCA5A5]">{error}</p> : null}
    {items.some(item => item.status === 'error') ? <p className="mt-2 text-[11px] text-[#FCA5A5]">읽지 못한 파일을 다시 첨부하거나 제거한 뒤 진행해주세요.</p> : null}
  </section>
}
