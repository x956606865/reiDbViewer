// Lightweight AES-256-GCM helpers using Web Crypto API

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function b64encode(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64decode(str: string): Uint8Array {
  const bin = atob(str)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export type AesCipher = { alg: 'A256GCM'; iv: string; ct: string }

export async function importAesKey(rawBase64: string): Promise<CryptoKey> {
  const raw = b64decode(rawBase64)
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function exportAesKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  return b64encode(raw)
}

export async function aesEncryptString(key: CryptoKey, plaintext: string): Promise<AesCipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = toBytes(plaintext)
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { alg: 'A256GCM', iv: b64encode(iv), ct: b64encode(new Uint8Array(ctBuf)) }
}

export async function aesDecryptToString(key: CryptoKey, cipher: AesCipher): Promise<string> {
  const iv = b64decode(cipher.iv)
  const ct = b64decode(cipher.ct)
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return fromBytes(new Uint8Array(ptBuf))
}

