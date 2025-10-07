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
  // background gradient (approximate with two rects since pureimage lacks gradients)
  ctx.fillStyle = '#0f172a' // start
  ctx.fillRect(0, 0, size, Math.floor(size * 0.55))
  ctx.fillStyle = '#1f2937' // end
  ctx.fillRect(0, Math.floor(size * 0.55), size, size - Math.floor(size * 0.55))

  // subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  const lineW = Math.max(1, Math.floor(size * 0.05))
  ctx.lineWidth = lineW
  ctx.strokeRect(lineW / 2, lineW / 2, size - lineW, size - lineW)

  // draw L with round joins
  const strokeWidth = Math.max(2, Math.floor(size * 0.16))
  const glyphHeight = Math.floor(size * 0.50)
  const horizontalLength = Math.floor(size * 0.40)
  const bboxWidth = horizontalLength + strokeWidth
  const bboxHeight = glyphHeight + strokeWidth
  const originX = Math.floor((size - bboxWidth) / 2 + strokeWidth / 2)
  const originY = Math.floor((size - bboxHeight) / 2 + strokeWidth / 2)

  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = strokeWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // shadow (simple fake by drawing behind)
  ctx.beginPath()
  ctx.moveTo(originX + 1, originY + 1)
  ctx.lineTo(originX + 1, originY + glyphHeight + 1)
  ctx.lineTo(originX + horizontalLength + 1, originY + glyphHeight + 1)
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'
  ctx.stroke()

  // foreground L
  ctx.beginPath()
  ctx.moveTo(originX, originY)
  ctx.lineTo(originX, originY + glyphHeight)
  ctx.lineTo(originX + horizontalLength, originY + glyphHeight)
  ctx.strokeStyle = '#e5e7eb'
  ctx.stroke()
}

async function main() {
  ensureDirSync(outDir)
  for (const s of sizes) {
    const img = PImage.make(s, s)
    drawIcon(img, s)
    const outPath = path.join(outDir, `icon${s}.png`)
    const stream = fs.createWriteStream(outPath)
    await PImage.encodePNGToStream(img, stream)
    await new Promise((res) => stream.on('finish', res))
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})


