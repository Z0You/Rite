import {
  isVaultState,
  mergeVaults,
  VaultState,
  VaultStorageConflictError,
  VaultStorageInterface,
} from '@standardnotes/snjs'
import { MegaAccount } from './MegaAccount'
import { MegaNode } from './MegaTypes'

export const RiteFolderName = 'Rite'
export const VaultFileName = 'rite-vault.json'
const BackupPrefix = 'rite-vault-backup-'
const BackupsToKeep = 7

type LoadedVersion = {
  /** Node ids of every vault file seen at load time. */
  nodeIds: string[]
  serialized: string
}

/**
 * Stores the Rite vault as `Rite/rite-vault.json` in the user's MEGA drive.
 *
 * - The file content is the vault JSON; every note inside it is already end-to-end encrypted.
 * - Saves upload a new file and then remove the previous one, so a complete copy always exists.
 * - If two devices save at the same moment and two vault files exist, they are merged on load.
 * - One backup per day is kept in the same folder (the last 7 days).
 */
export class MegaVaultStorage implements VaultStorageInterface {
  readonly displayName = 'MEGA'
  private loaded: LoadedVersion | undefined

  constructor(
    private readonly account: MegaAccount,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<VaultState | undefined> {
    const folder = await this.getFolder(false)
    const nodes = folder ? this.vaultNodes(folder) : []

    if (nodes.length === 0) {
      this.loaded = { nodeIds: [], serialized: '' }
      return undefined
    }

    const nodeIds = nodes.map((node) => node.nodeId as string)
    if (this.loaded && sameIds(this.loaded.nodeIds, nodeIds) && this.loaded.serialized) {
      return JSON.parse(this.loaded.serialized) as VaultState
    }

    const vaults: VaultState[] = []
    for (const node of nodes) {
      const bytes = await node.downloadBuffer({})
      const text = new TextDecoder().decode(bytes)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`The file ${RiteFolderName}/${VaultFileName} in your MEGA account is not a valid Rite vault.`)
      }
      if (!isVaultState(parsed)) {
        throw new Error(`The file ${RiteFolderName}/${VaultFileName} in your MEGA account is not a valid Rite vault.`)
      }
      vaults.push(parsed)
    }

    const state = mergeVaults(vaults)
    this.loaded = { nodeIds, serialized: JSON.stringify(state) }
    return state
  }

  async save(state: VaultState): Promise<void> {
    const folder = (await this.getFolder(true)) as MegaNode
    const current = this.vaultNodes(folder)
    const currentIds = current.map((node) => node.nodeId as string)

    if (!this.loaded || !sameIds(this.loaded.nodeIds, currentIds)) {
      this.loaded = undefined
      throw new VaultStorageConflictError()
    }

    const serialized = JSON.stringify(state)
    const bytes = new TextEncoder().encode(serialized)
    const uploaded = await folder.upload({ name: VaultFileName, size: bytes.byteLength }, bytes).complete

    for (const node of current) {
      await node.delete(true)
    }

    this.loaded = { nodeIds: [uploaded.nodeId as string], serialized }

    await this.writeDailyBackup(folder, bytes)
  }

  private async getFolder(create: boolean): Promise<MegaNode | undefined> {
    const storage = await this.account.openStorage()
    const existing = storage.root.children?.find((child) => child.directory && child.name === RiteFolderName)
    if (existing || !create) {
      return existing
    }
    return storage.root.mkdir(RiteFolderName)
  }

  private vaultNodes(folder: MegaNode): MegaNode[] {
    return (folder.children ?? [])
      .filter((child) => !child.directory && child.name === VaultFileName && child.nodeId)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  }

  private async writeDailyBackup(folder: MegaNode, bytes: Uint8Array): Promise<void> {
    try {
      const name = `${BackupPrefix}${this.now().toISOString().slice(0, 10)}.json`
      const backups = (folder.children ?? []).filter(
        (child) => !child.directory && child.name?.startsWith(BackupPrefix),
      )
      if (backups.some((backup) => backup.name === name)) {
        return
      }

      await folder.upload({ name, size: bytes.byteLength }, bytes).complete

      const sorted = [...backups].sort((a, b) => (b.name ?? '').localeCompare(a.name ?? ''))
      for (const old of sorted.slice(BackupsToKeep - 1)) {
        await old.delete(true)
      }
    } catch (error) {
      // Backups are a convenience; a failure must never block syncing.
      console.warn('Rite: could not write the daily MEGA backup', error)
    }
  }
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
