import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useCrypto } from '../hooks/useCrypto'

async function copyTextWithFallback(text, showMessage, successText = 'Copied!') {
  if (!text) {
    showMessage('Nothing to copy', 'info')
    return false
  }

  try {
    await globalThis.navigator.clipboard.writeText(text)
    showMessage(successText, 'success')
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, ta.value.length)
      showMessage('Clipboard unavailable. Text selected, press Ctrl+C.', 'info')
      globalThis.setTimeout(() => ta.remove(), 1000)
      return false
    } catch {
      // Fall through to manual-copy hint
    }
  }

  showMessage('Clipboard unavailable. Select and copy manually.', 'info')
  return false
}

export default function DecryptTab() {
  const { showMessage, autoCopy, playSound } = useApp()
  const { decryptMessage } = useCrypto()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [outputImg, setOutputImg] = useState(null)

  useEffect(() => {
    const onAutoPaste = (event) => {
      const text = event.detail?.text
      if (text) setInput(text)
    }
    globalThis.addEventListener('cute-autopaste-decrypt', onAutoPaste)
    return () => globalThis.removeEventListener('cute-autopaste-decrypt', onAutoPaste)
  }, [])

  const handleDecrypt = async () => {
    if (!input.trim()) return showMessage('Paste an encrypted message first 🔐', 'error')
    try {
      const dec = decryptMessage(input.trim())
      // Check if it's a JSON payload with an image
      try {
        const parsed = JSON.parse(dec)
        if (parsed.img) {
          setOutputImg(parsed.img)
          setOutput(parsed.text || '')
        } else {
          setOutput(dec)
          setOutputImg(null)
        }
      } catch {
        setOutput(dec)
        setOutputImg(null)
      }
      if (autoCopy) await copyTextWithFallback(dec, showMessage, 'Decrypted result copied 📋')
      showMessage('Decrypted! 💖', 'success')
      playSound('receive')
    } catch (e) {
      showMessage('Decryption failed: ' + e.message, 'error')
      playSound('error')
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="input-group">
        <label htmlFor="decryptInputBox">🔐 Paste Encrypted Message:</label>
        <textarea
          id="decryptInputBox"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste the encrypted message here..."
        />
      </div>
      <div className="actions">
        <button className="btn-primary" onClick={handleDecrypt}>🔓 Decrypt</button>
        <button className="btn-secondary" onClick={() => copyTextWithFallback(output, showMessage)}>
          📋 Copy Result
        </button>
      </div>
      <div className="input-group" style={{ marginTop: 16 }}>
        <label htmlFor="decryptOutputBox">💖 Decrypted Message:</label>
        <textarea id="decryptOutputBox" readOnly value={output} placeholder="Decrypted message will appear here..." />
        {outputImg && (
          <img src={outputImg} alt="Decrypted" style={{ maxWidth: '100%', borderRadius: 10, marginTop: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }} />
        )}
      </div>
    </div>
  )
}
