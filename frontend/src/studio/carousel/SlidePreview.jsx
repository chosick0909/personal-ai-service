import { useEffect, useRef, useState } from 'react'
import { drawSlide, prepare } from './render'
import { RATIOS, templateOf } from './templates'

const REDRAW_DELAY = 90

// One slide as a responsive canvas. It redraws (shortly after the last change) whenever its props change and tells
// the parent through `onResult({ overflow })` when the text no longer fits — once per change of that answer.
// `assets` is optional: pass what `useCarouselAssets` returned to share one load between many previews.
export default function SlidePreview({ slide, index = 0, total = 1, design, onResult, className, assets }) {
  const canvasRef = useRef(null)
  const resultRef = useRef(onResult)
  const reported = useRef(null)
  const drawn = useRef(false)
  useEffect(() => { resultRef.current = onResult })

  useEffect(() => {
    let stale = false
    const timer = setTimeout(async () => {
      const ready = assets || await prepare([slide], design)
      const canvas = canvasRef.current
      if (stale || !canvas) return
      const result = drawSlide(canvas, { slide, index, total, design, assets: ready })
      drawn.current = true
      if (reported.current !== result.overflow) {
        reported.current = result.overflow
        resultRef.current?.(result)
      }
    }, drawn.current ? REDRAW_DELAY : 0)
    return () => { stale = true; clearTimeout(timer) }
  }, [slide, index, total, design, assets])

  const [width, height] = RATIOS[design?.ratio] || RATIOS['4:5']
  const background = design?.colors?.background || templateOf(design?.template).colors.background
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, background }}
    />
  )
}

// Loads the fonts and photos of a whole carousel once. Returns null until the first load finishes, then a fresh
// object after every change (so previews that receive it redraw).
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs next to the component that takes its result
export function useCarouselAssets(slides, design) {
  const [assets, setAssets] = useState(null)
  useEffect(() => {
    let stale = false
    prepare(slides, design).then(ready => { if (!stale) setAssets(ready) })
    return () => { stale = true }
  }, [slides, design])
  return assets
}
