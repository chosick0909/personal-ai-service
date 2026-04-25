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
    <div className={`rounded-2xl border px-4 py-4 ${tone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em]">{label}</div>
      <div className="mt-2 line-clamp-2 text-sm leading-6 text-[#E5E7EB]">{value || '-'}</div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-md">
      <div className="flex max-h-[90vh] w-full max-w-[768px] flex-col overflow-hidden rounded-[32px] border border-[#2F3543] bg-[#0F1117] shadow-[0_30px_90px_rgba(0,0,0,0.56)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#232833] bg-[linear-gradient(180deg,#141821_0%,#10141D_100%)] px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#343A45] bg-[#1A1F2A] text-[#D1D5DB]">
                ⟳
              </div>
              <div className="text-2xl font-bold text-[#F3F4F6]">저장 내역</div>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#AEB6C5]">
              저장된 버전 목록을 보고 원하는 초안으로 불러올 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsVersionModalOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#343A45] bg-[#111723] text-[#AEB6C5] transition hover:border-[#4B5563] hover:bg-[#1A1F2A] hover:text-[#F3F4F6]"
          >
            ✕
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-101px)] gap-4 overflow-y-auto bg-[#0B0E14] px-6 py-5">
          {versions.length ? (
            versions.map((version, index) => {
              const sections = splitSections(version.content)
              const isLatest = index === 0
              return (
                <article
                  key={version.id}
                  className="rounded-[28px] border border-[#2F3543] bg-[linear-gradient(180deg,#121722_0%,#0F141D_100%)] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-[#F3F4F6]">
                          버전 {version.versionNumber}
                        </span>
                        {isLatest ? (
                          <span className="rounded-full border border-[#315C3A] bg-[#122418] px-3 py-1 text-xs font-semibold text-[#86EFAC]">
                            최신
                          </span>
                        ) : null}
                        <span className="rounded-full border border-[#3A3D43] bg-[#1D1F23] px-3 py-1 text-xs font-semibold text-[#D1D5DB]">
                          {labelByType[version.versionType] || version.source}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[#AEB6C5]">
                        <span>{formatDate(version.createdAt)}</span>
                        <span>{version.content.length.toLocaleString()} 글자</span>
                        <span>{version.score ?? '--'}점</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => restoreVersion(version.id)}
                      className="rounded-full bg-[#FAF9F6] px-5 py-2.5 text-sm font-semibold text-[#0F1117] transition hover:bg-[#E5E7EB]"
                    >
                      불러오기
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <SectionStrip
                      label="Hook"
                      value={sections.hook}
                      tone="border-[#4B2D33] bg-[#171014] text-[#FCA5A5]"
                    />
                    <SectionStrip
                      label="Body"
                      value={sections.body}
                      tone="border-[#2A3D59] bg-[#101722] text-[#93C5FD]"
                    />
                    <SectionStrip
                      label="CTA"
                      value={sections.cta}
                      tone="border-[#2B4A35] bg-[#101A14] text-[#86EFAC]"
                    />
                  </div>
                </article>
              )
            })
          ) : (
            <div className="rounded-[28px] border border-dashed border-[#343A45] bg-[#111723] px-5 py-8 text-center text-sm leading-7 text-[#AEB6C5]">
              아직 저장된 버전이 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
