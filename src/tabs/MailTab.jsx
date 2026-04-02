import { useState, useEffect, useRef } from 'react'
import { useApp, DB } from '../context/AppContext'
import forgeLib from 'node-forge'

function getPeerIdFromPublicKey(pubKeyPem) {
  if (!pubKeyPem) return ''
  const forge = globalThis.forge || forgeLib
  const md = forge.md.sha256.create()
  md.update(pubKeyPem.replace(/\s+/g, ''))
  return 'cutesec_' + md.digest().toHex().slice(0, 24)
}

function getMailbox()     { return DB.get('cute_mailbox') || { inbox: [], sent: [], drafts: [] } }
function saveMailbox(mb)  { DB.set('cute_mailbox', mb) }
function genId()          { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9) }

function getFolderLabel(folderName) {
  if (folderName === 'inbox') return '📥 Inbox'
  if (folderName === 'sent') return '📤 Sent'
  return '📝 Drafts'
}

function getMailPreview(mail, folderName) {
  const decryptedPreview = (mail.body || '').slice(0, 60)
  if (folderName === 'sent' && mail.deliveryStatus === 'pending') {
    const pendingPreview = mail.decrypted ? (mail.body || '').slice(0, 40) : '🔒 Encrypted'
    return `⏳ Pending • ${pendingPreview}`
  }
  return mail.decrypted ? decryptedPreview : '🔒 Encrypted'
}

function getReadFromLabel(folderName, mail) {
  if (folderName === 'sent') return `To: ${mail.to}`
  return `From: ${mail.from || 'Unknown'}`
}

function resolveRecipientKey({ to, identity, contacts }) {
  if (to === 'Note to Self') return identity.publicKey
  const contact = contacts.find((x) => x.name === to)
  return contact?.publicKey || null
}

function computeDeliveryStatus({ to, sentViaP2P }) {
  if (to === 'Note to Self') return 'local'
  return sentViaP2P ? 'delivered' : 'pending'
}

function buildSentMailRecord({ to, subject, encryptedPayload, deliveryStatus }) {
  return {
    id: genId(),
    to,
    subject,
    from: 'You',
    encryptedPayload,
    timestamp: Date.now(),
    read: true,
    deliveryStatus,
    decrypted: false,
  }
}

function resendPendingMail({ mail, contact, identityPublicKey }) {
  const remotePeerId = getPeerIdFromPublicKey(contact.publicKey)
  return globalThis.cuteSendToPeer(remotePeerId, {
    type: 'encrypted-mail',
    senderKey: identityPublicKey,
    payload: mail.encryptedPayload,
    subject: mail.subject,
    timestamp: new Date().toISOString(),
  })
}

function processPendingSentMail({ mail, contacts, identityPublicKey }) {
  if (mail.deliveryStatus !== 'pending') return { mail, changed: false }
  const contact = contacts.find((c) => c.name === mail.to)
  if (!contact) return { mail, changed: false }
  const delivered = resendPendingMail({
    mail,
    contact,
    identityPublicKey,
  })
  return {
    mail: { ...mail, deliveryStatus: delivered ? 'delivered' : 'pending' },
    changed: delivered,
  }
}

export default function MailTab() {
  const { identity, contacts, showMessage, mailOperationalNotice, playSound } = useApp()
  const forge = globalThis.forge || forgeLib

  const [folder, setFolder]   = useState('inbox')
  const [mailbox, setMailbox] = useState(getMailbox)
  const [view, setView]       = useState('empty') // 'empty' | 'compose' | 'read'
  const [activeMail, setActiveMail]   = useState(null)
  const [composeAttach, setComposeAttach] = useState(null)
  const attachRef = useRef()

  // Compose form state
  const [to, setTo]         = useState('')
  const [mailSubject, setMailSubject]  = useState('')
  const [body, setBody]     = useState('')

  const refresh = () => setMailbox(getMailbox())

  useEffect(() => {
    const onPeerData = (event) => {
      const payload = event.detail?.data
      if (payload?.type !== 'encrypted-mail') return

      const sender = contacts.find((c) => (c.publicKey || '').trim() === (payload.senderKey || '').trim())
      const senderName = sender?.name || 'Unknown'

      const mb = getMailbox()
      mb.inbox = [...(mb.inbox || []), {
        id: genId(),
        from: senderName,
        subject: payload.subject || '(Encrypted)',
        encryptedPayload: payload.payload,
        timestamp: Date.now(),
        decrypted: false,
        read: false,
      }]
      saveMailbox(mb)
      refresh()
      showMessage(`New encrypted mail from ${senderName} 📬`, 'success')
      playSound('receive')
    }

    globalThis.addEventListener('cute-peer-data', onPeerData)
    return () => globalThis.removeEventListener('cute-peer-data', onPeerData)
  }, [contacts, playSound, showMessage])

  const retryMailDelivery = (mailId) => {
    const mb = getMailbox()
    const idx = (mb.sent || []).findIndex((m) => m.id === mailId)
    if (idx < 0) return
    const mail = mb.sent[idx]
    if (mail.deliveryStatus !== 'pending') return
    const contact = contacts.find((c) => c.name === mail.to)
    if (!contact) return
    const remotePeerId = getPeerIdFromPublicKey(contact.publicKey)
    const delivered = typeof globalThis.cuteSendToPeer === 'function'
      ? globalThis.cuteSendToPeer(remotePeerId, {
          type: 'encrypted-mail',
          senderKey: identity?.publicKey,
          payload: mail.encryptedPayload,
          subject: mail.subject,
          timestamp: new Date().toISOString(),
        })
      : false
    mb.sent[idx] = { ...mail, deliveryStatus: delivered ? 'delivered' : 'pending' }
    saveMailbox(mb)
    refresh()
    if (activeMail?.id === mailId) {
      setActiveMail({ ...mb.sent[idx] })
    }
    showMessage(delivered ? 'Mail re-sent via P2P ⚡' : 'Recipient still offline, mail remains pending', delivered ? 'success' : 'info')
  }

  useEffect(() => {
    const retryPendingMails = () => {
      if (typeof globalThis.cuteSendToPeer !== 'function') return
      const mb = getMailbox()
      let changed = false
      mb.sent = (mb.sent || []).map((mail) => {
        const result = processPendingSentMail({
          mail,
          contacts,
          identityPublicKey: identity?.publicKey,
        })
        if (result.changed) changed = true
        return result.mail
      })
      if (changed) {
        saveMailbox(mb)
        refresh()
      }
    }
    globalThis.addEventListener('cute-peer-online', retryPendingMails)
    return () => globalThis.removeEventListener('cute-peer-online', retryPendingMails)
  }, [contacts, identity?.publicKey])

  const unread = (mailbox.inbox || []).filter(m => !m.read).length

  const items = (mailbox[folder] || []).slice().reverse()

  // ── Encrypt a message for one recipient ──
  const encryptPayload = (payloadStr, recipientPubKeyPem) => {
    const sk  = forge.random.getBytesSync(32)
    const iv  = forge.random.getBytesSync(16)
    const c   = forge.cipher.createCipher('AES-GCM', sk)
    c.start({ iv })
    c.update(forge.util.createBuffer(payloadStr, 'utf8'))
    c.finish()
    const enc = forge.util.encode64(c.output.getBytes())
    const tag = forge.util.encode64(c.mode.tag.getBytes())
    const pub = forge.pki.publicKeyFromPem(recipientPubKeyPem)
    const padded = forge.random.getBytesSync(16) + sk + forge.random.getBytesSync(16)
    const encKey = forge.util.encode64(pub.encrypt(padded, 'RSA-OAEP'))
    return JSON.stringify({ v:'2.0', encryptedKey: encKey, iv: forge.util.encode64(iv), authTag: tag, encryptedMessage: enc })
  }

  // ── Decrypt ──
  const decryptPayload = (encJson) => {
    const env = JSON.parse(encJson)
    const actual = env.envelope || env
    const priv = forge.pki.privateKeyFromPem(identity.privateKey)
    const padded = priv.decrypt(forge.util.decode64(actual.encryptedKey), 'RSA-OAEP')
    const sk = padded.slice(16, 16 + 32)
    const d = forge.cipher.createDecipher('AES-GCM', sk)
    d.start({ iv: forge.util.decode64(actual.iv), tag: forge.util.createBuffer(forge.util.decode64(actual.authTag)) })
    d.update(forge.util.createBuffer(forge.util.decode64(actual.encryptedMessage)))
    if (!d.finish()) throw new Error('Integrity check failed')
    return d.output.toString('utf8')
  }

  // ── Send ──
  const handleSend = () => {
    if (!to)               return showMessage('Select a recipient 💌', 'error')
    if (!mailSubject.trim() && !body.trim() && !composeAttach) return showMessage('Write something first ✏️', 'error')
    if (!identity?.publicKey) return showMessage('No identity — create one first 🔐', 'error')

    const recipientKey = resolveRecipientKey({ to, identity, contacts })
    if (!recipientKey) return showMessage('Contact not found 🚨', 'error')

    try {
      const payload = JSON.stringify({ subject: mailSubject, body, image: composeAttach })
      const encrypted = encryptPayload(payload, recipientKey)
      const remotePeerId = to === 'Note to Self' ? '' : getPeerIdFromPublicKey(recipientKey)
      const sentViaP2P = to !== 'Note to Self' && typeof globalThis.cuteSendToPeer === 'function'
        ? globalThis.cuteSendToPeer(remotePeerId, {
            type: 'encrypted-mail',
            senderKey: identity?.publicKey,
            payload: encrypted,
            subject: mailSubject,
            timestamp: new Date().toISOString(),
          })
        : false

      const deliveryStatus = computeDeliveryStatus({ to, sentViaP2P })

      const mb = getMailbox()
      const mail = buildSentMailRecord({
        to,
        subject: mailSubject,
        encryptedPayload: encrypted,
        deliveryStatus,
      })
      mb.sent = [...(mb.sent || []), mail]

      // Self-delivery to inbox
      if (to === 'Note to Self') {
        const inbox = { id: genId(), to: 'You', from: 'Note to Self', subject: mailSubject, encryptedPayload: encrypted, timestamp: Date.now(), read: false, decrypted: false }
        mb.inbox = [...(mb.inbox || []), inbox]
      }

      saveMailbox(mb)
      refresh()
      setTo(''); setMailSubject(''); setBody(''); setComposeAttach(null)
      setView('empty')
      showMessage(sentViaP2P ? 'Mail sent via P2P ⚡' : 'Mail encrypted & saved to Sent 📤', 'success')
      playSound('sent')
    } catch (e) {
      showMessage('Send failed: ' + e.message, 'error')
      playSound('error')
    }
  }

  const startReply = () => {
    if (!activeMail) return
    const targetRecipient = folder === 'sent'
      ? (activeMail.to || '')
      : (activeMail.from || '')
    setTo(targetRecipient)
    setMailSubject(`Re: ${activeMail.subject || ''}`)
    setBody(`\n\n--- Original Message ---\n${activeMail.body || ''}`)
    setComposeAttach(null)
    setView('compose')
  }

  const handleSaveDraft = () => {
    if (!mailSubject.trim() && !body.trim()) return showMessage('Nothing to save', 'error')
    const mb = getMailbox()
    mb.drafts = [...(mb.drafts || []), { id: genId(), to, subject: mailSubject, body, attachment: composeAttach, timestamp: Date.now() }]
    saveMailbox(mb); refresh()
    showMessage('Draft saved 💾', 'info')
  }

  const openMail = (mail) => {
    const mb = getMailbox()
    const folder_items = mb[folder]
    const idx = folder_items?.findIndex(m => m.id === mail.id)
    if (idx !== undefined && idx >= 0) { folder_items[idx].read = true; saveMailbox(mb); refresh() }
    setActiveMail({ ...mail, read: true })
    setView('read')
  }

  const decryptActiveMail = () => {
    if (!activeMail?.encryptedPayload) return
    if (!identity?.privateKey) return showMessage('No private key', 'error')
    try {
      const dec = decryptPayload(activeMail.encryptedPayload)
      let bodyText = dec, image = null
      try {
        const obj = JSON.parse(dec)
        if (obj.subject !== undefined) {
          bodyText = obj.body || ''
          image = obj.image || null
          if (obj.subject) activeMail.subject = obj.subject
        }
      } catch {
        void 0
      }

      const mb = getMailbox()
      const list = mb[folder]
      const idx = list?.findIndex(m => m.id === activeMail.id)
      if (idx !== undefined && idx >= 0) {
        list[idx] = { ...list[idx], body: bodyText, image, decrypted: true }
        saveMailbox(mb); refresh()
        setActiveMail(prev => ({ ...prev, body: bodyText, image, decrypted: true }))
      }
      showMessage('Mail decrypted! 🔓', 'success')
      playSound('receive')
    } catch (e) {
      showMessage('Decryption failed: ' + e.message, 'error')
      playSound('error')
    }
  }

  const decryptAllInbox = () => {
    if (!identity?.privateKey) return showMessage('No private key', 'error')

    const mb = getMailbox()
    let ok = 0
    let failed = 0

    mb.inbox = (mb.inbox || []).map((mail) => {
      if (mail.decrypted || !mail.encryptedPayload) return mail
      try {
        const dec = decryptPayload(mail.encryptedPayload)
        let bodyText = dec
        let image = null
        let subject = mail.subject

        try {
          const obj = JSON.parse(dec)
          if (obj?.subject !== undefined) {
            subject = obj.subject || subject
            bodyText = obj.body || ''
            image = obj.image || null
          }
        } catch {
          // Keep plain text fallback
        }

        ok++
        return { ...mail, subject, body: bodyText, image, decrypted: true }
      } catch {
        failed++
        return mail
      }
    })

    if (ok === 0 && failed === 0) {
      showMessage('No encrypted inbox messages to decrypt', 'info')
      return
    }

    saveMailbox(mb)
    refresh()

    if (activeMail && folder === 'inbox') {
      const updated = (mb.inbox || []).find((m) => m.id === activeMail.id)
      if (updated) setActiveMail(updated)
    }

    if (failed > 0) {
      showMessage(`Decrypt all finished: ${ok} decrypted, ${failed} failed`, ok > 0 ? 'info' : 'error')
      return
    }
    showMessage(`Decrypt all finished: ${ok} decrypted`, 'success')
  }

  const deleteMail = () => {
    if (!activeMail) return
    const mb = getMailbox()
    mb[folder] = (mb[folder] || []).filter(m => m.id !== activeMail.id)
    saveMailbox(mb); refresh()
    setActiveMail(null); setView('empty')
    showMessage('Deleted 🗑️', 'info')
  }

  const allRecipients = ['Note to Self', ...contacts.map(c => c.name)]

  return (
    <div className="mail-container" style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
      {/* ── Sidebar ── */}
      <div className={`mail-sidebar${view !== 'empty' && window.innerWidth <= 768 ? ' slide-out' : ''}`}>
        <div className="mail-sidebar-header">
          <div>
            <h3>📬 Mailbox</h3>
            <p className="mail-sidebar-subtitle">Asynchronous encrypted threads</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {folder === 'inbox' && (
              <button className="btn-secondary btn-small" onClick={decryptAllInbox}>🔓 All</button>
            )}
            <button className="btn-primary btn-small" onClick={() => setView('compose')}>✉️ Compose</button>
          </div>
        </div>

        <div className="mail-folder-tabs">
          {['inbox','sent','drafts'].map(f => (
            <button key={f} className={`mail-folder-btn${folder === f ? ' active' : ''}`}
              onClick={() => { setFolder(f); setView('empty') }}>
              {getFolderLabel(f)}
              {f === 'inbox' && unread > 0 && <span className="mail-count-badge">{unread}</span>}
            </button>
          ))}
        </div>

        <div className="mail-list">
          <div className={`operational-notice ${mailOperationalNotice.kind}`} id="mailStatusNotice" style={{ marginBottom: 10 }}>
            {mailOperationalNotice.text}
          </div>
          {items.length === 0 && (
            <div className="mail-empty"><span>📭</span><p>No messages in {folder}</p></div>
          )}
          {items.map(mail => (
            <button key={mail.id}
              type="button"
              className={`mail-list-item${activeMail?.id === mail.id ? ' active' : ''}${!mail.read && folder === 'inbox' ? ' unread' : ''}`}
              onClick={() => openMail(mail)}
              style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 0 }}>
              <div className="mail-item-top">
                <span className="mail-item-from">
                  {folder === 'sent' ? `To: ${mail.to || '???'}` : (mail.from || 'Unknown')}
                </span>
                <span className="mail-item-date">{mail.timestamp ? new Date(mail.timestamp).toLocaleDateString() : ''}</span>
              </div>
              <div className="mail-item-subject">{mail.subject || '(No Subject)'}</div>
              <div className="mail-item-preview">
                {getMailPreview(mail, folder)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className={`mail-main${view !== 'empty' && window.innerWidth <= 768 ? ' slide-in' : ''}`}>

        {/* Empty state */}
        {view === 'empty' && (
          <div className="mail-empty-state">
            <div className="mail-empty-icon">📬</div>
            <h3>Your encrypted mailbox</h3>
            <p>Send and receive encrypted letters via P2P. Messages are stored locally and delivered when your friend comes online.</p>
          </div>
        )}

        {/* Compose */}
        {view === 'compose' && (
          <div className="mail-compose-view" style={{ display: 'block', padding: 16 }}>
            <div className="mail-compose-header">
              <h3>✉️ Compose New Letter</h3>
              <button className="btn-secondary btn-small" onClick={() => setView('empty')}>✕</button>
            </div>
            <div className="input-group">
              <label htmlFor="mailRecipientSelect">👩‍❤️‍👨 To:</label>
              <select id="mailRecipientSelect" className="contact-select" value={to} onChange={e => setTo(e.target.value)}>
                <option value="">— Select recipient —</option>
                {allRecipients.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="mailSubjectInput">📌 Subject:</label>
              <input id="mailSubjectInput" type="text" value={mailSubject} onChange={e => setMailSubject(e.target.value)} placeholder="What's this about?" />
            </div>
            <div className="input-group">
              <label htmlFor="mailBodyInput">💌 Message:</label>
              <textarea id="mailBodyInput" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your encrypted letter..." rows={8} />
              <div className="mail-attach-bar" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                <button className="btn-secondary btn-small" onClick={() => attachRef.current.click()}>📎 Attach Image</button>
                <input ref={attachRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files[0]; if (!f) return
                    const r = new FileReader(); r.onload = ev => setComposeAttach(ev.target.result); r.readAsDataURL(f)
                  }} />
                {composeAttach && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={composeAttach} alt="attachment" style={{ height: 40, borderRadius: 6 }} />
                    <button className="btn-secondary btn-small" style={{ padding: '2px 6px', borderRadius: '50%' }}
                      onClick={() => { setComposeAttach(null); attachRef.current.value = '' }}>✕</button>
                  </div>
                )}
              </div>
            </div>
            <div className="actions">
              <button className="btn-primary" onClick={handleSend}>🚀 Encrypt & Send</button>
              <button className="btn-secondary" onClick={handleSaveDraft}>💾 Save Draft</button>
            </div>
          </div>
        )}

        {/* Read */}
        {view === 'read' && activeMail && (
          <div className="mail-read-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="mail-read-header">
              <button className="chat-back-btn" onClick={() => { setView('empty'); setActiveMail(null) }}>←</button>
              <div className="mail-read-info">
                <div className="mail-read-subject">{activeMail.subject || '(No Subject)'}</div>
                <div className="mail-read-meta">
                  <span className="mail-read-from">
                    {getReadFromLabel(folder, activeMail)}
                  </span>
                  <span className="mail-read-date">
                    {activeMail.timestamp ? new Date(activeMail.timestamp).toLocaleString() : ''}
                  </span>
                </div>
              </div>
              <div className="mail-read-actions">
                {!activeMail.decrypted && <button className="btn-primary btn-small" onClick={decryptActiveMail}>🔓 Decrypt</button>}
                {folder !== 'drafts' && <button className="btn-secondary btn-small" onClick={startReply}>↩️ Reply</button>}
                {folder === 'sent' && activeMail.deliveryStatus === 'pending' && (
                  <button className="btn-secondary btn-small" onClick={() => retryMailDelivery(activeMail.id)}>🔁 Retry</button>
                )}
                <button className="btn-secondary btn-small" onClick={deleteMail}>🗑️</button>
              </div>
            </div>

            <div className="mail-read-body" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {activeMail.decrypted ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{activeMail.body || ''}</div>
              ) : (
                <div className="mail-encrypted-placeholder">
                  <span>🔒</span>
                  <p>This message is encrypted. Click Decrypt to reveal.</p>
                </div>
              )}
            </div>

            {activeMail.image && (
              <img src={activeMail.image} alt="attachment" style={{ maxWidth: '100%', borderRadius: 10, margin: '0 16px 16px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
