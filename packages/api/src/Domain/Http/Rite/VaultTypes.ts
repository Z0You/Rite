/**
 * Rite vault format.
 *
 * A vault is the complete server-side state of a Rite "virtual server" (MEGA sync).
 * It is stored as a single JSON file in the user's cloud storage. Every note payload
 * inside it is already end-to-end encrypted by the client before it reaches the vault,
 * so the storage provider only ever sees ciphertext plus non-secret key parameters.
 */

export const RiteVaultFormat = 'rite-vault'
export const RiteVaultVersion = 1

export type VaultUser = {
  uuid: string
  email: string
  /** SHA-256 of (salt + server password). The server password is itself an Argon2id-derived secret. */
  passwordHash: string
  passwordSalt: string
  /** Non-secret root key parameters (identifier, pw_nonce, version, origination, created). */
  keyParams: Record<string, unknown>
  createdAt: string
}

export type VaultSession = {
  uuid: string
  userUuid: string
  accessToken: string
  refreshToken: string
  /** Milliseconds since epoch */
  accessExpiration: number
  /** Milliseconds since epoch */
  refreshExpiration: number
  readonlyAccess: boolean
  createdAt: string
  deviceInfo: string
}

export type VaultItem = {
  uuid: string
  user_uuid: string
  content_type: string
  content: string | null
  enc_item_key: string | null
  items_key_id?: string | null
  auth_hash?: string | null
  duplicate_of?: string | null
  key_system_identifier?: string | null
  shared_vault_uuid?: string | null
  last_edited_by_uuid?: string | null
  deleted: boolean
  /** Microseconds since epoch */
  created_at_timestamp: number
  /** Microseconds since epoch */
  updated_at_timestamp: number
  created_at: string
  updated_at: string
}

export type VaultState = {
  format: typeof RiteVaultFormat
  version: number
  users: VaultUser[]
  sessions: VaultSession[]
  items: Record<string, VaultItem>
  /** Monotonic microsecond clock; guarantees strictly increasing updated_at_timestamp values. */
  clock: number
  /**
   * Set when this vault was moved to another storage service. The old copy is kept as a backup,
   * but devices still syncing with it are told where the notes went instead of diverging.
   */
  movedTo?: VaultMove
}

export type VaultMove = {
  /** Sync address of the new location, e.g. "filen://rite". */
  host: string
  /** Shown to people, e.g. "Filen". */
  displayName: string
  /** ISO date of the move. */
  at: string
}

export function createEmptyVault(): VaultState {
  return {
    format: RiteVaultFormat,
    version: RiteVaultVersion,
    users: [],
    sessions: [],
    items: {},
    clock: 0,
  }
}

export function isVaultState(value: unknown): value is VaultState {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<VaultState>
  return (
    candidate.format === RiteVaultFormat &&
    Array.isArray(candidate.users) &&
    Array.isArray(candidate.sessions) &&
    typeof candidate.items === 'object' &&
    candidate.items !== null
  )
}
