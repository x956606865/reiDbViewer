import crypto from 'crypto'

function getKey(): Buffer {
  const b64 = process.env.APP_ENCRYPTION_KEY || ''
  if (!b64) throw new Error('APP_ENCRYPTION_KEY not configured')
  const raw = Buffer.from(b64, 'base64')
  if (raw.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)')
  return raw
}

export function encryptToBase64(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptFromBase64(b64: string): string {
  const key = getKey()
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

