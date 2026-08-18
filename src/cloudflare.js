import { createPublicKey } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

const KEY_TTL = 3_600_000
const keys = new Map()
let fetchedAt = 0

const issuer = () => config.cfAccessTeamDomain

async function loadKeys(force = false) {
  if (!force && keys.size && Date.now() - fetchedAt < KEY_TTL) return keys
  const response = await fetch(`${issuer()}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error(`Cloudflare Access JWKS request failed (${response.status})`)
  const data = await response.json()
  keys.clear()
  for (const jwk of data.keys || []) keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }))
  fetchedAt = Date.now()
  return keys
}

function tokenFromRequest(req) {
  return req.headers['cf-access-jwt-assertion'] || req.cookies?.CF_Authorization || null
}

export async function verifyAccessToken(token) {
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded?.header?.kid) throw new Error('Cloudflare Access token is malformed')
  let key = (await loadKeys()).get(decoded.header.kid)
  if (!key) key = (await loadKeys(true)).get(decoded.header.kid)
  if (!key) throw new Error('Cloudflare Access signing key not found')
  return jwt.verify(token, key, { algorithms: ['RS256'], audience: config.cfAccessAud, issuer: issuer() })
}

function isProtected(pathname) {
  return config.cfAccessProtectedPaths.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function deny(req, res, reason) {
  if (req.path.startsWith('/api/')) return res.status(403).json({ detail: `Cloudflare Access required: ${reason}` })
  res.status(403).render('error.html', { status: 403, message: 'Halaman ini dilindungi Cloudflare Zero Trust.' })
}

export function cloudflareAccess() {
  if (!config.cfAccessEnabled) return (req, res, next) => next()
  if (!config.cfAccessTeamDomain || !config.cfAccessAud) {
    console.warn('WARNING: CF_ACCESS_ENABLED=true but CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD is empty, Access check disabled')
    return (req, res, next) => next()
  }
  return async (req, res, next) => {
    if (!isProtected(req.path)) return next()
    const token = tokenFromRequest(req)
    if (!token) return deny(req, res, 'assertion header or CF_Authorization cookie is missing')
    try {
      req.cfAccess = await verifyAccessToken(token)
      next()
    } catch (error) {
      deny(req, res, error.message)
    }
  }
}

export function cloudflareStatus() {
  return {
    access_enabled: config.cfAccessEnabled,
    team_domain: config.cfAccessTeamDomain || null,
    protected_paths: config.cfAccessEnabled ? config.cfAccessProtectedPaths : []
  }
}
