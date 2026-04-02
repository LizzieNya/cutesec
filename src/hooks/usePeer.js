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
    // If no identity exists yet (e.g. fresh device trying to link), we still need PeerJS!
    // We instantiate PeerJS with a completely random ID so we can establish a connection
    // and receive the real identity via the P2P pipe.
    let currentId = identity?.privateKey ? getPeerId() : undefined
    
    if (currentId) {
      setMyPeerId(currentId)
    }

    let peer = currentId ? new Peer(currentId) : new Peer()
    peerRef.current = peer

    const setupPeer = (p) => {
      let reconnectTimeout = 5000;
      
      p.on('disconnected', () => {
        setPeerStatus('connecting')
        console.warn(`[usePeer] Disconnected from PeerJS server. Reconnecting in ${reconnectTimeout / 1000}s...`)
        setTimeout(() => {
          if (!p.destroyed) {
            p.reconnect()
          }
        }, reconnectTimeout)
        
        // Increase wait time exponentially to avoid maintaining active ban
        reconnectTimeout = Math.min(reconnectTimeout * 2, 60000); 
      })

      p.on('open', (assignedId) => {
        console.log(`[usePeer] PeerJS MY ID is now online: ${assignedId}`)
        reconnectTimeout = 5000; // Reset backoff after success
        if (!currentId) {
          setMyPeerId(assignedId)
        }
        setPeerStatus('online')
      })

      p.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // ID is taken by a prior ghost session (e.g., reloaded too fast)
          console.warn('[usePeer] ID taken by ghost session. Retrying in 5s...')
          setPeerStatus('connecting')
          setTimeout(() => {
            if (peerRef.current) peerRef.current.destroy()
            peerRef.current = new Peer(currentId)
            setupPeer(peerRef.current)
          }, 5000)
        } else if (err.type === 'network' || err.type === 'server-error') {
          console.warn(`[usePeer] Network error with PeerJS server (Possible rate limit ban). Waiting 5s...`, err)
        } else if (err.type === 'peer-unavailable') {
          console.log(`[usePeer] Note: attempted to connect to an offline peer.`)
        }
      })

      p.on('connection', (conn) => {
        console.log(`[usePeer] Receiving incoming connection from: ${conn.peer}`)
        connectionsRef.current[conn.peer] = conn; // Store immediately so sendTo can reuse the incoming connection!
        conn.on('open', () => {
          console.log(`[usePeer] Incoming connection OPEN from: ${conn.peer}`)
          connectionsRef.current[conn.peer] = conn
            globalThis.dispatchEvent(new CustomEvent('cute-peer-online', { detail: conn.peer }))
        })
        conn.on('error', (err) => {
          console.error(`[usePeer] Error in incoming connection from ${conn.peer}:`, err)
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

    return () => { 
      if (peerRef.current) {
        peerRef.current.disconnect()
        peerRef.current.destroy() 
      }
      connectionsRef.current = {}; 
      setPeerStatus('offline') 
    }
  }, [getPeerId, identity?.privateKey, onMessage, setMyPeerId, setPeerStatus])

  const connectTo = useCallback((remotePeerId) => {
    if (!peerRef.current) return null
    if (connectionsRef.current[remotePeerId]) return connectionsRef.current[remotePeerId]
    const conn = peerRef.current.connect(remotePeerId)
    connectionsRef.current[remotePeerId] = conn
    conn.on('open', () => { 
      console.log(`[usePeer] Outbound connection OPENED to ${remotePeerId}`)
      connectionsRef.current[remotePeerId] = conn 
        globalThis.dispatchEvent(new CustomEvent('cute-peer-online', { detail: remotePeerId }))
    })
    conn.on('error', (err) => {
      console.error(`[usePeer] Connection ERROR to ${remotePeerId}:`, err)
    })
    conn.on('data', (data) => { onMessage?.(remotePeerId, data) })
    conn.on('close', () => { delete connectionsRef.current[remotePeerId] })
    return conn
  }, [onMessage])

  const sendTo = useCallback((remotePeerId, data) => {
    let conn = connectionsRef.current[remotePeerId]
    if (!conn) {
      console.log(`[usePeer] No existing connection to ${remotePeerId}. Connecting now...`)
      conn = connectTo(remotePeerId)
    }
    if (conn) {
      if (conn.open) {
        conn.send(data)
        console.log(`[usePeer] Sent data instantly to ${remotePeerId}`)
        return true
      }
      console.log(`[usePeer] Connection to ${remotePeerId} not yet open. Queueing data...`)
      
      let opened = false;
      const onOpen = () => {
        opened = true;
        console.log(`[usePeer] Connection opened to ${remotePeerId}. Sending queued data!`)
        conn.send(data)
      }
      conn.on('open', onOpen)
      
      // Let's ensure if it fails, at least it doesn't leave them in the dark
      setTimeout(() => {
        if (!opened) console.warn(`[usePeer] Timeout: Connection to ${remotePeerId} never opened for queued data.`);
      }, 10000)

      return false // Pending status
    }
    return false
  }, [connectTo])

  return { peerId, connectTo, sendTo, peer: peerRef, connections: connectionsRef }
}
