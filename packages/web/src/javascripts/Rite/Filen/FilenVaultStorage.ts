import { CloudDrive, DriveEntry, DriveFolder } from '../Drive/DriveTypes'
import { DriveVaultStorage } from '../Drive/DriveVaultStorage'
import { FilenAccount } from './FilenAccount'
import { FilenCloudItem, FilenSDKInstance } from './FilenTypes'

/**
 * Filen adapter. Every listing is fetched from Filen (no cache), so each device sees what the
 * others saved. Filen keeps older versions of a file when one with the same name is uploaded.
 */
export class FilenDrive implements CloudDrive {
  readonly displayName = 'Filen'

  constructor(private readonly account: FilenAccount) {}

  async openFolder(name: string, create: boolean): Promise<DriveFolder | undefined> {
    const { sdk, rootFolder } = await this.account.open()
    try {
      const items = await sdk.cloud().listDirectory({ uuid: rootFolder, onlyDirectories: true })
      let folder = items.find((item) => item.type === 'directory' && item.name === name)?.uuid
      if (!folder && create) {
        folder = await sdk.cloud().createDirectory({ name, parent: rootFolder })
      }
      return folder ? new FilenFolder(sdk, folder, this.account) : undefined
    } catch (error) {
      return this.account.handleRequestError(error)
    }
  }
}

class FilenFolder implements DriveFolder {
  private items = new Map<string, FilenCloudItem>()

  constructor(
    private readonly sdk: FilenSDKInstance,
    private readonly uuid: string,
    private readonly account: FilenAccount,
  ) {}

  async list(): Promise<DriveEntry[]> {
    try {
      const items = await this.sdk.cloud().listDirectory({ uuid: this.uuid })
      return items.map((item) => this.entryFor(item))
    } catch (error) {
      return this.account.handleRequestError(error)
    }
  }

  async read(entry: DriveEntry): Promise<Uint8Array> {
    const item = this.items.get(entry.id)
    if (!item || item.type !== 'file') {
      throw new Error(`Filen file ${entry.name} is no longer available.`)
    }
    try {
      const stream = this.sdk.cloud().downloadFileToReadableStream({
        uuid: item.uuid,
        bucket: item.bucket,
        region: item.region,
        version: item.version,
        key: item.key,
        size: item.size,
        chunks: item.chunks,
      })
      return await readAll(stream)
    } catch (error) {
      return this.account.handleRequestError(error)
    }
  }

  async write(name: string, data: Uint8Array): Promise<DriveEntry> {
    try {
      const file = new File([data], name, { type: 'application/json' })
      const uploaded = await this.sdk.cloud().uploadWebFile({ file, parent: this.uuid, name })
      return this.entryFor(uploaded)
    } catch (error) {
      return this.account.handleRequestError(error)
    }
  }

  async remove(entry: DriveEntry): Promise<void> {
    try {
      await this.sdk.cloud().deleteFile({ uuid: entry.id })
    } catch (error) {
      return this.account.handleRequestError(error)
    }
  }

  private entryFor(item: FilenCloudItem): DriveEntry {
    this.items.set(item.uuid, item)
    return {
      id: item.uuid,
      name: item.name,
      isFolder: item.type === 'directory',
      modified: item.lastModified || item.timestamp,
    }
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Stores the Rite vault in `Rite/rite-vault.json` in the user's Filen drive. */
export class FilenVaultStorage extends DriveVaultStorage {
  constructor(account: FilenAccount, now: () => Date = () => new Date()) {
    super(new FilenDrive(account), now)
  }
}
