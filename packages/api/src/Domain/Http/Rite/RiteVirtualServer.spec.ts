import { createHash } from 'crypto'
import { HttpRequest, HttpStatusCode, HttpVerb } from '@standardnotes/responses'
import { InMemoryVaultStorage } from './InMemoryVaultStorage'
import { RiteVirtualServer } from './RiteVirtualServer'
import { VaultStorageAuthRequiredError, VaultStorageConflictError, VaultStorageInterface } from './VaultStorageInterface'

const HOST = 'mega://rite'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const keyParams = { identifier: 'me@example.com', pw_nonce: 'nonce', version: '004', origination: 'registration' }

function request(verb: HttpVerb, path: string, params?: Record<string, unknown>, authentication?: string): HttpRequest {
  return { url: `${HOST}${path}`, verb, params: { api: '20200115', ...params } as Any, authentication }
}

function pkce(verifier: string): string {
  const hex = createHash('sha256').update(verifier).digest('hex')
  return Buffer.from(hex).toString('base64url')
}

function item(uuid: string, content: string, updatedAt?: number, extra: Record<string, unknown> = {}) {
  return {
    uuid,
    content_type: 'Note',
    content: `004:${content}`,
    enc_item_key: `004:key-${uuid}`,
    items_key_id: 'items-key-1',
    deleted: false,
    updated_at_timestamp: updatedAt,
    ...extra,
  }
}

describe('RiteVirtualServer', () => {
  let storage: InMemoryVaultStorage
  let server: RiteVirtualServer

  const call = async (req: HttpRequest) => (await server.handleRequest<Any>(req)) as Any

  const register = async (email = 'me@example.com', password = 'server-pw') => {
    const response = await call(request(HttpVerb.Post, '/v1/users', { email, password, ...keyParams, ephemeral: false }))
    return response
  }

  const signIn = async (email = 'me@example.com', password = 'server-pw') => {
    const verifier = 'verifier-' + Math.random()
    const params = await call(request(HttpVerb.Post, '/v2/login-params', { email, code_challenge: pkce(verifier) }))
    const login = await call(
      request(HttpVerb.Post, '/v2/login', { email, password, code_verifier: verifier, ephemeral: false }),
    )
    return { params, login }
  }

  beforeEach(() => {
    storage = new InMemoryVaultStorage()
    server = new RiteVirtualServer(HOST, storage)
  })

  it('registers a user, stores only a password hash, and returns a session', async () => {
    const response = await register()

    expect(response.status).toBe(HttpStatusCode.Success)
    expect(response.data.session.access_token).toHaveLength(64)
    expect(response.data.user.email).toBe('me@example.com')
    expect(response.meta.auth.userUuid).toBe(response.data.user.uuid)

    const vault = (await storage.load()) as Any
    expect(vault.users).toHaveLength(1)
    expect(JSON.stringify(vault)).not.toContain('server-pw')
    expect(vault.users[0].keyParams).toMatchObject(keyParams)
    expect(vault.users[0].keyParams.api).toBeUndefined()
  })

  it('rejects registering the same email twice', async () => {
    await register()
    const second = await register('ME@example.com ')
    expect(second.status).toBe(HttpStatusCode.BadRequest)
  })

  it('signs in with PKCE and returns key params', async () => {
    await register()
    const { params, login } = await signIn()

    expect(params.status).toBe(HttpStatusCode.Success)
    expect(params.data).toMatchObject(keyParams)
    expect(login.status).toBe(HttpStatusCode.Success)
    expect(login.data.key_params).toMatchObject(keyParams)
    expect(login.data.session.refresh_token).toBeDefined()
  })

  it('rejects a wrong password, an unknown email and a bad PKCE verifier', async () => {
    await register()

    expect((await signIn('me@example.com', 'wrong')).login.status).toBe(HttpStatusCode.Unauthorized)
    expect((await signIn('nobody@example.com')).params.status).toBe(HttpStatusCode.Unauthorized)

    await call(request(HttpVerb.Post, '/v2/login-params', { email: 'me@example.com', code_challenge: pkce('a') }))
    const bad = await call(
      request(HttpVerb.Post, '/v2/login', { email: 'me@example.com', password: 'server-pw', code_verifier: 'b' }),
    )
    expect(bad.status).toBe(HttpStatusCode.Unauthorized)
  })

  it('requires a valid access token for sync', async () => {
    const response = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, 'not-a-token'))
    expect(response.status).toBe(HttpStatusCode.Unauthorized)
  })

  it('saves items and delivers them to a second device', async () => {
    const deviceA = (await register()).data.session.access_token
    const saved = await call(
      request(HttpVerb.Post, '/v1/items', { items: [item('a', 'one'), item('b', 'two')] }, deviceA),
    )
    expect(saved.data.saved_items).toHaveLength(2)
    expect(saved.data.conflicts).toEqual([])
    expect(saved.data.saved_items[0].updated_at_timestamp).toBeLessThan(saved.data.saved_items[1].updated_at_timestamp)

    const deviceB = (await signIn()).login.data.session.access_token
    const pulled = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, deviceB))
    expect(pulled.data.retrieved_items.map((i: Any) => i.uuid).sort()).toEqual(['a', 'b'])
    expect(pulled.data.retrieved_items[0].content).toBe('004:one')

    // Nothing new since the last token
    const again = await call(
      request(HttpVerb.Post, '/v1/items', { items: [], sync_token: pulled.data.sync_token }, deviceB),
    )
    expect(again.data.retrieved_items).toEqual([])
  })

  it('only sends changes made after the sync token', async () => {
    const token = (await register()).data.session.access_token
    const first = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'one')] }, token))
    const ts = first.data.saved_items[0].updated_at_timestamp

    await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'edited', ts)] }, token))
    const delta = await call(
      request(HttpVerb.Post, '/v1/items', { items: [], sync_token: first.data.sync_token }, token),
    )
    expect(delta.data.retrieved_items).toHaveLength(1)
    expect(delta.data.retrieved_items[0].content).toBe('004:edited')
  })

  it('reports a conflict when an item was changed elsewhere, and accepts identical content', async () => {
    const token = (await register()).data.session.access_token
    const first = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'one')] }, token))
    const ts = first.data.saved_items[0].updated_at_timestamp

    await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'from-device-a', ts)] }, token))

    const stale = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'from-device-b', ts)] }, token))
    expect(stale.data.saved_items).toEqual([])
    expect(stale.data.conflicts).toHaveLength(1)
    expect(stale.data.conflicts[0].type).toBe('sync_conflict')
    expect(stale.data.conflicts[0].server_item.content).toBe('004:from-device-a')

    const identical = await call(
      request(HttpVerb.Post, '/v1/items', { items: [item('a', 'from-device-a', ts)] }, token),
    )
    expect(identical.data.conflicts).toEqual([])
  })

  it('paginates large downloads with a cursor token', async () => {
    const token = (await register()).data.session.access_token
    const items = Array.from({ length: 7 }, (_, i) => item(`item-${i}`, `n${i}`))
    await call(request(HttpVerb.Post, '/v1/items', { items }, token))

    const device = (await signIn()).login.data.session.access_token
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await call(
        request(HttpVerb.Post, '/v1/items', { items: [], limit: 3, cursor_token: cursor }, device),
      )
      seen.push(...page.data.retrieved_items.map((i: Any) => i.uuid))
      cursor = page.data.cursor_token
      pages++
    } while (cursor && pages < 10)

    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(7)
  })

  it('keeps deletions as tombstones for other devices but hides them from a fresh download', async () => {
    const token = (await register()).data.session.access_token
    const first = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'one')] }, token))
    const syncToken = first.data.sync_token
    const ts = first.data.saved_items[0].updated_at_timestamp

    await call(
      request(HttpVerb.Post, '/v1/items', { items: [{ ...item('a', '', ts), deleted: true, content: null }] }, token),
    )

    const delta = await call(request(HttpVerb.Post, '/v1/items', { items: [], sync_token: syncToken }, token))
    expect(delta.data.retrieved_items[0].deleted).toBe(true)
    expect(delta.data.retrieved_items[0].content).toBeNull()

    const fresh = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, token))
    expect(fresh.data.retrieved_items).toEqual([])
  })

  it('isolates users that share a vault', async () => {
    const alice = (await register('alice@example.com')).data.session.access_token
    const bob = (await register('bob@example.com')).data.session.access_token
    await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'secret')] }, alice))

    const bobView = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, bob))
    expect(bobView.data.retrieved_items).toEqual([])

    const steal = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'mine')] }, bob))
    expect(steal.data.conflicts[0].type).toBe('uuid_conflict')
  })

  it('refreshes sessions, signs out, and expires access tokens with status 498', async () => {
    const session = (await register()).data.session
    const refreshed = await call(
      request(HttpVerb.Post, '/v1/sessions/refresh', {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    )
    expect(refreshed.status).toBe(HttpStatusCode.Success)
    const newToken = refreshed.data.session.access_token
    expect(newToken).not.toBe(session.access_token)

    const vault = (await storage.load()) as Any
    vault.sessions[0].accessExpiration = Date.now() - 1
    await storage.save(vault)
    const expired = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, newToken))
    expect(expired.status).toBe(HttpStatusCode.ExpiredAccessToken)

    vault.sessions[0].accessExpiration = Date.now() + 100000
    await storage.save(vault)
    await call(request(HttpVerb.Post, '/v1/logout', {}, newToken))
    const afterLogout = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, newToken))
    expect(afterLogout.status).toBe(HttpStatusCode.Unauthorized)
  })

  it('changes the password and signs out other devices', async () => {
    const reg = await register()
    const other = (await signIn()).login.data.session.access_token
    const changed = await call(
      request(
        HttpVerb.Put,
        `/v1/users/${reg.data.user.uuid}/attributes/credentials`,
        { current_password: 'server-pw', new_password: 'new-pw', ...keyParams, pw_nonce: 'nonce-2' },
        reg.data.session.access_token,
      ),
    )
    expect(changed.status).toBe(HttpStatusCode.Success)
    expect(changed.data.key_params.pw_nonce).toBe('nonce-2')

    expect((await call(request(HttpVerb.Post, '/v1/items', {}, other))).status).toBe(HttpStatusCode.Unauthorized)
    expect((await signIn('me@example.com', 'server-pw')).login.status).toBe(HttpStatusCode.Unauthorized)
    expect((await signIn('me@example.com', 'new-pw')).login.status).toBe(HttpStatusCode.Success)
  })

  it('answers integrity checks with the items the client is missing or has stale', async () => {
    const token = (await register()).data.session.access_token
    const saved = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', '1'), item('b', '2')] }, token))
    const [a] = saved.data.saved_items

    const check = await call(
      request(
        HttpVerb.Post,
        '/v1/items/check-integrity',
        { integrityPayloads: [{ uuid: 'a', updated_at_timestamp: a.updated_at_timestamp }] },
        token,
      ),
    )
    expect(check.data.mismatches.map((m: Any) => m.uuid)).toEqual(['b'])
  })

  it('does not persist the vault for read-only requests', async () => {
    const token = (await register()).data.session.access_token
    const before = storage.saveCount
    await call(request(HttpVerb.Post, '/v1/items', { items: [] }, token))
    await call(request(HttpVerb.Get, '/v1/sessions', undefined, token))
    expect(storage.saveCount).toBe(before)
  })

  it('returns a clear error for features the vault does not support', async () => {
    const token = (await register()).data.session.access_token
    const response = await call(request(HttpVerb.Post, '/v1/files/valet-tokens', {}, token))
    expect(response.status).toBe(HttpStatusCode.BadRequest)
    expect(response.data.error.message).toContain('not available')
  })

  it('surfaces storage sign-in problems as 401 errors with the backend message', async () => {
    const failing: VaultStorageInterface = {
      displayName: 'MEGA',
      load: async () => {
        throw new VaultStorageAuthRequiredError('Connect your MEGA account to sync.')
      },
      save: async () => undefined,
    }
    server = new RiteVirtualServer(HOST, failing)
    const response = await call(request(HttpVerb.Post, '/v2/login-params', { email: 'x@y.z' }))
    expect(response.status).toBe(HttpStatusCode.Unauthorized)
    expect(response.data.error.message).toBe('Connect your MEGA account to sync.')
  })

  it('replays a request on the fresh vault when another device saved in between', async () => {
    const token = (await register()).data.session.access_token
    const first = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'one')] }, token))
    const ts = first.data.saved_items[0].updated_at_timestamp

    // Simulate device B writing the vault between this device's load() and save().
    const otherDevice = new RiteVirtualServer(HOST, storage)
    const realSave = storage.save.bind(storage)
    let injected = false
    storage.save = async (state) => {
      if (!injected) {
        injected = true
        await otherDevice.handleRequest(request(HttpVerb.Post, '/v1/items', { items: [item('b', 'from-b')] }, token))
        throw new VaultStorageConflictError()
      }
      return realSave(state)
    }

    const result = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'edited', ts)] }, token))
    expect(result.data.saved_items[0].content).toBe('004:edited')

    const vault = (await storage.load()) as Any
    expect(vault.items.a.content).toBe('004:edited')
    expect(vault.items.b.content).toBe('004:from-b')
  })

  it('never sends null optional fields (the client reads null vault ids as "in a vault")', async () => {
    const token = (await register()).data.session.access_token
    const saved = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'one')] }, token))
    const pulled = await call(request(HttpVerb.Post, '/v1/items', { items: [] }, (await signIn()).login.data.session.access_token))

    for (const sent of [...saved.data.saved_items, ...pulled.data.retrieved_items]) {
      for (const field of ['key_system_identifier', 'shared_vault_uuid', 'duplicate_of', 'auth_hash']) {
        expect(field in sent).toBe(false)
      }
    }

    const ts = saved.data.saved_items[0].updated_at_timestamp
    await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'two', ts)] }, token))
    const conflict = await call(request(HttpVerb.Post, '/v1/items', { items: [item('a', 'three', ts)] }, token))
    expect('key_system_identifier' in conflict.data.conflicts[0].server_item).toBe(false)
  })

  it('tells devices where the notes went once the vault was moved', async () => {
    const token = (await register()).data.session.access_token
    const vault = (await storage.load()) as Any
    vault.movedTo = { host: 'filen://rite', displayName: 'Filen', at: '2026-10-30T08:00:00Z' }
    await storage.save(vault)

    for (const response of [
      await call(request(HttpVerb.Post, '/v1/items', { items: [] }, token)),
      await call(request(HttpVerb.Post, '/v2/login-params', { email: 'me@example.com', code_challenge: 'x' })),
    ]) {
      expect(response.status).toBe(HttpStatusCode.BadRequest)
      expect(response.data.error.message).toContain('moved to Filen')
    }
  })

  it('processes concurrent requests one at a time', async () => {
    const token = (await register()).data.session.access_token
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        call(request(HttpVerb.Post, '/v1/items', { items: [item(`c${i}`, `${i}`)] }, token)),
      ),
    )
    expect(results.every((r: Any) => r.data.saved_items.length === 1)).toBe(true)
    const vault = (await storage.load()) as Any
    expect(Object.keys(vault.items)).toHaveLength(5)
  })
})
