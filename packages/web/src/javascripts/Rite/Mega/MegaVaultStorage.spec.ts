import { TextDecoder, TextEncoder } from 'util'
Object.assign(globalThis, { TextEncoder, TextDecoder })
import { createEmptyVault, VaultStorageAuthRequiredError, VaultStorageConflictError } from '@standardnotes/snjs'
import { MegaAccount, KeyValueStore, describeMegaError } from './MegaAccount'
import { MegaVaultStorage, RiteFolderName, VaultFileName } from './MegaVaultStorage'
import { MegaModule, MegaNode, MegaSessionJSON, MegaStorage } from './MegaTypes'

let nextId = 1

/** In-memory stand-in for a MEGA drive shared by every "device" in a test. */
class FakeDrive {
  root = new FakeNode(this, 'root', true)
  validSid = 'sid-1'
}

class FakeNode implements MegaNode {
  nodeId = `n${nextId++}`
  timestamp = nextId
  children: FakeNode[] | undefined
  size = 0
  data = new Uint8Array()
  parent?: FakeNode

  constructor(
    private drive: FakeDrive,
    public name: string | null,
    public directory: boolean,
  ) {
    this.children = directory ? [] : undefined
  }

  async downloadBuffer() {
    return this.data
  }

  async delete() {
    if (this.parent?.children) {
      this.parent.children = this.parent.children.filter((child) => child !== this)
    }
  }

  upload(options: { name: string; size: number }, data: Uint8Array) {
    const node = new FakeNode(this.drive, options.name, false)
    node.data = data
    node.size = options.size
    node.parent = this
    this.children?.push(node)
    return { complete: Promise.resolve(node as MegaNode) }
  }

  async mkdir(name: string) {
    const node = new FakeNode(this.drive, name, true)
    node.parent = this
    this.children?.push(node)
    return node
  }
}

function fakeModule(drive: FakeDrive, passwords: Record<string, string>): MegaModule {
  class FakeStorage implements MegaStorage {
    root = drive.root
    ready: Promise<unknown>
    sid = ''
    options: Record<string, unknown>

    constructor(options: { email: string; password: string; secondFactorCode?: string }) {
      this.options = { ...options }
      this.ready =
        passwords[options.email] === options.password
          ? Promise.resolve((this.sid = drive.validSid))
          : Promise.reject(new Error('ENOENT (-9): Object (typically, node or user) not found'))
      this.ready.catch(() => undefined)
    }

    static fromJSON(json: MegaSessionJSON) {
      const storage = new FakeStorage({ email: String(json.options.email), password: 'unused-in-session-restore' })
      storage.ready = Promise.resolve()
      storage.sid = json.sid
      return storage
    }

    async reload() {
      if (this.sid !== drive.validSid) {
        throw new Error('ESID (-15): Invalid or expired user session, please relogin')
      }
    }

    toJSON(): MegaSessionJSON {
      return { key: 'session-key', sid: this.sid, name: 'Me', user: 'user-handle', options: this.options }
    }

    async close() {
      return
    }
  }

  return { Storage: FakeStorage as unknown as MegaModule['Storage'] }
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

describe('MEGA vault storage', () => {
  let drive: FakeDrive
  let module: MegaModule

  const device = async () => {
    const store = new MemoryStore()
    const account = new MegaAccount(store, async () => module)
    await account.connect('me@mega.example', 'mega-password')
    return { store, account, storage: new MegaVaultStorage(account, () => new Date('2026-10-29T10:00:00Z')) }
  }

  const folder = () => drive.root.children?.find((child) => child.name === RiteFolderName)

  beforeEach(() => {
    drive = new FakeDrive()
    module = fakeModule(drive, { 'me@mega.example': 'mega-password' })
  })

  it('connects without ever storing the MEGA password', async () => {
    const { store, account } = await device()
    expect(account.connectedEmail).toBe('me@mega.example')
    const persisted = [...store.values.values()].join()
    expect(persisted).toContain('sid-1')
    expect(persisted).not.toContain('mega-password')
  })

  it('reports a wrong MEGA password clearly', async () => {
    const account = new MegaAccount(new MemoryStore(), async () => module)
    await expect(account.connect('me@mega.example', 'nope')).rejects.toThrow('MEGA did not accept')
  })

  it('asks to connect when no MEGA account is connected', async () => {
    const storage = new MegaVaultStorage(new MegaAccount(new MemoryStore(), async () => module))
    await expect(storage.load()).rejects.toBeInstanceOf(VaultStorageAuthRequiredError)
  })

  it('treats an expired MEGA session as "connect again" and forgets it', async () => {
    const { account, storage } = await device()
    drive.validSid = 'rotated'
    await expect(storage.load()).rejects.toBeInstanceOf(VaultStorageAuthRequiredError)
    expect(account.isConnected).toBe(false)
  })

  it('returns nothing before the first save, then round-trips the vault in Rite/rite-vault.json', async () => {
    const { storage } = await device()
    expect(await storage.load()).toBeUndefined()

    await storage.save(vaultWithNote('hello', 5))

    const files = folder()?.children?.map((child) => child.name)
    expect(files).toContain(VaultFileName)
    expect(files).toContain('rite-vault-backup-2026-10-29.json')

    const other = await device()
    const loaded = await other.storage.load()
    expect(loaded?.items['note-hello'].content).toBe('hello')
  })

  it('replaces the vault file instead of piling up copies', async () => {
    const { storage } = await device()
    await storage.load()
    await storage.save(vaultWithNote('a', 1))
    await storage.save(vaultWithNote('b', 2))
    await storage.save(vaultWithNote('c', 3))

    const vaultFiles = folder()?.children?.filter((child) => child.name === VaultFileName) ?? []
    expect(vaultFiles).toHaveLength(1)
    expect((await (await device()).storage.load())?.items['note-c']).toBeDefined()
  })

  it('detects that another device saved since this device loaded', async () => {
    const a = await device()
    const b = await device()
    await a.storage.load()
    await b.storage.load()

    await b.storage.save(vaultWithNote('from-b', 1))
    await expect(a.storage.save(vaultWithNote('from-a', 2))).rejects.toBeInstanceOf(VaultStorageConflictError)

    // After reloading, device A can save again.
    const fresh = await a.storage.load()
    expect(fresh?.items['note-from-b']).toBeDefined()
    await expect(a.storage.save(vaultWithNote('from-a', 2))).resolves.toBeUndefined()
  })

  it('merges two vault files left behind by simultaneous saves', async () => {
    const { storage } = await device()
    await storage.save(vaultWithNote('ignored', 0)).catch(() => undefined)
    const rite = (folder() ?? (await drive.root.mkdir(RiteFolderName))) as FakeNode
    rite.children = []
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    rite.upload({ name: VaultFileName, size: 1 }, encode(vaultWithNote('one', 1)))
    rite.upload({ name: VaultFileName, size: 1 }, encode(vaultWithNote('two', 2)))

    const loaded = await (await device()).storage.load()
    expect(Object.keys(loaded?.items ?? {}).sort()).toEqual(['note-one', 'note-two'])
  })

  it('refuses a file that is not a Rite vault', async () => {
    const { storage } = await device()
    const rite = (await drive.root.mkdir(RiteFolderName)) as FakeNode
    rite.upload({ name: VaultFileName, size: 1 }, new TextEncoder().encode('{"hello":1}'))
    await expect(storage.load()).rejects.toThrow('not a valid Rite vault')
  })

  it('keeps at most 7 daily backups', async () => {
    const rite = (await drive.root.mkdir(RiteFolderName)) as FakeNode
    for (let day = 1; day <= 9; day++) {
      rite.upload({ name: `rite-vault-backup-2026-10-0${day}.json`, size: 1 }, new Uint8Array())
    }
    const { storage } = await device()
    await storage.load()
    await storage.save(vaultWithNote('x', 1))

    const backups = (folder()?.children ?? []).filter((child) => child.name?.startsWith('rite-vault-backup-'))
    expect(backups).toHaveLength(7)
    expect(backups.map((b) => b.name)).toContain('rite-vault-backup-2026-10-29.json')
    expect(backups.map((b) => b.name)).not.toContain('rite-vault-backup-2026-10-01.json')
  })

  it('translates MEGA error codes', () => {
    expect(describeMegaError(new Error('EMFAREQUIRED (-26)'))).toContain('two-factor')
    expect(describeMegaError(new Error('EOVERQUOTA (-17)'))).toContain('full')
  })
})
