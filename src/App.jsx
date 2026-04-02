import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import forgeLib from 'node-forge'
import { useApp } from './context/AppContext'
import { useCrypto } from './hooks/useCrypto'
import { usePeer } from './hooks/usePeer'
import ChatTab from './tabs/ChatTab'
import EncryptTab from './tabs/EncryptTab'
import DecryptTab from './tabs/DecryptTab'
import ContactsTab from './tabs/ContactsTab'
import SettingsTab from './tabs/SettingsTab'
import './styles.css'

const StegoTab = lazy(() => import('./tabs/StegoTab'))
const PgpTab   = lazy(() => import('./tabs/PgpTab'))

const TAB_LABELS = {
  chat:'💬 Chat', encrypt:'📤 Send',
  decrypt:'📥 Receive', stego:'🖼️ Stego', pgp:'🤓 PGP',
  contacts:'👥 Friends', settings:'⚙️ Settings',
}

const DESKTOP_APP_URL = 'https://github.com/LizzieNya/cute-secure-messenger/releases/download/v2.0.9/Cute.Secure.Messenger.exe'
const ANDROID_APP_URL = 'https://github.com/LizzieNya/cute-secure-messenger/releases/download/v2.0.9/Cute.Secure.Messenger.apk'
const PLATFORM_BANNER_DISMISS_KEY = 'cute-platform-banner-dismissed'

const detectDesktop = () => {
  const ua = globalThis.navigator?.userAgent?.toLowerCase() || '';
  return ua.includes('electron') || !!globalThis.electronAPI || !!globalThis.__TAURI_INTERNALS__ || !!globalThis.__TAURI_IPC__ || ua.includes('tauri');
}

const isStandaloneDisplay = () => {
  return globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true
}

function useSidebarResize(shellRef) {
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const splitter = shell.querySelector('#messengerSplitter')
    if (!splitter) return

    const clampWidth = (widthPx) => {
      const shellRect = shell.getBoundingClientRect()
      const minWidth = 260
      const maxWidth = Math.min(620, shellRect.width * 0.68)
      const next = Math.min(maxWidth, Math.max(minWidth, widthPx))
      document.documentElement.style.setProperty('--sidebar-width', `${next}px`)
      return next
    }

    const isWideDesktop = () => globalThis.matchMedia('(min-width: 901px)').matches

    let isResizing = false
    let currentWidth = null

    const onMove = (event) => {
      if (!isResizing) return
      const rect = shell.getBoundingClientRect()
      currentWidth = clampWidth(event.clientX - rect.left)
    }

    const stopResize = () => {
      if (!isResizing) return
      isResizing = false
      document.body.classList.remove('is-resizing-shell')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', stopResize)
      if (Number.isFinite(currentWidth)) {
        localStorage.setItem('cute_sidebar_width_px', String(Math.round(currentWidth)))
      }
    }

    const startResize = (event) => {
      if (!isWideDesktop()) return
      event.preventDefault()
      isResizing = true
      document.body.classList.add('is-resizing-shell')
      onMove(event)
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', stopResize)
    }

    const onSplitterKeyDown = (event) => {
      if (!isWideDesktop()) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const activeWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'))
      const fallback = shell.getBoundingClientRect().width * 0.3
      const current = Number.isFinite(activeWidth) ? activeWidth : fallback
      const delta = event.key === 'ArrowLeft' ? -20 : 20
      const next = clampWidth(current + delta)
      currentWidth = next
      localStorage.setItem('cute_sidebar_width_px', String(Math.round(next)))
    }

    const onResize = () => {
      if (!isWideDesktop()) {
        document.documentElement.style.removeProperty('--sidebar-width')
        return
      }
      const activeWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'))
      const fallback = Number.isFinite(currentWidth) ? currentWidth : shell.getBoundingClientRect().width * 0.3
      currentWidth = clampWidth(Number.isFinite(activeWidth) ? activeWidth : fallback)
    }

    splitter.addEventListener('mousedown', startResize)
    splitter.addEventListener('keydown', onSplitterKeyDown)
    globalThis.addEventListener('resize', onResize)

    const saved = Number.parseInt(localStorage.getItem('cute_sidebar_width_px') || '', 10)
    if (Number.isFinite(saved) && isWideDesktop()) {
      currentWidth = clampWidth(saved)
    }

    return () => {
      splitter.removeEventListener('mousedown', startResize)
      splitter.removeEventListener('keydown', onSplitterKeyDown)
      globalThis.removeEventListener('resize', onResize)
      stopResize()
    }
  }, [shellRef])
}

function executeVerifyLinkOtp({
  sendTo,
  otpInput,
  scannedPayload,
  closeLinkModal,
  showMessage,
}) {
  const otp = otpInput.trim()
  if (otp.length !== 6) {
    showMessage('Enter a 6-digit OTP 🔢', 'error')
    return
  }
  if (!scannedPayload?.h || !scannedPayload?.r) {
    showMessage('Missing or invalid QR payload. Scan again.', 'error')
    return
  }
  try {
    globalThis.cuteGuestLinkOtp = otp;
    sendTo(scannedPayload.h, { 
      type: 'LINK_IDENTITY_REQ',
      r: scannedPayload.r
    })
    showMessage('Requesting Identity via P2P...', 'info')
    closeLinkModal()
  } catch (e) {
    showMessage('Request failed: ' + e.message, 'error')
  }
}

async function executeGenerateHostLink({
  identity,
  myPeerId,
  setHostOtp,
  setHostQrDataUrl,
  setShowHostModal,
  showMessage,
}) {
  if (!identity?.privateKey || !identity?.publicKey) {
    showMessage('Create/link identity first 🔐', 'error')
    return
  }
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const reqHash = Math.random().toString(36).substring(2, 10)
    globalThis.cuteHostLinkHash = reqHash;
    globalThis.cuteHostLinkOtp = otp;
    globalThis.cuteHostIdentity = identity;
    const transferData = JSON.stringify({ h: myPeerId, r: reqHash })
    const qrDataUrl = await QRCode.toDataURL(transferData, { width: 256, margin: 1, errorCorrectionLevel: 'L' })
    setHostOtp(otp)
    setHostQrDataUrl(qrDataUrl)
    setShowHostModal(true)
  } catch (e) {
    showMessage('Failed to generate host link: ' + e.message, 'error')
  }
}

async function executeCreateIdentity({ mobileConfirm, generateKeyPair, saveIdentity, showMessage }) {
  const ok = await mobileConfirm('Create new identity? This device will have its own keys.\n\n(If you want to sync with desktop, use "Link Device" instead!)')
  if (!ok) return
  showMessage('Generating 2048-bit RSA keys... ⏳', 'info')
  try {
    const keys = await generateKeyPair()
    saveIdentity(keys)
    showMessage('Identity Created! You can now chat securely 💖', 'success')
  } catch (e) {
    showMessage('Key Gen Failed: ' + e.message, 'error')
  }
}

async function executeUnlink({ mobileConfirm, clearIdentity, showMessage }) {
  const ok = await mobileConfirm('Unlink device? Key data will be removed.')
  if (!ok) return
  clearIdentity()
  showMessage('Unlinked 🔓', 'info')
}

export default function App() { // NOSONAR
  const {
    activeTab, setActiveTab,
    identity, contacts,
    saveIdentity, saveContacts, clearIdentity, hasIdentity,
    peerStatus, myPeerId, queueStatus,
    webOnline, activeChatContact, setActiveChatContact,
    message, showMessage, clipboardRead,
    chatUnreadCounts, clearChatUnread,
    autoRead, setPgpModeEnabled,
    pgpModeEnabled,
  } = useApp()
  const { generateKeyPair } = useCrypto()
  const handlePeerMessage = useCallback((remotePeerId, data) => {
    globalThis.dispatchEvent(new CustomEvent('cute-peer-data', { detail: { remotePeerId, data } }))
  }, [])
  const { sendTo } = usePeer({ onMessage: handlePeerMessage })

  useEffect(() => {
    const p2pSyncHandler = (e) => {
      const { remotePeerId, data } = e.detail
      if (data?.type === 'SYNC_CONTACTS_REQ') {
        if (contacts && contacts.length > 0) {
          sendTo(remotePeerId, { type: 'SYNC_CONTACTS_RES', contacts })
        }
      }
      if (data?.type === 'LINK_IDENTITY_REQ') {
        if (data.r && data.r === globalThis.cuteHostLinkHash && globalThis.cuteHostIdentity) {
          try {
            const forge = globalThis.forge || forgeLib
            const salt = forge.random.getBytesSync(16)
            const iv = forge.random.getBytesSync(16)
            const key = forge.pkcs5.pbkdf2(globalThis.cuteHostLinkOtp, salt, 10000, 32, forge.md.sha256.create())
            const payload = JSON.stringify({
              privateKey: globalThis.cuteHostIdentity.privateKey,
              publicKey: globalThis.cuteHostIdentity.publicKey
            })
            const cipher = forge.cipher.createCipher('AES-CBC', key)
            cipher.start({ iv })
            cipher.update(forge.util.createBuffer(payload, 'utf8'))
            if (!cipher.finish()) throw new Error('Encrypt failed')
            
            sendTo(remotePeerId, {
              type: 'LINK_IDENTITY_RES',
              s: forge.util.encode64(salt),
              iv: forge.util.encode64(iv),
              d: forge.util.encode64(cipher.output.getBytes())
            })
            showMessage('Identity sent safely! ✅', 'success')
          } catch(err) {
            console.error(err)
            showMessage('Host link generic failure! ' + err.message, 'error')
          }
        } else {
          showMessage('Invalid link code or hash! Make sure the host window is waiting linking.', 'error')
        }
      }
      if (data?.type === 'LINK_IDENTITY_RES') {
        if (!globalThis.cuteGuestLinkOtp) return
        try {
          const forge = globalThis.forge || forgeLib
          const otp = globalThis.cuteGuestLinkOtp
          const salt = forge.util.decode64(data.s)
          const iv = forge.util.decode64(data.iv)
          const encrypted = forge.util.decode64(data.d)
          
          const key = forge.pkcs5.pbkdf2(otp, salt, 10000, 32, forge.md.sha256.create())
          const decipher = forge.cipher.createDecipher('AES-CBC', key)
          decipher.start({ iv })
          decipher.update(forge.util.createBuffer(encrypted))
          if (!decipher.finish()) throw new Error('Decryption failed, wrong OTP')
          
          const imported = JSON.parse(decipher.output.toString())
          if (!imported?.privateKey || !imported?.publicKey) throw new Error('Invalid payload')
          
          saveIdentity({ privateKey: imported.privateKey, publicKey: imported.publicKey })
          showMessage('Device linked successfully! 🎉', 'success')
          
          setTimeout(() => {
            sendTo(remotePeerId, { type: 'SYNC_CONTACTS_REQ' })
          }, 500)
          
          delete globalThis.cuteGuestLinkOtp
        } catch(err) {
          showMessage('Linking failed: ' + err.message, 'error')
        }
      }
      if (data?.type === 'SYNC_CONTACTS_RES') {
        if (Array.isArray(data.contacts)) {
          saveContacts(data.contacts)
          showMessage(`Synced ${data.contacts.length} contacts automatically! 👥✨`, 'success')
        }
      }
    }
    globalThis.addEventListener('cute-peer-data', p2pSyncHandler)
    return () => globalThis.removeEventListener('cute-peer-data', p2pSyncHandler)
  }, [contacts, sendTo, saveContacts, saveIdentity, showMessage])

  const forge = globalThis.forge || forgeLib
  const isDesktop = detectDesktop()
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [showPlatformBanner, setShowPlatformBanner] = useState(() => {
    if (detectDesktop() || isStandaloneDisplay()) return false

    // If coming from TWA (encapsulated APK), document.referrer is sometimes 'android-app://...'
    if (document.referrer && document.referrer.includes('android-app://')) return false

    const val = localStorage.getItem(PLATFORM_BANNER_DISMISS_KEY)
    let dismissedAt = 0
    const ONE_DAY = 24 * 60 * 60 * 1000
    if (val === 'true') {
      dismissedAt = Date.now() - ONE_DAY // Trigger now if coming from old 'true' string
      localStorage.setItem(PLATFORM_BANNER_DISMISS_KEY, dismissedAt.toString()) 
    } else if (val) {
      dismissedAt = parseInt(val, 10) || 0
    }
    
    return (Date.now() - dismissedAt > ONE_DAY)
  })
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkStep, setLinkStep] = useState('scan')
  const [otpInput, setOtpInput] = useState('')
  const [scannedPayload, setScannedPayload] = useState(null)
  const [showHostModal, setShowHostModal] = useState(false)
  const [hostOtp, setHostOtp] = useState('000000')
  const [hostQrDataUrl, setHostQrDataUrl] = useState('')
  const [sidebarChatSearch, setSidebarChatSearch] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const videoRef = useRef(null)
  const videoStreamRef = useRef(null)
  const scanRafRef = useRef(null)
  const shellRef = useRef(null)
  useSidebarResize(shellRef)

  const statusDotClass = webOnline
    ? ({ online:'online', connecting:'connecting', error:'error' }[peerStatus] || 'offline')
    : 'error'
  const statusText = webOnline
    ? ({ online:'Peer Online', connecting:'Peer Connecting...', error:'Peer Error', offline:'Peer Offline' }[peerStatus] || 'Peer Offline')
    : 'Web Offline'
  const sidebarContacts = [{ name: 'Note to Self' }, ...contacts]
    .filter((c) => c.name.toLowerCase().includes(sidebarChatSearch.toLowerCase()))

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setShowInstallBanner(false)
  }, [deferredPrompt])

  useEffect(() => {
    document.body.classList.toggle('is-desktop', isDesktop)

    if (isDesktop) return

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
      setShowInstallBanner(true)
    }

    const onAppInstalled = () => {
      setDeferredPrompt(null)
      setShowInstallBanner(false)
      showMessage('CuteSec installed successfully 💖', 'success')
    }

    globalThis.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    globalThis.addEventListener('appinstalled', onAppInstalled)

    return () => {
      globalThis.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      globalThis.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [isDesktop, showMessage])

  const dismissPlatformBanner = () => {
    localStorage.setItem(PLATFORM_BANNER_DISMISS_KEY, Date.now().toString())
    setShowPlatformBanner(false)
  }

  const createIdentity = useCallback(async () => {
    await executeCreateIdentity({ mobileConfirm, generateKeyPair, saveIdentity, showMessage })
  }, [generateKeyPair, saveIdentity, showMessage])

  const unlink = useCallback(async () => {
    await executeUnlink({ mobileConfirm, clearIdentity, showMessage })
  }, [clearIdentity, showMessage])

  const stopVideoOnly = useCallback(() => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((track) => track.stop())
      videoStreamRef.current = null
    }
    if (scanRafRef.current) {
      globalThis.cancelAnimationFrame(scanRafRef.current)
      scanRafRef.current = null
    }
  }, [])

  const closeLinkModal = useCallback(() => {
    stopVideoOnly()
    setShowLinkModal(false)
    setLinkStep('scan')
    setOtpInput('')
    setScannedPayload(null)
  }, [stopVideoOnly])

  const scanFrame = useCallback(function runScanFrame() {
    const video = videoRef.current
    if (!video || !videoStreamRef.current) return
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code?.data) {
        try {
          const parsed = JSON.parse(code.data)
          if (parsed.h && parsed.r) {
            setScannedPayload(parsed)
            setLinkStep('otp')
            stopVideoOnly()
            return
          }
        } catch {
          // Continue scanning if QR payload is not expected format
        }
      }
    }
    scanRafRef.current = globalThis.requestAnimationFrame(runScanFrame)
  }, [stopVideoOnly])

  const openScanner = useCallback(async () => {
    stopVideoOnly()
    try {
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      videoStreamRef.current = stream
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        videoStreamRef.current = null
        return
      }
      videoRef.current.srcObject = stream
      videoRef.current.setAttribute('playsinline', 'true')
      await videoRef.current.play()
      scanRafRef.current = globalThis.requestAnimationFrame(scanFrame)
    } catch {
      showMessage('Camera access denied or unavailable 😢', 'error')
    }
  }, [scanFrame, showMessage, stopVideoOnly])

  const startLinkDevice = useCallback(async () => {
    setShowLinkModal(true)
    setLinkStep('scan')
    setOtpInput('')
    setScannedPayload(null)
    await openScanner()
  }, [openScanner])

  const backToScanStep = useCallback(async () => {
    setLinkStep('scan')
    setOtpInput('')
    setScannedPayload(null)
    await openScanner()
  }, [openScanner])

  const verifyLinkOtp = useCallback(() => {
    executeVerifyLinkOtp({
      sendTo,
      otpInput,
      scannedPayload,
      forge,
      saveIdentity,
      saveContacts,
      closeLinkModal,
      showMessage,
    })
  }, [otpInput, scannedPayload, forge, saveIdentity, saveContacts, closeLinkModal, showMessage, sendTo])

  const generateHostLink = useCallback(async () => {
    await executeGenerateHostLink({
      identity,
      myPeerId,
      contacts,
      forge,
      setHostOtp,
      setHostQrDataUrl,
      setShowHostModal,
      showMessage,
    })
  }, [contacts, forge, identity, showMessage, myPeerId])

  const closeHostModal = () => {
    setShowHostModal(false)
    setHostOtp('000000')
    setHostQrDataUrl('')
  }

  useEffect(() => {
    return () => stopVideoOnly()
  }, [stopVideoOnly])

  useEffect(() => {
    const onGenerateHostLink = () => {
      generateHostLink()
    }
    globalThis.addEventListener('cute-generate-host-link', onGenerateHostLink)
    return () => {
      globalThis.removeEventListener('cute-generate-host-link', onGenerateHostLink)
    }
  }, [generateHostLink])

  useEffect(() => {
    globalThis.cuteSendToPeer = sendTo
    return () => {
      if (globalThis.cuteSendToPeer === sendTo) {
        delete globalThis.cuteSendToPeer
      }
    }
  }, [sendTo])

  useEffect(() => {
    if (peerStatus === 'online') {
      globalThis.dispatchEvent(new Event('cute-peer-online'))
    }
  }, [peerStatus])

  useEffect(() => {
    const checkClipboard = async () => {
      if (!autoRead) return
      if (!document.hasFocus() && !window.__TAURI_IPC__) return
      try {
        const text = await clipboardRead()
        if (!text?.trim()) return

        if (text.includes('BEGIN PGP MESSAGE')) {
          setPgpModeEnabled(true)
          setActiveTab('pgp')
          globalThis.dispatchEvent(new CustomEvent('cute-autopaste-pgp', { detail: { text } }))
          showMessage('Detected PGP message in clipboard 🤓', 'info')
          return
        }

        if (text.trim().startsWith('{') && text.includes('"envelope"')) {
          setActiveTab('decrypt')
          globalThis.dispatchEvent(new CustomEvent('cute-autopaste-decrypt', { detail: { text } }))
          showMessage('Detected encrypted message in clipboard 🔐', 'info')
        }
      } catch {
        // Ignore denied clipboard access
      }
    }

    globalThis.addEventListener('focus', checkClipboard)
    return () => globalThis.removeEventListener('focus', checkClipboard)
  }, [autoRead, setActiveTab, setPgpModeEnabled, showMessage, clipboardRead])

  return (
    <>
      {message && (
        <div className={`message ${message.type} message-${message.type}`} style={{ display: 'block' }}>
          {message.text}
        </div>
      )}

      <div className="container" ref={shellRef}>
        {showInstallBanner && !isDesktop && (
          <div className="pwa-badge" id="installBanner">
            <button id="installBtn" className="btn-primary btn-small" onClick={promptInstall}>
              🌐 Install WebApp
            </button>
            <a href={DESKTOP_APP_URL} id="installDesktopBtn" className="btn-secondary btn-small" target="_blank" rel="noreferrer">
              💻 Desktop App
            </a>
            <a href={ANDROID_APP_URL} id="installMobileBtn" className="btn-secondary btn-small" target="_blank" rel="noreferrer">
              📱 Android APK
            </a>
          </div>
        )}

        {/* --- Drawer Menu --- */}
        <div 
          className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} 
          onClick={() => setIsDrawerOpen(false)}
          role="button"
          tabIndex={isDrawerOpen ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsDrawerOpen(false)
            }
          }}
          aria-label="Close menu"
        />
        <div className={`drawer-menu ${isDrawerOpen ? 'open' : ''}`}>
          <div className="drawer-header">
            <h3>Menu</h3>
            <button className="drawer-close-btn" onClick={() => setIsDrawerOpen(false)}>✕</button>
          </div>
          <div className="drawer-content">
            {[['chat','💬','Chats'],['contacts','👥','Friends'],['stego','🖼️','Stego Image'],['encrypt','📤','Encrypt Tools'],['decrypt','📥','Decrypt Tools'],['settings','⚙️','Settings']].map(([t,icon,label]) => (
              <button 
                key={t} 
                className={`drawer-item ${activeTab===t ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(t);
                  setIsDrawerOpen(false);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="drawer-item-icon">{icon}</span>
                  <span className="drawer-item-label">{label}</span>
                </div>
              </button>
            ))}
            {pgpModeEnabled && (
                <button className={`drawer-item ${activeTab==='pgp' ? 'active' : ''}`}
                  onClick={() => {setActiveTab('pgp'); setIsDrawerOpen(false);}} >
                  <span className="drawer-item-icon">🤓</span><span className="drawer-item-label">PGP</span>
                </button>
            )}
          </div>
        </div>
        {/* --- End Drawer Menu --- */}

        <section className={`messenger-app-shell active-tab-${activeTab} ${activeChatContact  ? 'has-active-chat' : 'no-active-chat'}`}>
          {/* ── Left sidebar ── */}
          <aside className="messenger-primary-nav" aria-label="Primary Navigation">
            <div className="nav-profile-header">
              <button 
                className="hamburger-btn" 
                onClick={() => setIsDrawerOpen(true)} 
                title="Menu"
                style={{ background: 'transparent', border: 'none', fontSize: '1.4em', marginRight: '6px', color: 'inherit', cursor: 'pointer' }}
              >
                ☰
              </button>
              <div 
                className="nav-profile-avatar" 
                onClick={() => setIsDrawerOpen(true)} 
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsDrawerOpen(true) }}
                style={{ cursor: 'pointer' }}
                aria-label="Open menu from avatar"
              >
                🧸
              </div>
              <div 
                className="nav-profile-info" 
                onClick={() => setIsDrawerOpen(true)} 
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsDrawerOpen(true) }}
                style={{ cursor: 'pointer', flex: 1 }}
                aria-label="Open menu from status"
              >
                <span style={{ color: hasIdentity ? '#2ecc71' : '#e74c3c' }}>
                  {hasIdentity ? '● Secure' : '● No Identity'}
                </span>
              </div>
              <button className="tab-btn tab-tool nav-new-chat-btn" onClick={() => setActiveTab('contacts')} title="New Chat">＋</button>
            </div>

            {!hasIdentity && (
              <div 
                style={{ padding:'12px', background:'rgba(255,105,180,0.08)', borderBottom:'1px solid var(--border-soft)', cursor:'pointer' }} 
                onClick={() => setActiveTab('settings')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab('settings') }}
                aria-label="Go to settings to set up identity"
              >
                <p style={{ fontSize:'0.8em', color:'#9a89b3', marginBottom:0 }}>🔐 Set up your identity in Settings</p>
              </div>
            )}

            <div className="chat-contact-search">
              <input
                type="text"
                placeholder="Search friends..."
                id="chatContactSearch"
                value={sidebarChatSearch}
                onChange={(e) => setSidebarChatSearch(e.target.value)}
              />
            </div>
            <div id="chatContactList" className="chat-contact-list">
              {sidebarContacts.length === 0 ? (
                <div className="chat-no-contacts"><span>💌</span><p>Add friends to start chatting!</p></div>
              ) : (
                sidebarContacts.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={`chat-contact-item${activeChatContact === c.name ? ' active' : ''}${chatUnreadCounts[c.name] ? ' has-unread' : ''}`}
                    onClick={() => { 
                      setActiveChatContact(c.name); 
                      setActiveTab('chat');
                      clearChatUnread(c.name);
                    }}
                    style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent' }}
                  >
                    <div className="chat-contact-avatar">{c.name[0].toUpperCase()}</div>
                    <div className="chat-contact-info">
                      <div className="chat-contact-name">{c.name}</div>
                      <div className="chat-contact-preview">🔒 End-to-End Encrypted</div>
                    </div>
                    {chatUnreadCounts[c.name] > 0 && (
                      <div className="chat-unread-badge">{chatUnreadCounts[c.name]}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          </aside>

          <button className="messenger-splitter" id="messengerSplitter" aria-label="Resize" type="button" />

          <div className="messenger-workspace">
            {/* Status bar */}
            <div className="global-status-bar" id="globalStatusBar">
              <span id="globalActiveContext">{TAB_LABELS[activeTab]||activeTab}</span>
              <output className="global-connection-pill" aria-live="polite">
                <span className={`status-dot ${statusDotClass}`} /><span>{statusText}</span>
              </output>
              <output className="global-queue-pill" aria-live="polite">{queueStatus}</output>
              <output className="global-identity-pill" aria-live="polite">{hasIdentity ? 'Identity active' : 'No identity'}</output>
            </div>

            <main className="app-content" id="main-content">
              {/* Key status */}
              <div className="key-status" id="keyStatusSection" style={{ display: activeTab === 'settings' ? 'flex' : 'none' }}>
                {hasIdentity ? (
                  <div id="linkedState" style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ color:'#2ecc71' }}>✨ Identity Active &amp; Secure!</span>
                    {myPeerId && <span style={{ color:'#8a7fa8', fontSize:'0.75em' }}>Peer: {myPeerId.slice(0, 16)}...</span>}
                    <button id="generateHostLinkBtn" className="btn-primary btn-small" onClick={generateHostLink}>🔗 Link My Phone</button>
                    <button id="unlinkBtn" className="btn-secondary btn-small" onClick={unlink}>Unlink</button>
                  </div>
                ) : (
                  <div id="unlinkedState">
                    <p>🔗 Link a device to sync keys &amp; contacts!</p>
                    <button id="startLinkBtn" className="btn-primary" onClick={startLinkDevice}>📱 Link Device</button>
                    <button id="createIdentityBtn" className="btn-secondary" style={{ marginTop:5 }} onClick={createIdentity}>✨ Create Identity</button>
                  </div>
                )}
              </div>

              {!hasIdentity && activeTab !== 'settings' && activeTab !== 'chat' && (
                <div className="app-locked-overlay" style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10,
                  backgroundColor: 'var(--surface, rgba(255,255,255,0.95))', backdropFilter: 'blur(8px)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', padding: '20px'
                }}>
                  <div style={{ fontSize: '4em', marginBottom: 15 }}>🔐</div>
                  <h2 style={{ color: 'var(--text-primary)', marginBottom: 10 }}>Identity Required</h2>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 20, maxWidth: 300, lineHeight: 1.5 }}>
                    You must create an identity to use the app.
                  </p>
                  <button className="btn-primary" onClick={() => setActiveTab('settings')}>
                    Go to Settings
                  </button>
                </div>
              )}

              {/* Tab panes */}
              <div className="tab-content">
                <div id="chat-tab"     className={`tab-pane${activeTab==='chat'     ?' active':''}`}><ChatTab /></div>
                <div id="encrypt-tab"  className={`tab-pane${activeTab==='encrypt'  ?' active':''}`}><EncryptTab /></div>
                <div id="decrypt-tab"  className={`tab-pane${activeTab==='decrypt'  ?' active':''}`}><DecryptTab /></div>
                <div id="contacts-tab" className={`tab-pane${activeTab==='contacts' ?' active':''}`}><ContactsTab /></div>
                <div id="settings-tab" className={`tab-pane${activeTab==='settings' ?' active':''}`}>
                  <SettingsTab
                    isDesktop={isDesktop}
                    showInstallFromSettings={!isDesktop && showInstallBanner}
                    onInstallFromSettings={promptInstall}
                  />
                </div>
                <Suspense fallback={<div style={{padding:20}}>Loading...</div>}>
                  
                  <div id="stego-tab" className={`tab-pane${activeTab==='stego' ?' active':''}`}>{activeTab==='stego' && <StegoTab />}</div>
                  {pgpModeEnabled && (
                    <div id="pgp-tab" className={`tab-pane${activeTab==='pgp'   ?' active':''}`}>{activeTab==='pgp'   && <PgpTab />}</div>
                  )}
                </Suspense>
              </div>
            </main>
          </div>
        </section>

        {showPlatformBanner && !isDesktop && (
          <div className="platform-banner" id="platformBanner">
            <div className="platform-banner-content">
              <div className="platform-banner-icon">🎀</div>
              <div className="platform-banner-text">
                <strong>Get the best experience! Download Cute Secure Messenger</strong>
                <p>You're using the web version. For full features, try our native apps:</p>
              </div>
              <button
                className="platform-banner-close"
                id="closePlatformBanner"
                title="Dismiss"
                type="button"
                onClick={dismissPlatformBanner}
              >
                ✕
              </button>
            </div>
            <div className="platform-banner-buttons">
              <a href={DESKTOP_APP_URL} className="platform-btn platform-btn-desktop" id="downloadDesktopBtn" target="_blank" rel="noreferrer">
                <span className="platform-btn-icon">💻</span>
                <span className="platform-btn-label">Windows Desktop</span>
                <span className="platform-btn-sub">Portable .exe with offline support</span>
              </a>
              <a href={ANDROID_APP_URL} className="platform-btn platform-btn-mobile" id="downloadMobileBtn" target="_blank" rel="noreferrer">
                <span className="platform-btn-icon">📱</span>
                <span className="platform-btn-label">Android App</span>
                <span className="platform-btn-sub">Standalone APK for mobile devices</span>
              </a>
              <button className="platform-btn platform-btn-pwa" id="continueWebBtn" type="button" onClick={dismissPlatformBanner}>
                <span className="platform-btn-icon">🌐</span>
                <span className="platform-btn-label">Continue in Browser</span>
                <span className="platform-btn-sub">Install as WebApp when available</span>
              </button>
            </div>
          </div>
        )}

        {showLinkModal && (
          <div className="modal" style={{ display: 'block' }}>
            <div className="modal-content" style={{ maxWidth: 420 }}>
              {linkStep === 'scan' ? (
                <>
                  <h3>🔗 Link Device</h3>
                  <p>Scan the QR code from your Host Device (Settings → Link Another Device)</p>
                  <div
                    id="videoContainer"
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: 300,
                      background: '#000',
                      overflow: 'hidden',
                      borderRadius: 10,
                    }}
                  >
                    <video
                      ref={videoRef}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      muted
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        border: '2px solid #ff69b4',
                        width: 200,
                        height: 200,
                        borderRadius: 20,
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                      }}
                    />
                  </div>
                  <p style={{ textAlign: 'center', marginTop: 10 }}>Scanning...</p>
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button className="btn-secondary" onClick={closeLinkModal}>Close</button>
                  </div>
                </>
              ) : (
                <>
                  <h3>🔐 Enter OTP</h3>
                  <p>Enter the 6-digit OTP code displayed on your host device:</p>
                  <div className="input-group">
                    <input
                      type="text"
                      value={otpInput}
                      maxLength={6}
                      inputMode="numeric"
                      placeholder="123456"
                      onChange={(e) => setOtpInput(e.target.value.replaceAll(/\D/g, '').slice(0, 6))}
                    />
                  </div>
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button className="btn-primary" onClick={verifyLinkOtp}>Verify &amp; Import</button>
                    <button className="btn-secondary" onClick={backToScanStep}>Scan Again</button>
                    <button className="btn-secondary" onClick={closeLinkModal}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {showHostModal && (
          <div className="modal" style={{ display: 'block' }}>
            <div className="modal-content" style={{ maxWidth: 420, textAlign: 'center' }}>
              <h2>📱 Link Another Device</h2>
              <p>
                Scan this QR code from the other device, then type the code below.
              </p>
              {hostQrDataUrl && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    margin: '20px 0',
                    background: '#fff',
                    padding: 15,
                    borderRadius: 10,
                  }}
                >
                  <img src={hostQrDataUrl} alt="Host Link QR" style={{ width: 256, height: 256, borderRadius: 8 }} />
                </div>
              )}
              <h3>One-Time Password:</h3>
              <div style={{ marginTop: 12, fontSize: '2em', letterSpacing: '0.22em', fontWeight: 700, color: 'var(--accent)' }}>{hostOtp}</div>
              <p style={{ color: '#666', fontSize: '0.9em', marginTop: 10 }}>
                This code is valid for this QR scan only. Do not let anyone else see it.
              </p>
              <div className="actions" style={{ marginTop: 14 }}>
                <button className="btn-secondary" onClick={closeHostModal}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

async function mobileConfirm(msg) {
  if (typeof globalThis.mobileConfirm === 'function') return globalThis.mobileConfirm(msg)
  return globalThis.confirm(msg)
}
