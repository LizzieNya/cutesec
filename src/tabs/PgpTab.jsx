import { useState, useEffect } from 'react'
import { useApp, DB } from '../context/AppContext'
import * as openpgpLib from 'openpgp'

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

function getPgpMyKeys()        { return DB.get('cute_pgp_my_keys')   || [] }
function getPgpContacts()      { return DB.get('cute_pgp_contacts')  || [] }
function savePgpMyKeys(keys)   { DB.set('cute_pgp_my_keys', keys) }
function savePgpContacts(list) { DB.set('cute_pgp_contacts', list) }

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export default function PgpTab() {
  const { showMessage, playSound } = useApp()
  const openpgp = globalThis.openpgp || openpgpLib

  const [myKeys,    setMyKeys]    = useState(getPgpMyKeys)
  const [contacts,  setContacts]  = useState(getPgpContacts)
  const [input,     setInput]     = useState('')
  const [output,    setOutput]    = useState('')
  const [selectedRecipients, setSelectedRecipients] = useState([])
  const [showGenModal, setShowGenModal] = useState(false)

  // Gen form
  const [genName,  setGenName]  = useState('')
  const [genEmail, setGenEmail] = useState('')
  const [genPass,  setGenPass]  = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactKey, setContactKey] = useState('')

  const refresh = () => { setMyKeys(getPgpMyKeys()); setContacts(getPgpContacts()) }

  useEffect(() => {
    const onAutoPaste = (event) => {
      const text = event.detail?.text
      if (text) setInput(text)
    }
    globalThis.addEventListener('cute-autopaste-pgp', onAutoPaste)
    return () => globalThis.removeEventListener('cute-autopaste-pgp', onAutoPaste)
  }, [])

  const generateKey = async () => {
    if (!genName || !genEmail) return showMessage('Name & Email required!', 'error')
    if (!openpgp) return showMessage('OpenPGP library not loaded', 'error')
    setGenLoading(true)
    try {
      const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'rsa', rsaBits: 4096,
        userIDs: [{ name: genName, email: genEmail }],
        passphrase: genPass || undefined,
      })
      const updated = [...getPgpMyKeys(), { id: Date.now().toString(), name: genName, email: genEmail, publicKey, privateKey, createdAt: new Date().toISOString() }]
      savePgpMyKeys(updated); refresh()
      setShowGenModal(false); setGenName(''); setGenEmail(''); setGenPass('')
      showMessage('PGP key pair generated! 🔑', 'success')
      playSound('sent')
    } catch (e) {
      showMessage('Key generation failed: ' + e.message, 'error')
      playSound('error')
    } finally { setGenLoading(false) }
  }

  const encrypt = async () => {
    if (!openpgp) return showMessage('OpenPGP not loaded', 'error')
    if (!input.trim()) return showMessage('Enter a message', 'error')
    if (!selectedRecipients.length) return showMessage('Select at least one recipient', 'error')
    try {
      const pubKeys = await Promise.all(
        selectedRecipients.map(id => {
          const c = contacts.find(x => x.id === id) || myKeys.find(x => x.id === id)
          return openpgp.readKey({ armoredKey: c.publicKey })
        })
      )
      const msg = await openpgp.createMessage({ text: input })
      const encrypted = await openpgp.encrypt({ message: msg, encryptionKeys: pubKeys })
      setOutput(encrypted)
      showMessage('Encrypted! 🔒', 'success')
      playSound('sent')
    } catch (e) {
      showMessage('Encryption failed: ' + e.message, 'error')
      playSound('error')
    }
  }

  const decrypt = async () => {
    if (!openpgp) return showMessage('OpenPGP not loaded', 'error')
    if (!input.trim()) return showMessage('Paste a PGP message', 'error')
    if (!myKeys.length) return showMessage('No private keys — generate one first', 'error')
    // Try each private key
    for (const k of myKeys) {
      try {
        let privKey = await openpgp.readPrivateKey({ armoredKey: k.privateKey })
        const needsPassphrase = typeof privKey.isDecrypted === 'function' ? !privKey.isDecrypted() : Boolean(k.hasPassphrase)
        if (needsPassphrase) {
          const passphrase = globalThis.prompt(`Enter passphrase for ${k.name || 'selected key'}:`)
          if (!passphrase) continue
          privKey = await openpgp.decryptKey({ privateKey: privKey, passphrase })
        }
        const message = await openpgp.readMessage({ armoredMessage: input })
        const { data } = await openpgp.decrypt({ message, decryptionKeys: privKey })
        setOutput(data)
        showMessage('Decrypted! 🔓', 'success')
        playSound('receive')
        return
      } catch {
        // Continue trying remaining keys.
      }
    }
    showMessage('Decryption failed — message not for any of your keys', 'error')
    playSound('error')
  }

  const removeKey = (id) => {
    const updated = getPgpMyKeys().filter(k => k.id !== id)
    savePgpMyKeys(updated); refresh()
  }

  const addContact = async () => {
    if (!contactName.trim() || !contactKey.trim()) {
      showMessage('Contact name and public key are required', 'error')
      return
    }
    try {
      await openpgp.readKey({ armoredKey: contactKey.trim() })
      const exists = contacts.some((c) => c.name.toLowerCase() === contactName.trim().toLowerCase())
      if (exists) {
        showMessage('A PGP contact with that name already exists', 'error')
        return
      }
      const next = [...contacts, {
        id: Date.now().toString(),
        name: contactName.trim(),
        publicKey: contactKey.trim(),
      }]
      savePgpContacts(next)
      setContactName('')
      setContactKey('')
      refresh()
      showMessage('PGP contact imported! 👥', 'success')
    } catch (e) {
      showMessage('Invalid armored public key: ' + e.message, 'error')
    }
  }

  const removeContact = (id) => {
    savePgpContacts(getPgpContacts().filter((c) => c.id !== id))
    refresh()
  }

  const allRecipients = [
    ...myKeys.map(k => ({ id: k.id, label: `👤 ${k.name} <${k.email}> (Me)` })),
    ...contacts.map(c => ({ id: c.id, label: `👥 ${c.name}` })),
  ]

  return (
    <div style={{ padding: 16 }}>
      <div className="pgp-layout">
        {/* Sidebar */}
        <div className="pgp-sidebar">
          <h3>Keyring 🔑</h3>
          <div className="pgp-key-list">
            {myKeys.length === 0 && <p style={{ color: '#9a89b3', fontSize: '0.85em' }}>No keys yet</p>}
            {myKeys.map(k => (
              <div key={k.id} className="pgp-key-item" style={{ padding: '8px', borderRadius: 8, marginBottom: 6, background: 'rgba(255,182,193,0.1)' }}>
                <strong style={{ fontSize: '0.85em' }}>{k.name}</strong>
                <div style={{ fontSize: '0.75em', color: '#9a89b3' }}>{k.email}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn-secondary btn-small"
                    onClick={() => copyTextWithFallback(k.publicKey, showMessage, 'Public key copied!')}>📋</button>
                  <button className="btn-secondary btn-small"
                    onClick={() => downloadTextFile(`pgp_${k.name.replaceAll(/\s+/g, '_')}_public.asc`, k.publicKey)}>⬇️ Pub</button>
                  <button className="btn-secondary btn-small"
                    onClick={() => downloadTextFile(`pgp_${k.name.replaceAll(/\s+/g, '_')}_private.asc`, k.privateKey)}>⬇️ Priv</button>
                  <button className="btn-secondary btn-small" onClick={() => removeKey(k.id)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
          <h4 style={{ marginTop: 14, marginBottom: 8 }}>PGP Contacts</h4>
          <div className="pgp-key-list">
            {contacts.length === 0 && <p style={{ color: '#9a89b3', fontSize: '0.85em' }}>No PGP contacts yet</p>}
            {contacts.map((c) => (
              <div key={c.id} className="pgp-key-item" style={{ padding: '8px', borderRadius: 8, marginBottom: 6, background: 'rgba(137,207,240,0.12)' }}>
                <strong style={{ fontSize: '0.85em' }}>{c.name}</strong>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn-secondary btn-small"
                    onClick={() => copyTextWithFallback(c.publicKey, showMessage, 'Contact public key copied!')}>📋</button>
                  <button className="btn-secondary btn-small" onClick={() => removeContact(c.id)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-primary btn-small" style={{ width: '100%', marginTop: 10 }}
            onClick={() => setShowGenModal(true)}>➕ New Key Pair</button>
        </div>

        {/* Main */}
        <div className="pgp-main">
          <div className="pgp-section">
            <h3>📝 PGP Message</h3>
            <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Type message or paste PGP block..." />
            <div className="pgp-controls">
              <div className="pgp-recipients">
                <label htmlFor="pgpRecipientSelect">To:</label>
                <select id="pgpRecipientSelect" multiple value={selectedRecipients}
                  onChange={e => setSelectedRecipients([...e.target.selectedOptions].map(o => o.value))}>
                  {allRecipients.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div className="pgp-actions">
                <button className="btn-primary" onClick={encrypt}>🔒 Encrypt</button>
                <button className="btn-action" onClick={decrypt}>🔓 Decrypt</button>
              </div>
            </div>
          </div>

          {output && (
            <div className="pgp-section result">
              <h3>📄 Result</h3>
              <textarea readOnly value={output} />
              <button className="btn-secondary btn-small"
                onClick={() => copyTextWithFallback(output, showMessage)}>📋 Copy</button>
            </div>
          )}

          <div className="pgp-section" style={{ marginTop: 12 }}>
            <h3>👥 Import PGP Contact</h3>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact name"
              style={{ marginBottom: 8 }}
            />
            <textarea
              value={contactKey}
              onChange={(e) => setContactKey(e.target.value)}
              placeholder="Paste armored public key (-----BEGIN PGP PUBLIC KEY BLOCK-----)"
            />
            <button className="btn-secondary" style={{ marginTop: 8 }} onClick={addContact}>Import Contact Key</button>
          </div>
        </div>
      </div>

      {/* Generate modal */}
      {showGenModal && (
        <div className="modal" style={{ display: 'block' }}>
          <div className="modal-content">
            <button type="button" className="close" onClick={() => setShowGenModal(false)}>&times;</button>
            <h3>Generate PGP Key Pair</h3>
            <input type="text"     value={genName}  onChange={e => setGenName(e.target.value)}  placeholder="Your Name" style={{ marginBottom: 10 }} />
            <input type="email"    value={genEmail} onChange={e => setGenEmail(e.target.value)} placeholder="Email Address" style={{ marginBottom: 10 }} />
            <input type="password" value={genPass}  onChange={e => setGenPass(e.target.value)}  placeholder="Passphrase (optional but recommended)" style={{ marginBottom: 16 }} />
            <button className="btn-primary" onClick={generateKey} disabled={genLoading}>
              {genLoading ? 'Generating... ⏳' : 'Generate Key 🔑'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
