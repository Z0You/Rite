import { mergeVaults } from './MergeVaults'
import { createEmptyVault, VaultItem, VaultState } from './VaultTypes'

function vaultWith(clock: number, items: Partial<VaultItem>[], extra: Partial<VaultState> = {}): VaultState {
  const vault = createEmptyVault()
  vault.clock = clock
  for (const partial of items) {
    vault.items[partial.uuid as string] = {
      user_uuid: 'u1',
      content_type: 'Note',
      content: 'c',
      enc_item_key: 'k',
      deleted: false,
      created_at_timestamp: 1,
      updated_at_timestamp: 1,
      created_at: '',
      updated_at: '',
      ...partial,
    } as VaultItem
  }
  return { ...vault, ...extra }
}

describe('mergeVaults', () => {
  it('keeps the newest version of every item from every copy', () => {
    const a = vaultWith(10, [
      { uuid: 'x', content: 'a-x', updated_at_timestamp: 10 },
      { uuid: 'only-a', updated_at_timestamp: 5 },
    ])
    const b = vaultWith(8, [
      { uuid: 'x', content: 'b-x', updated_at_timestamp: 8 },
      { uuid: 'only-b', updated_at_timestamp: 7 },
    ])

    const merged = mergeVaults([b, a])

    expect(Object.keys(merged.items).sort()).toEqual(['only-a', 'only-b', 'x'])
    expect(merged.items.x.content).toBe('a-x')
    expect(merged.clock).toBe(10)
  })

  it('unions sessions and takes users from the newest copy', () => {
    const user = { uuid: 'u1', email: 'old@x.y', passwordHash: 'h1', passwordSalt: 's', keyParams: {}, createdAt: '' }
    const session = (uuid: string) => ({
      uuid,
      userUuid: 'u1',
      accessToken: uuid,
      refreshToken: uuid,
      accessExpiration: 1,
      refreshExpiration: 1,
      readonlyAccess: false,
      createdAt: '',
      deviceInfo: '',
    })
    const older = vaultWith(1, [], { users: [user], sessions: [session('s1')] })
    const newer = vaultWith(2, [], { users: [{ ...user, email: 'new@x.y' }], sessions: [session('s2')] })

    const merged = mergeVaults([newer, older])

    expect(merged.users).toHaveLength(1)
    expect(merged.users[0].email).toBe('new@x.y')
    expect(merged.sessions.map((s) => s.uuid).sort()).toEqual(['s1', 's2'])
  })

  it('keeps the "moved" marker when merging copies', () => {
    const moved = vaultWith(1, [], { movedTo: { host: 'filen://rite', displayName: 'Filen', at: 'x' } })
    expect(mergeVaults([vaultWith(2, []), moved]).movedTo?.host).toBe('filen://rite')
  })

  it('returns the single vault unchanged and an empty vault for none', () => {
    const only = vaultWith(3, [{ uuid: 'x' }])
    expect(mergeVaults([only])).toBe(only)
    expect(mergeVaults([]).items).toEqual({})
  })
})
