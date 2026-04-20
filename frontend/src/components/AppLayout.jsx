import { useState } from 'react'

export default function AppLayout({ sidebar, main, panel, children }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  return (
    <main className="h-screen overflow-hidden bg-[#0D0F14] text-[#F3F4F6]">
      <div className="flex h-full flex-col md:hidden">
        <header className="flex h-14 items-center border-b border-[#2C313C] bg-[#12151D] px-4">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-full border border-[#3A414F] bg-[#1B202A] px-3 py-1.5 text-xs font-semibold text-[#D1D5DB]"
          >
            내역
          </button>
        </header>

        <section className="min-h-0 flex-1 overflow-hidden bg-[#0D0F14]">{main}</section>

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
            <div className="h-[calc(82vh-48px)] overflow-y-auto">{sidebar}</div>
          </div>
        </div>
      ) : null}

      {children}
    </main>
  )
}
