import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

function SectionPreview({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-2 line-clamp-3 text-sm leading-6 text-[#E5E7EB]">{value || '-'}</div>
    </div>
  )
}

export default function ScriptCard({ script, onSelect, globalKnowledgeDebug = [] }) {
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false)
  const chunkCount = globalKnowledgeDebug.length
  const documentCount = new Set(globalKnowledgeDebug.map((item) => item.title || item.id)).size
  const documents = useMemo(() => {
    const grouped = new Map()

    for (const chunk of globalKnowledgeDebug) {
      const key = chunk.documentId || chunk.title || chunk.id
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          title: chunk.title || '문서',
          category: chunk.category || '',
          chunks: [],
        })
      }

      grouped.get(key).chunks.push(chunk)
    }

    return Array.from(grouped.values()).map((doc) => ({
      ...doc,
      chunks: doc.chunks.sort((a, b) => (a.rank || 0) - (b.rank || 0)),
    }))
  }, [globalKnowledgeDebug])

  return (
    <article className="rounded-[28px] border border-[#2F3543] bg-[#12151D] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.36)]">
      <div>
        <div>
          <div className="inline-flex rounded-full border border-[#3A4252] bg-[#171B24] px-3 py-1 text-xs font-semibold text-[#D1D5DB]">
            {script.label}
          </div>
          <h3 className="mt-3 text-xl font-bold leading-8 text-[#F8FAFC]">{script.angle}</h3>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setIsSourceModalOpen(true)}
        className="mt-4 flex w-full items-center rounded-2xl border border-[#3A4252] bg-[#171B24] px-4 py-3 text-left text-sm font-semibold text-[#CBD5E1] transition hover:bg-[#1D2330]"
      >
        <span>
          참조 청크 {chunkCount}개 · 문서 {documentCount}개
        </span>
      </button>

      <div className="mt-5 grid gap-3">
        <SectionPreview
          label="Hook"
          value={script.hook}
          tone="border-[#4A3338] bg-[#181316] text-[#FCA5A5]"
        />
        <SectionPreview
          label="Body"
          value={script.body}
          tone="border-[#31435A] bg-[#141A23] text-[#93C5FD]"
        />
        <SectionPreview
          label="CTA"
          value={script.cta}
          tone="border-[#314A3D] bg-[#131A16] text-[#86EFAC]"
        />
      </div>

      <button
        type="button"
        onClick={() => onSelect(script.id)}
        className="btn-solid-contrast mt-5 flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold transition hover:bg-white"
      >
        사용하기
      </button>

      {isSourceModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[130] bg-[rgba(10,10,10,0.45)]"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsSourceModalOpen(false)
                }
              }}
            >
              <div className="absolute left-1/2 top-1/2 w-[min(880px,calc(100vw-32px))] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-[#2F3543] bg-[#12151D] shadow-[0_20px_60px_rgba(0,0,0,0.46)]">
                <div className="flex items-center justify-between border-b border-[#2F3543] px-5 py-4">
                  <div>
                    <h4 className="text-base font-semibold text-[#F8FAFC]">참조 문서 보기</h4>
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      청크 {chunkCount}개 · 문서 {documentCount}개
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSourceModalOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#AEB6C5] transition hover:bg-[#1B202A]"
                    aria-label="참조 문서 닫기"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                <div className="max-h-[calc(80vh-80px)] overflow-y-auto px-5 py-4">
                  {chunkCount ? (
                    <div className="grid gap-4">
                      {documents.map((doc, idx) => (
                        <article key={doc.key} className="rounded-2xl border border-[#2F3543] bg-[#171B24] p-4">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#CBD5E1]">
                            <span className="rounded-full border border-[#3A4252] bg-[#1B202A] px-2 py-0.5 text-xs">
                              문서 {idx + 1}
                            </span>
                            <span className="text-[#F3F4F6]">{doc.title}</span>
                            {doc.category ? <span className="text-xs text-[#8E97A6]">· {doc.category}</span> : null}
                          </div>
                          <div className="mt-3 grid gap-2">
                            {doc.chunks.map((item, chunkIndex) => (
                              <div
                                key={item.id || `${doc.key}-${chunkIndex}`}
                                className="rounded-xl border border-[#2F3543] bg-[#12151D] p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[#8E97A6]">
                                  <span className="rounded-full bg-[#1B202A] px-2 py-0.5 font-semibold text-[#D1D5DB]">
                                    #{item.rank}
                                  </span>
                                  {item.chunkIndex != null ? <span>chunk {item.chunkIndex}</span> : null}
                                  {item.documentId ? <span>· doc {String(item.documentId).slice(0, 8)}</span> : null}
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#CBD5E1]">
                                  {item.content || ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[#9CA3AF]">참조된 글로벌 청크가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </article>
  )
}
