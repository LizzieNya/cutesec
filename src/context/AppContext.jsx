import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'
import localforage from 'localforage'

const AppContext = createContext(null)

// Simple localStorage wrapper (same as original DB object in app.js)
// eslint-disable-next-line react-refresh/only-export-components
export const DB = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val))
    globalThis.dispatchEvent(new Event('cute-data-updated'))
  },
  remove(key) {
    localStorage.removeItem(key)
    globalThis.dispatchEvent(new Event('cute-data-updated'))
  },
}

export function AppProvider({ children }) { // NOSONAR
  const [identity, setIdentity] = useState(() => {
    const keys = DB.get('cute_rsa_keys')
    return keys?.privateKey ? keys : null
  })
  const [contacts, setContacts] = useState(() => DB.get('cute_contacts') || [])

  // ── Navigation ──
  const [activeTab, setActiveTab] = useState('chat')

  // ── Settings ──
  const [theme, setTheme] = useState(() => DB.get('cute-theme') || 'light')
  const [accentColor, setAccentColor] = useState(() => DB.get('cute-accent') || 'pink')
  const [fontSize, setFontSize] = useState(() => DB.get('cute-font-size') || 'medium')
  const [layoutMode, setLayoutMode] = useState(() => DB.get('cute-layout') || 'default')
  const [autoCopy, setAutoCopy] = useState(() => DB.get('cute-autocopy') ?? false)
  const [animations, setAnimations] = useState(() => DB.get('cute-animations') ?? true)
  const [autoRead, setAutoRead] = useState(() => DB.get('cute-autoread') ?? true)
  const [soundEnabled, setSoundEnabled] = useState(() => DB.get('cute-sound') ?? true)
  const [pgpModeEnabled, setPgpModeEnabled] = useState(() => DB.get('cute-pgp-mode') ?? false)

  // ── Peer / Connection ──
  const [peerStatus, setPeerStatus] = useState('offline') // offline | connecting | online | error
  const [myPeerId, setMyPeerId] = useState('')
  const [queueStatus, setQueueStatus] = useState('No pending delivery')
  const [webOnline, setWebOnline] = useState(() => globalThis.navigator?.onLine ?? true)
  const [chatOperationalNotice, setChatOperationalNotice] = useState({ kind: 'info', text: 'Peer status unavailable' })
    
  const [message, setMessage] = useState(null)
  const [activeChatContact, setActiveChatContact] = useState(null)
  
  const [chatUnreadCounts, setChatUnreadCounts] = useState(() => {
    try {
      const stored = localStorage.getItem('cute_chat_unreads')
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  const incrementChatUnread = useCallback((contactName) => {
    setChatUnreadCounts(prev => {
      const next = { ...prev, [contactName]: (prev[contactName] || 0) + 1 }
      localStorage.setItem('cute_chat_unreads', JSON.stringify(next))
      return next
    })
  }, [])

  const clearChatUnread = useCallback((contactName) => {
    setChatUnreadCounts(prev => {
      if (!prev[contactName]) return prev
      const next = { ...prev }
      delete next[contactName]
      localStorage.setItem('cute_chat_unreads', JSON.stringify(next))
      return next
    })
  }, [])

  useEffect(() => {
    const syncWebOnline = () => setWebOnline(globalThis.navigator?.onLine ?? true)
    globalThis.addEventListener('online', syncWebOnline)
    globalThis.addEventListener('offline', syncWebOnline)
    return () => {
      globalThis.removeEventListener('online', syncWebOnline)
      globalThis.removeEventListener('offline', syncWebOnline)
    }
  }, [])

  const playSound = useCallback((type = 'sent') => {
    if (!soundEnabled) return
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      const now = ctx.currentTime
      if (type === 'sent') {
        osc.frequency.setValueAtTime(880, now)
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1)
        gain.gain.setValueAtTime(0.1, now)
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3)
        osc.start(now)
        osc.stop(now + 0.3)
      } else if (type === 'receive') {
        osc.frequency.setValueAtTime(523.25, now)
        osc.frequency.linearRampToValueAtTime(659.25, now + 0.1)
        gain.gain.setValueAtTime(0.1, now)
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4)
        osc.start(now)
        osc.stop(now + 0.4)
      } else if (type === 'error') {
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(220, now)
        osc.frequency.linearRampToValueAtTime(110, now + 0.2)
        gain.gain.setValueAtTime(0.1, now)
        gain.gain.linearRampToValueAtTime(0.01, now + 0.3)
        osc.start(now)
        osc.stop(now + 0.3)
      }
      const closeDelayMs = 600
      globalThis.setTimeout(() => {
        ctx.close().catch(() => {})
      }, closeDelayMs)
    } catch {
      // Ignore audio failures on restricted environments.
    }
  }, [soundEnabled])

  const refreshOperationalIndicators = useCallback(async () => {
    let chatPending = 0
    try {
      const keys = await localforage.keys()
      for (const key of keys) {
        if (!key.startsWith('chat_history_')) continue
        const msgs = await localforage.getItem(key) || []
        chatPending += msgs.filter((m) => m?.sender === 'me' && m?.deliveryStatus === 'pending').length
      }
    } catch {
      // ignore
    }

    
    
            const totalPending = chatPending
    const currentlyWebOnline = globalThis.navigator?.onLine ?? true
    const realtimeOnline = currentlyWebOnline && peerStatus === 'online'

    setWebOnline(currentlyWebOnline)
    
    setQueueStatus(totalPending > 0 ? `${totalPending} pending (chat)` : 'No pending delivery')

    if (!currentlyWebOnline) {
      setChatOperationalNotice({
        kind: 'warning',
        text: 'Web is offline. Messages stay encrypted and can be shared once connection returns.',
      })
      
      return
    }

    if (!realtimeOnline) {
      setChatOperationalNotice({
        kind: 'warning',
        text: `Peer not connected yet. ${chatPending} chat message(s) are waiting.`,
      })
      
      return
    }

    setChatOperationalNotice({
      kind: 'success',
      text: chatPending > 0
        ? `Peer connected. ${chatPending} chat message(s) still pending manual resend.`
        : 'Peer connected. Real-time encrypted chat is ready.',
    })
  }, [peerStatus])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) refreshOperationalIndicators()
    })
    globalThis.addEventListener('cute-data-updated', refreshOperationalIndicators)
    globalThis.addEventListener('storage', refreshOperationalIndicators)
    globalThis.addEventListener('online', refreshOperationalIndicators)
    globalThis.addEventListener('offline', refreshOperationalIndicators)
    return () => {
      cancelled = true
      globalThis.removeEventListener('cute-data-updated', refreshOperationalIndicators)
      globalThis.removeEventListener('storage', refreshOperationalIndicators)
      globalThis.removeEventListener('online', refreshOperationalIndicators)
      globalThis.removeEventListener('offline', refreshOperationalIndicators)
    }
  }, [refreshOperationalIndicators])

  // ── Apply theme/accent/font/layout to <html> and <body> ──
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    html.classList.toggle('dark-mode', theme === 'dark')
    // Accent
    const allThemes = ['blue','mint','lavender','peach','gold','teal','gray','cherry','coffee','ocean','forest','sunset','grape','rose','neon','ice','coral','candy','midnight']
    allThemes.forEach(t => body.classList.remove(`theme-${t}`))
    if (accentColor !== 'pink') body.classList.add(`theme-${accentColor}`)
    // Font
    body.classList.remove('font-small','font-medium','font-large')
    body.classList.add(`font-${fontSize}`)
    // Layout
    body.classList.remove('layout-compact','layout-pro')
    if (layoutMode === 'compact') body.classList.add('layout-compact')
    if (layoutMode === 'pro') body.classList.add('layout-pro')
  }, [theme, accentColor, fontSize, layoutMode])

  // ── Persist settings ──
  useEffect(() => { DB.set('cute-theme', theme) }, [theme])
  useEffect(() => { DB.set('cute-accent', accentColor) }, [accentColor])
  useEffect(() => { DB.set('cute-font-size', fontSize) }, [fontSize])
  useEffect(() => { DB.set('cute-layout', layoutMode) }, [layoutMode])
  useEffect(() => { DB.set('cute-autocopy', autoCopy) }, [autoCopy])
  useEffect(() => { DB.set('cute-animations', animations) }, [animations])
  useEffect(() => { DB.set('cute-autoread', autoRead) }, [autoRead])
  useEffect(() => { DB.set('cute-sound', soundEnabled) }, [soundEnabled])
  useEffect(() => { DB.set('cute-pgp-mode', pgpModeEnabled) }, [pgpModeEnabled])

  // ── Show toast message & Notification ──
  const showMessage = useCallback((text, type = 'info', duration = 5000, skipNative = false) => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), duration)

    if (!skipNative && window.__TAURI_IPC__ && (type === 'info' || type === 'success' || type === 'error')) {
      isPermissionGranted().then(granted => {
        if (granted) {
          sendNotification({ title: 'CuteSec', body: text })
        } else {
          requestPermission().then(newPermission => {
            if (newPermission === 'granted') {
              sendNotification({ title: 'CuteSec', body: text })
            }
          })
        }
      }).catch(err => console.warn('Native notification error:', err))
    }
  }, [])

  // ── Native Clipboard Hooks ──
  const clipboardWrite = useCallback(async (text) => {
    if (window.__TAURI_IPC__) {
      try {
        await writeText(text)
        return true
      } catch (e) {
        console.warn('Native clipboard write failed:', e)
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (e) {
      console.error('Web clipboard write failed:', e)
      return false
    }
  }, [])

  const clipboardRead = useCallback(async () => {
    if (window.__TAURI_IPC__) {
      try {
        return await readText()
      } catch (e) {
        console.warn('Native clipboard read failed:', e)
      }
    }
    try {
      return await navigator.clipboard.readText()
    } catch (e) {
      console.error('Web clipboard read failed:', e)
      return null
    }
  }, [])

  // ── Save identity ──
  const saveIdentity = useCallback((keys) => {
    DB.set('cute_rsa_keys', keys)
    setIdentity(keys)
  }, [])

  const clearIdentity = useCallback(async () => {
    DB.remove('cute_rsa_keys')
    DB.remove('cute_contacts')
    DB.remove('cute_chat_history')
    DB.remove('cute_mailbox')
                try {
      await localforage.removeItem('cute_mailbox')
      const keys = await localforage.keys()
      for (const key of keys) {
        if (key.startsWith('chat_history_')) {
          await localforage.removeItem(key)
        }
      }
    } catch {
      // ignore
    }
    setIdentity(null)
    setContacts([])
    setActiveChatContact(null)
  }, [setActiveChatContact])

  // ── Contacts ──
  const saveContacts = useCallback((list) => {
    DB.set('cute_contacts', list)
    setContacts(list)
  }, [])

  const value = useMemo(() => ({
    // Identity
    identity, saveIdentity, clearIdentity,
    hasIdentity: Boolean(identity?.privateKey),
    // Contacts
    contacts, saveContacts,
    // Navigation
    activeTab, setActiveTab,
    // Settings
    theme, setTheme,
    accentColor, setAccentColor,
    fontSize, setFontSize,
    layoutMode, setLayoutMode,
    autoCopy, setAutoCopy,
    animations, setAnimations,
    autoRead, setAutoRead,
    soundEnabled, setSoundEnabled,
    pgpModeEnabled, setPgpModeEnabled,
    // Peer
    peerStatus, setPeerStatus,
    myPeerId, setMyPeerId,
    queueStatus, setQueueStatus,
    webOnline,
    
    chatOperationalNotice,
    
    refreshOperationalIndicators,
    playSound,
    // UI
    message, showMessage, clipboardWrite, clipboardRead,
    chatUnreadCounts, incrementChatUnread, clearChatUnread,
    activeChatContact, setActiveChatContact,
  }), [
    identity, saveIdentity, clearIdentity,
    contacts, saveContacts,
    activeTab, setActiveTab,
    theme, setTheme,
    accentColor, setAccentColor,
    fontSize, setFontSize,
    layoutMode, setLayoutMode,
    autoCopy, setAutoCopy,
    animations, setAnimations,
    autoRead, setAutoRead,
    soundEnabled, setSoundEnabled,
    pgpModeEnabled, setPgpModeEnabled,
    peerStatus, setPeerStatus,
    myPeerId, setMyPeerId,
    queueStatus, setQueueStatus,
    webOnline,
    
    chatOperationalNotice,
    
    refreshOperationalIndicators,
    playSound,
    message, showMessage, clipboardWrite, clipboardRead,
    chatUnreadCounts, incrementChatUnread, clearChatUnread,
    activeChatContact, setActiveChatContact,
  ])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
