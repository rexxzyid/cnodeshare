import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { config } from './config.js'

export async function executeCode(code, language) {
  if (!config.enableCodeRunner) return { output: 'Code runner is disabled by server configuration.', error: true }
  if (String(language).toLowerCase() !== 'javascript') return { output: 'Only JavaScript execution is supported by the Node.js runner.', error: true }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeshare-'))
  const file = path.join(dir, 'code.mjs')
  await fs.writeFile(file, String(code), 'utf8')
  try {
    return await new Promise(resolve => {
      const child = spawn(process.execPath, ['--max-old-space-size=64', '--disable-proto=throw', file], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH || '', NODE_NO_WARNINGS: '1' }
      })
      let stdout = ''
      let stderr = ''
      const cap = chunk => String(chunk).slice(0, 128 * 1024)
      child.stdout.on('data', chunk => { if (stdout.length < 128 * 1024) stdout += cap(chunk) })
      child.stderr.on('data', chunk => { if (stderr.length < 128 * 1024) stderr += cap(chunk) })
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.on('close', code => {
        clearTimeout(timer)
        const failed = code !== 0
        resolve({ output: failed ? (stderr || `Process exited with code ${code}`) : stdout, error: failed })
      })
      child.on('error', error => {
        clearTimeout(timer)
        resolve({ output: error.message, error: true })
      })
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
