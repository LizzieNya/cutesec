/**
 * usePeer — manages the PeerJS connection lifecycle.
 * Extracted from the large DOMContentLoaded block in app.js.
 * window.Peer is loaded via CDN.
 */
import { useEffect, useRef, useCallback } from 'react'
import { Peer } from 'peerjs'
import { useApp } from '../context/AppContext'
import { useCrypto } from './useCrypto'

export function usePeer({ onMessage } = {}) {
  const { identity, setPeerStatus, setMyPeerId } = useApp()
  const { getPeerId } = useCrypto()
  const peerRef      = useRef(null)
  const connectionsRef = useRef({})

  const peerId = identity ? getPeerId() : ''

  useEffect(() => {
    if (!identity?.privateKey) return

    let currentId = getPeerId()
    setMyPeerId(currentId)

    let peer = new Peer(currentId)
    peerRef.current = peer

    const setupPeer = (p) => {
      p.on('open', () => {
        setPeerStatus('online')
      })

      p.on('disconnected', () => {
        setPeerStatus('connecting')
        p.reconnect()
      })

      p.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // ID collision - append random suffix to overcome stuck sessions
          currentId = currentId + '_' + Math.random().toString(36).substring(2, 5)
          setMyPeerId(currentId)
          if (peerRef.current) peerRef.current.destroy()
          peerRef.current = new Peer(currentId)
          setupPeer(peerRef.current)
        } else {
          setPeerStatus('error')
          console.warn('PeerJS error:', err)
        }
      })

      p.on('connection', (conn) => {
        conn.on('open', () => {
          connectionsRef.current[conn.peer] = conn
        })
        conn.on('data', (data) => {
          onMessage?.(conn.peer, data)
        })
        conn.on('close', () => {
          delete connectionsRef.current[conn.peer]
        })
      })
    }

    setupPeer(peer)

    return () => { peerRef.current?.destroy(); setPeerStatus('offline') }
  }, [getPeerId, identity?.privateKey, onMessage, setMyPeerId, setPeerStatus])

  const connectTo = useCallback((remotePeerId) => {
    if (!peerRef.current) return null
    if (connectionsRef.current[remotePeerId]) return connectionsRef.current[remotePeerId]
    const conn = peerRef.current.connect(remotePeerId)
    conn.on('open', () => { connectionsRef.current[remotePeerId] = conn })
    conn.on('data', (data) => { onMessage?.(remotePeerId, data) })
    conn.on('close', () => { delete connectionsRef.current[remotePeerId] })
    return conn
  }, [onMessage])

  const sendTo = useCallback((remotePeerId, data) => {
    const conn = connectionsRef.current[remotePeerId] || connectTo(remotePeerId)
    if (conn?.open) {
      conn.send(data)
      return true
    }
    // Queue it — simplified: just warn for now, full queue logic in app.js stays intact
    return false
  }, [connectTo])

  return { peerId, connectTo, sendTo, peer: peerRef, connections: connectionsRef }
}
