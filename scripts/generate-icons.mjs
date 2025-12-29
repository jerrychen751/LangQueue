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
  // vertical gradient background to match action icon
  const top = '#0f172a'
  const bottom = '#1f2937'
  // PureImage lacks gradients; approximate with bands
  const bands = size
  for (let y = 0; y < size; y++) {
    const t = y / Math.max(1, size - 1)
    const lerp = (a, b) => Math.round(a + (b - a) * t)
    const topRgb = [0x0f, 0x17, 0x2a]
    const botRgb = [0x1f, 0x29, 0x37]
    const r = lerp(topRgb[0], botRgb[0])
    const g = lerp(topRgb[1], botRgb[1])
    const b = lerp(topRgb[2], botRgb[2])
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, y, size, 1)
  }

  // subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  const border = Math.max(1, Math.floor(size * 0.05))
  for (let i = 0; i < border; i++) {
    ctx.strokeRect(i + 0.5, i + 0.5, size - 1 - i * 2, size - 1 - i * 2)
  }

  // Rounded-stroke L approximation with filled rects (PureImage lacks stroke caps)
  const strokeWidth = Math.max(2, Math.floor(size * 0.14))
  const glyphHeight = Math.floor(size * 0.50)
  const horizontalLength = Math.floor(size * 0.40)
  const bboxWidth = horizontalLength + strokeWidth
  const bboxHeight = glyphHeight + strokeWidth
  const originX = Math.floor((size - bboxWidth) / 2 + strokeWidth / 2)
  // Shift up slightly for optical centering
  const originY = Math.floor((size - bboxHeight) / 2 + strokeWidth / 2 - size * 0.04)
  const color = '#e5e7eb'

  // vertical bar
  ctx.fillStyle = color
  ctx.fillRect(originX, originY, strokeWidth, glyphHeight + Math.floor(strokeWidth / 2))
  // bottom bar
  ctx.fillRect(originX, originY + glyphHeight, horizontalLength + Math.floor(strokeWidth / 2), strokeWidth)
}

async function main() {
  ensureDirSync(outDir)
  for (const s of sizes) {
    const img = PImage.make(s, s)
    drawIcon(img, s)
    const outPath = path.join(outDir, `icon${s}.png`)
    await PImage.encodePNGToStream(img, fs.createWriteStream(outPath))
    console.log(`wrote ${outPath}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

