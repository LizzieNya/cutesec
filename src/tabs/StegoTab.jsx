import { useState, useRef, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import { useApp } from '../context/AppContext'
import forgeLib from 'node-forge'

// ── Constants (same as app.js) ──
const STEGO_BIT_PLANE_OFFSET = 2
const MIN_WRITABLE_ALPHA = 254
const HEADER_BITS = 128
const MAGIC_NUMBER  = 0xC5E0C5E0
const MAGIC_NUMBER_2 = 0x57E60827
const BITS_PER_CHANNEL = 2
const BITS_PER_DECOY_PIXEL = 6  // 3 channels × 2 bits
const MAX_STEGO_FILE_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_STEGO_IMAGE_DIMENSION = 4096
const IMAGE_OP_TIMEOUT_MS = 25_000
const CANCELLED_OP = '__STEGO_OP_CANCELLED__'

function createStegoWorker() {
  return new Worker(new URL('../lib/stegoWorker.js', import.meta.url), { type: 'module' })
}
// ── Pure functions (ported exactly from app.js) ──
function fnv1a32(bytes) {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

async function loadImageData(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file provided'))
    if (file.size > MAX_STEGO_FILE_BYTES) {
        return reject(new Error(`Image too large. Max allowed is 50 MB (got ${(file.size / (1024 * 1024)).toFixed(1)} MB)`))
    }

    const objectURL = URL.createObjectURL(file)
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(objectURL)
      reject(new Error('Image loading timed out. Try a smaller image.'))
    }, IMAGE_OP_TIMEOUT_MS)

    const img = new Image()
    img.onload = () => {
      clearTimeout(timeout)
      if (img.width > MAX_STEGO_IMAGE_DIMENSION || img.height > MAX_STEGO_IMAGE_DIMENSION) {
        URL.revokeObjectURL(objectURL)
        return reject(new Error(`Image dimensions too large. Max is ${MAX_STEGO_IMAGE_DIMENSION}x${MAX_STEGO_IMAGE_DIMENSION}px (got ${img.width}x${img.height}px)`))
      }
      // NOTE: We no longer get image data here. We only resolve metadata.
      // The heavy lifting is moved to the worker.
      resolve({
        width: img.width,
        height: img.height,
        objectURL,
        file, // Pass the file along
      })
    }
    img.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(objectURL)
      reject(new Error('Failed to decode image data'))
    }
    img.src = objectURL
  })
}

async function autoResizeSecret(sourceURL, capacityBits) {
  const maxBytes = Math.floor((capacityBits - HEADER_BITS) / 8)
  const maxData  = Math.floor(maxBytes / 1.4) - 800
  return new Promise(resolve => {
    const timeout = globalThis.setTimeout(() => resolve(null), IMAGE_OP_TIMEOUT_MS)
    const img = new Image()
    img.onload = () => {
      let low = 0.01;
      let high = 1.0;
      let bestFit = null;
      let attempts = 0;
      
      const tryScale = () => {
        attempts++;
        const scale = (low + high) / 2;
        const w = Math.max(1, Math.floor(img.width * scale));
        const h = Math.max(1, Math.floor(img.height * scale));
        
        const c = document.createElement('canvas'); 
        c.width = w; 
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        
        // Use JPEG for far better compression size than PNG, quality 0.85
        const resized = c.toDataURL('image/jpeg', 0.85);
        
        if (resized.length <= maxData) {
          bestFit = resized;
          low = scale; // try to get a larger image that still fits
        } else {
          high = scale; // need to shrink more
        }

        // Binary search up to 8 iterations is usually plenty for convergence
        if (attempts >= 8) {
          globalThis.clearTimeout(timeout);
          resolve(bestFit);
        } else {
          globalThis.setTimeout(tryScale, 0);
        }
      }
      
      // First try scale = 1.0 to avoid quality loss if it already fits!
      const initialCanvas = document.createElement('canvas');
      initialCanvas.width = img.width; 
      initialCanvas.height = img.height;
      initialCanvas.getContext('2d').drawImage(img, 0, 0, img.width, img.height);
      const initialData = initialCanvas.toDataURL('image/png'); // Can keep png for 1:1 if it fits perfectly
      
      if (initialData.length <= maxData) {
        globalThis.clearTimeout(timeout);
        resolve(initialData);
      } else {
        // Fallback to the binary search JPEG compressor
        tryScale();
      }
    }
    img.onerror = () => {
      globalThis.clearTimeout(timeout)
      resolve(null)
    }
    img.src = sourceURL
  })
}

function stripUnsafeControlChars(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)
    const isUnsafe = (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
    if (!isUnsafe) out += text[i]
  }
  return out
}

function extractStegoEnvelopeFromPayload(payloadBuf) {
  const jsonStr = stripUnsafeControlChars(new TextDecoder('utf-8').decode(payloadBuf))
  const envelope = JSON.parse(jsonStr)
  if (!envelope?.v?.startsWith('STEGO')) throw new Error('Invalid stego version')
  return envelope
}

function recoverStegoSessionKey({ envelope, privateKeyPem, forge }) {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem)
  for (const encKey of Object.values(envelope.recipients || {})) {
    try {
      const padded = privateKey.decrypt(forge.util.decode64(encKey), 'RSA-OAEP')
      return padded.slice(16, 16 + 32)
    } catch {
      continue
    }
  }
  return null
}

// ── Component ──
export default function StegoTab() {
  const { identity, contacts, showMessage, playSound } = useApp()
  const [mode, setMode]             = useState('encode')
  const [decoyImg, setDecoyImg]     = useState(null)
  const [secretImg, setSecretImg]   = useState(null)
  const [decodeImg, setDecodeImg]   = useState(null)
  const [selectedRecipients, setSelectedRecipients] = useState(['Note to Self (me)'])
  const [capacity, setCapacity]     = useState(null)
  const [encodeLoading, setEncodeLoading] = useState(false)
  const [decodeLoading, setDecodeLoading] = useState(false)
  const [encodeProgress, setEncodeProgress] = useState(0)
  const [decodeProgress, setDecodeProgress] = useState(0)
  const [decodeDragOver, setDecodeDragOver] = useState(false)
  const [encodeResult, setEncodeResult]   = useState(null) // canvas ref
  const [decodeResult, setDecodeResult]   = useState(null) // decoded image URL
  const outputCanvasRef = useRef()
  const decodeCanvasRef = useRef()
  const workerRef = useRef(null)
  const workerTaskIdRef = useRef(0)
  const encodeTokenRef = useRef(0)
  const decodeTokenRef = useRef(0)

  const forge = globalThis.forge || forgeLib

  const assertEncodeActive = (token) => {
    if (token !== encodeTokenRef.current) throw new Error(CANCELLED_OP)
  }

  const assertDecodeActive = (token) => {
    if (token !== decodeTokenRef.current) throw new Error(CANCELLED_OP)
  }

  // Worker lifecycle
  useEffect(() => {
    workerRef.current = createStegoWorker()
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  // Object URL cleanup
  useEffect(() => {
    return () => {
      if (decoyImg?.objectURL) URL.revokeObjectURL(decoyImg.objectURL)
    }
  }, [decoyImg])

  useEffect(() => {
    return () => {
      if (secretImg?.objectURL) URL.revokeObjectURL(secretImg.objectURL)
    }
  }, [secretImg])

  useEffect(() => {
    return () => {
      if (decodeImg?.objectURL) URL.revokeObjectURL(decodeImg.objectURL)
    }
  }, [decodeImg])

  const resetWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = createStegoWorker()
  }, [])

  const runWorkerTask = useCallback((type, payload, transfer = []) => {
    if (!workerRef.current) workerRef.current = createStegoWorker()
    const id = ++workerTaskIdRef.current
    return new Promise((resolve, reject) => {
      const worker = workerRef.current
      const onMessage = (event) => {
        const msg = event.data
        if (msg?.id !== id) return
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        if (!msg.ok) {
          reject(new Error(msg.error || 'Stego worker task failed'))
          return
        }
        resolve(msg)
      }
      const onError = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        reject(new Error('Stego worker crashed'))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ id, type, ...payload }, transfer)
    })
  }, [])

  const cancelEncode = () => {
    if (!encodeLoading) return
    encodeTokenRef.current += 1
    resetWorker()
    setEncodeLoading(false)
    setEncodeProgress(0)
    showMessage('Stego encode cancelled', 'info')
  }

  const cancelDecode = () => {
    if (!decodeLoading) return
    decodeTokenRef.current += 1
    resetWorker()
    setDecodeLoading(false)
    setDecodeProgress(0)
    showMessage('Stego decode cancelled', 'info')
  }

  // ── Update capacity bar whenever both images are loaded ──
  const updateCapacity = useCallback((decoy, secret) => {
    if (!decoy || !secret) { setCapacity(null); return }

    // The worker now handles getting writable info from the file itself
    runWorkerTask('getWritableInfo', { file: decoy.file })
      .then(workerResult => {
        const { writableCount } = workerResult
        const capBits = writableCount * BITS_PER_DECOY_PIXEL
        const estBytes = Math.ceil((secret.fileSize || 0) * 2) + 1200
        const bitsNeeded = HEADER_BITS + estBytes * 8
        setCapacity({ usage: capBits > 0 ? (bitsNeeded / capBits) * 100 : 999, writable: writableCount })
      })
      .catch((e) => {
        setCapacity(null)
        showMessage('Failed to analyze decoy capacity: ' + e.message, 'error')
      })
  }, [runWorkerTask, showMessage])

  const loadDecoyFile = useCallback(async (file) => {
    if (!file) return
    try {
      const d = await loadImageData(file)
      setDecoyImg(prev => {
        if (prev?.objectURL) URL.revokeObjectURL(prev.objectURL)
        return { ...d, fileSize: file.size }
      })
      updateCapacity(d, secretImg)
    } catch (e) {
      showMessage('Failed to load decoy image: ' + e.message, 'error')
    }
  }, [secretImg, showMessage, updateCapacity])

  const loadSecretFile = useCallback(async (file) => {
    if (!file) return
    try {
      const d = await loadImageData(file)
      setSecretImg(prev => {
        if (prev?.objectURL) URL.revokeObjectURL(prev.objectURL)
        return { ...d, fileSize: file.size }
      })
      updateCapacity(decoyImg, d)
    } catch (e) {
      showMessage('Failed to load secret image: ' + e.message, 'error')
    }
  }, [decoyImg, showMessage, updateCapacity])

  const loadDecodeFile = useCallback(async (file) => {
    if (!file) return
    try {
      const d = await loadImageData(file)
      setDecodeImg(prev => {
        if (prev?.objectURL) URL.revokeObjectURL(prev.objectURL)
        return { ...d, fileSize: file.size }
      })
      setDecodeResult(null)
    } catch (e) {
      showMessage('Failed to load stego image: ' + e.message, 'error')
    }
  }, [showMessage])

  const handleDecoyLoad = async (e) => {
    const f = e.target.files[0]
    if (f) await loadDecoyFile(f)
    e.target.value = '' // Clear input
  }

  const handleSecretLoad = async (e) => {
    const f = e.target.files[0]
    if (f) await loadSecretFile(f)
    e.target.value = '' // Clear input
  }

  const handleDecodeLoad = async (e) => {
    const f = e.target.files[0]
    if (f) await loadDecodeFile(f)
    e.target.value = '' // Clear input
  }

  const handleModeChange = (newMode) => {
    setMode(newMode)
    setDecoyImg(null)
    setSecretImg(null)
    setDecodeImg(null)
    setEncodeResult(null)
    setDecodeResult(null)
    setCapacity(null)
  }

  // ── Encrypt & Embed ──
  const handleEncode = async () => {
    if (!decoyImg || !secretImg) return
    if (selectedRecipients.length === 0) {
      playSound('error')
      return showMessage('Please select at least one recipient.', 'error')
    }
    if (!identity?.publicKey) return showMessage('No identity — create one first', 'error')
    const runToken = ++encodeTokenRef.current
    setEncodeLoading(true)
    setEncodeProgress(0)
    try {
      // The worker gets writable info directly from the file
      const { writableCount } = await runWorkerTask('getWritableInfo', { file: decoyImg.file })
      const capBits = writableCount * BITS_PER_DECOY_PIXEL
      if (capBits <= HEADER_BITS) throw new Error('Decoy has too few opaque pixels')

      const maxBytes = Math.floor((capBits - HEADER_BITS) / 8)
      const maxDataChars = Math.floor(maxBytes / 1.4) - 800
      if (maxDataChars < 2048) throw new Error('Decoy capacity too low. Choose a larger decoy image.')

      const oversizeRatio = Math.ceil((secretImg.fileSize || 0) * 1.4) / Math.max(maxDataChars, 1)
      if (oversizeRatio > 25) {
        throw new Error('Secret image is far too large for this decoy. Use a larger decoy or much smaller secret image.')
      }
      assertEncodeActive(runToken)

      // Auto-resize
      const fittedURL = await autoResizeSecret(secretImg.objectURL, capBits)
      if (!fittedURL) throw new Error('Secret image too large or resize timed out — use a smaller secret or bigger decoy')
      if (fittedURL !== secretImg.objectURL) showMessage('Image auto-resized to fit 🎨', 'info')
      assertEncodeActive(runToken)

      // Encrypt payload
      const secretPayload = JSON.stringify({ v: 'STEGO-IMG-1', imgDataUrl: fittedURL })
      const encryptedJson = await stegoEncrypt(secretPayload, selectedRecipients, identity, contacts, forge)
      const encArray = new TextEncoder().encode(encryptedJson)
      const encBytes = encArray.buffer
      const checksum = fnv1a32(encArray)
      const bitsNeeded = HEADER_BITS + encArray.length * 8
      if (bitsNeeded > capBits) throw new Error('Encrypted secret too large for decoy')
      setEncodeProgress(10)
      assertEncodeActive(runToken)

      // The worker now does all the drawing and embedding
      const workerResult = await runWorkerTask(
        'embed',
        {
          decoyFile: decoyImg.file,
          bytesBuffer: encBytes,
          checksum,
        },
        [encBytes],
      )
      assertEncodeActive(runToken)
      setEncodeProgress(90)

      // The worker returns a finished image blob
      const resultBlob = workerResult.imageBlob
      const resultUrl = URL.createObjectURL(resultBlob)

      const canvas = outputCanvasRef.current
      canvas.width = decoyImg.width; canvas.height = decoyImg.height
      const ctx = canvas.getContext('2d')
      const resultImage = new Image()
      resultImage.onload = () => {
        ctx.drawImage(resultImage, 0, 0)
        URL.revokeObjectURL(resultUrl) // Clean up
        setEncodeProgress(100)
        setEncodeResult(true)
        showMessage('Secret hidden successfully! 🔮✨', 'success')
        playSound('sent')
      }
      resultImage.src = resultUrl

    } catch (e) {
      if (e.message === CANCELLED_OP) return
      showMessage('Encoding failed: ' + e.message, 'error')
      playSound('error')
    } finally {
      setEncodeLoading(false)
      setEncodeProgress(0)
    }
  }

  const handleSave = () => {
    const link = document.createElement('a')
    link.download = 'stego_image.png'
    link.href = outputCanvasRef.current.toDataURL('image/png')
    link.click()
  }

  // ── Decode ──
  const handleDecode = async () => {
    if (!decodeImg) return
    if (!identity?.privateKey) return showMessage('No private key — create identity first', 'error')
    const runToken = ++decodeTokenRef.current
    setDecodeLoading(true)
    setDecodeProgress(0)
    let stage = 'extract'
    try {
      // The worker now extracts directly from the file
      const workerResult = await runWorkerTask('extract', { file: decodeImg.file })
      setDecodeProgress(40)
      assertDecodeActive(runToken)

      const payloadBuffer = new Uint8Array(workerResult.bytesBuffer)
      const envelope = extractStegoEnvelopeFromPayload(payloadBuffer)

      stage = 'keys'
      const sessionKey = recoverStegoSessionKey({ envelope, privateKeyPem: identity.privateKey, forge })
      if (!sessionKey) throw new Error('You are not an authorized recipient')

      stage = 'decrypt'
      const decipher = forge.cipher.createDecipher('AES-GCM', sessionKey)
      decipher.start({ iv: forge.util.decode64(envelope.iv), tag: forge.util.createBuffer(forge.util.decode64(envelope.tag)) })
      decipher.update(forge.util.createBuffer(forge.util.decode64(envelope.data)))
      if (!decipher.finish()) throw new Error('Integrity check failed')
      setDecodeProgress(95)
      assertDecodeActive(runToken)

      const secretPayload = JSON.parse(decipher.output.toString('utf8'))
      if (secretPayload?.v !== 'STEGO-IMG-1') throw new Error('Unsupported secret version')

      // Render result
      const img = new Image(); img.src = secretPayload.imgDataUrl
      await new Promise(r => { img.onload = r })
      const c = decodeCanvasRef.current
      c.width = img.width; c.height = img.height
      c.getContext('2d').drawImage(img, 0, 0)
      setDecodeResult(secretPayload.imgDataUrl)
      setDecodeProgress(100)
      showMessage('Secret revealed! 🔓✨', 'success')
      playSound('receive')
    } catch (e) {
      if (e.message === CANCELLED_OP) return
      showMessage(`Decoding failed (${stage}): ${e.message}`, 'error')
      playSound('error')
    } finally {
      setDecodeLoading(false)
      setDecodeProgress(0)
    }
  }

  const allRecipients = [
    { name: 'Note to Self (me)' },
    ...contacts,
  ]

  return (
    <div style={{ padding: 16 }}>
      <div className="stego-info-banner">
        <span className="stego-info-icon">🖼️</span>
        <div>
          <strong>Image Steganography</strong>
          <p>Hide encrypted messages inside innocent-looking images using LSB encoding.</p>
        </div>
      </div>

      <div className="stego-mode-btns">
        <button className={`stego-mode-btn${mode === 'encode' ? ' active' : ''}`} onClick={() => handleModeChange('encode')}>🔒 Hide Message</button>
        <button className={`stego-mode-btn${mode === 'decode' ? ' active' : ''}`} onClick={() => handleModeChange('decode')}>🔓 Reveal Message</button>
      </div>

      {/* ── ENCODE ── */}
      {mode === 'encode' && (
        <div className="stego-section active">
          <div className="stego-upload-grid">
            <UploadCard label="🖼️ Decoy Image (PNG/JPG)" imgData={decoyImg} onChange={handleDecoyLoad} onFileDrop={loadDecoyFile} />
            <div className="stego-upload-arrow">→</div>
            <UploadCard label="🤫 Secret Image" imgData={secretImg} onChange={handleSecretLoad} onFileDrop={loadSecretFile} />
          </div>

          {capacity && (
            <>
              <div className="stego-capacity-bar-container">
                <div className="stego-capacity-bar"
                  style={{ width: Math.min(capacity.usage, 100) + '%', backgroundColor: capacity.usage > 100 ? '#f39c12' : '#2ecc71' }} />
              </div>
              <div className="stego-capacity-text">
                {capacity.usage > 100
                  ? `⚠️ Needs more capacity (~${capacity.usage.toFixed(0)}%)`
                  : `Capacity: ~${capacity.usage.toFixed(1)}% (${capacity.writable.toLocaleString()} writable px)`}
              </div>
            </>
          )}

          <div className="stego-recipients">
            <label htmlFor="stegoRecipientsSelect">Recipients (can reveal)</label>
            <select id="stegoRecipientsSelect" multiple value={selectedRecipients}
              onChange={e => setSelectedRecipients([...e.target.selectedOptions].map(o => o.value))}>
              {allRecipients.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <div className="stego-recipients-hint">Only selected recipients can decrypt.</div>
          </div>

          <button className="btn-primary" disabled={!decoyImg || !secretImg || encodeLoading} onClick={handleEncode}>
            {encodeLoading ? `Processing... ${encodeProgress}% 🔮` : '🔮 Encrypt & Hide'}
          </button>
          {encodeLoading && (
            <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={cancelEncode}>Cancel</button>
          )}

          <div id="stegoEncodeResult" style={{ display: encodeResult ? 'block' : 'none', marginTop: 16 }}>
            <canvas ref={outputCanvasRef} style={{ maxWidth: '100%', borderRadius: 10 }} />
            {encodeResult && (
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn-secondary" onClick={handleSave}>💾 Save Image</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DECODE ── */}
      {mode === 'decode' && (
        <div className="stego-section active">
          <div className="stego-upload-card full-width">
            <button
              type="button"
              className={`stego-drop-zone${decodeDragOver ? ' drag-over' : ''}`}
              onClick={() => document.getElementById('stegoDecodeFileInput').click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDecodeDragOver(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setDecodeDragOver(false)
              }}
              onDrop={async (e) => {
                e.preventDefault()
                setDecodeDragOver(false)
                const file = e.dataTransfer?.files?.[0]
                await loadDecodeFile(file)
              }}
              aria-label="Upload stego image to decode"
            >
              {decodeImg
                ? <img src={decodeImg.objectURL} className="upload-preview" alt="Stego" style={{ display: 'block' }} />
                : <div className="upload-placeholder"><span>🔍</span><span>Stego Image to Decode</span></div>
              }
            </button>
            <input id="stegoDecodeFileInput" type="file" accept="image/png,image/jpeg,image/jpg,image/bmp" hidden onChange={handleDecodeLoad} />
          </div>

          <button className="btn-primary" style={{ marginTop: 12 }} disabled={!decodeImg || decodeLoading} onClick={handleDecode}>
            {decodeLoading ? `Decoding... ${decodeProgress}% 🔍` : '🔓 Reveal Secret'}
          </button>
          {decodeLoading && (
            <button className="btn-secondary" style={{ marginTop: 12, marginLeft: 8 }} onClick={cancelDecode}>Cancel</button>
          )}

          <div id="stegoDecodeResult" style={{ display: decodeResult ? 'block' : 'none', marginTop: 16, textAlign: 'center' }}>
            <canvas ref={decodeCanvasRef} style={{ maxWidth: '100%', borderRadius: 10 }} />
            {decodeResult && (
              <div className="actions" style={{ marginTop: 10 }}>
                <a className="btn-secondary" href={decodeResult} download="revealed_secret.png">💾 Save Revealed Image</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function UploadCard({ label, imgData, onChange, onFileDrop }) {
  const id = label.replaceAll(' ', '_')
  const [dragOver, setDragOver] = useState(false)

  return (
    <div className="stego-upload-card">
      <button
        type="button"
        className={`stego-drop-zone${dragOver ? ' drag-over' : ''}`}
        onClick={() => document.getElementById(id).click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragOver(false)
        }}
        onDrop={async (e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer?.files?.[0]
          await onFileDrop?.(file)
        }}
        aria-label={`Upload ${label}`}
      >
        {imgData
          ? <img src={imgData.objectURL} className="upload-preview" alt="Preview" style={{ display: 'block' }} />
          : <div className="upload-placeholder"><span>{label.split(' ')[0]}</span><span>{label.split(' ').slice(1).join(' ')}</span></div>
        }
      </button>
      <input id={id} type="file" accept="image/png,image/jpeg,image/jpg,image/bmp" hidden onChange={onChange} />
      {imgData && <div className="upload-info">{imgData.width}×{imgData.height}px</div>}
    </div>
  )
}

UploadCard.propTypes = {
  label: PropTypes.string.isRequired,
  imgData: PropTypes.shape({
    objectURL: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
  }),
  onChange: PropTypes.func.isRequired,
  onFileDrop: PropTypes.func,
}

async function stegoEncrypt(payload, recipientNames, identity, contacts, forge) {
  const sessionKey = forge.random.getBytesSync(32)
  const iv = forge.random.getBytesSync(16)
  const cipher = forge.cipher.createCipher('AES-GCM', sessionKey)
  cipher.start({ iv })
  cipher.update(forge.util.createBuffer(payload, 'utf8'))
  cipher.finish()
  const encData = forge.util.encode64(cipher.output.getBytes()).replaceAll('\n', '')
  const authTag = forge.util.encode64(cipher.mode.tag.getBytes()).replaceAll('\n', '')

  const recipients = {}
  const names = recipientNames.length ? recipientNames : ['Note to Self (me)']
  for (const name of names) {
    let pubKeyPem
    if (name === 'Note to Self (me)' || name === '__SELF__') pubKeyPem = identity.publicKey
    else {
      const c = contacts.find(x => x.name === name)
      if (c) pubKeyPem = c.publicKey
    }
    if (!pubKeyPem) continue
    const pub = forge.pki.publicKeyFromPem(pubKeyPem)
    const padded = forge.random.getBytesSync(16) + sessionKey + forge.random.getBytesSync(16)
    recipients[name] = forge.util.encode64(pub.encrypt(padded, 'RSA-OAEP')).replaceAll('\n', '')
  }

  return JSON.stringify({ v: 'STEGO-2.0', recipients, iv: forge.util.encode64(iv).replaceAll('\n', ''), tag: authTag, data: encData, ts: Date.now() })
}
