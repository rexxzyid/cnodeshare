import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'
import nunjucks from 'nunjucks'
import multer from 'multer'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import { config } from './config.js'
import {
  initStore, ensureAdmin, getUser, saveUser, getPaste, savePaste, userPastes, publicPastes,
  getThreads, addThread, allUsers, allPastes, deletePasteFiles, deleteUserFile, calculateBadges,
  badgeInfo, calculateBadgesFor, updateBadges, platformStats, search, feedFor, toggleFollow, createNotification,
  getNotifications, markNotification, markAllNotifications, isExpired, renameUser
} from './store.js'
import { hashPassword, verifyPassword, createToken, optionalUser, requireUser, requireAdmin } from './security.js'
import { initRealtime, sendToUser, broadcast } from './realtime.js'
import { executeCode } from './executor.js'
import { cloudflareAccess, cloudflareStatus } from './cloudflare.js'

await initStore()
await ensureAdmin()

const app = express()
const server = http.createServer(app)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
})
const form = upload.none()
const viewSessions = new Map()
const editRate = new Map()

if (config.secretKey === 'change-this-to-a-long-random-secret') console.warn('WARNING: change SECRET_KEY before public deployment')
if (config.adminUsername === 'admin' && config.adminPassword === 'admin123') console.warn('WARNING: change default admin credentials before public deployment')

app.set('trust proxy', config.trustProxy)
app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}))
app.use(compression({ threshold: 1024 }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use('/assets', express.static(config.publicDir, { maxAge: config.nodeEnv === 'production' ? '7d' : 0, etag: true }))
app.use('/profile_pictures', express.static(config.profilePicturesDir, { maxAge: '1d', etag: true }))

const env = nunjucks.configure(config.templatesDir, {
  autoescape: true,
  express: app,
  noCache: config.nodeEnv !== 'production'
})
env.addFilter('date', value => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
})
env.addFilter('day', value => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date)
})
env.addFilter('initial', value => String(value || '?').slice(0, 1).toUpperCase())
env.addFilter('json', value => JSON.stringify(value))
app.set('view engine', 'html')

app.use(cloudflareAccess())

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false })
const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false })
const runnerLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false })
app.use('/api', apiLimiter)

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === '1'
}

function validUsername(value) {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(String(value || ''))
}

function cleanPaste(paste) {
  if (!paste) return paste
  const { password_hash, ...safe } = paste
  return { ...safe, has_password: Boolean(password_hash) }
}

function languageFromFilename(filename, fallback = 'text') {
  const ext = String(filename || '').split('.').pop().toLowerCase()
  const map = {
    py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', html: 'html', htm: 'html', css: 'css',
    java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp', rb: 'ruby', php: 'php', go: 'go', rs: 'rust', kt: 'kotlin', swift: 'swift',
    scala: 'scala', dart: 'dart', sql: 'sql', json: 'json', xml: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini',
    env: 'dotenv', sh: 'bash', bash: 'bash', ps1: 'powershell', bat: 'batch', cmd: 'batch', md: 'markdown', markdown: 'markdown', rst: 'rst',
    tex: 'latex', vue: 'vue', svelte: 'svelte', jsx: 'jsx', tsx: 'tsx', ejs: 'ejs', twig: 'twig', jinja: 'jinja2', pl: 'perl', lua: 'lua',
    r: 'r', erl: 'erlang', ex: 'elixir', clj: 'clojure', hs: 'haskell', ml: 'ocaml'
  }
  return map[ext] || fallback
}

async function renderPaste(req, res, pasteId) {
  const paste = await getPaste(pasteId)
  if (!paste || isExpired(paste)) return res.status(404).render('error.html', { status: 404, message: 'Paste tidak ditemukan atau sudah kedaluwarsa.' })
  if (paste.password_hash) {
    const password = String(req.query.password || '')
    if (!password) return res.render('password.html', { paste_id: pasteId, error: null })
    if (!(await verifyPassword(password, paste.password_hash))) return res.status(401).render('password.html', { paste_id: pasteId, error: 'Password salah.' })
  }

  let sessionId = req.cookies.session_id
  if (!sessionId) {
    sessionId = randomUUID()
    res.cookie('session_id', sessionId, { httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', maxAge: 365 * 24 * 3600 * 1000 })
  }
  const key = `${pasteId}:${sessionId}`
  const last = viewSessions.get(key) || 0
  if (Date.now() - last > 300_000 && !String(req.get('referer') || '').includes(`/edit/${pasteId}`)) {
    paste.views = Number(paste.views || 0) + 1
    await savePaste(pasteId, paste)
    viewSessions.set(key, Date.now())
    broadcast({ type: 'view_update', paste_id: pasteId, views: paste.views })
  }
  if (viewSessions.size > 10_000) {
    const cutoff = Date.now() - 300_000
    for (const [k, time] of viewSessions) if (time < cutoff) viewSessions.delete(k)
  }

  const [threads, owner] = await Promise.all([getThreads(pasteId), getUser(paste.author_username)])
  res.render('paste.html', {
    paste: { ...cleanPaste(paste), author_profile_picture: owner?.profile_picture || null },
    threads
  })
}

app.get('/health', async (req, res) => {
  const stats = await platformStats()
  res.json({ status: 'healthy', runtime: `node ${process.version}`, storage: 'json_files', cloudflare: cloudflareStatus(), ...stats })
})

app.get('/', (req, res) => res.render('index.html'))
app.get('/search', (req, res) => res.render('search.html'))
app.get('/login', (req, res) => res.render('login.html'))
app.get('/signup', (req, res) => res.render('signup.html'))
app.get('/create', (req, res) => res.render('create.html'))
app.get('/dashboard', (req, res) => res.render('dashboard.html'))
app.get('/feed', (req, res) => res.render('feed.html'))
app.get('/edit/:pasteId', (req, res) => res.render('edit.html', { paste_id: req.params.pasteId }))

app.get('/auth/google', (req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) return res.redirect('/login?error=google_not_configured')
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    scope: 'openid email profile',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent'
  })
  res.redirect(`https://accounts.google.com/o/oauth2/auth?${params}`)
})

app.get('/auth/google/callback', async (req, res) => {
  if (req.query.error || !req.query.code) return res.redirect('/login?error=oauth_failed')
  if (!config.googleClientId || !config.googleClientSecret) return res.redirect('/login?error=google_not_configured')
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        code: String(req.query.code),
        grant_type: 'authorization_code',
        redirect_uri: config.googleRedirectUri
      })
    })
    if (!tokenResponse.ok) throw new Error('Google token exchange failed')
    const tokenData = await tokenResponse.json()
    const infoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${tokenData.access_token}` } })
    if (!infoResponse.ok) throw new Error('Google user info failed')
    const google = await infoResponse.json()
    const users = await allUsers()
    let user = users.find(v => v.google_id === google.id || v.email === google.email)
    if (!user) {
      const base = String(google.email || 'user').split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24) || 'user'
      let username = base
      let i = 1
      while (await getUser(username)) username = `${base}${i++}`
      user = {
        id: randomUUID(), username, email: google.email, google_id: google.id, name: google.name || '', picture: google.picture || '',
        created_at: new Date().toISOString(), badges: ['newcomer', 'google_user'], is_admin: false, verified_by_admin: true,
        auth_provider: 'google', profile_picture: google.picture || null, followers: [], following: []
      }
      await saveUser(username, user)
    } else if (!user.google_id) {
      user.google_id = google.id
      user.picture = google.picture || user.picture || ''
      user.profile_picture ||= google.picture || null
      user.auth_provider = 'google'
      user.verified_by_admin = true
      await saveUser(user.username, user)
    }
    const token = createToken(user.username)
    res.render('auth_success.html', { token })
  } catch {
    res.redirect('/login?error=oauth_failed')
  }
})

app.post('/api/signup', authLimiter, form, async (req, res) => {
  const username = String(req.body.username || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = String(req.body.password || '')
  if (!validUsername(username)) return res.status(400).json({ detail: 'Username harus 3-32 karakter dan hanya boleh huruf, angka, titik, strip, atau underscore.' })
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ detail: 'Email tidak valid.' })
  if (password.length < 8) return res.status(400).json({ detail: 'Password minimal 8 karakter.' })
  if (await getUser(username)) return res.status(400).json({ detail: 'Username already exists' })
  const users = await allUsers()
  if (users.some(v => String(v.email || '').toLowerCase() === email)) return res.status(400).json({ detail: 'Email already registered' })
  const user = {
    id: randomUUID(), username, email, password_hash: await hashPassword(password), created_at: new Date().toISOString(), badges: ['newcomer'],
    is_admin: false, verified_by_admin: false, auth_provider: 'local', profile_picture: null, followers: [], following: []
  }
  await saveUser(username, user)
  res.status(201).json({ access_token: createToken(username), token_type: 'bearer' })
})

app.post('/api/login', authLimiter, form, async (req, res) => {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const user = await getUser(username)
  if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ detail: 'Invalid credentials' })
  res.json({ access_token: createToken(username), token_type: 'bearer' })
})

app.get('/api/me', requireUser, async (req, res) => {
  const badges = await calculateBadges(req.user.username)
  res.json({ user: { ...req.user, password_hash: undefined, badges } })
})

app.post('/api/paste', requireUser, upload.single('file'), async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 160)
  if (!title) return res.status(400).json({ detail: 'Title is required' })
  let content = String(req.body.content || '')
  let language = String(req.body.language || 'text').toLowerCase()
  if (req.file) {
    let fileContent
    try { fileContent = req.file.buffer.toString('utf8') } catch { return res.status(400).json({ detail: 'File must be text-based' }) }
    if (fileContent.includes('\u0000')) return res.status(400).json({ detail: 'File must be text-based' })
    content = content ? `${content}\n\n${fileContent}` : fileContent
    if (language === 'text') language = languageFromFilename(req.file.originalname, 'text')
  }
  if (!content.trim()) return res.status(400).json({ detail: 'Content is required' })
  if (content.length > 1_000_000) return res.status(413).json({ detail: 'Paste is too large' })
  const password = String(req.body.password || '')
  const paste = {
    id: randomUUID(), title, content, language, author_id: req.user.id, author_username: req.user.username,
    is_private: bool(req.body.is_private), password_hash: password ? await hashPassword(password) : null,
    views: 0, created_at: new Date().toISOString(), expires_at: null
  }
  await savePaste(paste.id, paste)
  await updateBadges(req.user.username)
  if (!paste.is_private) {
    for (const follower of req.user.followers || []) {
      const notification = await createNotification(follower, 'new_paste', `Paste baru dari ${req.user.username}`, `${req.user.username} membagikan ${language}: ${title}`, { paste_id: paste.id, author: req.user.username })
      sendToUser(follower, { type: 'notification', data: notification })
    }
    broadcast({ type: 'new_paste', paste_id: paste.id, title, author: req.user.username, language })
  }
  res.status(201).json({ paste_id: paste.id })
})

app.get('/paste/:pasteId', (req, res) => renderPaste(req, res, req.params.pasteId))

app.get('/api/dashboard', requireUser, async (req, res) => {
  const pastes = await userPastes(req.user.username)
  const badges = await calculateBadges(req.user.username)
  res.json({
    user: {
      username: req.user.username, email: req.user.email, badges, badge_details: badges.map(badgeInfo), verified_by_admin: Boolean(req.user.verified_by_admin),
      is_admin: Boolean(req.user.is_admin), profile_picture: req.user.profile_picture || null, name: req.user.name || ''
    },
    pastes: pastes.map(p => ({ id: p.id, title: p.title, language: p.language, views: Number(p.views || 0), created_at: p.created_at, is_private: Boolean(p.is_private) })),
    stats: { total_pastes: pastes.length, total_views: pastes.reduce((sum, p) => sum + Number(p.views || 0), 0) }
  })
})

app.post('/api/thread', requireUser, form, async (req, res) => {
  const paste = await getPaste(req.body.paste_id)
  const content = String(req.body.content || '').trim()
  if (!paste) return res.status(404).json({ detail: 'Paste not found' })
  if (!content) return res.status(400).json({ detail: 'Comment cannot be empty' })
  if (content.length > 5000) return res.status(413).json({ detail: 'Comment is too long' })
  const thread = {
    id: randomUUID(), paste_id: paste.id, author_id: req.user.id, author_username: req.user.username, content, created_at: new Date().toISOString()
  }
  await addThread(paste.id, thread)
  res.status(201).json({ thread_id: thread.id })
})

app.post('/api/run-code', runnerLimiter, async (req, res) => {
  const code = String(req.body.code || '')
  if (!code.trim()) return res.status(400).json({ detail: 'No code provided' })
  const result = await executeCode(code, req.body.language || 'text')
  res.json(result)
})

app.get('/api/paste/:pasteId/stats', async (req, res) => {
  const paste = await getPaste(req.params.pasteId)
  if (!paste) return res.status(404).json({ detail: 'Paste not found' })
  res.json({ views: Number(paste.views || 0) })
})

app.get('/user/:username', async (req, res) => {
  const user = await getUser(req.params.username)
  if (!user) return res.status(404).render('error.html', { status: 404, message: 'User tidak ditemukan.' })
  const [pastes, badges] = await Promise.all([userPastes(user.username), calculateBadges(user.username)])
  res.render('user_profile.html', {
    user: {
      username: user.username, name: user.name || '', badges, badge_details: badges.map(badgeInfo), created_at: user.created_at,
      is_admin: Boolean(user.is_admin), verified_by_admin: Boolean(user.verified_by_admin), profile_picture: user.profile_picture || null,
      followers_count: (user.followers || []).length, following_count: (user.following || []).length
    },
    pastes: pastes.filter(p => !p.is_private && !p.password_hash && !isExpired(p)).map(cleanPaste)
  })
})

app.get('/users', async (req, res) => {
  const [users, pastes] = await Promise.all([allUsers(), allPastes()])
  const grouped = new Map()
  for (const paste of pastes) {
    const list = grouped.get(paste.author_username) || []
    list.push(paste)
    grouped.set(paste.author_username, list)
  }
  const enriched = users.map(user => {
    const own = grouped.get(user.username) || []
    const badges = calculateBadgesFor(user, own)
    return {
      username: user.username, email: user.email, created_at: user.created_at, badges, badge_details: badges.map(badgeInfo),
      is_admin: Boolean(user.is_admin), verified_by_admin: Boolean(user.verified_by_admin), profile_picture: user.profile_picture || null,
      paste_count: own.length, followers_count: (user.followers || []).length
    }
  })
  res.render('users.html', { users: enriched })
})

app.put('/api/paste/:pasteId', requireUser, form, async (req, res) => {
  const now = Date.now()
  const edits = (editRate.get(req.user.username) || []).filter(time => now - time < 60_000)
  if (edits.length >= 5) return res.status(429).json({ detail: 'Too many edit requests. Please wait a moment.' })
  edits.push(now)
  editRate.set(req.user.username, edits)
  const paste = await getPaste(req.params.pasteId)
  if (!paste) return res.status(404).json({ detail: 'Paste not found' })
  if (paste.author_username !== req.user.username && !req.user.is_admin) return res.status(403).json({ detail: 'You can only edit your own pastes' })
  paste.title = String(req.body.title || '').trim().slice(0, 160)
  paste.content = String(req.body.content || '')
  paste.language = String(req.body.language || 'text').toLowerCase()
  paste.is_private = bool(req.body.is_private)
  const password = String(req.body.password || '')
  if (password) paste.password_hash = await hashPassword(password)
  else if (bool(req.body.remove_password)) paste.password_hash = null
  paste.updated_at = new Date().toISOString()
  await savePaste(paste.id, paste)
  res.json({ message: 'Paste updated successfully', paste_id: paste.id })
})

app.delete('/api/paste/:pasteId', requireUser, async (req, res) => {
  const paste = await getPaste(req.params.pasteId)
  if (!paste) return res.status(404).json({ detail: 'Paste not found' })
  if (paste.author_username !== req.user.username) return res.status(403).json({ detail: 'You can only delete your own pastes' })
  await deletePasteFiles(paste.id)
  await updateBadges(req.user.username)
  res.json({ message: 'Paste deleted successfully' })
})

app.get('/api/paste/:pasteId/edit', requireUser, async (req, res) => {
  const paste = await getPaste(req.params.pasteId)
  if (!paste) return res.status(404).json({ detail: 'Paste not found' })
  if (paste.author_username !== req.user.username && !req.user.is_admin) return res.status(403).json({ detail: 'You can only edit your own pastes' })
  res.json({ id: paste.id, title: paste.title, content: paste.content, language: paste.language, is_private: Boolean(paste.is_private), has_password: Boolean(paste.password_hash) })
})

app.get('/api/public-pastes', async (req, res) => res.json({ pastes: (await publicPastes(req.query.limit)).map(cleanPaste) }))
app.get('/api/search', async (req, res) => res.json(await search(req.query)))
app.get('/api/feed', requireUser, async (req, res) => res.json(await feedFor(req.user.username, req.query.page, req.query.limit)))

app.post('/api/follow/:username', requireUser, async (req, res) => {
  try {
    const result = await toggleFollow(req.user.username, req.params.username)
    if (!result) return res.status(404).json({ detail: 'User not found' })
    if (result.following) {
      const notification = await createNotification(req.params.username, 'follow', 'Follower baru', `${req.user.username} mulai mengikuti kamu.`, { username: req.user.username })
      sendToUser(req.params.username, { type: 'notification', data: notification })
    }
    res.json(result)
  } catch (error) {
    res.status(400).json({ detail: error.message })
  }
})

app.get('/api/follow/:username/status', requireUser, async (req, res) => {
  res.json({ following: (req.user.following || []).includes(req.params.username) })
})

app.get('/api/admin/users', requireUser, requireAdmin, async (req, res) => {
  const users = await allUsers()
  res.json({ users: users.map(u => ({ username: u.username, email: u.email, created_at: u.created_at, badges: u.badges || [], is_admin: Boolean(u.is_admin), verified_by_admin: Boolean(u.verified_by_admin), profile_picture: u.profile_picture || null })) })
})

app.post('/api/admin/verify-user', requireUser, requireAdmin, form, async (req, res) => {
  const user = await getUser(req.body.username)
  if (!user) return res.status(404).json({ detail: 'User not found' })
  user.verified_by_admin = true
  user.badges = [...new Set([...(user.badges || []), 'verified'])]
  await saveUser(user.username, user)
  res.json({ message: `User ${user.username} has been verified` })
})

app.post('/api/admin/promote-user', requireUser, requireAdmin, form, async (req, res) => {
  const user = await getUser(req.body.username)
  if (!user) return res.status(404).json({ detail: 'User not found' })
  user.is_admin = true
  user.verified_by_admin = true
  user.badges = [...new Set([...(user.badges || []), 'admin', 'verified'])]
  await saveUser(user.username, user)
  res.json({ message: `User ${user.username} has been promoted to admin` })
})

app.get('/api/admin/stats', requireUser, requireAdmin, async (req, res) => res.json(await platformStats()))
app.get('/api/admin/pastes', requireUser, requireAdmin, async (req, res) => {
  const pastes = await allPastes()
  pastes.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  res.json({ pastes: pastes.slice(0, 500).map(cleanPaste) })
})

app.post('/api/profile-picture', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ detail: 'Image is required' })
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '')
  const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
  if (!allowed.has(ext)) return res.status(400).json({ detail: 'Invalid image format' })
  const filename = `${req.user.username}.${ext}`
  await fs.writeFile(path.join(config.profilePicturesDir, filename), req.file.buffer)
  req.user.profile_picture = `/profile_pictures/${filename}`
  await saveUser(req.user.username, req.user)
  res.json({ profile_picture: req.user.profile_picture })
})

app.post('/api/profile/update', requireUser, form, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80)
  const newUsername = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const oldUsername = req.user.username
  if (name) req.user.name = name
  if (password) {
    if (password.length < 8) return res.status(400).json({ detail: 'Password minimal 8 karakter.' })
    req.user.password_hash = await hashPassword(password)
  }
  if (newUsername && newUsername !== oldUsername) {
    if (!validUsername(newUsername)) return res.status(400).json({ detail: 'Username tidak valid.' })
    if (await getUser(newUsername)) return res.status(400).json({ detail: 'Username already exists' })
    if (req.user.profile_picture?.startsWith('/profile_pictures/')) {
      const oldFile = path.join(config.profilePicturesDir, path.basename(req.user.profile_picture))
      const ext = path.extname(oldFile)
      const newFile = path.join(config.profilePicturesDir, `${newUsername}${ext}`)
      try {
        await fs.rename(oldFile, newFile)
        req.user.profile_picture = `/profile_pictures/${newUsername}${ext}`
      } catch {}
    }
    await renameUser(oldUsername, newUsername, req.user)
    return res.json({ message: 'Profile updated successfully', new_token: createToken(newUsername) })
  }
  await saveUser(oldUsername, req.user)
  res.json({ message: 'Profile updated successfully' })
})

app.delete('/api/admin/paste/:pasteId', requireUser, requireAdmin, async (req, res) => {
  const paste = await getPaste(req.params.pasteId)
  if (!paste) return res.status(404).json({ detail: 'Paste not found' })
  await deletePasteFiles(paste.id)
  res.json({ message: 'Paste deleted successfully by admin' })
})

app.delete('/api/admin/user/:username', requireUser, requireAdmin, async (req, res) => {
  if (req.params.username === req.user.username) return res.status(400).json({ detail: 'Cannot delete your own account' })
  const user = await getUser(req.params.username)
  if (!user) return res.status(404).json({ detail: 'User not found' })
  const pastes = await userPastes(user.username)
  await Promise.all(pastes.map(p => deletePasteFiles(p.id)))
  await deleteUserFile(user.username)
  const remainingUsers = await allUsers()
  await Promise.all(remainingUsers.map(async other => {
    const following = Array.isArray(other.following) ? other.following : []
    const followers = Array.isArray(other.followers) ? other.followers : []
    const nextFollowing = following.filter(name => name !== user.username)
    const nextFollowers = followers.filter(name => name !== user.username)
    if (nextFollowing.length !== following.length || nextFollowers.length !== followers.length) {
      other.following = nextFollowing
      other.followers = nextFollowers
      await saveUser(other.username, other)
    }
  }))
  await fs.rm(path.join(config.notificationsDir, `${user.username}.json`), { force: true })
  if (user.profile_picture?.startsWith('/profile_pictures/')) await fs.rm(path.join(config.profilePicturesDir, path.basename(user.profile_picture)), { force: true })
  res.json({ message: `User ${user.username} and all their content deleted successfully` })
})

app.get('/api/notifications', requireUser, async (req, res) => res.json({ notifications: await getNotifications(req.user.username) }))
app.post('/api/notifications/:id/read', requireUser, async (req, res) => {
  await markNotification(req.user.username, req.params.id)
  res.json({ message: 'Notification marked as read' })
})
app.post('/api/notifications/read-all', requireUser, async (req, res) => {
  await markAllNotifications(req.user.username)
  res.json({ message: 'All notifications marked as read' })
})

app.get('/:pasteId', (req, res, next) => {
  if (!/^[0-9a-fA-F-]{32,36}$/.test(req.params.pasteId)) return next()
  return renderPaste(req, res, req.params.pasteId)
})

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ detail: 'Not found' })
  res.status(404).render('error.html', { status: 404, message: 'Halaman tidak ditemukan.' })
})

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ detail: error.message })
  console.error(error)
  if (res.headersSent) return next(error)
  if (req.path.startsWith('/api/')) return res.status(500).json({ detail: 'Internal server error' })
  res.status(500).render('error.html', { status: 500, message: 'Terjadi kesalahan pada server.' })
})

initRealtime(server)
server.listen(config.port, config.host, () => {
  console.log(`CodeShare Node.js ${process.version} running at http://${config.host}:${config.port}`)
  console.log(`Public base URL: ${config.publicBaseUrl}`)
  if (config.cfAccessEnabled) console.log(`Cloudflare Access active for: ${config.cfAccessProtectedPaths.join(', ')}`)
})
