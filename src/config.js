import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:8700').replace(/\/+$/, '')
const teamDomain = (process.env.CF_ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '')

export const config = {
  root,
  publicBaseUrl,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8700),
  nodeEnv: process.env.NODE_ENV || 'development',
  secretKey: process.env.SECRET_KEY || 'change-this-to-a-long-random-secret',
  tokenMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 30),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@codeshare.local',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || `${publicBaseUrl}/auth/google/callback`,
  enableCodeRunner: String(process.env.ENABLE_CODE_RUNNER || 'false').toLowerCase() === 'true',
  trustProxy: Number(process.env.TRUST_PROXY || 1),
  cfAccessEnabled: String(process.env.CF_ACCESS_ENABLED || 'false').toLowerCase() === 'true',
  cfAccessTeamDomain: teamDomain,
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
