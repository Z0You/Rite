import { TextDecoder, TextEncoder } from 'util'
Object.assign(globalThis, { TextEncoder, TextDecoder })
import { createEmptyVault, VaultStorageAuthRequiredError, VaultStorageConflictError } from '@standardnotes/snjs'
import { MegaAccount, KeyValueStore, describeMegaError } from './MegaAccount'
import { MegaVaultStorage, RiteFolderName, VaultFileName } from './MegaVaultStorage'
import { MegaModule, MegaNode, MegaSessionJSON, MegaStorage } from './MegaTypes'

let nextId = 1

type LiveItem = { id: string; parent: string; name: string; directory: boolean; data: Uint8Array; timestamp: number }

/**
 * Stand-in for MEGA's servers, shared by every "device" in a test. It follows megajs' real
 * behaviour where it matters (see the FakeStorage notes below), because a too-friendly fake once
 * hid a real bug.
 */
class FakeDrive {
  items = new Map<string, LiveItem>()
  sessions = new Set<string>()
  rootId = 'root'

  login(): string {
    const sid = `sid-${nextId++}`
    this.sessions.add(sid)
    return sid
  }

  mkdir(parent: string, name: string): LiveItem {
    const item = { id: `n${nextId++}`, parent, name, directory: true, data: new Uint8Array(), timestamp: nextId }
    this.items.set(item.id, item)
    return item
  }

  put(parent: string, name: string, data: Uint8Array): LiveItem {
    const item = { id: `n${nextId++}`, parent, name, directory: false, data, timestamp: nextId }
    this.items.set(item.id, item)
    return item
  }

  childrenOf(parent: string): LiveItem[] {
    return [...this.items.values()].filter((item) => item.parent === parent)
  }

  folder(name: string): LiveItem | undefined {
    return this.childrenOf(this.rootId).find((item) => item.directory && item.name === name)
  }
}

/** One megajs file object, belonging to one Storage object (like megajs' MutableFile). */
class FakeNode implements MegaNode {
  children: FakeNode[] | undefined
  constructor(
    private storage: FakeStorageBase,
    public nodeId: string,
    public name: string | null,
    public directory: boolean,
    public timestamp: number,
  ) {
    this.children = directory ? [] : undefined
  }

  async downloadBuffer() {
    const item = this.storage.drive.items.get(this.nodeId)
    if (!item) {
      throw new Error('ENOENT (-9): Object (typically, node or user) not found')
    }
    return item.data
  }

  // Like megajs: deleting only tells the server. This Storage object keeps listing the file
  // (megajs learns about deletions only over a live connection, which Rite does not keep).
  async delete() {
    this.storage.drive.items.delete(this.nodeId)
  }

  upload(options: { name: string; size: number }, data: Uint8Array) {
    const item = this.storage.drive.put(this.nodeId, options.name, data)
    return { complete: Promise.resolve(this.storage.importItem(item) as MegaNode) }
  }

  async mkdir(name: string) {
    return this.storage.importItem(this.storage.drive.mkdir(this.nodeId, name))
  }
}

abstract class FakeStorageBase {
  abstract drive: FakeDrive
  files = new Map<string, FakeNode>()
  abstract root: FakeNode

  /** Like megajs' _importFile: add a node once and never remove it. */
  importItem(item: LiveItem): FakeNode {
    let node = this.files.get(item.id)
    if (!node) {
      node = new FakeNode(this, item.id, item.name, item.directory, item.timestamp)
      this.files.set(item.id, node)
      this.files.get(item.parent)?.children?.push(node)
    }
    return node
  }
}

function fakeModule(drive: FakeDrive, passwords: Record<string, string>): MegaModule {
  class FakeStorage extends FakeStorageBase implements MegaStorage {
    drive = drive
    root: FakeNode
    ready: Promise<unknown>
    sid = ''
    options: Record<string, unknown>

    constructor(options: { email: string; password: string; secondFactorCode?: string }, restoring = false) {
      super()
      this.options = { ...options }
      this.root = new FakeNode(this, drive.rootId, 'Cloud Drive', true, 0)
      this.files.set(drive.rootId, this.root)
      if (restoring) {
        this.ready = Promise.resolve()
        return
      }
      this.ready =
        passwords[options.email] === options.password
          ? Promise.resolve((this.sid = drive.login())).then(() => this.reload())
          : Promise.reject(new Error('ENOENT (-9): Object (typically, node or user) not found'))
      this.ready.catch(() => undefined)
    }

    static fromJSON(json: MegaSessionJSON) {
      const storage = new FakeStorage({ email: String(json.options.email), password: '' }, true)
      storage.sid = json.sid
      return storage
    }

    // Like megajs: imports nodes it has not seen yet, but never drops ones that were deleted.
    async reload() {
      if (!drive.sessions.has(this.sid)) {
        throw new Error('ESID (-15): Invalid or expired user session, please relogin')
      }
      const pending = [...drive.items.values()].sort((a, b) => Number(a.directory) - Number(b.directory)).reverse()
      for (const item of pending) {
        this.importItem(item)
      }
    }

    toJSON(): MegaSessionJSON {
      return { key: 'session-key', sid: this.sid, name: 'Me', user: 'user-handle', options: this.options }
    }

    // Like megajs: close() logs the session out on MEGA's side.
    async close() {
      drive.sessions.delete(this.sid)
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

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('MEGA vault storage', () => {
  let drive: FakeDrive
  let module: MegaModule

  const device = async () => {
    const store = new MemoryStore()
    const account = new MegaAccount(store, async () => module)
    await account.connect('me@mega.example', 'mega-password')
    return { store, account, storage: new MegaVaultStorage(account, () => new Date('2026-10-29T10:00:00Z')) }
  }

  const riteFiles = () => {
    const rite = drive.folder(RiteFolderName)
    return rite ? drive.childrenOf(rite.id) : []
  }

  beforeEach(() => {
    drive = new FakeDrive()
    module = fakeModule(drive, { 'me@mega.example': 'mega-password' })
  })

  it('connects without ever storing the MEGA password', async () => {
    const { store, account } = await device()
    expect(account.connectedEmail).toBe('me@mega.example')
    const persisted = [...store.values.values()].join()
    expect(persisted).toContain('sid-')
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

  it('treats a session MEGA ended as "connect again" and forgets it', async () => {
    const { account, storage } = await device()
    drive.sessions.clear()
    await expect(storage.load()).rejects.toBeInstanceOf(VaultStorageAuthRequiredError)
    expect(account.isConnected).toBe(false)
  })

  it('keeps the MEGA session alive across connects and app restarts (never logs it out by accident)', async () => {
    const { store, account, storage } = await device()
    await storage.load()
    await storage.save(vaultWithNote('one', 1))

    // Connecting again (e.g. from the sign-in screen) must not end the session already saved.
    await account.connect('me@mega.example', 'mega-password')
    await storage.load()

    // An app restart: new account object, same saved session.
    const restarted = new MegaAccount(store, async () => module)
    const afterRestart = new MegaVaultStorage(restarted)
    expect((await afterRestart.load())?.items['note-one']).toBeDefined()
    expect(restarted.isConnected).toBe(true)
  })

  it('Disconnect ends the session on MEGA and forgets it on the device', async () => {
    const { store, account } = await device()
    const sid = JSON.parse([...store.values.values()][0]).session.sid
    await account.disconnect()
    expect(account.isConnected).toBe(false)
    expect(drive.sessions.has(sid)).toBe(false)
  })

  it('returns nothing before the first save, then round-trips the vault in Rite/rite-vault.json', async () => {
    const { storage } = await device()
    expect(await storage.load()).toBeUndefined()

    await storage.save(vaultWithNote('hello', 5))

    const files = riteFiles().map((item) => item.name)
    expect(files).toContain(VaultFileName)
    expect(files).toContain('rite-vault-backup-2026-10-29.json')

    const other = await device()
    expect((await other.storage.load())?.items['note-hello'].content).toBe('hello')
  })

  it('keeps syncing in a long session: deleted vault copies are never read back', async () => {
    const { storage } = await device()
    for (let i = 1; i <= 5; i++) {
      const state = (await storage.load()) ?? createEmptyVault()
      state.items[`note-${i}`] = vaultWithNote(String(i), i).items[`note-${i}`]
      await storage.save(state)
    }
    const final = await storage.load()
    expect(Object.keys(final?.items ?? {}).sort()).toEqual(['note-1', 'note-2', 'note-3', 'note-4', 'note-5'])
    expect(riteFiles().filter((item) => item.name === VaultFileName)).toHaveLength(1)
  })

  it('detects that another device saved since this device loaded', async () => {
    const a = await device()
    const b = await device()
    await a.storage.load()
    await b.storage.load()

    await b.storage.save(vaultWithNote('from-b', 1))
    await expect(a.storage.save(vaultWithNote('from-a', 2))).rejects.toBeInstanceOf(VaultStorageConflictError)

    const fresh = await a.storage.load()
    expect(fresh?.items['note-from-b']).toBeDefined()
    await expect(a.storage.save(vaultWithNote('from-a', 2))).resolves.toBeUndefined()
  })

  it('merges two vault files left behind by simultaneous saves', async () => {
    const rite = drive.mkdir(drive.rootId, RiteFolderName)
    drive.put(rite.id, VaultFileName, encode(vaultWithNote('one', 1)))
    drive.put(rite.id, VaultFileName, encode(vaultWithNote('two', 2)))

    const loaded = await (await device()).storage.load()
    expect(Object.keys(loaded?.items ?? {}).sort()).toEqual(['note-one', 'note-two'])
  })

  it('refuses a file that is not a Rite vault', async () => {
    const { storage } = await device()
    const rite = drive.mkdir(drive.rootId, RiteFolderName)
    drive.put(rite.id, VaultFileName, new TextEncoder().encode('{"hello":1}'))
    await expect(storage.load()).rejects.toThrow('not a valid Rite vault')
  })

  it('keeps at most 7 daily backups', async () => {
    const rite = drive.mkdir(drive.rootId, RiteFolderName)
    for (let day = 1; day <= 9; day++) {
      drive.put(rite.id, `rite-vault-backup-2026-10-0${day}.json`, new Uint8Array())
    }
    const { storage } = await device()
    await storage.load()
    await storage.save(vaultWithNote('x', 1))

    const backups = riteFiles().filter((item) => item.name.startsWith('rite-vault-backup-'))
    expect(backups).toHaveLength(7)
    expect(backups.map((b) => b.name)).toContain('rite-vault-backup-2026-10-29.json')
    expect(backups.map((b) => b.name)).not.toContain('rite-vault-backup-2026-10-01.json')
  })

  it('translates MEGA error codes, and only calls ENOENT a wrong password while signing in', () => {
    expect(describeMegaError(new Error('EMFAREQUIRED (-26)'))).toContain('two-factor')
    expect(describeMegaError(new Error('EOVERQUOTA (-17)'))).toContain('full')
    expect(describeMegaError(new Error('ENOENT (-9)'), true)).toContain('did not accept')
    expect(describeMegaError(new Error('ENOENT (-9)'))).not.toContain('did not accept')
  })
})
