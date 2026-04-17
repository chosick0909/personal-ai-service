export default function AppLayout({ sidebar, main, panel, children }) {
  return (
    <main className="h-screen overflow-hidden bg-[#0D0F14] text-[#F3F4F6]">
      <div
        className={`grid h-full transition-[grid-template-columns] duration-500 ${
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
      {children}
    </main>
  )
}
