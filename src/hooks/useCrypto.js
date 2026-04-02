/**
 * useCrypto — thin React wrapper around the forge / WebCrypto logic
 * that was previously inline in app.js.
 *
 * forge is loaded via CDN <script> tag in index.html (window.forge)
 * so we access it via window.forge to avoid bundling it.
 */
import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import forgeLib from 'node-forge'

const getForge = () => {
  const forge = globalThis.forge || forgeLib
  if (!forge) throw new Error('forge not loaded')
  return forge
}

export function useCrypto() {
  const { identity } = useApp()

  // ── Generate new RSA-2048 key pair (same as app.js createIdentityBtn handler) ──
  const generateKeyPair = useCallback(() => {
    return new Promise((resolve, reject) => {
      const forge = getForge()
      forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (err, keypair) => {
        if (err) return reject(err)
        resolve({
          privateKey: forge.pki.privateKeyToPem(keypair.privateKey),
          publicKey: forge.pki.publicKeyToPem(keypair.publicKey),
        })
      })
    })
  }, [])

  // ── Encrypt message for one recipient (RSA-OAEP + AES-256-GCM) ──
  const encryptForRecipient = useCallback((message, recipientPublicKeyPem) => {
    const forge = getForge()
    const aesKey = forge.random.getBytesSync(32)
    const iv     = forge.random.getBytesSync(16)
    const cipher = forge.cipher.createCipher('AES-GCM', aesKey)
    cipher.start({ iv })
    cipher.update(forge.util.createBuffer(message, 'utf8'))
    cipher.finish()
    const encryptedMsg = cipher.output.getBytes()
    const authTag      = cipher.mode.tag.getBytes()

    const pubKey   = forge.pki.publicKeyFromPem(recipientPublicKeyPem)
    const encKey   = pubKey.encrypt(aesKey, 'RSA-OAEP')

    return JSON.stringify({
      v: '2.0',
      encryptedKey: forge.util.encode64(encKey),
      iv:  forge.util.encode64(iv),
      tag: forge.util.encode64(authTag),
      data: forge.util.encode64(encryptedMsg),
      ts: Date.now(),
    })
  }, [])

  // ── Encrypt for multiple recipients ──
  const encryptForMultiple = useCallback((message, recipientMap) => {
    // recipientMap: { name: publicKeyPem }
    const results = {}
    for (const [name, pubKeyPem] of Object.entries(recipientMap)) {
      try { results[name] = encryptForRecipient(message, pubKeyPem) }
      catch { results[name] = null }
    }
    return results
  }, [encryptForRecipient])

  // ── Decrypt ──
  const decryptMessage = useCallback((encryptedJson) => {
    const forge = getForge()
    if (!identity?.privateKey) throw new Error('No private key')
    const env     = JSON.parse(encryptedJson)
    const privKey = forge.pki.privateKeyFromPem(identity.privateKey)
    const aesKey  = privKey.decrypt(forge.util.decode64(env.encryptedKey), 'RSA-OAEP')
    const decipher = forge.cipher.createDecipher('AES-GCM', aesKey)
    decipher.start({
      iv:  forge.util.decode64(env.iv),
      tag: forge.util.createBuffer(forge.util.decode64(env.tag)),
    })
    decipher.update(forge.util.createBuffer(forge.util.decode64(env.data)))
    if (!decipher.finish()) throw new Error('Decryption failed — wrong key or tampered data')
    return decipher.output.toString('utf8')
  }, [identity])

  // ── Export public key as base64-encoded shareable string ──
  const getPublicKeyPem = useCallback(() => {
    return identity?.publicKey ?? null
  }, [identity])

  // ── Derive a short peer ID from the public key (same as app.js) ──
  const getPeerId = useCallback(() => {
    if (!identity?.publicKey) return ''
    const forge = getForge()
    const md = forge.md.sha256.create()
    // Normalize to prevent \r\n vs \n hash mismatches
    md.update(identity.publicKey.replace(/\s+/g, ''))
    return 'cutesec_' + md.digest().toHex().slice(0, 24)
  }, [identity])

  return { generateKeyPair, encryptForRecipient, encryptForMultiple, decryptMessage, getPublicKeyPem, getPeerId }
}
