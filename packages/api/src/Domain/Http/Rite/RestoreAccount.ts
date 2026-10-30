import { createEmptyVault, VaultState } from './VaultTypes'

export type AccountToRestore = {
  userUuid: string
  email: string
  /** The Argon2id-derived server password the device holds in its root key (not the real password). */
  serverPassword: string
  /** The account's root key parameters (identifier, pw_nonce, version…), exactly as the device has them. */
  keyParams: Record<string, unknown>
  session: {
    accessToken: string
    refreshToken: string
    /** Milliseconds since epoch */
    accessExpiration: number
    /** Milliseconds since epoch */
    refreshExpiration: number
  }
  deviceInfo?: string
}

/**
 * Puts a signed-in device's Rite account back into a vault that lost it (or never had it), so
 * the device can re-upload all its notes. The same email, password and encryption keys keep
 * working: the account record is rebuilt from what the device already holds.
 *
 * Returns undefined if the vault already contains this account (nothing to restore).
 */
export async function restoreAccountIntoVault(
  existing: VaultState | undefined,
  account: AccountToRestore,
): Promise<VaultState | undefined> {
  const state = existing ?? createEmptyVault()
  const email = account.email.trim().toLowerCase()

  if (state.users.some((user) => user.email === email || user.uuid === account.userUuid)) {
    return undefined
  }

  const passwordSalt = randomHex(16)
  const now = new Date().toISOString()
  state.users.push({
    uuid: account.userUuid,
    email,
    passwordSalt,
    // Same formula the sync server uses when an account is created.
    passwordHash: await sha256Hex(`${passwordSalt}:${account.serverPassword}`),
    keyParams: { ...account.keyParams, identifier: account.keyParams.identifier ?? email },
    createdAt: now,
  })
  state.sessions.push({
    uuid: randomUuid(),
    userUuid: account.userUuid,
    accessToken: account.session.accessToken,
    refreshToken: account.session.refreshToken,
    accessExpiration: account.session.accessExpiration,
    refreshExpiration: account.session.refreshExpiration,
    readonlyAccess: false,
    createdAt: now,
    deviceInfo: account.deviceInfo ?? 'Rite',
  })
  delete state.movedTo
  return state
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomUuid(): string {
  const hex = randomHex(16).split('')
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
