import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { getUser } from './store.js'

export const hashPassword = password => bcrypt.hash(String(password), 12)
export const verifyPassword = (plain, hash) => bcrypt.compare(String(plain), String(hash || ''))

export function createToken(username) {
  return jwt.sign({ sub: username }, config.secretKey, { algorithm: 'HS256', expiresIn: `${config.tokenMinutes}m` })
}

export function tokenFromRequest(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return req.cookies?.access_token || null
}

export function decodeToken(token) {
  return jwt.verify(token, config.secretKey, { algorithms: ['HS256'] })
}

export async function optionalUser(req) {
  try {
    const token = tokenFromRequest(req)
    if (!token) return null
    const payload = decodeToken(token)
    const user = await getUser(payload.sub)
    return user || null
  } catch {
    return null
  }
}

export async function requireUser(req, res, next) {
  const user = await optionalUser(req)
  if (!user) return res.status(401).json({ detail: 'Invalid or missing token' })
  req.user = user
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ detail: 'Admin access required' })
  next()
}
