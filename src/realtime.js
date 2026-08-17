import { WebSocketServer, WebSocket } from 'ws'
import { decodeToken } from './security.js'

const connections = new Map()
let wss

function add(username, socket) {
  const set = connections.get(username) || new Set()
  set.add(socket)
  connections.set(username, set)
}

function remove(username, socket) {
  const set = connections.get(username)
  if (!set) return
  set.delete(socket)
  if (!set.size) connections.delete(username)
}

export function initRealtime(server) {
  wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost')
    const token = url.searchParams.get('token')
    let username = 'guest'
    if (token) {
      try { username = decodeToken(token).sub || 'guest' } catch {}
    }
    add(username, socket)
    socket.send(JSON.stringify({ type: 'connected', message: 'Real-time connection established' }))
    socket.on('message', raw => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
      } catch {}
    })
    socket.on('close', () => remove(username, socket))
    socket.on('error', () => remove(username, socket))
  })
  return wss
}

export function sendToUser(username, payload) {
  const set = connections.get(username)
  if (!set) return
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  for (const socket of set) if (socket.readyState === WebSocket.OPEN) socket.send(body)
}

export function broadcast(payload) {
  if (!wss) return
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN) socket.send(body)
}
