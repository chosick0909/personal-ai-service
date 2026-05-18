export function FabricBackgroundOverlay() {
  return (
    <>
      <div className="pointer-events-none absolute -left-24 top-10 h-[340px] w-[500px] rotate-[-14deg] rounded-full bg-[#faf9f6]/8 blur-3xl" />
      <div className="pointer-events-none absolute right-[-180px] top-[22%] h-[420px] w-[520px] rotate-[16deg] rounded-full bg-[#868584]/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-140px] left-[18%] h-[300px] w-[620px] rotate-[-6deg] rounded-full bg-[#faf9f6]/6 blur-3xl" />
    </>
  )
}
