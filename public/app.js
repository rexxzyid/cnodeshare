const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const auth = {
  token: () => localStorage.getItem('token') || '',
  set: token => localStorage.setItem('token', token),
  clear: () => localStorage.removeItem('token'),
  headers(extra = {}) {
    const token = this.token()
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
  },
  async me() {
    if (!this.token()) return null
    try {
      const res = await fetch('/api/me', { headers: this.headers() })
      if (!res.ok) {
        if (res.status === 401) this.clear()
        return null
      }
      return (await res.json()).user
    } catch { return null }
  }
}

window.CodeShare = { auth }

window.toast = (message, type = '') => {
  let wrap = $('.toast-wrap')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.className = 'toast-wrap'
    document.body.appendChild(wrap)
  }
  const node = document.createElement('div')
  node.className = `toast ${type}`
  node.textContent = message
  wrap.appendChild(node)
  setTimeout(() => node.remove(), 3800)
}

window.api = async (url, options = {}) => {
  options.headers = auth.headers(options.headers || {})
  const res = await fetch(url, options)
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) {
    const error = new Error(data?.detail || data?.message || `Request failed (${res.status})`)
    error.status = res.status
    throw error
  }
  return data
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char])
}
window.escapeHtml = escapeHtml

function timeAgo(value) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const seconds = Math.floor((Date.now() - time) / 1000)
  if (seconds < 60) return 'baru saja'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m lalu`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}j lalu`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}h lalu`
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(time))
}
window.timeAgo = timeAgo

window.pasteCard = paste => `
  <a class="card card-hover paste-card" href="/paste/${encodeURIComponent(paste.id)}">
    <div class="paste-meta"><span class="tag">${escapeHtml(paste.language || 'text')}</span><span>oleh ${escapeHtml(paste.author_username || 'unknown')}</span></div>
    <h3 class="paste-title">${escapeHtml(paste.title || 'Untitled')}</h3>
    <div class="paste-preview">${escapeHtml((paste.content || '').slice(0, 240))}</div>
    <div class="paste-foot"><span>${timeAgo(paste.created_at)}</span><span>◉ ${Number(paste.views || 0).toLocaleString('id-ID')}</span></div>
  </a>`

async function hydrateNav() {
  const me = await auth.me()
  const authSlot = $('#nav-auth')
  if (authSlot) {
    authSlot.innerHTML = me
      ? `<a class="btn btn-sm" href="/dashboard">${me.profile_picture ? `<img src="${escapeHtml(me.profile_picture)}" class="avatar" style="width:25px;height:25px;border-radius:8px">` : ''}<span>${escapeHtml(me.username)}</span></a><button class="btn btn-sm btn-ghost" id="logout-btn">Keluar</button>`
      : `<a class="btn btn-sm" href="/login">Masuk</a><a class="btn btn-sm btn-primary mobile-essential" href="/signup">Daftar</a>`
    $('#logout-btn')?.addEventListener('click', () => {
      auth.clear()
      window.location.href = '/'
    })
  }
  document.documentElement.dataset.auth = me ? 'yes' : 'no'
  if (me) document.documentElement.dataset.username = me.username
  return me
}

function connectRealtime() {
  const token = auth.token()
  if (!token || !('WebSocket' in window)) return
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const socket = new WebSocket(`${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`)
  const ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })) }, 25000)
  socket.addEventListener('message', event => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'notification') toast(data.data?.message || data.data?.title || 'Notifikasi baru')
      if (data.type === 'view_update') window.dispatchEvent(new CustomEvent('codeshare:view', { detail: data }))
      if (data.type === 'new_paste') window.dispatchEvent(new CustomEvent('codeshare:newpaste', { detail: data }))
    } catch {}
  })
  socket.addEventListener('close', () => clearInterval(ping))
}

document.addEventListener('DOMContentLoaded', async () => {
  await hydrateNav()
  connectRealtime()
  $$('[data-tab]').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('[data-tabs-root]') || document
    $$('[data-tab]', group).forEach(v => v.classList.toggle('active', v === button))
    $$('[data-panel]', group).forEach(v => v.classList.toggle('active', v.dataset.panel === button.dataset.tab))
  }))
})
