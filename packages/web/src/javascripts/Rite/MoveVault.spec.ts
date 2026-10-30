import { createEmptyVault, InMemoryVaultStorage, VaultState, VaultStorageConflictError } from '@standardnotes/snjs'
import { moveVault } from './MoveVault'

const NamedStorage = InMemoryVaultStorage

function vaultWith(items: Record<string, { content: string; ts: number; deleted?: boolean }>, clock = 10): VaultState {
  const vault = createEmptyVault()
  vault.clock = clock
  vault.users.push({ uuid: 'u1', email: 'me@rite.test', passwordHash: 'h', passwordSalt: 's', keyParams: {}, createdAt: '' })
  vault.sessions.push({
    uuid: 's1',
    userUuid: 'u1',
    accessToken: 'token',
    refreshToken: 'refresh',
    accessExpiration: 1,
    refreshExpiration: 1,
    readonlyAccess: false,
    createdAt: '',
    deviceInfo: '',
  })
  for (const [uuid, item] of Object.entries(items)) {
    vault.items[uuid] = {
      uuid,
      user_uuid: 'u1',
      content_type: 'Note',
      content: item.content,
      enc_item_key: 'k',
      deleted: !!item.deleted,
      created_at_timestamp: 1,
      updated_at_timestamp: item.ts,
      created_at: '',
      updated_at: '',
    }
  }
  return vault
}

describe('moveVault', () => {
  const now = () => new Date('2026-10-30T09:00:00Z')

  it('copies everything, keeps the account and session, and marks the old vault as moved', async () => {
    const mega = new NamedStorage('MEGA')
    const filen = new NamedStorage('Filen')
    await mega.save(vaultWith({ a: { content: '004:a', ts: 1 }, b: { content: '004:b', ts: 2 }, c: { content: '', ts: 3, deleted: true } }))

    const result = await moveVault({ from: mega, to: filen, toHost: 'filen://rite', now })

    expect(result).toEqual({ movedNotes: 2, merged: false })
    const copied = (await filen.load()) as VaultState
    expect(Object.keys(copied.items).sort()).toEqual(['a', 'b', 'c'])
    expect(copied.users[0].email).toBe('me@rite.test')
    expect(copied.sessions[0].accessToken).toBe('token')
    expect(copied.movedTo).toBeUndefined()

    const old = (await mega.load()) as VaultState
    expect(old.movedTo).toEqual({ host: 'filen://rite', displayName: 'Filen', at: '2026-10-30T09:00:00.000Z' })
    expect(Object.keys(old.items)).toHaveLength(3)
  })

  it('combines with a vault already at the destination, newest version of each note wins', async () => {
    const mega = new NamedStorage('MEGA')
    const filen = new NamedStorage('Filen')
    await mega.save(vaultWith({ a: { content: 'old-a', ts: 1 }, b: { content: 'only-in-mega', ts: 2 } }))
    await filen.save(vaultWith({ a: { content: 'new-a', ts: 5 }, x: { content: 'only-in-filen', ts: 3 } }, 20))

    const result = await moveVault({ from: mega, to: filen, toHost: 'filen://rite', now })

    expect(result.merged).toBe(true)
    const items = ((await filen.load()) as VaultState).items
    expect(items.a.content).toBe('new-a')
    expect(items.b.content).toBe('only-in-mega')
    expect(items.x.content).toBe('only-in-filen')
  })

  it('lets a second device switch over to a vault another device already moved', async () => {
    const mega = new NamedStorage('MEGA')
    const filen = new NamedStorage('Filen')
    await mega.save(vaultWith({ a: { content: 'a', ts: 1 } }))
    await moveVault({ from: mega, to: filen, toHost: 'filen://rite', now })
    const savesBefore = mega.saveCount

    await moveVault({ from: mega, to: filen, toHost: 'filen://rite', now })

    expect(mega.saveCount).toBe(savesBefore)
    expect(((await filen.load()) as VaultState).items.a.content).toBe('a')
  })

  it('can move back the other way later', async () => {
    const mega = new NamedStorage('MEGA')
    const filen = new NamedStorage('Filen')
    await mega.save(vaultWith({ a: { content: 'a', ts: 1 } }))
    await moveVault({ from: mega, to: filen, toHost: 'filen://rite', now })

    await moveVault({ from: filen, to: mega, toHost: 'mega://rite', now })

    expect(((await mega.load()) as VaultState).movedTo).toBeUndefined()
    expect(((await filen.load()) as VaultState).movedTo?.host).toBe('mega://rite')
  })

  it('retries when another device saves during the move', async () => {
    const mega = new NamedStorage('MEGA')
    const filen = new NamedStorage('Filen')
    await mega.save(vaultWith({ a: { content: 'a', ts: 1 } }))
    const realSave = mega.save.bind(mega)
    let failed = false
    mega.save = async (state) => {
      if (!failed) {
        failed = true
        await realSave(vaultWith({ a: { content: 'a', ts: 1 }, late: { content: 'late edit', ts: 9 } }))
        throw new VaultStorageConflictError()
      }
      return realSave(state)
    }

    await moveVault({ from: mega, to: filen, toHost: 'filen://rite', now })

    expect(((await filen.load()) as VaultState).items.late.content).toBe('late edit')
  })

  it('refuses to move when there is nothing to move', async () => {
    await expect(
      moveVault({ from: new NamedStorage('MEGA'), to: new NamedStorage('Filen'), toHost: 'filen://rite' }),
    ).rejects.toThrow('no Rite vault in MEGA')
  })
})
