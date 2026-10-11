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

const root = process.cwd()
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'https://cnodeshare.vercel.app').replace(/\/+$/, '')
const nodeEnv = process.env.NODE_ENV || 'production'

const config = {
  root,
  publicBaseUrl,
  host: '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  nodeEnv,
  secretKey: process.env.SECRET_KEY || 'change-this-to-a-long-random-secret',
  tokenMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 30),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@codeshare.local',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || `${publicBaseUrl}/auth/google/callback`,
  enableCodeRunner: String(process.env.ENABLE_CODE_RUNNER || 'false').toLowerCase() === 'true',
  trustProxy: 1,
  cfAccessEnabled: String(process.env.CF_ACCESS_ENABLED || 'false').toLowerCase() === 'true',
  cfAccessTeamDomain: (process.env.CF_ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, ''),
  cfAccessAud: process.env.CF_ACCESS_AUD || '',
  cfAccessProtectedPaths: String(process.env.CF_ACCESS_PROTECTED_PATHS || '/dashboard,/api/admin')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  dataDir: path.join(root, 'data'),
  usersDir: path.join(root, 'data', 'users'),
  codesDir: path.join(root, 'data', 'codes'),
  threadsDir: path.join(root, 'data', 'threads'),
  notificationsDir: path.join(root, 'data', 'notifications'),
  profilePicturesDir: path.join(root, 'data', 'profile_pictures'),
  publicDir: path.join(root, 'public'),
  templatesDir: path.join(root, 'templates')
}

async function initStore() {
  const dirs = [config.dataDir, config.usersDir, config.codesDir, config.threadsDir, config.notificationsDir, config.profilePicturesDir]
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {}
  }
}

async function getUser(username) {
  try {
    const data = await fs.readFile(path.join(config.usersDir, `${username}.json`), 'utf8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function saveUser(username, user) {
  await fs.writeFile(path.join(config.usersDir, `${username}.json`), JSON.stringify(user, null, 2))
}

async function getPaste(pasteId) {
  try {
    const data = await fs.readFile(path.join(config.codesDir, `${pasteId}.json`), 'utf8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function savePaste(pasteId, paste) {
  await fs.writeFile(path.join(config.codesDir, `${pasteId}.json`), JSON.stringify(paste, null, 2))
}

async function ensureAdmin() {
  const admin = await getUser(config.adminUsername)
  if (!admin) {
    const bcryptjs = await import('bcryptjs')
    const hash = await bcryptjs.hash(config.adminPassword, 10)
    const adminUser = {
      id: randomUUID(),
      username: config.adminUsername,
      email: config.adminEmail,
      password_hash: hash,
      created_at: new Date().toISOString(),
      badges: ['admin'],
      is_admin: true,
      verified_by_admin: true,
      auth_provider: 'local',
      profile_picture: null,
      followers: [],
      following: []
    }
    await saveUser(config.adminUsername, adminUser)
  }
}

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
})
const form = upload.none()
const viewSessions = new Map()

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}))
app.use(compression({ threshold: 1024 }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))

if (nodeEnv !== 'production') {
  app.use('/assets', express.static(config.publicDir, { maxAge: 0, etag: true }))
  app.use('/profile_pictures', express.static(config.profilePicturesDir, { maxAge: '1d', etag: true }))
}

const env = nunjucks.configure(config.templatesDir, {
  autoescape: true,
  express: app,
  noCache: nodeEnv !== 'production'
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

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false })
const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false })
app.use('/api', apiLimiter)

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === '1'
}

async function initializeApp() {
  await initStore()
  await ensureAdmin()
}

app.get('/health', async (req, res) => {
  res.json({ status: 'healthy', runtime: `node ${process.version}` })
})

app.get('/', (req, res) => res.render('index.html'))
app.get('/search', (req, res) => res.render('search.html'))
app.get('/login', (req, res) => res.render('login.html'))
app.get('/signup', (req, res) => res.render('signup.html'))
app.get('/create', (req, res) => res.render('create.html'))
app.get('/dashboard', (req, res) => res.render('dashboard.html'))
app.get('/feed', (req, res) => res.render('feed.html'))

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

await initializeApp()

export default app
