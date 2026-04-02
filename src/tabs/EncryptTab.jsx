import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { useCrypto } from '../hooks/useCrypto'

export default function EncryptTab() {
  const { contacts, identity, showMessage, playSound  , clipboardWrite } = useApp()
  const { encryptForMultiple } = useCrypto()
  const [selectedContacts, setSelectedContacts] = useState([])
  const [message, setMessage] = useState('')
  const [results, setResults] = useState(null)
  const [attachImg, setAttachImg] = useState(null)
  const fileRef = useRef()

  const handleEncrypt = () => {
    if (!selectedContacts.length) return showMessage('Select at least one recipient 💌', 'error')
    if (!message.trim() && !attachImg) return showMessage('Type a message first 💭', 'error')

    const recipientMap = {}
    selectedContacts.forEach(name => {
      if (name === 'Note to Self' && identity?.publicKey) {
        recipientMap[name] = identity.publicKey
        return
      }
      const c = contacts.find(c => c.name === name)
      if (c) recipientMap[name] = c.publicKey
    })

    const payload = attachImg ? JSON.stringify({ text: message, img: attachImg }) : message
    try {
      const encrypted = encryptForMultiple(payload, recipientMap)
      setResults(encrypted)
      showMessage('Encrypted successfully! ✨', 'success')
      playSound('sent')
    } catch (e) {
      showMessage('Encryption failed: ' + e.message, 'error')
      playSound('error')
    }
  }

  const copyAll = () => {
    if (!results) return
    const text = Object.entries(results).map(([n, v]) => `// ${n}\n${v}`).join('\n\n')
    clipboardWrite(text)
    showMessage('Copied all! 📋', 'success')
  }

  return (
    <div className="tab-pane-inner" style={{ padding: '16px' }}>
<div className="stego-recipients">
          <label htmlFor="encryptRecipientsSelect">👩‍❤️‍👨 Send to Friends:</label>
          <select
            id="encryptRecipientsSelect"
            multiple
            value={selectedContacts}
            onChange={e => setSelectedContacts([...e.target.selectedOptions].map(o => o.value))}
          >
            {identity?.publicKey && <option value="Note to Self">Note to Self 💖</option>}
            {contacts.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <div className="stego-recipients-hint">Hold Ctrl/Cmd to select multiple.</div>
      </div>

      <div className="input-group">
        <label htmlFor="encryptMessageInput">💌 Your Secret Message:</label>
        <textarea
          id="encryptMessageInput"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Type your secret message here... 💭"
        />
        <div className="mail-attach-bar" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
          <button className="btn-secondary btn-small" onClick={() => fileRef.current.click()}>
            📎 Attach Image / Stego
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files[0]
              if (!f) return
              const r = new FileReader()
              r.onload = ev => setAttachImg(ev.target.result)
              r.readAsDataURL(f)
            }}
          />
          {attachImg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={attachImg} alt="Attachment" style={{ height: 40, borderRadius: 6 }} />
              <button className="btn-secondary btn-small" style={{ padding: '2px 6px', borderRadius: '50%' }}
                onClick={() => { setAttachImg(null); fileRef.current.value = '' }}>✕</button>
            </div>
          )}
        </div>
      </div>

      <div className="actions">
        <button className="btn-primary" onClick={handleEncrypt}>✨ Encrypt</button>
        <button className="btn-secondary" onClick={copyAll}>📋 Copy All</button>
      </div>

      {results && (
        <div className="results-container" style={{ marginTop: 16 }}>
          {Object.entries(results).map(([name, enc]) => (
            <div key={name} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--accent-2)' }}>For {name}:</div>
              <div style={{ position: 'relative' }}>
                <textarea readOnly value={enc || 'Encryption failed'} style={{ height: 80, fontSize: '0.75em', fontFamily: 'monospace' }} />
                <button className="btn-secondary btn-small"
                  style={{ position: 'absolute', top: 6, right: 6 }}
                  onClick={() => { clipboardWrite(enc); showMessage('Copied!', 'success') }}>
                  📋
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
