import { useEffect, useRef } from 'react'

type LogoProps = {
  size?: number
  className?: string
  ariaLabel?: string
}

// Draw the exact same logo as the action icon: a rounded-stroke "L" on a dark gradient background
function drawLIcon(ctx: CanvasRenderingContext2D, size: number) {
  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, size)
  gradient.addColorStop(0, '#0f172a')
  gradient.addColorStop(1, '#1f2937')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  // Subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = Math.max(1, Math.floor(size * 0.05))
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth)

  // Rounded-stroke "L"
  const strokeWidth = Math.max(2, Math.floor(size * 0.14))
  const glyphHeight = Math.floor(size * 0.50)
  const horizontalLength = Math.floor(size * 0.40)

  // Bounding box of the stroked path with round caps: width = L + W, height = H + W
  const bboxWidth = horizontalLength + strokeWidth
  const bboxHeight = glyphHeight + strokeWidth
  const originX = Math.floor((size - bboxWidth) / 2 + strokeWidth / 2)
  // Shift up slightly for optical centering
  const originY = Math.floor((size - bboxHeight) / 2 + strokeWidth / 2 - size * 0.04)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = strokeWidth
  ctx.strokeStyle = '#e5e7eb' // gray-200
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = Math.max(0, Math.floor(size * 0.06))

  ctx.beginPath()
  ctx.moveTo(originX, originY)
  ctx.lineTo(originX, originY + glyphHeight)
  ctx.lineTo(originX + horizontalLength, originY + glyphHeight)
  ctx.stroke()
}

export default function Logo({ size = 20, className, ariaLabel = 'LangQueue logo' }: LogoProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const pixelSize = Math.max(1, Math.floor(size * dpr))
    canvas.width = pixelSize
    canvas.height = pixelSize
    // Ensure CSS size matches logical size
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (dpr !== 1) ctx.scale(dpr, dpr)
    drawLIcon(ctx, size)
  }, [size])

  return (
    <canvas ref={canvasRef} aria-label={ariaLabel} role="img" className={className} />
  )
}


