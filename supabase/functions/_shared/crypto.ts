/**
 * Luzerge — Shared Cryptography Utilities
 *
 * Layer 1: HMAC-SHA256 with server pepper + per-token salt (for API tokens)
 * Layer 2: AES-256-GCM encryption at rest (for stored CDN credentials)
 * Layer 3: TLS in transit (handled by infrastructure)
 */

// ─── Environment ────────────────────────────────────────────────────────────

function getEncryptionKey(): string {
  const key = Deno.env.get('ENCRYPTION_KEY')
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be set (min 32 chars)')
  }
  return key
}

function getHmacPepper(): string {
  const pepper = Deno.env.get('HMAC_PEPPER')
  if (!pepper || pepper.length < 32) {
    throw new Error('HMAC_PEPPER must be set (min 32 chars)')
  }
  return pepper
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

// ─── Layer 1: HMAC-SHA256 with Pepper + Salt (for API token hashing) ───────

/**
 * Generate a random 16-byte salt as hex string
 */
export function generateSalt(): string {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  return bufToHex(salt.buffer)
}

/**
 * Hash an API token with HMAC-SHA256 using server pepper + per-token salt.
 *
 * hash = HMAC-SHA256(pepper, salt + rawToken)
 *
 * This means:
 *   - Even if DB is dumped, hashes can't be reversed without the pepper
 *   - Per-token salt prevents rainbow table attacks
 *   - HMAC prevents length-extension attacks vs plain SHA-256
 */
export async function hmacHashToken(rawToken: string, salt: string): Promise<string> {
  const pepper = getHmacPepper()
  const encoder = new TextEncoder()

  // Import pepper as HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // HMAC-SHA256(pepper, salt + token)
  const message = encoder.encode(salt + rawToken)
  const signature = await crypto.subtle.sign('HMAC', key, message)

  return bufToHex(signature)
}

/**
 * Verify a raw token against a stored hash + salt
 */
export async function verifyToken(rawToken: string, salt: string, storedHash: string): Promise<boolean> {
  const computed = await hmacHashToken(rawToken, salt)
  // Constant-time comparison to prevent timing attacks
  if (computed.length !== storedHash.length) return false
  let result = 0
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i)
  }
  return result === 0
}

// ─── Layer 2: AES-256-GCM Encryption at Rest (for CDN credentials) ─────────

/**
 * Derive a 256-bit AES key from the encryption key using HKDF.
 * This allows the ENCRYPTION_KEY env var to be any length >= 32.
 */
async function deriveAesKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const rawKey = encoder.encode(getEncryptionKey())

  // Import as HKDF base key
  const baseKey = await crypto.subtle.importKey(
    'raw', rawKey, 'HKDF', false, ['deriveKey']
  )

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('luzerge-aes-v1'),  // static salt for key derivation
      info: encoder.encode('cdn-credentials'),   // context binding
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * Returns: "iv_hex:ciphertext_hex:tag" (IV is random per encryption)
 *
 * - 12-byte random IV (nonce) per encryption — never reused
 * - 128-bit authentication tag — integrity + authenticity
 * - Even identical plaintexts produce different ciphertexts
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await deriveAesKey()
  const encoder = new TextEncoder()

  // 12-byte random IV (NIST recommended for GCM)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoder.encode(plaintext)
  )

  // Format: iv_hex:ciphertext_hex
  return bufToHex(iv.buffer) + ':' + bufToHex(ciphertext)
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 *
 * Input format: "iv_hex:ciphertext_hex" (as produced by encrypt())
 */
export async function decrypt(encrypted: string): Promise<string> {
  const key = await deriveAesKey()
  const decoder = new TextDecoder()

  const parts = encrypted.split(':')
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted format')
  }

  const iv = hexToBuf(parts[0])
  const ciphertext = hexToBuf(parts[1])

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext
  )

  return decoder.decode(plaintext)
}

/**
 * Check if a value looks like it's already encrypted (iv:ciphertext format)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false
  const parts = value.split(':')
  // Encrypted format: 24-char hex IV + ":" + variable-length hex ciphertext
  return parts.length === 2 && /^[0-9a-f]{24}$/.test(parts[0]) && /^[0-9a-f]+$/.test(parts[1])
}
