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

  const inset = Math.max(1, Math.round(size * 0.03125))
  const border = Math.max(1, Math.round(size * 0.046875))
  const innerSize = size - inset * 2

  ctx.fillStyle = '#f6f7f5'
  ctx.fillRect(inset, inset, innerSize, innerSize)

  ctx.fillStyle = '#7a8e94'
  ctx.fillRect(inset, inset, innerSize, border)
  ctx.fillRect(inset, size - inset - border, innerSize, border)
  ctx.fillRect(inset, inset + border, border, innerSize - border * 2)
  ctx.fillRect(size - inset - border, inset + border, border, innerSize - border * 2)

  const glyphX = Math.round(size * 0.34375)
  const glyphY = Math.round(size * 0.265625)
  const glyphWidth = Math.max(2, Math.round(size * 0.1171875))
  const glyphHeight = Math.round(size * 0.5)
  const glyphEndX = Math.round(size * 0.6875)

  ctx.fillStyle = '#4f6c75'
  ctx.fillRect(glyphX, glyphY, glyphWidth, glyphHeight)
  ctx.fillRect(glyphX, glyphY + glyphHeight - glyphWidth, glyphEndX - glyphX, glyphWidth)
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
