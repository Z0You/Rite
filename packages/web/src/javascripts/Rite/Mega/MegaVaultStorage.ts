import { CloudDrive, DriveEntry, DriveFolder } from '../Drive/DriveTypes'
import { DriveVaultStorage } from '../Drive/DriveVaultStorage'
import { MegaAccount } from './MegaAccount'
import { MegaNode } from './MegaTypes'

export { RiteFolderName, VaultFileName } from '../Drive/DriveVaultStorage'

/** MEGA adapter: MEGA keeps both files when one with the same name is uploaded. */
export class MegaDrive implements CloudDrive {
  readonly displayName = 'MEGA'

  constructor(private readonly account: MegaAccount) {}

  async openFolder(name: string, create: boolean): Promise<DriveFolder | undefined> {
    const storage = await this.account.openStorage()
    let folder = storage.root.children?.find((child) => child.directory && child.name === name)
    if (!folder && create) {
      folder = await storage.root.mkdir(name)
    }
    return folder ? new MegaFolder(folder) : undefined
  }
}

class MegaFolder implements DriveFolder {
  private nodes = new Map<string, MegaNode>()

  constructor(private readonly node: MegaNode) {}

  async list(): Promise<DriveEntry[]> {
    return (this.node.children ?? [])
      .filter((child) => child.nodeId && child.name)
      .map((child) => this.entryFor(child))
  }

  async read(entry: DriveEntry): Promise<Uint8Array> {
    return this.nodeFor(entry).downloadBuffer({})
  }

  async write(name: string, data: Uint8Array): Promise<DriveEntry> {
    const uploaded = await this.node.upload({ name, size: data.byteLength }, data).complete
    return this.entryFor(uploaded)
  }

  async remove(entry: DriveEntry): Promise<void> {
    await this.nodeFor(entry).delete(true)
  }

  private entryFor(node: MegaNode): DriveEntry {
    const id = node.nodeId as string
    this.nodes.set(id, node)
    return { id, name: node.name ?? '', isFolder: node.directory, modified: (node.timestamp ?? 0) * 1000 }
  }

  private nodeFor(entry: DriveEntry): MegaNode {
    const node = this.nodes.get(entry.id)
    if (!node) {
      throw new Error(`MEGA file ${entry.name} is no longer available.`)
    }
    return node
  }
}

/** Stores the Rite vault in `Rite/rite-vault.json` in the user's MEGA drive. */
export class MegaVaultStorage extends DriveVaultStorage {
  constructor(account: MegaAccount, now: () => Date = () => new Date()) {
    super(new MegaDrive(account), now)
  }
}
