import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { config } from './config.js'

const jsonCache = new Map()
const editLocks = new Map()

const safeName = value => String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '')
const clone = value => structuredClone(value)

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson(file, fallback = {}) {
  try {
    const stat = await fs.stat(file)
    const cached = jsonCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) return clone(cached.value)
    const raw = await fs.readFile(file, 'utf8')
    const value = JSON.parse(raw)
    jsonCache.set(file, { mtimeMs: stat.mtimeMs, value })
    return clone(value)
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return clone(fallback)
    throw error
  }
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = JSON.stringify(value, null, 2)
  await fs.writeFile(tmp, body, 'utf8')
  await fs.rename(tmp, file)
  const stat = await fs.stat(file)
  jsonCache.set(file, { mtimeMs: stat.mtimeMs, value: clone(value) })
}

async function withLock(key, task) {
  const previous = editLocks.get(key) || Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  editLocks.set(key, next)
  try {
    return await next
  } finally {
    if (editLocks.get(key) === next) editLocks.delete(key)
  }
}

async function listJson(dir) {
  try {
    const files = await fs.readdir(dir, { withFileTypes: true })
    return files.filter(v => v.isFile() && v.name.endsWith('.json')).map(v => path.join(dir, v.name))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export async function initStore() {
  await Promise.all([
    ensureDir(config.usersDir),
    ensureDir(config.codesDir),
    ensureDir(config.threadsDir),
    ensureDir(config.notificationsDir),
    ensureDir(config.profilePicturesDir)
  ])
}

export async function getUser(username) {
  const name = safeName(username)
  if (!name) return null
  const value = await readJson(path.join(config.usersDir, `${name}.json`), {})
  return Object.keys(value).length ? value : null
}

export async function saveUser(username, value) {
  const name = safeName(username)
  if (!name) throw new Error('Invalid username')
  await writeJson(path.join(config.usersDir, `${name}.json`), value)
}

export async function deleteUserFile(username) {
  const file = path.join(config.usersDir, `${safeName(username)}.json`)
  jsonCache.delete(file)
  await fs.rm(file, { force: true })
}

export async function getPaste(id) {
  const name = safeName(id)
  if (!name) return null
  const value = await readJson(path.join(config.codesDir, `${name}.json`), {})
  return Object.keys(value).length ? value : null
}

export async function savePaste(id, value) {
  await writeJson(path.join(config.codesDir, `${safeName(id)}.json`), value)
}

export async function deletePasteFiles(id) {
  const name = safeName(id)
  const codeFile = path.join(config.codesDir, `${name}.json`)
  const threadFile = path.join(config.threadsDir, `${name}.json`)
  jsonCache.delete(codeFile)
  jsonCache.delete(threadFile)
  await Promise.all([fs.rm(codeFile, { force: true }), fs.rm(threadFile, { force: true })])
}

export async function allUsers() {
  const files = await listJson(config.usersDir)
  const users = (await Promise.all(files.map(file => readJson(file, {})))).filter(v => Object.keys(v).length)
  return users.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

export async function allPastes() {
  const files = await listJson(config.codesDir)
  const pastes = (await Promise.all(files.map(file => readJson(file, {})))).filter(v => Object.keys(v).length)
  return pastes
}

export async function userPastes(username) {
  const values = await allPastes()
  return values.filter(v => v.author_username === username).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

export async function publicPastes(limit = 10) {
  const values = await allPastes()
  return values
    .filter(v => !v.is_private && !v.password_hash && !isExpired(v))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 100)))
}

export async function getThreads(pasteId) {
  const value = await readJson(path.join(config.threadsDir, `${safeName(pasteId)}.json`), { threads: [] })
  return Array.isArray(value.threads) ? value.threads : []
}

export async function addThread(pasteId, thread) {
  const file = path.join(config.threadsDir, `${safeName(pasteId)}.json`)
  return withLock(file, async () => {
    const value = await readJson(file, { threads: [] })
    value.threads = Array.isArray(value.threads) ? value.threads : []
    value.threads.push(thread)
    await writeJson(file, value)
    return thread
  })
}

export async function getNotifications(username) {
  const value = await readJson(path.join(config.notificationsDir, `${safeName(username)}.json`), { notifications: [] })
  return Array.isArray(value.notifications) ? value.notifications : []
}

export async function createNotification(username, type, title, message, data = {}) {
  const file = path.join(config.notificationsDir, `${safeName(username)}.json`)
  return withLock(file, async () => {
    const value = await readJson(file, { notifications: [] })
    const notification = {
      id: randomUUID(),
      user_id: username,
      type,
      title,
      message,
      data,
      read: false,
      created_at: new Date().toISOString()
    }
    value.notifications = [notification, ...(value.notifications || [])].slice(0, 50)
    await writeJson(file, value)
    return notification
  })
}

export async function markNotification(username, id) {
  const file = path.join(config.notificationsDir, `${safeName(username)}.json`)
  return withLock(file, async () => {
    const value = await readJson(file, { notifications: [] })
    for (const item of value.notifications || []) if (item.id === id) item.read = true
    await writeJson(file, value)
  })
}

export async function markAllNotifications(username) {
  const file = path.join(config.notificationsDir, `${safeName(username)}.json`)
  return withLock(file, async () => {
    const value = await readJson(file, { notifications: [] })
    for (const item of value.notifications || []) item.read = true
    await writeJson(file, value)
  })
}

export function isExpired(paste) {
  if (!paste?.expires_at) return false
  return Date.now() > Date.parse(paste.expires_at)
}

export function badgeInfo(badge) {
  const map = {
    newcomer: { name: 'Newcomer', icon: '🌱', verified: false },
    member: { name: 'Member', icon: '👤', verified: false },
    verified: { name: 'Verified', icon: '✓', verified: true },
    pro: { name: 'Pro', icon: '★', verified: false },
    expert: { name: 'Expert', icon: '🏆', verified: false },
    legend: { name: 'Legend', icon: '👑', verified: false },
    popular: { name: 'Popular', icon: '🔥', verified: false },
    prolific: { name: 'Prolific', icon: '✎', verified: false },
    admin: { name: 'Admin', icon: '◆', verified: true },
    google_user: { name: 'Google', icon: 'G', verified: true }
  }
  return { key: badge, ...(map[badge] || { name: String(badge), icon: '•', verified: false }) }
}

export function calculateBadgesFor(user, pastes = []) {
  if (!user) return ['newcomer']
  const total = pastes.length
  const views = pastes.reduce((sum, p) => sum + Number(p.views || 0), 0)
  const badges = []
  if (user.is_admin) badges.push('admin')
  if (user.verified_by_admin) badges.push('verified')
  if (total >= 50 && views >= 10000) badges.push('legend')
  else if (total >= 25 && views >= 5000) badges.push('expert')
  else if (total >= 15 && views >= 2000) badges.push('pro')
  else if (total >= 8 && views >= 500 && !badges.includes('verified')) badges.push('verified')
  else if (total >= 3 && views >= 100) badges.push('member')
  else if (!badges.length) badges.push('newcomer')
  if (views >= 1000) badges.push('popular')
  if (total >= 10) badges.push('prolific')
  if (user.auth_provider === 'google') badges.push('google_user')
  return [...new Set(badges)]
}

export async function calculateBadges(username) {
  const [user, pastes] = await Promise.all([getUser(username), userPastes(username)])
  return calculateBadgesFor(user, pastes)
}

export async function updateBadges(username) {
  const user = await getUser(username)
  if (!user) return null
  user.badges = await calculateBadges(username)
  await saveUser(username, user)
  return user.badges
}

export async function ensureAdmin() {
  const existing = await getUser(config.adminUsername)
  if (existing) return existing
  const user = {
    id: randomUUID(),
    username: config.adminUsername,
    email: config.adminEmail,
    password_hash: await bcrypt.hash(config.adminPassword, 12),
    created_at: new Date().toISOString(),
    badges: ['admin', 'verified', 'legend'],
    is_admin: true,
    verified_by_admin: true,
    auth_provider: 'local',
    profile_picture: null,
    followers: [],
    following: []
  }
  await saveUser(user.username, user)
  return user
}

export async function platformStats() {
  const [users, pastes] = await Promise.all([allUsers(), allPastes()])
  return {
    total_users: users.length,
    total_pastes: pastes.length,
    total_views: pastes.reduce((sum, p) => sum + Number(p.views || 0), 0)
  }
}

export async function search(query = {}) {
  const q = String(query.q || '').trim().toLowerCase()
  const language = String(query.language || '').trim().toLowerCase()
  const author = String(query.author || '').trim().toLowerCase()
  const sort = String(query.sort || 'newest')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.max(1, Math.min(Number(query.limit) || 20, 100))
  const [pastes, users] = await Promise.all([allPastes(), allUsers()])
  const usersByName = new Map(users.map(user => [user.username, user]))
  const activity = new Map()
  for (const paste of pastes) {
    const list = activity.get(paste.author_username) || []
    list.push(paste)
    activity.set(paste.author_username, list)
  }

  const pasteResults = []
  for (const paste of pastes) {
    if (paste.is_private || paste.password_hash || isExpired(paste)) continue
    const haystack = `${paste.title || ''}\n${paste.content || ''}\n${paste.author_username || ''}\n${paste.language || ''}`.toLowerCase()
    if (q && !haystack.includes(q)) continue
    if (language && String(paste.language || '').toLowerCase() !== language) continue
    if (author && String(paste.author_username || '').toLowerCase() !== author) continue
    const owner = usersByName.get(paste.author_username)
    const badges = calculateBadgesFor(owner, activity.get(paste.author_username) || [])
    pasteResults.push({
      ...paste,
      type: 'paste',
      author_is_verified: Boolean(owner?.verified_by_admin || owner?.is_admin),
      author_is_admin: Boolean(owner?.is_admin),
      author_badge_details: badges.map(badgeInfo)
    })
  }

  if (sort === 'oldest') pasteResults.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  else if (sort === 'most_viewed') pasteResults.sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
  else if (sort === 'title') pasteResults.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
  else pasteResults.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

  const userResults = []
  if (q) {
    for (const user of users) {
      if (!String(user.username || '').toLowerCase().includes(q)) continue
      const own = activity.get(user.username) || []
      const badges = calculateBadgesFor(user, own)
      userResults.push({
        username: user.username,
        badges,
        badge_details: badges.map(badgeInfo),
        is_verified: Boolean(user.verified_by_admin || user.is_admin),
        is_admin: Boolean(user.is_admin),
        paste_count: own.length,
        created_at: user.created_at,
        profile_picture: user.profile_picture || null,
        type: 'user'
      })
    }
  }

  userResults.sort((a, b) => a.username.localeCompare(b.username))
  const all = [...userResults, ...pasteResults]
  const start = (page - 1) * limit
  return {
    results: all.slice(start, start + limit),
    total: all.length,
    page,
    pages: Math.ceil(all.length / limit),
    limit
  }
}

export async function feedFor(username, page = 1, limit = 10) {
  const user = await getUser(username)
  const following = new Set(user?.following || [])
  if (!following.size) return { pastes: [], total: 0, page, pages: 0 }
  const values = (await allPastes())
    .filter(p => following.has(p.author_username) && !p.is_private && !p.password_hash && !isExpired(p))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50))
  const start = (safePage - 1) * safeLimit
  return { pastes: values.slice(start, start + safeLimit), total: values.length, page: safePage, pages: Math.ceil(values.length / safeLimit) }
}

export async function toggleFollow(actor, target) {
  if (actor === target) throw new Error('You cannot follow yourself')
  return withLock(`follow:${[actor, target].sort().join(':')}`, async () => {
    const [me, other] = await Promise.all([getUser(actor), getUser(target)])
    if (!me || !other) return null
    me.following = Array.isArray(me.following) ? me.following : []
    other.followers = Array.isArray(other.followers) ? other.followers : []
    const following = !me.following.includes(target)
    if (following) {
      me.following.push(target)
      if (!other.followers.includes(actor)) other.followers.push(actor)
    } else {
      me.following = me.following.filter(v => v !== target)
      other.followers = other.followers.filter(v => v !== actor)
    }
    await Promise.all([saveUser(actor, me), saveUser(target, other)])
    return { following, followers: other.followers.length }
  })
}

export async function renameUser(oldName, newName, user) {
  const oldSafe = safeName(oldName)
  const newSafe = safeName(newName)
  if (!newSafe || newSafe !== newName) throw new Error('Invalid username')
  user.username = newName
  await saveUser(newName, user)
  if (oldName !== newName) await deleteUserFile(oldName)
  const [pastes, users, threadFiles] = await Promise.all([allPastes(), allUsers(), listJson(config.threadsDir)])
  await Promise.all(pastes.filter(p => p.author_username === oldName).map(p => {
    p.author_username = newName
    return savePaste(p.id, p)
  }))
  await Promise.all(users.filter(u => u.username !== newName).map(async u => {
    let changed = false
    if (Array.isArray(u.following) && u.following.includes(oldName)) {
      u.following = u.following.map(v => v === oldName ? newName : v)
      changed = true
    }
    if (Array.isArray(u.followers) && u.followers.includes(oldName)) {
      u.followers = u.followers.map(v => v === oldName ? newName : v)
      changed = true
    }
    if (changed) await saveUser(u.username, u)
  }))
  await Promise.all(threadFiles.map(async file => {
    const data = await readJson(file, { threads: [] })
    let changed = false
    for (const thread of data.threads || []) {
      if (thread.author_username === oldName) {
        thread.author_username = newName
        changed = true
      }
    }
    if (changed) await writeJson(file, data)
  }))
  if (oldSafe !== newSafe) {
    const oldNotifications = path.join(config.notificationsDir, `${oldSafe}.json`)
    const newNotifications = path.join(config.notificationsDir, `${newSafe}.json`)
    try {
      await fs.rename(oldNotifications, newNotifications)
      jsonCache.delete(oldNotifications)
      jsonCache.delete(newNotifications)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

export { readJson, writeJson, safeName }
