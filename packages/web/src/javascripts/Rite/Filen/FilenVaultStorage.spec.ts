import { TextDecoder, TextEncoder } from 'util'
import { ReadableStream } from 'stream/web'
import { Blob } from 'buffer'
Object.assign(globalThis, { TextEncoder, TextDecoder, ReadableStream })

import { createEmptyVault, VaultStorageAuthRequiredError, VaultStorageConflictError } from '@standardnotes/snjs'
import { KeyValueStore } from '../Mega/MegaAccount'
import { describeFilenError, FilenAccount } from './FilenAccount'
import { FilenVaultStorage } from './FilenVaultStorage'
import { FilenCloudItem, FilenModule, FilenSDKInstance } from './FilenTypes'

/** A File that works in the test environment (reads its bytes back for the fake upload). */
class TestFile extends Blob {
  constructor(parts: Uint8Array[], public name: string) {
    super(parts)
  }
}
Object.assign(globalThis, { File: TestFile })

let nextId = 1

type StoredItem = FilenCloudItem & { data?: Uint8Array }

/**
 * Stand-in for Filen shared by every "device" in a test. Like Filen, uploading a file whose
 * name already exists in the folder replaces it (the old one becomes a previous version).
 */
class FakeFilen {
  items: StoredItem[] = []
  versions: StoredItem[] = []
  validApiKey = 'api-1'
  root = 'root-folder'

  private dir(name: string, parent: string): StoredItem {
    return { type: 'directory', uuid: `d${nextId++}`, name, parent, timestamp: nextId, lastModified: nextId }
  }

  module(passwords: Record<string, string>, needs2fa = false): FilenModule {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const drive = this
    class SDK implements FilenSDKInstance {
      config: Record<string, unknown>
      constructor(config: Record<string, unknown>) {
        this.config = { ...config }
      }
      async login(params: { email: string; password: string; twoFactorCode?: string }) {
        if (passwords[params.email] !== params.password) {
          throw Object.assign(new Error('Invalid email or password.'), { code: 'email_or_password_wrong' })
        }
        if (needs2fa && !params.twoFactorCode) {
          throw Object.assign(new Error('Please enter your 2FA code.'), { code: 'enter_2fa' })
        }
        Object.assign(this.config, {
          email: params.email,
          password: 'redacted',
          apiKey: drive.validApiKey,
          masterKeys: ['master-key'],
          baseFolderUUID: drive.root,
          authVersion: 2,
          userId: 7,
        })
      }
      private check() {
        if (this.config.apiKey !== drive.validApiKey) {
          throw Object.assign(new Error('API key not found.'), { code: 'api_key_not_found' })
        }
      }
      cloud() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const sdk = this
        return {
          async listDirectory({ uuid, onlyDirectories }: { uuid: string; onlyDirectories?: boolean }) {
            sdk.check()
            return drive.items
              .filter((item) => item.parent === uuid && (!onlyDirectories || item.type === 'directory'))
              .map(({ data: _data, ...item }) => item as FilenCloudItem)
          },
          async createDirectory({ name, parent }: { name: string; parent: string }) {
            sdk.check()
            const dir = drive.dir(name, parent)
            drive.items.push(dir)
            return dir.uuid
          },
          async uploadWebFile({ file, parent, name }: { file: File; parent: string; name?: string }) {
            sdk.check()
            const data = new Uint8Array(await (file as unknown as Blob).arrayBuffer())
            const fileName = name ?? (file as unknown as TestFile).name
            const existing = drive.items.find((item) => item.parent === parent && item.name === fileName)
            if (existing) {
              drive.items = drive.items.filter((item) => item !== existing)
              drive.versions.push(existing)
            }
            nextId++
            const item = {
              type: 'file',
              uuid: `f${nextId}`,
              name: fileName,
              parent,
              timestamp: nextId,
              lastModified: nextId,
              size: data.byteLength,
              mime: 'application/json',
              version: 2,
              chunks: 1,
              key: 'k',
              bucket: 'b',
              region: 'r',
              data,
            } as StoredItem
            drive.items.push(item)
            const { data: _data, ...plain } = item
            return plain as FilenCloudItem
          },
          downloadFileToReadableStream({ uuid }: { uuid: string }) {
            sdk.check()
            const item = drive.items.find((candidate) => candidate.uuid === uuid) as StoredItem
            const data = item.data as Uint8Array
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(data.slice(0, 5))
                controller.enqueue(data.slice(5))
                controller.close()
              },
            }) as unknown as globalThis.ReadableStream<Uint8Array>
          },
          async deleteFile({ uuid }: { uuid: string }) {
            sdk.check()
            drive.items = drive.items.filter((item) => item.uuid !== uuid)
          },
        }
      }
    }
    return { FilenSDK: SDK as unknown as FilenModule['FilenSDK'] }
  }
}

class MemoryStore implements KeyValueStore {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function vaultWithNote(content: string, clock: number) {
  const vault = createEmptyVault()
  vault.clock = clock
  vault.items[`note-${content}`] = {
    uuid: `note-${content}`,
    user_uuid: 'u',
    content_type: 'Note',
    content,
    enc_item_key: 'k',
    deleted: false,
    created_at_timestamp: clock,
    updated_at_timestamp: clock,
    created_at: '',
    updated_at: '',
  }
  return vault
}

describe('Filen vault storage', () => {
  let drive: FakeFilen
  let module: FilenModule

  const device = async () => {
    const store = new MemoryStore()
    const account = new FilenAccount(store, async () => module)
    await account.connect('me@filen.test', 'filen-password')
    return { store, account, storage: new FilenVaultStorage(account, () => new Date('2026-10-30T10:00:00Z')) }
  }

  const riteFolder = () => drive.items.find((item) => item.type === 'directory' && item.name === 'Rite')
  const filesInRite = () => drive.items.filter((item) => item.parent === riteFolder()?.uuid).map((item) => item.name)

  beforeEach(() => {
    drive = new FakeFilen()
    module = drive.module({ 'me@filen.test': 'filen-password' })
  })

  it('connects and keeps only the Filen session, never the password', async () => {
    const { store, account } = await device()
    expect(account.connectedEmail).toBe('me@filen.test')
    const saved = [...store.values.values()].join()
    expect(saved).toContain('api-1')
    expect(saved).not.toContain('filen-password')
    expect(saved).not.toContain('redacted')
  })

  it('explains a wrong password and a missing two-factor code', async () => {
    const account = new FilenAccount(new MemoryStore(), async () => module)
    await expect(account.connect('me@filen.test', 'nope')).rejects.toThrow('Filen did not accept')

    module = drive.module({ 'me@filen.test': 'filen-password' }, true)
    await expect(account.connect('me@filen.test', 'filen-password')).rejects.toThrow('two-factor')
    await expect(account.connect('me@filen.test', 'filen-password', '123456')).resolves.toBeUndefined()
  })

  it('asks to connect when no Filen account is connected', async () => {
    const storage = new FilenVaultStorage(new FilenAccount(new MemoryStore(), async () => module))
    await expect(storage.load()).rejects.toBeInstanceOf(VaultStorageAuthRequiredError)
  })

  it('treats a revoked Filen session as "connect again" and forgets it', async () => {
    const { account, storage } = await device()
    drive.validApiKey = 'rotated'
    await expect(storage.load()).rejects.toBeInstanceOf(VaultStorageAuthRequiredError)
    expect(account.isConnected).toBe(false)
  })

  it('round-trips the vault in Rite/rite-vault.json with a daily backup', async () => {
    const { storage } = await device()
    expect(await storage.load()).toBeUndefined()

    await storage.save(vaultWithNote('hello', 5))
    expect(filesInRite().sort()).toEqual(['rite-vault-backup-2026-10-30.json', 'rite-vault.json'])

    const other = await device()
    expect((await other.storage.load())?.items['note-hello'].content).toBe('hello')
  })

  it('keeps one current vault file; older ones become Filen versions', async () => {
    const { storage } = await device()
    await storage.load()
    await storage.save(vaultWithNote('a', 1))
    await storage.save(vaultWithNote('b', 2))
    await storage.save(vaultWithNote('c', 3))

    expect(filesInRite().filter((name) => name === 'rite-vault.json')).toHaveLength(1)
    expect(drive.versions.length).toBeGreaterThanOrEqual(2)
    expect((await (await device()).storage.load())?.items['note-c']).toBeDefined()
  })

  it('detects that another device saved since this device loaded', async () => {
    const a = await device()
    const b = await device()
    await a.storage.load()
    await b.storage.load()

    await b.storage.save(vaultWithNote('from-b', 1))
    await expect(a.storage.save(vaultWithNote('from-a', 2))).rejects.toBeInstanceOf(VaultStorageConflictError)

    expect((await a.storage.load())?.items['note-from-b']).toBeDefined()
    await expect(a.storage.save(vaultWithNote('from-a', 2))).resolves.toBeUndefined()
  })

  it('translates Filen error codes', () => {
    expect(describeFilenError({ code: 'wrong_2fa', message: 'x' })).toContain('not accepted')
    expect(describeFilenError(new Error('Network Error'))).toContain('internet')
  })
})
