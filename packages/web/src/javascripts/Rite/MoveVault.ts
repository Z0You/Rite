import { mergeVaults, VaultState, VaultStorageConflictError, VaultStorageInterface } from '@standardnotes/snjs'

export type MoveResult = {
  /** Notes found in the source vault (not counting deleted ones). */
  movedNotes: number
  /** True when the destination already had a vault and both were combined. */
  merged: boolean
}

const MaxAttempts = 4

/**
 * Copies the whole Rite vault from one storage service to another, then marks the old copy as
 * moved so other devices still syncing with it are told where the notes went.
 *
 * - Nothing is deleted: the old vault stays where it was, as a backup.
 * - If the destination already holds a vault (for example another device moved first), both are
 *   combined; for every note the most recent version wins.
 * - Accounts and sessions are copied too, so the same Rite email/password keep working and this
 *   device stays signed in.
 */
export async function moveVault(params: {
  from: VaultStorageInterface
  to: VaultStorageInterface
  toHost: string
  now?: () => Date
}): Promise<MoveResult> {
  const now = params.now ?? (() => new Date())

  for (let attempt = 1; ; attempt++) {
    try {
      const source = await params.from.load()
      if (!source || source.users.length === 0) {
        throw new Error(`There is no Rite vault in ${params.from.displayName} to move.`)
      }
      const destination = await params.to.load()

      const combined = mergeVaults(destination ? [destination, stripMove(source)] : [stripMove(source)])
      delete combined.movedTo
      await params.to.save(combined)

      if (!source.movedTo || source.movedTo.host !== params.toHost) {
        await params.from.save({
          ...source,
          movedTo: { host: params.toHost, displayName: params.to.displayName, at: now().toISOString() },
        })
      }

      return {
        movedNotes: Object.values(source.items).filter((item) => !item.deleted && item.content_type === 'Note').length,
        merged: !!destination,
      }
    } catch (error) {
      // Another device synced while we were copying: start over with fresh copies.
      if (error instanceof VaultStorageConflictError && attempt < MaxAttempts) {
        continue
      }
      throw error
    }
  }
}

function stripMove(vault: VaultState): VaultState {
  const copy = { ...vault }
  delete copy.movedTo
  return copy
}
