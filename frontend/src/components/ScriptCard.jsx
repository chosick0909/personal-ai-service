function SectionPreview({ label, value, tone, sizeClass = '' }) {
  return (
    <div className={`flex flex-col rounded-2xl border px-4 py-3 ${tone} ${sizeClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-2 line-clamp-4 text-sm leading-6 text-[#E5E7EB]">{value || '-'}</div>
    </div>
  )
}

const FALLBACK_ANGLE_BY_LABEL = {
  A안: '원본형',
  B안: '대화형',
  C안: '후킹형',
}

const LEGACY_ANGLE_LABELS = {
  구조밀착: '원본형',
  '구조 밀착': '원본형',
  자연화: '대화형',
  자연형: '대화형',
  '전환강화': '후킹형',
  '전환 강화': '후킹형',
}

function getDisplayAngle(script = {}) {
  const fallback = FALLBACK_ANGLE_BY_LABEL[script.label] || '초안'
  const angle = String(script.angle || '').trim().replace(/\s+/g, ' ')

  if (!angle) return fallback
  if (LEGACY_ANGLE_LABELS[angle]) return LEGACY_ANGLE_LABELS[angle]
  if (angle.length > 8) return fallback
  if (/[.?!。！？]$/.test(angle)) return fallback

  return angle
}

export default function ScriptCard({ script, onSelect, isSelected = false, hasSelection = false, disabled = false }) {
  const displayAngle = getDisplayAngle(script)

  const handleSelect = () => {
    if (disabled) {
      return
    }
    onSelect(script.id)
  }

  return (
    <article
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleSelect()
        }
      }}
      className={`flex h-full flex-col rounded-[28px] border p-5 shadow-[0_20px_50px_rgba(0,0,0,0.36)] transition ${
        isSelected
          ? 'border-[#A5B4FC] bg-[#161C28] ring-2 ring-[#A5B4FC] shadow-[0_24px_60px_rgba(99,102,241,0.18)]'
          : hasSelection
            ? 'border-[#2A303B] bg-[#11151D] grayscale-[0.55] opacity-55'
            : 'border-[#2F3543] bg-[#12151D] hover:border-[#495164] hover:bg-[#151B25]'
      } ${disabled ? 'pointer-events-none cursor-default opacity-70' : 'cursor-pointer'}`}
    >
      <div className="min-h-[96px]">
        <div className="flex h-full flex-col">
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
          <h3 className="mt-3 text-xl font-bold leading-8 text-[#F8FAFC]">{displayAngle}</h3>
        </div>
      </div>

      <div className="mt-5 grid flex-1 content-start gap-3">
        <SectionPreview
          label="Hook"
          value={script.hook}
          tone="border-[#4A3338] bg-[#181316] text-[#FCA5A5]"
          sizeClass="min-h-[188px]"
        />
        <SectionPreview
          label="Body"
          value={script.body}
          tone="border-[#31435A] bg-[#141A23] text-[#93C5FD]"
          sizeClass="min-h-[222px]"
        />
        <SectionPreview
          label="CTA"
          value={script.cta}
          tone="border-[#314A3D] bg-[#131A16] text-[#86EFAC]"
          sizeClass="min-h-[168px]"
        />
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          handleSelect()
        }}
        className="btn-solid-contrast mt-5 flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold transition hover:bg-white disabled:cursor-default disabled:opacity-70"
      >
        {isSelected ? '편집 계속하기' : '사용하기'}
      </button>
    </article>
  )
}
