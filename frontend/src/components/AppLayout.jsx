import { cloneElement, isValidElement, useState } from 'react'

function IconMenu() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
      <path
        d="M4 6.25h12M4 10h12M4 13.75h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconClock() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
      <path
        d="M10 4.25a5.75 5.75 0 1 0 0 11.5a5.75 5.75 0 0 0 0-11.5Zm0 2.35V10l2.2 1.55"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
      <path
        d="M8.1 3.9h3.8l.4 2a6 6 0 0 1 1.35.8l1.9-.8 1.8 3.15-1.5 1.3c.08.43.12.87.12 1.31 0 .45-.04.89-.12 1.32l1.5 1.3-1.8 3.14-1.9-.8c-.42.31-.87.57-1.35.79l-.4 2H8.1l-.4-2a6.26 6.26 0 0 1-1.35-.8l-1.9.81-1.8-3.15 1.5-1.3a7.2 7.2 0 0 1 0-2.63l-1.5-1.3 1.8-3.14 1.9.8c.42-.31.87-.57 1.35-.79l.4-2Zm1.9 4.02a2.08 2.08 0 1 0 0 4.16a2.08 2.08 0 0 0 0-4.16Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function AppLayout({ sidebar, main, panel, children, mobileVariant = 'default' }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const mobileSidebar = isValidElement(sidebar)
    ? cloneElement(sidebar, {
        onRequestClose: () => setMobileSidebarOpen(false),
      })
    : sidebar

  return (
    <main className="h-screen overflow-hidden bg-[#0D0F14] text-[#F3F4F6]">
      <div className="flex h-full flex-col md:hidden">
        {mobileVariant === 'upload' ? (
          <header className="grid grid-cols-[46px_minmax(0,1fr)_84px] items-center gap-2.5 bg-[#0D0F14] px-4 pb-2.5 pt-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-[18px] border border-[#2F3543] bg-[#171B24] text-[#F3F4F6] shadow-[0_8px_20px_rgba(0,0,0,0.22)]"
              aria-label="메뉴 열기"
            >
              <IconMenu />
            </button>

            <div className="inline-flex h-[46px] min-w-0 items-center justify-center rounded-[18px] border border-[#2F3543] bg-[#171B24] px-4 text-center text-[17px] font-bold tracking-[-0.03em] text-[#F8FAFC] shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
              <span className="translate-y-[-0.5px]">HookAI</span>
            </div>

            <div className="ml-auto inline-flex h-[46px] items-center gap-0.5 rounded-[18px] border border-[#2F3543] bg-[#171B24] px-1.5 text-[#F3F4F6] shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
              <button
                type="button"
                onClick={() => window.location.assign('/settings')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[#232833]"
                aria-label="설정"
              >
                <IconSettings />
              </button>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[#232833]"
                aria-label="최근 분석"
              >
                <IconClock />
              </button>
            </div>
          </header>
        ) : (
          <header className="flex h-14 items-center border-b border-[#2C313C] bg-[#12151D] px-4">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1.5 text-xs font-semibold text-[#D1D5DB]"
            >
              내역
            </button>
          </header>
        )}

        <section className="min-h-0 flex-1 overflow-hidden bg-[#0D0F14]">{main}</section>

        {mobileVariant === 'upload' ? null : (
          <footer className="grid h-14 grid-cols-2 border-t border-[#2C313C] bg-[#12151D] px-2 pb-[env(safe-area-inset-bottom)] pt-1">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="rounded-xl text-sm font-medium text-[#E5E7EB]"
            >
              작업
            </button>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="rounded-xl text-sm font-medium text-[#AEB6C5]"
            >
              최근
            </button>
          </footer>
        )}
      </div>

      <div
        className={`hidden h-full transition-[grid-template-columns] duration-500 md:grid ${
          panel ? 'grid-cols-[280px_minmax(0,1fr)_340px]' : 'grid-cols-[280px_minmax(0,1fr)]'
        }`}
      >
        <aside className="min-h-0 overflow-hidden border-r border-[#2C313C] bg-[#12151D]">{sidebar}</aside>
        <section className="relative min-h-0 overflow-hidden bg-[#0D0F14]">{main}</section>
        {panel ? (
          <aside className="min-h-0 overflow-hidden border-l border-[#2C313C] bg-[#12151D]">
            {panel}
          </aside>
        ) : null}
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 bg-black/55 md:hidden">
          <button
            type="button"
            aria-label="close recent panel"
            className="absolute inset-0"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-hidden rounded-t-[28px] border border-[#2F3543] bg-[#12151D] shadow-[0_-20px_60px_rgba(0,0,0,0.45)]">
            <div className="flex h-12 items-center justify-between border-b border-[#2C313C] px-4">
              <div className="text-sm font-semibold text-[#E5E7EB]">최근 분석</div>
              <button
                type="button"
                className="rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1 text-xs font-semibold text-[#D1D5DB]"
                onClick={() => setMobileSidebarOpen(false)}
              >
                닫기
              </button>
            </div>
            <div className="h-[calc(82vh-48px)] overflow-y-auto">{mobileSidebar}</div>
          </div>
        </div>
      ) : null}

      {children}
    </main>
  )
}
