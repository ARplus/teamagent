// 生成简单 PWA 图标（无需外部依赖）
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

function crc32(buf) {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf])
}

function makePng(size, r, g, b) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  
  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: RGB
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace
  
  // Image data: each row = filter byte (0) + RGB pixels
  const rowSize = 1 + size * 3
  const raw = Buffer.alloc(size * rowSize)
  for (let y = 0; y < size; y++) {
    const rowBase = y * rowSize
    raw[rowBase] = 0 // filter type: None
    for (let x = 0; x < size; x++) {
      const px = rowBase + 1 + x * 3
      // Draw a gradient: dark background with orange circle
      const cx = x - size / 2
      const cy = y - size / 2
      const dist = Math.sqrt(cx * cx + cy * cy)
      const radius = size * 0.4
      
      if (dist < radius) {
        // Orange gradient circle
        const t = 1 - dist / radius
        raw[px]     = Math.round(15 + t * (249 - 15))   // R: dark → orange
        raw[px + 1] = Math.round(23 + t * (115 - 23))   // G
        raw[px + 2] = Math.round(42 + t * (22 - 42))    // B
      } else {
        // Dark background
        raw[px]     = 15   // R
        raw[px + 1] = 23   // G
        raw[px + 2] = 42   // B
      }
    }
  }
  
  const compressed = zlib.deflateSync(raw)
  const idat = chunk('IDAT', compressed)
  const iend = chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, chunk('IHDR', ihdr), idat, iend])
}

const publicDir = path.join(__dirname, 'public')

// Generate 192x192
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), makePng(192))
console.log('✅ icon-192.png generated')

// Generate 512x512
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), makePng(512))
console.log('✅ icon-512.png generated')
