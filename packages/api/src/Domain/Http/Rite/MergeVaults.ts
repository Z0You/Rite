import { createEmptyVault, VaultItem, VaultSession, VaultState, VaultUser } from './VaultTypes'

/**
 * Combines vault copies written concurrently by different devices into one.
 *
 * - Items: the copy with the newest `updated_at_timestamp` wins (ties prefer the later argument).
 * - Users: the copy from the vault with the highest clock wins (password changes, emails).
 * - Sessions: union by uuid, so no device is signed out by the merge.
 * - Clock: maximum, so timestamps keep increasing.
 */
export function mergeVaults(vaults: VaultState[]): VaultState {
  if (vaults.length === 0) {
    return createEmptyVault()
  }
  if (vaults.length === 1) {
    return vaults[0]
  }

  const ordered = [...vaults].sort((a, b) => (a.clock ?? 0) - (b.clock ?? 0))
  const merged = createEmptyVault()

  const users = new Map<string, VaultUser>()
  const sessions = new Map<string, VaultSession>()
  const items: Record<string, VaultItem> = {}

  for (const vault of ordered) {
    merged.clock = Math.max(merged.clock, vault.clock ?? 0)
    merged.version = Math.max(merged.version, vault.version ?? 1)

    for (const user of vault.users) {
      users.set(user.uuid, user)
    }
    for (const session of vault.sessions) {
      sessions.set(session.uuid, session)
    }
    for (const [uuid, item] of Object.entries(vault.items)) {
      const existing = items[uuid]
      if (!existing || item.updated_at_timestamp >= existing.updated_at_timestamp) {
        items[uuid] = item
      }
    }
  }

  merged.users = [...users.values()]
  const userUuids = new Set(merged.users.map((user) => user.uuid))
  merged.sessions = [...sessions.values()].filter((session) => userUuids.has(session.userUuid))
  merged.items = items

  const moved = [...ordered].reverse().find((vault) => vault.movedTo)
  if (moved?.movedTo) {
    merged.movedTo = moved.movedTo
  }

  return merged
}
