import fs from 'node:fs'
import path from 'node:path'
import * as PImage from 'pureimage'

const sizes = [16, 32, 48, 128]
const outDir = path.resolve(process.cwd(), 'public', 'images')

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function drawIcon(img, size) {
  const ctx = img.getContext('2d')
  // flat background
  const backgroundColor = '#0f172a'
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, size, size)

  // geometry for crisp, straight-edged L
  const padding = Math.max(1, Math.floor(size * 0.12))
  const contentLeft = padding
  const contentTop = padding
  const contentSize = size - padding * 2

  const glyphColor = '#e5e7eb'
  const lThickness = Math.max(2, Math.floor(size * 0.12))
  const horizontalLength = Math.max(lThickness * 2, Math.floor((size - padding * 2) * 0.6))

  // L vertical bar
  ctx.fillStyle = glyphColor
  ctx.fillRect(contentLeft, contentTop, lThickness, contentSize)

  // L bottom bar (shorter than height to make L less square)
  ctx.fillRect(contentLeft, contentTop + contentSize - lThickness, horizontalLength, lThickness)

  // Q in the top-right quadrant, sitting on top of the L
  const qBoxLeft = contentLeft + lThickness
  const qBoxTop = contentTop
  const qBoxSize = contentSize - lThickness
  if (qBoxSize > 0) {
    // Outer ring
    const cx = qBoxLeft + qBoxSize / 2
    const cy = qBoxTop + qBoxSize / 2
    const outerR = qBoxSize / 2
    const ringThickness = Math.max(1, Math.floor(qBoxSize * 0.18))
    const innerR = Math.max(1, outerR - ringThickness)

    // Draw outer filled circle (Q body)
    ctx.fillStyle = glyphColor
    ctx.beginPath()
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2, false)
    ctx.fill()

    // Punch inner hole to create the ring
    ctx.fillStyle = backgroundColor
    ctx.beginPath()
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2, false)
    ctx.fill()

    // Q tail: diagonal wedge at bottom-right to read clearly as a Q (not O)
    const theta = Math.PI / 4 // 45° (bottom-right)
    const delta = Math.PI / 12 // wedge half-angle (~15°)
    const tailLength = Math.max(1, Math.floor(qBoxSize * 0.28))

    const base1x = cx + Math.cos(theta - delta) * outerR
    const base1y = cy + Math.sin(theta - delta) * outerR
    const base2x = cx + Math.cos(theta + delta) * outerR
    const base2y = cy + Math.sin(theta + delta) * outerR
    const tipx = cx + Math.cos(theta) * (outerR + tailLength)
    const tipy = cy + Math.sin(theta) * (outerR + tailLength)

    ctx.fillStyle = glyphColor
    ctx.beginPath()
    ctx.moveTo(base1x, base1y)
    ctx.lineTo(base2x, base2y)
    ctx.lineTo(tipx, tipy)
    ctx.closePath()
    ctx.fill()
  }
}

async function main() {
  ensureDirSync(outDir)
  for (const s of sizes) {
    const img = PImage.make(s, s)
    drawIcon(img, s)
    const outPath = path.join(outDir, `icon${s}.png`)
    await PImage.encodePNGToStream(img, fs.createWriteStream(outPath))
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})


