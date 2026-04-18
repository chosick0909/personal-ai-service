function SectionPreview({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-2 line-clamp-3 text-sm leading-6 text-[#E5E7EB]">{value || '-'}</div>
    </div>
  )
}

export default function ScriptCard({ script, onSelect, isSelected = false, hasSelection = false }) {
  return (
    <article
      className={`rounded-[28px] border p-5 shadow-[0_20px_50px_rgba(0,0,0,0.36)] transition ${
        isSelected
          ? 'border-[#A5B4FC] bg-[#161C28] ring-2 ring-[#A5B4FC] shadow-[0_24px_60px_rgba(99,102,241,0.18)]'
          : hasSelection
            ? 'border-[#2A303B] bg-[#11151D] grayscale-[0.55] opacity-55'
            : 'border-[#2F3543] bg-[#12151D]'
      }`}
    >
      <div>
        <div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full border border-[#3A4252] bg-[#171B24] px-3 py-1 text-xs font-semibold text-[#D1D5DB]">
              {script.label}
            </div>
            {isSelected ? (
              <div className="inline-flex rounded-full border border-[#A5B4FC] bg-[#1E2635] px-2 py-0.5 text-[10px] font-semibold text-[#E5E7EB]">
                선택한 초안
              </div>
            ) : null}
          </div>
          <h3 className="mt-3 text-xl font-bold leading-8 text-[#F8FAFC]">{script.angle}</h3>
        </div>
      </div>

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
        {isSelected ? '선택됨' : '사용하기'}
      </button>
    </article>
  )
}
