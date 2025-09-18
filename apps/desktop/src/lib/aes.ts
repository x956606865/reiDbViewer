// Lightweight AES-256-GCM helpers using Web Crypto API

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function b64encode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function b64decode(str: string): Uint8Array {
  const bin = atob(str)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) {
    const code = bin.charCodeAt(i)
    bytes[i] = code
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer
    }
    return buffer.slice(byteOffset, byteOffset + byteLength)
  }
  const copy = new Uint8Array(byteLength)
  copy.set(bytes)
  return copy.buffer
}

export type AesCipher = { alg: 'A256GCM'; iv: string; ct: string }

function getCrypto(): Crypto {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi) {
    throw new Error('Web Crypto API is not available in this environment')
  }
  return cryptoApi
}

export async function importAesKey(rawBase64: string): Promise<CryptoKey> {
  const raw = b64decode(rawBase64)
  const cryptoApi = getCrypto()
  return await cryptoApi.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function exportAesKey(key: CryptoKey): Promise<string> {
  const cryptoApi = getCrypto()
  const raw = new Uint8Array(await cryptoApi.subtle.exportKey('raw', key))
  return b64encode(raw)
}

export async function aesEncryptString(key: CryptoKey, plaintext: string): Promise<AesCipher> {
  const cryptoApi = getCrypto()
  const ivBytes = cryptoApi.getRandomValues(new Uint8Array(12))
  const data = toBytes(plaintext)
  const ctBuf = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(ivBytes) },
    key,
    toArrayBuffer(data),
  )
  return { alg: 'A256GCM', iv: b64encode(ivBytes), ct: b64encode(new Uint8Array(ctBuf)) }
}

export async function aesDecryptToString(key: CryptoKey, cipher: AesCipher): Promise<string> {
  const cryptoApi = getCrypto()
  const iv = b64decode(cipher.iv)
  const ct = b64decode(cipher.ct)
  const ptBuf = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct),
  )
  return fromBytes(new Uint8Array(ptBuf))
}
