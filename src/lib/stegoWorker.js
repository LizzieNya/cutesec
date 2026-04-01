const MAGIC_NUMBER = 0xC5E0C5E0
const MAGIC_NUMBER_2 = 0x57E60827
const STEGO_BIT_PLANE_OFFSET = 2
const MIN_WRITABLE_ALPHA = 254
const BITS_PER_CHANNEL = 2
const BITS_PER_DECOY_PIXEL = 6
const HEADER_BITS = 128

function buildWritablePixelMap(rgbaData) {
  const maxPixels = rgbaData.length / 4
  const tempArray = new Uint32Array(maxPixels)
  let count = 0

  for (let i = 0; i < maxPixels; i++) {
    if (rgbaData[i * 4 + 3] >= MIN_WRITABLE_ALPHA) {
      tempArray[count++] = i
    }
  }
  
  return tempArray.slice(0, count)
}

function writeBits(decoyData, bitOffset, value, numBits, pixelMap) {
  for (let i = numBits - 1; i >= 0; i--) {
    const bit = (value >>> i) & 1
    const pixelSlot = (bitOffset / BITS_PER_DECOY_PIXEL) | 0
    const pixelIndex = pixelMap ? pixelMap[pixelSlot] : pixelSlot
    if (pixelIndex === undefined) throw new Error('Writable pixel map exhausted while embedding')
    const bitInPixel = bitOffset % BITS_PER_DECOY_PIXEL
    const ch = (bitInPixel / BITS_PER_CHANNEL) | 0
    const bc = bitInPixel % BITS_PER_CHANNEL
    const di = pixelIndex * 4 + ch
    const targetBit = STEGO_BIT_PLANE_OFFSET + (BITS_PER_CHANNEL - 1 - bc)
    decoyData[di] = (decoyData[di] & ~(1 << targetBit)) | (bit << targetBit)
    bitOffset++
  }
  return bitOffset
}

function readBits(stegoData, bitOffset, numBits, pixelMap) {
  let value = 0
  for (let i = numBits - 1; i >= 0; i--) {
    const pixelSlot = (bitOffset / BITS_PER_DECOY_PIXEL) | 0
    const pixelIndex = pixelMap ? pixelMap[pixelSlot] : pixelSlot
    if (pixelIndex === undefined) throw new Error('Writable pixel map exhausted while reading')
    const bitInPixel = bitOffset % BITS_PER_DECOY_PIXEL
    const ch = (bitInPixel / BITS_PER_CHANNEL) | 0
    const bc = bitInPixel % BITS_PER_CHANNEL
    const di = pixelIndex * 4 + ch
    const targetBit = STEGO_BIT_PLANE_OFFSET + (BITS_PER_CHANNEL - 1 - bc)
    value |= (((stegoData[di] >> targetBit) & 1) << i)
    bitOffset++
  }
  return { value: value >>> 0, bitOffset }
}

function fnv1a32(bytes) {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function embedPayload(imageDataArray, encBytesArray, checksum) {
  const writableMap = buildWritablePixelMap(imageDataArray)
  const writableBits = writableMap.length * BITS_PER_DECOY_PIXEL
  const bitsNeeded = HEADER_BITS + (encBytesArray.length * 8)
  if (bitsNeeded > writableBits) {
    throw new Error('Secret is too large for opaque regions of this decoy image.')
  }

  let off = 0
  off = writeBits(imageDataArray, off, MAGIC_NUMBER, 32, writableMap)
  off = writeBits(imageDataArray, off, MAGIC_NUMBER_2, 32, writableMap)
  off = writeBits(imageDataArray, off, encBytesArray.length, 32, writableMap)
  off = writeBits(imageDataArray, off, checksum, 32, writableMap)

  for (const byte of encBytesArray) {
    off = writeBits(imageDataArray, off, byte, 8, writableMap)
  }

  // Fast verification in worker to avoid roundtrip invalid states.
  let verifyOffset = 0
  let vr = readBits(imageDataArray, verifyOffset, 32, writableMap)
  const vm1 = vr.value
  verifyOffset = vr.bitOffset
  vr = readBits(imageDataArray, verifyOffset, 32, writableMap)
  const vm2 = vr.value
  verifyOffset = vr.bitOffset
  vr = readBits(imageDataArray, verifyOffset, 32, writableMap)
  const vLen = vr.value
  verifyOffset = vr.bitOffset
  vr = readBits(imageDataArray, verifyOffset, 32, writableMap)
  const vChecksum = vr.value

  if (vm1 !== MAGIC_NUMBER || vm2 !== MAGIC_NUMBER_2 || vLen !== encBytesArray.length || vChecksum !== checksum) {
    throw new Error('Post-embed verification failed (header/checksum mismatch)')
  }

  return imageDataArray
}

function extractPayload(stegoDataArray) {
  const writableMap = buildWritablePixelMap(stegoDataArray)
  let off = 0
  let r = readBits(stegoDataArray, off, 32, writableMap)
  const m1 = r.value
  off = r.bitOffset
  r = readBits(stegoDataArray, off, 32, writableMap)
  const m2 = r.value
  off = r.bitOffset

  if (m1 !== MAGIC_NUMBER || m2 !== MAGIC_NUMBER_2) {
    throw new Error('Not a matching stego image')
  }

  r = readBits(stegoDataArray, off, 32, writableMap)
  const len = r.value
  off = r.bitOffset
  if (len <= 0 || len > 20_000_000) {
    throw new Error('Invalid data length')
  }

  r = readBits(stegoDataArray, off, 32, writableMap)
  const expectedCs = r.value >>> 0
  off = r.bitOffset

  const payload = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    r = readBits(stegoDataArray, off, 8, writableMap)
    payload[i] = r.value
    off = r.bitOffset
  }

  if (fnv1a32(payload) !== expectedCs) {
    throw new Error('Corrupted payload (checksum mismatch)')
  }

  return payload
}

async function getImageDataFromFile(file) {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, width, height)
}

function drawWatermark(ctx, w, h) {
  const size = 14, margin = 4, x = w - size - margin, y = h - size - margin
  ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = '#FF69B4'
  ctx.beginPath(); ctx.ellipse(x + 4, y + 5, 3.5, 4, -0.3, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(x + 10, y + 5, 3.5, 4, 0.3, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

globalThis.onmessage = async (event) => {
  const { id, type, file, decoyFile, bytesBuffer, checksum } = event.data || {}
  try {
    if (type === 'getWritableInfo') {
      const imageData = await getImageDataFromFile(file)
      const writableMap = buildWritablePixelMap(imageData.data)
      self.postMessage({ id, ok: true, writableCount: writableMap.length })
      return
    }

    if (type === 'embed') {
      const imageData = await getImageDataFromFile(decoyFile)
      const payload = new Uint8Array(bytesBuffer)
      
      const canvas = new OffscreenCanvas(imageData.width, imageData.height)
      const ctx = canvas.getContext('2d')
      
      // Draw watermark FIRST so its pixels are baked in before LSB encoding
      const originalImageData = new ImageData(new Uint8ClampedArray(imageData.data.buffer), imageData.width, imageData.height)
      ctx.putImageData(originalImageData, 0, 0)
      drawWatermark(ctx, imageData.width, imageData.height)
      
      // Read the pixels (now includes watermark) as base for LSB encoding
      const newData = ctx.getImageData(0, 0, imageData.width, imageData.height)
      const outDataArray = embedPayload(newData.data, payload, checksum)
      
      const modifiedImageData = new ImageData(new Uint8ClampedArray(outDataArray.buffer), imageData.width, imageData.height)
      ctx.putImageData(modifiedImageData, 0, 0)
      const imageBlob = await canvas.convertToBlob({ type: 'image/png' })
      
      self.postMessage({ id, ok: true, imageBlob })
      return
    }

    if (type === 'extract') {
      const imageData = await getImageDataFromFile(file)
      const payload = extractPayload(imageData.data)
      self.postMessage({ id, ok: true, bytesBuffer: payload.buffer }, [payload.buffer])
      return
    }

    throw new Error(`Unknown worker task type: ${type}`)
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || 'Stego worker error' })
  }
}

