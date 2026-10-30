import {
  isVaultState,
  mergeVaults,
  VaultState,
  VaultStorageConflictError,
  VaultStorageInterface,
} from '@standardnotes/snjs'
import { CloudDrive, DriveEntry, DriveFolder } from './DriveTypes'

export const RiteFolderName = 'Rite'
export const VaultFileName = 'rite-vault.json'
export const BackupPrefix = 'rite-vault-backup-'
const BackupsToKeep = 7

type LoadedVersion = {
  /** Ids of every vault file seen at load time. */
  ids: string[]
  serialized: string
}

/**
 * Stores the Rite vault as `Rite/rite-vault.json` in a cloud drive.
 *
 * - The file content is the vault JSON; every note inside it is already end-to-end encrypted.
 * - Before saving, the folder is checked again: if another device saved in the meantime, the
 *   save is refused with VaultStorageConflictError and the sync server replays on the new copy.
 * - Saves upload the new file first and remove the previous one afterwards, so a complete copy
 *   always exists. If two devices still end up leaving two vault files, they are merged on load.
 * - One backup per day is kept in the same folder (the last 7 days).
 */
export class DriveVaultStorage implements VaultStorageInterface {
  private loaded: LoadedVersion | undefined

  constructor(
    private readonly drive: CloudDrive,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get displayName(): string {
    return this.drive.displayName
  }

  async load(): Promise<VaultState | undefined> {
    const folder = await this.drive.openFolder(RiteFolderName, false)
    const entries = folder ? vaultEntries(await folder.list()) : []

    if (!folder || entries.length === 0) {
      this.loaded = { ids: [], serialized: '' }
      return undefined
    }

    const ids = entries.map((entry) => entry.id)
    if (this.loaded && sameIds(this.loaded.ids, ids) && this.loaded.serialized) {
      return JSON.parse(this.loaded.serialized) as VaultState
    }

    const vaults: VaultState[] = []
    for (const entry of entries) {
      vaults.push(this.parse(await folder.read(entry)))
    }

    const state = mergeVaults(vaults)
    this.loaded = { ids, serialized: JSON.stringify(state) }
    return state
  }

  async save(state: VaultState): Promise<void> {
    const folder = (await this.drive.openFolder(RiteFolderName, true)) as DriveFolder
    const before = await folder.list()
    const current = vaultEntries(before)
    const currentIds = current.map((entry) => entry.id)

    if (!this.loaded || !sameIds(this.loaded.ids, currentIds)) {
      this.loaded = undefined
      throw new VaultStorageConflictError()
    }

    const serialized = JSON.stringify(state)
    const bytes = new TextEncoder().encode(serialized)
    const uploaded = await folder.write(VaultFileName, bytes)

    // Remove the previous copies that are still listed (services that replace same-name files
    // on upload have already turned them into old versions, so there is nothing left to remove).
    const previous = new Set(currentIds)
    for (const entry of vaultEntries(await folder.list())) {
      if (entry.id !== uploaded.id && previous.has(entry.id)) {
        await folder.remove(entry)
      }
    }

    this.loaded = { ids: [uploaded.id], serialized }

    await this.writeDailyBackup(folder, before, bytes)
  }

  private parse(bytes: Uint8Array): VaultState {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      parsed = undefined
    }
    if (!isVaultState(parsed)) {
      throw new Error(
        `The file ${RiteFolderName}/${VaultFileName} in your ${this.drive.displayName} account is not a valid Rite vault.`,
      )
    }
    return parsed
  }

  private async writeDailyBackup(folder: DriveFolder, entries: DriveEntry[], bytes: Uint8Array): Promise<void> {
    try {
      const name = `${BackupPrefix}${this.now().toISOString().slice(0, 10)}.json`
      const backups = entries.filter((entry) => !entry.isFolder && entry.name.startsWith(BackupPrefix))
      if (backups.some((backup) => backup.name === name)) {
        return
      }

      await folder.write(name, bytes)

      const sorted = [...backups].sort((a, b) => b.name.localeCompare(a.name))
      for (const old of sorted.slice(BackupsToKeep - 1)) {
        await folder.remove(old)
      }
    } catch (error) {
      // Backups are a convenience; a failure must never block syncing.
      console.warn(`Rite: could not write the daily ${this.drive.displayName} backup`, error)
    }
  }
}

function vaultEntries(entries: DriveEntry[]): DriveEntry[] {
  return entries
    .filter((entry) => !entry.isFolder && entry.name === VaultFileName)
    .sort((a, b) => a.modified - b.modified)
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
