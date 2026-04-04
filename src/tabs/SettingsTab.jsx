import { DB, useApp } from '../context/AppContext'
import forgeLib from 'node-forge'

const ACCENTS = [
  { key: 'pink',     emoji: '🎀', bg: '#ff69b4' },
  { key: 'blue',     emoji: '🦋', bg: '#5dade2' },
  { key: 'mint',     emoji: '🌿', bg: '#58d68d' },
  { key: 'lavender', emoji: '🔮', bg: '#af7ac5' },
  { key: 'peach',    emoji: '🍑', bg: '#ffb347' },
  { key: 'gold',     emoji: '✨', bg: '#f1c40f' },
  { key: 'teal',     emoji: '💎', bg: '#1abc9c' },
  { key: 'gray',     emoji: '🌪️', bg: '#95a5a6' },
  { key: 'cherry',   emoji: '🍒', bg: '#e74c3c' },
  { key: 'coffee',   emoji: '☕', bg: '#a0522d' },
  { key: 'ocean',    emoji: '🌊', bg: '#2980b9' },
  { key: 'forest',   emoji: '🌲', bg: '#27ae60' },
  { key: 'sunset',   emoji: '🌅', bg: '#ff6b35' },
  { key: 'grape',    emoji: '🍇', bg: '#7d3c98' },
  { key: 'rose',     emoji: '🌹', bg: '#e91e63' },
  { key: 'neon',     emoji: '💚', bg: '#00e676' },
  { key: 'ice',      emoji: '❄️', bg: '#42a5f5' },
  { key: 'coral',    emoji: '🪸', bg: '#ff7043' },
  { key: 'candy',    emoji: '🍬', bg: '#ec407a' },
  { key: 'midnight', emoji: '🌌', bg: '#1a237e' },
]

function Toggle({ id, checked, onChange, label }) { // NOSONAR
  return (
    <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}>
      <span style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>{label}</span>
      <span className="toggle-switch" aria-hidden="true">
        <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label} />
        <span className="toggle-slider" />
      </span>
    </label>
  )
}

export default function SettingsTab({ isDesktop = false, showInstallFromSettings = false, onInstallFromSettings = () => {} }) { // NOSONAR
  const {
    theme, setTheme,
    accentColor, setAccentColor,
    fontSize, setFontSize,
    layoutMode, setLayoutMode,
    autoCopy, setAutoCopy,
    animations, setAnimations,
    autoRead, setAutoRead,
    soundEnabled, setSoundEnabled,
    pgpModeEnabled, setPgpModeEnabled,
    hasIdentity,
    clearIdentity, showMessage,
  } = useApp()

  const exportKeys = () => {
    const forge = globalThis.forge || forgeLib
    const pass = globalThis.prompt('Create a password to encrypt your backup file:')
    if (!pass) return
    try {
      const rsaKeys = DB.get('cute_rsa_keys')
      const contacts = DB.get('cute_contacts') || []
      const pgp = DB.get('cute_pgp_my_keys') || DB.get('cute_pgp_keys') || []
      const settings = {
        theme: DB.get('cute-theme') || 'light',
        accentColor: DB.get('cute-accent') || 'pink',
      }
      const payload = JSON.stringify({
        version: '2.0',
        timestamp: new Date().toISOString(),
        rsa: rsaKeys,
        contacts,
        pgp,
        settings,
      })

      const salt = forge.random.getBytesSync(32)
      const iv = forge.random.getBytesSync(16)
      const key = forge.pkcs5.pbkdf2(pass, salt, 100000, 32, forge.md.sha512.create())
      const cipher = forge.cipher.createCipher('AES-GCM', key)
      cipher.start({ iv })
      cipher.update(forge.util.createBuffer(payload, 'utf8'))
      const ok = cipher.finish()
      if (!ok) throw new Error('Could not encrypt backup')

      const backup = {
        backup: true,
        v: '2.0',
        salt: forge.util.encode64(salt),
        iv: forge.util.encode64(iv),
        tag: forge.util.encode64(cipher.mode.tag.getBytes()),
        data: forge.util.encode64(cipher.output.getBytes()),
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cute_messenger_backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      showMessage('Encrypted backup exported 💾', 'success')
    } catch (e) {
      showMessage('Backup export failed: ' + e.message, 'error')
    }
  }

  const importKeys = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    try {
      const forge = globalThis.forge || forgeLib
      const fileText = await f.text()
      const data = JSON.parse(fileText)
      if (!data.backup || !data.salt || !data.iv || !data.data || !data.tag) {
        showMessage('Invalid encrypted backup file 🚨', 'error')
        return
      }

      const pass = globalThis.prompt(`Enter password for backup "${f.name}":`)
      if (!pass) return

      const salt = forge.util.decode64(data.salt)
      const iv = forge.util.decode64(data.iv)
      const tag = forge.util.decode64(data.tag)
      const encrypted = forge.util.decode64(data.data)
      const key = forge.pkcs5.pbkdf2(pass, salt, 100000, 32, forge.md.sha512.create())
      const decipher = forge.cipher.createDecipher('AES-GCM', key)
      decipher.start({ iv, tag: forge.util.createBuffer(tag) })
      decipher.update(forge.util.createBuffer(encrypted))
      if (!decipher.finish()) throw new Error('Wrong password or corrupted backup')
      const restored = JSON.parse(decipher.output.toString('utf8'))

      if (restored.rsa) DB.set('cute_rsa_keys', restored.rsa)
      if (restored.contacts) DB.set('cute_contacts', restored.contacts)
      if (restored.pgp) {
        DB.set('cute_pgp_my_keys', restored.pgp)
        DB.set('cute_pgp_keys', restored.pgp)
      }
      if (restored.settings?.theme) DB.set('cute-theme', restored.settings.theme)
      if (restored.settings?.accentColor) DB.set('cute-accent', restored.settings.accentColor)

      showMessage('Encrypted backup restored! Reloading... 🎉', 'success')
      setTimeout(() => globalThis.location.reload(), 1200)
    } catch {
      showMessage('Could not parse file 🚨', 'error')
    }
  }

  const resetApp = async () => {
    const ok = await mobileConfirm('⚠️ Reset EVERYTHING? All keys and messages will be permanently deleted.')
    if (!ok) return
    clearIdentity()
    localStorage.clear()
    showMessage('App reset. Reloading...', 'info')
    setTimeout(() => globalThis.location.reload(), 1200)
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>⚙️ Settings</h2>

      <div className="setting-item">
        <p className="setting-label">🌗 Theme</p>
        <button className="btn-secondary" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Switch to Light Mode ☀️' : 'Switch to Dark Mode 🌙'}
        </button>
      </div>

      <div className="setting-item">
        <p className="setting-label">🎨 Accent Color</p>
        <div className="color-options">
          {ACCENTS.map(a => (
            <button key={a.key}
              className={`color-btn${accentColor === a.key ? ' active' : ''}`}
              data-color={a.key}
              style={{ background: a.bg }}
              onClick={() => setAccentColor(a.key)}>
              {a.emoji} {a.key.charAt(0).toUpperCase() + a.key.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-item">
        <p className="setting-label">📐 Layout Mode</p>
        <div className="layout-options" style={{ display: 'flex', gap: 10 }}>
          {['default','compact','pro'].map(l => (
            <button key={l} className={`layout-btn${layoutMode === l ? ' active' : ''}`}
              onClick={() => setLayoutMode(l)}>
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-item">
        <p className="setting-label">🔡 Font Size</p>
        <div className="font-options">
          {['small','medium','large'].map(s => (
            <button key={s} className={`font-btn${fontSize === s ? ' active' : ''}`}
              onClick={() => setFontSize(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-item">
        <p className="setting-label">⚙️ Behavior</p>
        <Toggle id="autoCopyToggle"  checked={autoCopy}    onChange={setAutoCopy}    label="Auto-Copy Decrypted Text" />
        <Toggle id="animationsToggle" checked={animations} onChange={setAnimations}  label="Enable Animations" />
      </div>

      <div className="setting-item">
        <p className="setting-label">📋 Clipboard</p>
        <Toggle id="autoReadToggle" checked={autoRead} onChange={setAutoRead} label="Auto-read encrypted messages" />
      </div>

      <div className="setting-item">
        <p className="setting-label">🔊 Sound Effects</p>
        <Toggle id="soundToggle" checked={soundEnabled} onChange={setSoundEnabled} label="Play cute sounds on send/receive" />
      </div>

      <div className="setting-item">
        <p className="setting-label">🤓 Advanced Mode</p>
        <p>Show manual PGP key tools and options.</p>
        <button className="btn-secondary" onClick={() => setPgpModeEnabled(v => !v)}>
          {pgpModeEnabled ? 'Disable PGP Mode 🔒' : 'Enable PGP Mode 🔓'}
        </button>
      </div>

      <div className="setting-item">
        <p className="setting-label">💾 Backup Keys</p>
        <p>Export your keys so you can restore them later.</p>
        <button className="btn-secondary" onClick={exportKeys}>📥 Export All Keys</button>
        <button
          type="button"
          className="btn-secondary"
          style={{ marginLeft: 8 }}
          onClick={() => document.getElementById('importKeysInput')?.click()}
        >
          📤 Import Keys
        </button>
        <input id="importKeysInput" type="file" accept=".json" style={{ display: 'none' }} onChange={importKeys} />
      </div>

      <div className="setting-item">
        <p className="setting-label">📦 Get Native Apps</p>
        <div className="download-cards">
          <a href="https://github.com/LizzieNya/cute-secure-messenger/releases/download/v2.0.9/Cute.Secure.Messenger.exe" className="download-card">
            <div className="download-card-icon">💻</div>
            <div className="download-card-info"><strong>Windows Desktop</strong><span>Portable .exe — no install needed</span></div>
            <div className="download-card-action">📥 Download</div>
          </a>
          <a href="https://github.com/LizzieNya/cute-secure-messenger/releases/download/v2.0.9/Cute.Secure.Messenger.apk" className="download-card">
            <div className="download-card-icon">🤖</div>
            <div className="download-card-info"><strong>Android Mobile</strong><span>Download APK & Link with Desktop via QR</span></div>
            <div className="download-card-action">📥 Download</div>
          </a>
          {!isDesktop && (
            <button
              type="button"
              className="download-card download-card-info-only"
              onClick={() => {
                if (showInstallFromSettings) {
                  onInstallFromSettings()
                } else {
                  showMessage('To install on iOS: Tap Share ⬆️ then "Add to Home Screen". On Android: Tap menu ⋮ then "Install App" or "Add to Home Screen".', 'info', 10000)
                }
              }}
            >
              <div className="download-card-icon">🌐</div>
              <div className="download-card-info"><strong>Web App (PWA)</strong><span>Install for iOS / Android without App Store</span></div>
              <div className="download-card-action">Install</div>
            </button>
          )}
        </div>
      </div>

      <div className="setting-item">
        <p className="setting-label">🔗 Device Linking</p>
        <p>Generate a host QR from settings to link another device.</p>
        <button
          className="btn-secondary"
          onClick={() => {
            if (!hasIdentity) {
              showMessage('Create or link an identity first 🔐', 'error')
              return
            }
            globalThis.dispatchEvent(new Event('cute-generate-host-link'))
          }}
        >
          🔗 Generate Host Link QR
        </button>
      </div>

      <div className="setting-item">
        <p className="setting-label">✨ Credits</p>
        <p style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
          Built with 💖 by <strong>LizzieNya</strong> and <strong>Antigravity</strong>
        </p>
      </div>

      <div className="setting-item">
        <p className="setting-label">🔐 Security</p>
        <button className="btn-danger" onClick={resetApp}>⚠️ Reset Everything</button>
      </div>
    </div>
  )
}

async function mobileConfirm(msg) {
  if (typeof globalThis.mobileConfirm === 'function') return globalThis.mobileConfirm(msg)
  return globalThis.confirm(msg)
}
