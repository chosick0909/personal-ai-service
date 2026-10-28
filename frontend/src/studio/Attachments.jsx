import { Paperclip, X, LoaderCircle } from 'lucide-react'

// 📎 in a conversation: files are read into text by the studio and sent along with the next message.
export const FILE_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.docx'
export function AttachButton({ uploading, onFiles }) {
  return <label className="st-icon-btn st-attach-btn" title="파일 올리기 (PDF·이미지·텍스트·워드, 5개까지)" aria-label="파일 올리기">
    {uploading ? <LoaderCircle size={18} className="st-spin" /> : <Paperclip size={18} />}
    <input type="file" multiple accept={FILE_TYPES} style={{ display: 'none' }} disabled={uploading} onChange={e => { onFiles([...e.target.files]); e.target.value = '' }} />
  </label>
}
export function AttachChips({ items, onRemove }) {
  if (!items.length) return null
  return <div className="st-attach-chips">{items.map((a, i) => <span key={`${a.name}-${i}`} className="st-chip"><Paperclip size={13} />{a.name}{onRemove && <button type="button" aria-label="빼기" onClick={() => onRemove(i)}><X size={13} /></button>}</span>)}</div>
}
