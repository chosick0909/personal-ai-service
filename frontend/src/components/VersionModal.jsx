import { useAppState } from '../store/AppState'

function formatDate(value) {
  return new Date(value).toLocaleString('ko-KR')
}

function splitSections(content = '') {
  const parts = content.split(/\n\s*\n/)
  return {
    hook: parts[0] || '',
    body: parts[1] || '',
    cta: parts.slice(2).join('\n\n') || '',
  }
}

function SectionStrip({ label, value, tone }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${tone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-2 line-clamp-2 text-sm leading-6">{value || '-'}</div>
    </div>
  )
}

export default function VersionModal() {
  const { versions, setIsVersionModalOpen, restoreVersion } = useAppState()
  const labelByType = {
    ai_generation: 'AI 생성',
    feedback_apply: '피드백 반영',
    manual_save: '수동 저장',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-[768px] flex-col overflow-hidden rounded-[32px] border border-[#e5e7eb] bg-white shadow-[0_30px_90px_rgba(17,24,39,0.18)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#f3f4f6] px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f3e8ff] text-[#8200db]">
                ⟳
              </div>
              <div className="text-2xl font-bold text-[#101828]">저장 내역</div>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#4a5565]">
              저장된 버전 목록을 보고 원하는 초안으로 불러올 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsVersionModalOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] text-[#6b7280] transition hover:bg-[#fafafa]"
          >
            ✕
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-101px)] gap-4 overflow-y-auto px-6 py-5">
          {versions.length ? (
            versions.map((version, index) => {
              const sections = splitSections(version.content)
              const isLatest = index === 0
              return (
                <article
                  key={version.id}
                  className="rounded-[28px] border border-[#e5e7eb] bg-white p-5 shadow-[0_16px_40px_rgba(17,24,39,0.04)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-[#101828]">
                          버전 {version.versionNumber}
                        </span>
                        {isLatest ? (
                          <span className="rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-semibold text-[#008236]">
                            최신
                          </span>
                        ) : null}
                        <span className="rounded-full bg-[#f3e8ff] px-3 py-1 text-xs font-semibold text-[#8200db]">
                          {labelByType[version.versionType] || version.source}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[#4a5565]">
                        <span>{formatDate(version.createdAt)}</span>
                        <span>{version.content.length.toLocaleString()} 글자</span>
                        <span>{version.score ?? '--'}점</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => restoreVersion(version.id)}
                      className="rounded-full bg-[#9810fa] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#870de0]"
                    >
                      불러오기
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <SectionStrip
                      label="Hook"
                      value={sections.hook}
                      tone="border-[#fecaca] bg-[#fef2f2] text-[#c10007]"
                    />
                    <SectionStrip
                      label="Body"
                      value={sections.body}
                      tone="border-[#bfdbfe] bg-[#eff6ff] text-[#1447e6]"
                    />
                    <SectionStrip
                      label="CTA"
                      value={sections.cta}
                      tone="border-[#bbf7d0] bg-[#f0fdf4] text-[#008236]"
                    />
                  </div>
                </article>
              )
            })
          ) : (
            <div className="rounded-[28px] border border-dashed border-[#e5e7eb] px-5 py-8 text-center text-sm leading-7 text-[#6b7280]">
              아직 저장된 버전이 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
