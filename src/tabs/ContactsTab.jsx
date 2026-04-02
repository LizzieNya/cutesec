import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import forgeLib from 'node-forge'

export default function ContactsTab() {
  const { contacts, saveContacts, identity, showMessage  , clipboardWrite } = useApp()
  const [name, setName] = useState('')
  const [keyText, setKeyText] = useState('')
  const importFileRef = useRef()
  const forge = globalThis.forge || forgeLib

  const addContact = () => {
    if (!name.trim()) return showMessage('Enter a name 💕', 'error')
    if (!keyText.trim()) return showMessage('Paste their public key 🔑', 'error')
    if (contacts.some(c => c.name === name.trim())) return showMessage('Friend already exists!', 'error')
    try {
      // Validate it's a real RSA key
      forge.pki.publicKeyFromPem(keyText.trim())
      saveContacts([...contacts, { name: name.trim(), publicKey: keyText.trim() }])
      setName(''); setKeyText('')
      showMessage('Friend added! 💖', 'success')
    } catch {
      showMessage('Invalid public key format 🚨', 'error')
    }
  }

  const removeContact = async (contactName) => {
    const ok = await mobileConfirm(`Remove friend ${contactName}?`)
    if (!ok) return
    saveContacts(contacts.filter(c => c.name !== contactName))
    showMessage('Removed 🗑️', 'info')
  }

  const importFile = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    const fileText = await f.text()
    try {
      const data = JSON.parse(fileText)
      if (data.salt && data.iv && data.data && data.authTag) {
        const pass = globalThis.prompt(`Enter password to decrypt "${f.name}":`)
        if (!pass) return
        const salt = forge.util.decode64(data.salt)
        const iv = forge.util.decode64(data.iv)
        const authTag = forge.util.decode64(data.authTag)
        const encrypted = forge.util.decode64(data.data)
        const key = forge.pkcs5.pbkdf2(pass, salt, 100000, 32, forge.md.sha512.create())
        const decipher = forge.cipher.createDecipher('AES-GCM', key)
        decipher.start({ iv, tag: forge.util.createBuffer(authTag) })
        decipher.update(forge.util.createBuffer(encrypted))
        if (!decipher.finish()) throw new Error('Wrong password or corrupted file')
        setKeyText(decipher.output.toString('utf8').trim())
        setName(f.name.replace(/\.(json|keyenc|pubkey|pem)$/i, ''))
        showMessage('Encrypted key file decrypted ✅', 'success')
      } else if (data.publicKey && data.name) {
        setName(data.name)
        setKeyText(data.publicKey)
        showMessage('Key loaded! Click Add Friend to save.', 'info')
      } else {
        setKeyText(fileText.trim())
        showMessage('Key loaded! Add a name and click Add Friend.', 'info')
      }
    } catch {
      setKeyText(fileText.trim())
    }
  }

  const myPubKey = identity?.publicKey || ''

  const exportEncryptedPublicKey = () => {
    if (!myPubKey) {
      showMessage('No identity to export', 'error')
      return
    }
    const pass = globalThis.prompt('Choose a password to encrypt your public key export:')
    if (!pass) return
    try {
      const salt = forge.random.getBytesSync(32)
      const iv = forge.random.getBytesSync(16)
      const key = forge.pkcs5.pbkdf2(pass, salt, 100000, 32, forge.md.sha512.create())
      const cipher = forge.cipher.createCipher('AES-GCM', key)
      cipher.start({ iv })
      cipher.update(forge.util.createBuffer(myPubKey, 'utf8'))
      if (!cipher.finish()) throw new Error('Could not encrypt key')

      const out = {
        version: '2.0',
        salt: forge.util.encode64(salt),
        iv: forge.util.encode64(iv),
        authTag: forge.util.encode64(cipher.mode.tag.getBytes()),
        data: forge.util.encode64(cipher.output.getBytes()),
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'my_identity_public.keyenc'
      a.click()
      URL.revokeObjectURL(url)
      showMessage('Encrypted public key exported 🔒', 'success')
    } catch (e) {
      showMessage('Export failed: ' + e.message, 'error')
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="input-group">
        <p className="setting-label">➕ Add Friend (Public Key)</p>
        <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={() => importFileRef.current.click()}>
            📂 Import Key File
          </button>
          <input ref={importFileRef} type="file" accept=".keyenc,.pubkey,.json" style={{ display: 'none' }} onChange={importFile} />
        </div>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Friend's name..." />
        <textarea value={keyText} onChange={e => setKeyText(e.target.value)} placeholder="Paste their RSA Public Key here..." />
        <button className="btn-primary" onClick={addContact}>💕 Add Friend</button>
      </div>

      <h3 style={{ marginTop: 20 }}>Your Friends</h3>
      <div className="contacts-list" id="contactsContainer">
        {contacts.length === 0 && <p style={{ color: '#9a89b3', textAlign: 'center', padding: 20 }}>No friends yet 💌</p>}
        {contacts.map(c => (
          <div key={c.name} className="contact-card">
            <div className="contact-avatar">{c.name[0].toUpperCase()}</div>
            <div className="contact-info">
              <strong>{c.name}</strong>
              <span style={{ fontSize: '0.75em', color: '#9a89b3', fontFamily: 'monospace' }}>
                {c.publicKey.slice(27, 55)}…
              </span>
            </div>
            <div className="contact-actions">
              <button className="btn-secondary btn-small"
                onClick={() => { clipboardWrite(c.publicKey); showMessage('Key copied!', 'success') }}>
                📋
              </button>
              <button className="btn-secondary btn-small" onClick={() => removeContact(c.name)}>🗑️</button>
            </div>
          </div>
        ))}
      </div>

      <div className="input-group" style={{ marginTop: 30, borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: 20 }}>
        <p className="setting-label">📋 Your Identity (Share with friends)</p>
        <textarea readOnly value={myPubKey} placeholder="No identity found. Create New Identity." />
        <div className="actions">
          <button className="btn-secondary" onClick={() => { clipboardWrite(myPubKey); showMessage('Key copied!', 'success') }}>
            📋 Copy
          </button>
          <button className="btn-secondary" onClick={exportEncryptedPublicKey}>
            🔒 Export Encrypted Key
          </button>
        </div>
      </div>
    </div>
  )
}

// Re-use the mobile-safe confirm from app.js global scope if available, else fallback
async function mobileConfirm(msg) {
  if (typeof globalThis.mobileConfirm === 'function') return globalThis.mobileConfirm(msg)
  return globalThis.confirm(msg)
}
