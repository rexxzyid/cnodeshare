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

function icon(name, extra = 'icon-sm') {
  return `<svg class="icon ${extra}"><use href="#i-${name}"></use></svg>`
}
window.icon = icon

function timeAgo(value) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const seconds = Math.floor((Date.now() - time) / 1000)
  if (seconds < 60) return 'baru saja'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam lalu`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} hari lalu`
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(time))
}
window.timeAgo = timeAgo

const formatNumber = value => Number(value || 0).toLocaleString('id-ID')
window.formatNumber = formatNumber

function avatarHtml(user, size = '') {
  const name = escapeHtml(String(user?.username || '?').slice(0, 1).toUpperCase())
  return user?.profile_picture
    ? `<img class="avatar ${size}" src="${escapeHtml(user.profile_picture)}" alt="Avatar ${escapeHtml(user.username || '')}">`
    : `<div class="avatar ${size}">${name}</div>`
}
window.avatarHtml = avatarHtml

function badgeHtml(badge) {
  return `<span class="badge" data-badge="${escapeHtml(badge.key)}" title="${escapeHtml(badge.description || '')}"><svg class="badge-icon"><use href="#i-${escapeHtml(badge.icon)}"></use></svg>${escapeHtml(badge.name)}</span>`
}
window.badgeHtml = badgeHtml

function badgeListHtml(badges = [], limit = 0) {
  const items = limit ? badges.slice(0, limit) : badges
  return items.length ? `<div class="badges">${items.map(badgeHtml).join('')}</div>` : ''
}
window.badgeListHtml = badgeListHtml

function verifiedMark(user) {
  if (!user?.is_admin && !user?.is_verified && !user?.verified_by_admin) return ''
  return `<span class="badge-check"><svg class="badge-icon"><use href="#i-check"></use></svg></span>`
}
window.verifiedMark = verifiedMark

window.pasteCard = paste => `
  <a class="card card-hover paste-card" href="/paste/${encodeURIComponent(paste.id)}">
    <div class="paste-meta"><span class="tag">${escapeHtml(paste.language || 'text')}</span><span>oleh ${escapeHtml(paste.author_username || 'unknown')}</span>${verifiedMark({ is_verified: paste.author_is_verified, is_admin: paste.author_is_admin })}</div>
    <h3 class="paste-title">${escapeHtml(paste.title || 'Untitled')}</h3>
    <div class="paste-preview">${escapeHtml((paste.content || '').slice(0, 240))}</div>
    <div class="paste-foot"><span>${icon('clock')}${timeAgo(paste.created_at)}</span><span>${icon('eye')}${formatNumber(paste.views)}</span></div>
  </a>`

window.userCard = user => `
  <a class="card card-hover" href="/user/${encodeURIComponent(user.username)}">
    <div class="user-card-top">${avatarHtml(user)}<div><h3>${escapeHtml(user.username)} ${verifiedMark(user)}</h3><div class="muted">${formatNumber(user.paste_count)} paste</div></div></div>
    ${badgeListHtml(user.badge_details || [], 3)}
  </a>`

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
  const use = $('#theme-icon use')
  if (use) use.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon')
}

function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

function setupChrome() {
  const toggle = $('#theme-toggle')
  const use = $('#theme-icon use')
  if (use) use.setAttribute('href', currentTheme() === 'dark' ? '#i-sun' : '#i-moon')
  toggle?.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'))

  const navToggle = $('#nav-toggle')
  const navLinks = $('#nav-links')
  navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open')
    navToggle.setAttribute('aria-expanded', String(open))
    $('use', navToggle).setAttribute('href', open ? '#i-close' : '#i-menu')
  })

  markCurrentNav()
}

function markCurrentNav() {
  const path = location.pathname
  $$('.nav-link[href]').forEach(link => {
    const href = link.getAttribute('href')
    if (href === path || (href !== '/' && path.startsWith(href))) link.setAttribute('aria-current', 'page')
  })
}

function logout() {
  auth.clear()
  location.href = '/'
}

async function hydrateNav() {
  const me = await auth.me()
  const slot = $('#nav-auth')
  const menuSlot = $('#nav-menu-auth')
  if (slot) {
    slot.innerHTML = me
      ? `<a class="btn btn-sm" href="/dashboard">${avatarHtml(me, 'avatar-sm')}<span>${escapeHtml(me.username)}</span></a><button class="btn btn-sm btn-ghost" id="logout-btn" type="button">Keluar</button>`
      : `<a class="btn btn-sm" href="/login">Masuk</a><a class="btn btn-sm btn-accent mobile-essential" href="/signup">Daftar</a>`
    $('#logout-btn')?.addEventListener('click', logout)
  }
  if (menuSlot) {
    menuSlot.innerHTML = me
      ? `<a class="nav-link menu-only" href="/dashboard">${icon('user')}Dashboard</a><button class="nav-link menu-only" id="menu-logout" type="button">${icon('arrow')}Keluar</button>`
      : `<a class="nav-link menu-only" href="/login">${icon('user')}Masuk</a>`
    $('#menu-logout')?.addEventListener('click', logout)
    markCurrentNav()
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
      if (data.type === 'view_update') dispatchEvent(new CustomEvent('codeshare:view', { detail: data }))
      if (data.type === 'new_paste') dispatchEvent(new CustomEvent('codeshare:newpaste', { detail: data }))
    } catch {}
  })
  socket.addEventListener('close', () => clearInterval(ping))
}

document.addEventListener('DOMContentLoaded', async () => {
  setupChrome()
  await hydrateNav()
  connectRealtime()
  $$('[data-tab]').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('[data-tabs-root]') || document
    $$('[data-tab]', group).forEach(v => v.classList.toggle('active', v === button))
    $$('[data-panel]', group).forEach(v => v.classList.toggle('active', v.dataset.panel === button.dataset.tab))
  }))
})
