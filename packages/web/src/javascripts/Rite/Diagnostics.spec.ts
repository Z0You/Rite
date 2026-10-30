import { TextDecoder, TextEncoder } from 'util'
Object.assign(globalThis, { TextEncoder, TextDecoder })
import { createEmptyVault } from '@standardnotes/snjs'
import { CloudDrive, DriveEntry, DriveFolder } from './Drive/DriveTypes'
import { diagnoseStorage } from './Diagnostics'
import { StorageProvider } from './RiteSync'

class MemoryFolder implements DriveFolder {
  files = new Map<string, { name: string; data: Uint8Array }>()
  private next = 1
  async list(): Promise<DriveEntry[]> {
    return [...this.files].map(([id, file]) => ({ id, name: file.name, isFolder: false, modified: 0 }))
  }
  async read(entry: DriveEntry): Promise<Uint8Array> {
    return (this.files.get(entry.id) as { data: Uint8Array }).data
  }
  async write(name: string, data: Uint8Array): Promise<DriveEntry> {
    const id = String(this.next++)
    this.files.set(id, { name, data })
    return { id, name, isFolder: false, modified: 0 }
  }
  async remove(entry: DriveEntry): Promise<void> {
    this.files.delete(entry.id)
  }
}

function providerWith(folder: MemoryFolder | undefined): StorageProvider {
  const drive: CloudDrive = {
    displayName: 'MEGA',
    openFolder: async () => folder,
    describe: async () => ['MEGA items received: 4'],
  }
  return {
    id: 'mega',
    name: 'MEGA',
    host: 'mega://rite',
    website: 'mega.nz',
    account: { connectedEmail: 'me@mega.test' } as StorageProvider['account'],
    createStorage: () => {
      throw new Error('not used')
    },
    createDrive: () => drive,
  }
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('diagnoseStorage', () => {
  it('reports a missing Rite folder', async () => {
    const report = (await diagnoseStorage(providerWith(undefined), { email: 'a@b.c' })).join('\n')
    expect(report).toContain('MEGA items received: 4')
    expect(report).toContain('"Rite" folder: NOT FOUND')
  })

  it('describes the vault without exposing tokens', async () => {
    const vault = createEmptyVault()
    vault.users.push({
      uuid: 'u1',
      email: 'a@b.c',
      passwordHash: 'h',
      passwordSalt: 's',
      keyParams: {},
      createdAt: '',
    })
    vault.sessions.push({
      uuid: 's1',
      userUuid: 'u1',
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh',
      accessExpiration: 0,
      refreshExpiration: 0,
      readonlyAccess: false,
      createdAt: '',
      deviceInfo: '',
    })
    const folder = new MemoryFolder()
    await folder.write('rite-vault.json', encode(vault))
    await folder.write('rite-vault-backup-2026-10-29.json', encode({ nope: true }))

    const report = (
      await diagnoseStorage(providerWith(folder), { email: 'a@b.c', userUuid: 'u1', accessToken: 'secret-access-token' })
    ).join('\n')

    expect(report).toContain('Vault files: 1; daily backups: 1')
    expect(report).toContain('accounts: 1, this account: yes')
    expect(report).toContain("this device's session: yes")
    expect(report).toContain('NOT a readable Rite vault')
    expect(report).not.toContain('secret')
  })
})
