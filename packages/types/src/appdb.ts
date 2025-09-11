export interface UserRecord {
  id: string
  email: string
  createdAt: string
}

export interface UserConnectionRecord {
  id: string
  userId: string
  alias: string
  dsnCipher: string // AES-256-GCM(iv+tag+ct base64)
  createdAt: string
  lastUsedAt?: string
}

