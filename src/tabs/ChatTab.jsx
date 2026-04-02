import { useState, useEffect, useRef } from 'react'
import { useApp, DB } from '../context/AppContext'
import { useCrypto } from '../hooks/useCrypto'
import forgeLib from 'node-forge'

function getPeerIdFromPublicKey(pubKeyPem) {
  if (!pubKeyPem) return ''
  const forge = globalThis.forge || forgeLib
  const md = forge.md.sha256.create()
  md.update(pubKeyPem.replace(/\s+/g, ''))
  return 'cutesec_' + md.digest().toHex().slice(0, 24)
}

export default function ChatTab() {
  const {
    contacts,
    identity,
    myPeerId,
    peerStatus,
    webOnline,
    showMessage,
    activeChatContact,
    setActiveChatContact,
    chatOperationalNotice,
    playSound,
    incrementChatUnread,
    clearChatUnread
  } = useApp()
  const { encryptForRecipient, decryptMessage } = useCrypto()
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [attachImg, setAttachImg] = useState(null)
  const messagesEndRef = useRef()
  const fileRef = useRef()

  const historyKey = activeChatContact ? `chat_history_${activeChatContact}` : null

  // Load messages when contact changes
  useEffect(() => {
    if (!historyKey) return
    const saved = DB.get(historyKey) || []
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) {
        setMessages(saved)
        clearChatUnread(activeChatContact)
        
        // If we have messages from them that we never read (we can infer this if needed, 
        // but let's just send a bulk READ receipt for any non-read messages from them).
        const contactName = activeChatContact
        const contact = contacts.find(c => c.name === contactName)
        if (contact && typeof globalThis.cuteSendToPeer === 'function') {
          // Send bulk READ
          const unreadIds = saved.filter(m => m.sender === 'them' && !m.readAckSent).map(m => m.id)
          if (unreadIds.length > 0) {
            const remotePeerId = getPeerIdFromPublicKey(contact.publicKey)
            globalThis.cuteSendToPeer(remotePeerId, {
              type: 'CHAT_MSG_READ_BULK',
              msgIds: unreadIds,
              senderKey: identity?.publicKey
            })
            // Mark them locally so we don't resend read receipts
            const updated = saved.map(m => unreadIds.includes(m.id) ? { ...m, readAckSent: true } : m)
            DB.set(historyKey, updated)
            setMessages(updated)
          }
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [historyKey, activeChatContact, contacts, identity, clearChatUnread])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const saveMessages = (msgs) => {
    setMessages(msgs)
    if (historyKey) {
      DB.set(historyKey, msgs)
      globalThis.dispatchEvent(new Event('cute-data-updated'))
    }
  }

  const formatDateDivider = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  }

  const getGroupedMessages = (rawMessages) => {
    const groups = []
    let lastDate = ''
    rawMessages.forEach((msg) => {
      const dateKey = new Date(msg.ts).toDateString()
      if (dateKey !== lastDate) {
        groups.push({ type: 'divider', id: `divider-${dateKey}`, label: formatDateDivider(msg.ts) })
        lastDate = dateKey
      }
      groups.push({ type: 'message', message: msg })
    })
    return groups
  }

  const retryMessage = (contactName, msgId) => {
    const key = `chat_history_${contactName}`
    const history = DB.get(key) || []
    const idx = history.findIndex((m) => m.id === msgId)
    if (idx < 0) return
    const msg = history[idx]
    const contact = contacts.find((c) => c.name === contactName)
    if (!contact) return
    const remotePeerId = getPeerIdFromPublicKey(contact.publicKey)
    const wasSent = typeof globalThis.cuteSendToPeer === 'function'
      ? globalThis.cuteSendToPeer(remotePeerId, {
          type: 'encrypted-message',
          msgId,
          senderKey: identity?.publicKey,
          payload: msg.encrypted,
          timestamp: new Date().toISOString(),
        })
      : false
    history[idx] = { ...msg, deliveryStatus: wasSent ? 'sent' : 'pending' }
    DB.set(key, history)
    if (activeChatContact === contactName) setMessages(history)
    showMessage(wasSent ? 'Message re-sent via P2P ⚡' : 'Friend still offline, message remains pending', wasSent ? 'success' : 'info')
  }

  const pasteFromClipboard = async () => {
    if (!activeChatContact) return
    try {
      const text = await globalThis.navigator.clipboard.readText()
      if (!text?.trim()) {
        showMessage('Clipboard is empty', 'info')
        return
      }
      let decrypted = ''
      try {
        decrypted = decryptMessage(text.trim())
      } catch {
        showMessage('Clipboard text is not decryptable with your key', 'error')
        return
      }

      let content = decrypted
      let img = null
      try {
        const parsed = JSON.parse(decrypted)
        if (parsed && (parsed.text !== undefined || parsed.img !== undefined)) {
          content = parsed.text || ''
          img = parsed.img || null
        }
      } catch {
        // Keep plaintext fallback
      }

      const next = [...messages, {
        id: Date.now() + Math.floor(Math.random() * 1000),
        sender: 'them',
        content,
        img,
        encrypted: text.trim(),
        ts: Date.now(),
      }]
      saveMessages(next)
      showMessage('Encrypted message pasted and decrypted 🔓', 'success')
      playSound('receive')
    } catch {
      showMessage('Clipboard read failed', 'error')
      playSound('error')
    }
  }

  const decryptSingleMessage = (msgId) => {
    const idx = messages.findIndex((m) => m.id === msgId)
    if (idx < 0) return
    const msg = messages[idx]
    if (msg.sender !== 'them' || msg.content || !msg.encrypted) return

    try {
      const decrypted = decryptMessage(msg.encrypted)
      let text = decrypted
      let img = null
      try {
        const parsed = JSON.parse(decrypted)
        if (parsed && (parsed.text !== undefined || parsed.img !== undefined)) {
          text = parsed.text || ''
          img = parsed.img || null
        }
      } catch {
        // Keep plain text fallback
      }

      const next = [...messages]
      next[idx] = { ...msg, content: text, img }
      saveMessages(next)
      showMessage('Message decrypted 🔓', 'success')
      playSound('receive')
    } catch {
      showMessage('Decryption failed for this message', 'error')
      playSound('error')
    }
  }

  const decryptAllMessages = () => {
    const next = messages.map((msg) => {
      if (msg.sender !== 'them' || msg.content || !msg.encrypted) return msg
      try {
        const decrypted = decryptMessage(msg.encrypted)
        try {
          const parsed = JSON.parse(decrypted)
          if (parsed && (parsed.text !== undefined || parsed.img !== undefined)) {
            return { ...msg, content: parsed.text || '', img: parsed.img || null }
          }
        } catch {
          return { ...msg, content: decrypted }
        }
        return msg
      } catch {
        return msg
      }
    })
    saveMessages(next)
    showMessage('Bulk decrypt complete 🔓', 'success')
    playSound('receive')
  }

  const getMessagePayload = () => {
    if (attachImg) {
      return JSON.stringify({ text: inputText, img: attachImg })
    }
    return inputText
  }

  const computeDeliveryStatus = ({ isNoteToSelf, sentViaP2P }) => {
    if (isNoteToSelf) return 'local'
    return sentViaP2P ? 'sent' : 'pending'
  }

  const showPostSendStatus = ({ isNoteToSelf, sentViaP2P }) => {
    if (sentViaP2P) {
      showMessage('Sent instantly via P2P ⚡', 'success')
      return
    }
    if (!isNoteToSelf) {
      showMessage('Friend offline: encrypted message copied to clipboard 📋', 'info')
    }
  }

  const sendMessage = async () => {
    if (!activeChatContact) return
    if (!inputText.trim() && !attachImg) return
    const contact = contacts.find(c => c.name === activeChatContact)
    const isNoteToSelf = activeChatContact === 'Note to Self'
    if (!contact && !isNoteToSelf) return showMessage('Contact not found 🚨', 'error')

    try {
      const msgId = Date.now()
      const payload = getMessagePayload()
      const recipientPublicKey = isNoteToSelf ? identity?.publicKey : contact.publicKey
      const encrypted = encryptForRecipient(payload, recipientPublicKey)
      const remotePeerId = isNoteToSelf ? '' : getPeerIdFromPublicKey(recipientPublicKey)
      const sentViaP2P = !isNoteToSelf && typeof globalThis.cuteSendToPeer === 'function'
        ? globalThis.cuteSendToPeer(remotePeerId, {
            type: 'encrypted-message',
            msgId,
            senderKey: identity?.publicKey,
            payload: encrypted,
            timestamp: new Date().toISOString(),
          })
        : false
      const deliveryStatus = computeDeliveryStatus({ isNoteToSelf, sentViaP2P })
      const msg = {
        id: msgId,
        sender: 'me',
        content: inputText,
        img: attachImg,
        encrypted,
        deliveryStatus,
        ts: Date.now(),
      }
      saveMessages([...messages, msg])
      try {
        await globalThis.navigator.clipboard.writeText(encrypted)
      } catch {
        // Clipboard is optional; keep message flow working even if denied.
      }
      setInputText('')
      setAttachImg(null)
      if (fileRef.current) fileRef.current.value = ''
      showPostSendStatus({ isNoteToSelf, sentViaP2P })
      playSound('sent')
    } catch (e) {
      showMessage('Send failed: ' + e.message, 'error')
      playSound('error')
    }
  }

  useEffect(() => {
    const onPeerData = (event) => {
      const payload = event.detail?.data
      const remotePeerId = event.detail?.remotePeerId

      if (payload?.type === 'CHAT_MSG_ACK' || payload?.type === 'CHAT_MSG_READ' || payload?.type === 'CHAT_MSG_READ_BULK') {
        const normalizeKey = (k) => (k || '').replace(/\s+/g, '')
        const sender = contacts.find((c) => normalizeKey(c.publicKey) === normalizeKey(payload.senderKey))
        if (!sender) return
        
        const key = `chat_history_${sender.name}`
        const prev = DB.get(key) || []
        
        let changed = false
        const next = prev.map(m => {
          if (m.sender !== 'me') return m
          
          if (payload.type === 'CHAT_MSG_READ_BULK' && payload.msgIds?.includes(m.id)) {
            if (m.deliveryStatus !== 'read') {
              changed = true
              return { ...m, deliveryStatus: 'read' }
            }
          } else if (m.id === payload.msgId) {
            const newStatus = payload.type === 'CHAT_MSG_READ' ? 'read' : 'delivered'
            if (m.deliveryStatus !== 'read' && m.deliveryStatus !== newStatus) {
              changed = true
              return { ...m, deliveryStatus: newStatus }
            }
          }
          return m
        })
        
        if (changed) {
          DB.set(key, next)
          if (activeChatContact === sender.name) setMessages(next)
        }
        return
      }

      if (payload?.type !== 'encrypted-message') return
      
      const normalizeKey = (k) => (k || '').replace(/\s+/g, '')
      const sender = contacts.find((c) => normalizeKey(c.publicKey) === normalizeKey(payload.senderKey))
      
      if (!sender) {
        console.warn('Received P2P message but sender public key not found in contacts.', payload.senderKey)
        return
      }

      // Send ACK back
      if (payload.msgId && typeof globalThis.cuteSendToPeer === 'function' && remotePeerId) {
        const ackType = activeChatContact === sender.name ? 'CHAT_MSG_READ' : 'CHAT_MSG_ACK'
        globalThis.cuteSendToPeer(remotePeerId, {
          type: ackType,
          msgId: payload.msgId,
          senderKey: identity?.publicKey
        })
      }

      try {
        const decrypted = decryptMessage(payload.payload)
        let text = decrypted
        let img = null
        try {
          const parsed = JSON.parse(decrypted)
          if (parsed && (parsed.text !== undefined || parsed.img !== undefined)) {
            text = parsed.text || ''
            img = parsed.img || null
          }
        } catch {
          // Keep plain text format
        }

        const key = `chat_history_${sender.name}`
        const prev = DB.get(key) || []
        const isCurrentlyOpen = activeChatContact === sender.name
        const next = [...prev, {
          id: payload.msgId || Date.now() + Math.floor(Math.random() * 1000), // ensure ID sync
          sender: 'them',
          content: text,
          img,
          encrypted: payload.payload,
          ts: Date.now(),
          readAckSent: isCurrentlyOpen
        }]
        DB.set(key, next)
        if (isCurrentlyOpen) {
          setMessages(next)
        } else {
          incrementChatUnread(sender.name)
        }
        showMessage(`New encrypted message from ${sender.name} 💌`, 'success')
        playSound('receive')
      } catch {
        // Ignore messages that cannot be decrypted by this identity
      }
    }

    globalThis.addEventListener('cute-peer-data', onPeerData)
    return () => globalThis.removeEventListener('cute-peer-data', onPeerData)
  }, [activeChatContact, contacts, decryptMessage, playSound, showMessage, incrementChatUnread])

  useEffect(() => {
    const retryPendingChats = () => {
      if (typeof globalThis.cuteSendToPeer !== 'function') return
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('chat_history_')) continue
        const contactName = key.replace('chat_history_', '')
        const contact = contacts.find((c) => c.name === contactName)
        if (!contact) continue
        const remotePeerId = getPeerIdFromPublicKey(contact.publicKey)
        const history = DB.get(key) || []
        let changed = false
        const next = history.map((msg) => {
          if (msg.sender !== 'me' || msg.deliveryStatus !== 'pending' || !msg.encrypted) return msg
          const wasSent = globalThis.cuteSendToPeer(remotePeerId, {
            type: 'encrypted-message',
            msgId: msg.id,
            senderKey: identity?.publicKey,
            payload: msg.encrypted,
            timestamp: new Date().toISOString(),
          })
          if (wasSent) changed = true
          return { ...msg, deliveryStatus: wasSent ? 'sent' : 'pending' }
        })
        if (changed) {
          DB.set(key, next)
          if (activeChatContact === contactName) setMessages(next)
        }
      }
    }
    globalThis.addEventListener('cute-peer-online', retryPendingChats)
    return () => globalThis.removeEventListener('cute-peer-online', retryPendingChats)
  }, [activeChatContact, contacts, identity?.publicKey])

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const contactsWithSelf = [{ name: 'Note to Self' }, ...filteredContacts]
  const groupedRows = getGroupedMessages(messages)
  const statusDotClass = webOnline
    ? ({ online: 'online', connecting: 'connecting', error: 'error' }[peerStatus] || 'offline')
    : 'error'
  const statusText = webOnline
    ? ({ online: 'Online', connecting: 'Connecting...', error: 'Error', offline: 'Offline' }[peerStatus] || 'Offline')
    : 'Web Offline'

  if (!identity) {
    return (
      <div className="chat-empty-state" style={{ padding: 32, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {activeChatContact && (
          <div style={{ textAlign: 'left', marginBottom: 20 }}>
            <button className="btn-secondary btn-small" onClick={() => setActiveChatContact(null)}>← Back to Chats</button>
          </div>
        )}
        <div style={{ margin: 'auto', textAlign: 'center' }}>
          <div className="chat-empty-icon">🔐</div>
          <h3>No identity yet</h3>
          <p>Create an identity to start chatting securely</p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-container" style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
      {/* Sidebar — contact list */}
      <div className={`chat-sidebar${activeChatContact ? ' slide-out' : ''}`}>
        <div className="chat-connection-bar">
          <div className="chat-peer-info">
            <span className="chat-peer-label">Your ID:</span>
            <code className="chat-peer-id-code">{myPeerId || 'No identity'}</code>
            <button
              className="btn-secondary btn-small"
              title="Copy Peer ID"
              onClick={async () => {
                if (!myPeerId) return showMessage('Peer ID unavailable', 'error')
                await navigator.clipboard.writeText(myPeerId)
                showMessage('Peer ID copied 📋', 'success')
              }}
            >
              📋
            </button>
          </div>
          <div className="chat-peer-status" id="peerStatusBar">
            <span className={`status-dot ${statusDotClass}`} />
            <span>{statusText}</span>
          </div>
        </div>
        <div className={`operational-notice ${chatOperationalNotice.kind}`} id="chatStatusNotice" style={{ marginBottom: 10, display: chatOperationalNotice.text ? 'block' : 'none' }}>
          {chatOperationalNotice.text}
        </div>
        
        <div className="chat-sidebar-header" style={{ padding: '12px 14px 8px' }}>
          <h3>💬 Chats</h3>
          <p className="chat-sidebar-subtitle">Recent encrypted conversations</p>
        </div>
        <div className="chat-contact-search">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search friends..."
          />
        </div>
        <div className="chat-contact-list">
          {contactsWithSelf.length === 0 && (
            <div className="chat-no-contacts">
              <span>💌</span>
              <p>Add friends to start chatting!</p>
            </div>
          )}
          {contactsWithSelf.map(c => (
            <button key={c.name}
              type="button"
              className={`chat-contact-item${activeChatContact === c.name ? ' active' : ''}`}
              onClick={() => setActiveChatContact(c.name)}
              data-contact-id={c.name}
              style={{ cursor: 'pointer', width: '100%', textAlign: 'left', background: 'transparent', border: 0 }}>
              <div className="chat-contact-avatar">{c.name[0].toUpperCase()}</div>
              <div className="chat-contact-info">
                <div className="chat-contact-name">{c.name}</div>
                <div className="chat-contact-preview">🔒 End-to-End Encrypted</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat main area */}
      <div className={`chat-main${activeChatContact ? ' slide-in' : ''}`}>
        {activeChatContact ? (
          <>
            <div className="chat-header">
              <button className="chat-back-btn" onClick={() => setActiveChatContact(null)}>←</button>
              <div className="chat-header-avatar">{activeChatContact[0].toUpperCase()}</div>
              <div className="chat-header-info">
                <div className="chat-header-name">{activeChatContact}</div>
                <div className="chat-header-status">🔒 End-to-End Encrypted</div>
              </div>
              <div className="chat-header-actions">
                <button className="btn-secondary btn-small" onClick={pasteFromClipboard}>📋</button>
                <button className="btn-secondary btn-small" onClick={decryptAllMessages}>🔓 All</button>
                <button
                  className="btn-secondary btn-small"
                  onClick={() => {
                    if (!myPeerId) return showMessage('Peer ID unavailable', 'error')
                    globalThis.navigator.clipboard.writeText(myPeerId)
                    showMessage('Peer ID copied 📋', 'success')
                  }}
                >
                  🆔
                </button>
                <button className="btn-secondary btn-small"
                  onClick={() => { 
                    if (globalThis.confirm('Are you sure you want to clear this entire chat history?')) {
                      saveMessages([]); 
                      showMessage('Chat cleared 🗑️', 'info');
                    }
                  }}>
                  🗑️
                </button>
              </div>
            </div>

            <div className="chat-messages">
              {groupedRows.map((row) => {
                if (row.type === 'divider') {
                  return (
                    <div key={row.id} className="chat-date-divider"><span>{row.label}</span></div>
                  )
                }

                const msg = row.message
                return (
                  <div key={msg.id} className={`chat-bubble-row ${msg.sender === 'me' ? 'sent' : 'received'}`}>
                    <div className="chat-bubble">
                      {!msg.content && msg.sender === 'them' && msg.encrypted && (
                        <button
                          className="btn-secondary btn-small"
                          style={{ marginBottom: 6 }}
                          onClick={() => decryptSingleMessage(msg.id)}
                        >
                          🔓 Decrypt
                        </button>
                      )}
                      {msg.content && <p>{msg.content}</p>}
                      {msg.img && <img src={msg.img} alt="attachment" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 4 }} />}
                      {msg.sender === 'me' && msg.deliveryStatus === 'pending' && activeChatContact !== 'Note to Self' && (
                        <button
                          className="btn-secondary btn-small"
                          style={{ marginTop: 6 }}
                          onClick={() => retryMessage(activeChatContact, msg.id)}
                        >
                          🔁 Retry
                        </button>
                      )}
                      <span className="chat-ts">
                        {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {msg.sender === 'me' && activeChatContact !== 'Note to Self' && (
                          <span className="chat-ticks" style={{ marginLeft: 6, fontSize: '1.2em', verticalAlign: 'middle', userSelect: 'none' }}>
                            {msg.deliveryStatus === 'read' ? <span style={{ color: '#34B7F1' }}>✓✓</span> :
                             msg.deliveryStatus === 'delivered' ? '✓✓' :
                             msg.deliveryStatus === 'sent' ? '✓' : '⌚'}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-composer">
              {attachImg && (
                <div className="chat-attachment-preview" style={{ display: 'flex' }}>
                  <img src={attachImg} alt="Attachment Preview" />
                  <button className="chat-attach-clear" onClick={() => { setAttachImg(null); fileRef.current.value = '' }}>✕</button>
                </div>
              )}
              <div className="chat-input-bar">
                <button className="chat-attach-btn" onClick={() => fileRef.current.click()}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
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
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  placeholder="Type a message or attach an image..."
                  rows={1}
                />
                <button className="chat-send-btn" onClick={sendMessage}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">💬</div>
            <h3>Select a friend to chat</h3>
            <p>Messages are auto-encrypted with RSA-2048 + AES-256-GCM and sent P2P via WebRTC</p>
          </div>
        )}
      </div>
    </div>
  )
}
