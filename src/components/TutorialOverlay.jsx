import { useState, useCallback } from 'react'
import { useCrypto } from '../hooks/useCrypto'

const TOTAL_STEPS = 3

function StepDots({ step }) {
  return (
    <div className="tutorial-progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <span key={i} className={`tutorial-dot${i + 1 <= step ? ' active' : ''}`} />
      ))}
    </div>
  )
}

// ─── Step 1: Identity ────────────────────────────────────────────────────────

function IdentityStep({ onSkip, startLinkDevice, saveIdentity, showMessage, onIdentityCreated }) {
  const { generateKeyPair } = useCrypto()
  const [view, setView] = useState('choose') // 'choose' | 'confirm' | 'generating'

  const handleCreateConfirmed = useCallback(async () => {
    setView('generating')
    try {
      const keys = await generateKeyPair()
      saveIdentity(keys)
      showMessage('Identity Created! You can now chat securely 💖', 'success')
      onIdentityCreated()
    } catch (e) {
      showMessage('Key generation failed: ' + e.message, 'error')
      setView('confirm')
    }
  }, [generateKeyPair, saveIdentity, showMessage, onIdentityCreated])

  const handleLinkDevice = useCallback(() => {
    startLinkDevice()
    onSkip() // Close tutorial — will re-show next visit if still no identity
  }, [startLinkDevice, onSkip])

  if (view === 'choose') {
    return (
      <>
        <StepDots step={1} />
        <div className="tutorial-hero-icon">🎀</div>
        <h2 className="tutorial-title">Welcome to CuteSec!</h2>
        <p className="tutorial-subtitle">
          Before you can chat securely, you need an identity — your personal encryption key pair.
        </p>

        <div className="tutorial-options">
          <button className="tutorial-option-card" onClick={() => setView('confirm')}>
            <span className="tutorial-option-icon">✨</span>
            <strong className="tutorial-option-title">Create Identity</strong>
            <span className="tutorial-option-desc">
              Generate fresh RSA-2048 keys on this device. <em>Best if you're new!</em>
            </span>
          </button>
          <button className="tutorial-option-card" onClick={handleLinkDevice}>
            <span className="tutorial-option-icon">📱</span>
            <strong className="tutorial-option-title">Link a Device</strong>
            <span className="tutorial-option-desc">
              Sync existing keys from your desktop or another device using a QR code.
            </span>
          </button>
        </div>

        <div className="tutorial-footer">
          <button className="tutorial-skip-link" onClick={onSkip}>Skip for now</button>
        </div>
      </>
    )
  }

  if (view === 'generating') {
    return (
      <>
        <StepDots step={1} />
        <div className="tutorial-hero-icon tutorial-spin">⚙️</div>
        <h2 className="tutorial-title">Generating Keys…</h2>
        <p className="tutorial-subtitle">
          Crunching 2048-bit RSA mathematics. This may take a moment ⏳
        </p>
      </>
    )
  }

  // confirm view
  return (
    <>
      <StepDots step={1} />
      <div className="tutorial-hero-icon">🔑</div>
      <h2 className="tutorial-title">Create Your Identity?</h2>
      <p className="tutorial-subtitle">
        This generates a unique RSA-2048 key pair. Your <strong>private key never leaves this device</strong>.
      </p>
      <div className="tutorial-confirm-box">
        <p>💡 <strong>Tip:</strong> You can link this identity to other devices later via Settings → Link Another Device.</p>
      </div>
      <div className="tutorial-footer">
        <button className="tutorial-skip-link" onClick={() => setView('choose')}>← Back</button>
        <button className="btn-primary" onClick={handleCreateConfirmed}>
          ✨ Yes, Create Identity!
        </button>
      </div>
    </>
  )
}

// ─── Step 2: Add a Friend ────────────────────────────────────────────────────

function FriendsStep({ onDone, setActiveTab }) {
  return (
    <>
      <StepDots step={2} />
      <div className="tutorial-hero-icon">👥</div>
      <h2 className="tutorial-title">Add a Friend</h2>
      <p className="tutorial-subtitle">
        To chat securely, you need your friend's public key. Here's how:
      </p>

      <div className="tutorial-step-visual">
        <div className="tutorial-visual-row">
          <span className="tutorial-visual-num">1</span>
          <span>Ask your friend to open CuteSec and copy their public key from the <strong>Friends</strong> tab.</span>
        </div>
        <div className="tutorial-visual-row">
          <span className="tutorial-visual-num">2</span>
          <span>In your Friends tab, paste their key, give them a nickname, and hit <strong>Add Friend</strong>.</span>
        </div>
        <div className="tutorial-visual-row">
          <span className="tutorial-visual-num">3</span>
          <span>Share <em>your</em> public key with them too so they can write back!</span>
        </div>
      </div>

      <div className="tutorial-footer">
        <button className="tutorial-skip-link" onClick={onDone}>I'll do this later</button>
        <button className="btn-primary" onClick={() => { setActiveTab('contacts'); onDone() }}>
          👥 Open Friends Tab →
        </button>
      </div>
    </>
  )
}

// ─── Step 3: Choose Mode ─────────────────────────────────────────────────────

const MODES = [
  {
    id: 'chat',
    icon: '💬',
    title: 'Live Chat',
    desc: 'Real-time end-to-end encrypted P2P messages. Both of you need to be online.',
    badge: 'P2P',
  },
  {
    id: 'encrypt',
    icon: '📤',
    title: 'Encrypt / Decrypt',
    desc: 'Create encrypted payloads you can share anywhere — email, text, a USB drive.',
    badge: 'Async',
  },
  {
    id: 'stego',
    icon: '🖼️',
    title: 'Stego Image',
    desc: 'Hide your encrypted message inside an ordinary image. Secret in plain sight.',
    badge: 'Covert',
  },
]

function ModeStep({ onDone, setActiveTab, onBack }) {
  return (
    <>
      <StepDots step={3} />
      <div className="tutorial-hero-icon">🎉</div>
      <h2 className="tutorial-title">You're All Set!</h2>
      <p className="tutorial-subtitle">
        CuteSec has three ways to communicate. Pick one to try:
      </p>

      <div className="tutorial-mode-cards">
        {MODES.map(m => (
          <button
            key={m.id}
            className="tutorial-mode-card"
            onClick={() => { setActiveTab(m.id); onDone() }}
          >
            <span className="tutorial-mode-icon">{m.icon}</span>
            <span className="tutorial-mode-badge">{m.badge}</span>
            <strong className="tutorial-mode-title">{m.title}</strong>
            <span className="tutorial-mode-desc">{m.desc}</span>
            <span className="tutorial-mode-try">Try it →</span>
          </button>
        ))}
      </div>

      <div className="tutorial-footer tutorial-footer-center">
        <button className="tutorial-skip-link" onClick={onBack}>← Back</button>
        <button className="btn-primary" onClick={onDone}>Got it! Finish 🎉</button>
      </div>
    </>
  )
}

// ─── Root Component ──────────────────────────────────────────────────────────

export default function TutorialOverlay({
  hasIdentity,
  saveIdentity,
  startLinkDevice,
  setActiveTab,
  showMessage,
  onDone,
  onSkipIdentityStep,
}) {
  // If already has identity, skip straight to step 2
  const [step, setStep] = useState(hasIdentity ? 2 : 1)

  const handleIdentityCreated = useCallback(() => {
    setStep(2)
  }, [])

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="Getting started tutorial">
      <div className="tutorial-card">

        {/* Allow closing identity step without marking done */}
        {step === 1 && (
          <button className="tutorial-close-btn" onClick={onSkipIdentityStep} aria-label="Close tutorial">✕</button>
        )}
        {step !== 1 && (
          <button className="tutorial-close-btn" onClick={onDone} aria-label="Close tutorial">✕</button>
        )}

        {step === 1 && (
          <IdentityStep
            onSkip={onSkipIdentityStep}
            startLinkDevice={startLinkDevice}
            saveIdentity={saveIdentity}
            showMessage={showMessage}
            onIdentityCreated={handleIdentityCreated}
          />
        )}

        {step === 2 && (
          <FriendsStep
            onDone={onDone}
            setActiveTab={setActiveTab}
          />
        )}

        {step === 3 && (
          <ModeStep
            onDone={onDone}
            setActiveTab={setActiveTab}
            onBack={() => setStep(2)}
          />
        )}

        {/* Next button for step 2 → 3 */}
        {step === 2 && (
          <div className="tutorial-next-row">
            <button className="btn-secondary btn-small" onClick={() => setStep(3)}>
              What can I do? →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
