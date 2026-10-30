import { createHash } from 'crypto'
import { HttpStatusCode, HttpVerb } from '@standardnotes/responses'
import { InMemoryVaultStorage } from './InMemoryVaultStorage'
import { RiteVirtualServer } from './RiteVirtualServer'
import { restoreAccountIntoVault } from './RestoreAccount'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const HOST = 'mega://rite'
const keyParams = { identifier: 'me@example.com', pw_nonce: 'nonce', version: '004', origination: 'registration' }
const account = {
  userUuid: 'user-1',
  email: 'Me@Example.com',
  serverPassword: 'derived-server-password',
  keyParams,
  session: { accessToken: 'access', refreshToken: 'refresh', accessExpiration: Date.now() + 1e6, refreshExpiration: Date.now() + 2e6 },
}

function pkce(verifier: string): string {
  return Buffer.from(createHash('sha256').update(verifier).digest('hex')).toString('base64url')
}

describe('restoreAccountIntoVault', () => {
  it('rebuilds the account so the device keeps syncing and the same password still signs in', async () => {
    const storage = new InMemoryVaultStorage()
    const restored = await restoreAccountIntoVault(undefined, account)
    await storage.save(restored as Any)
    const server = new RiteVirtualServer(HOST, storage)
    const call = (verb: HttpVerb, path: string, params: Any, auth?: string) =>
      server.handleRequest<Any>({ url: HOST + path, verb, params, authentication: auth }) as Promise<Any>

    // The device's existing session works again…
    const sync = await call(HttpVerb.Post, '/v1/items', { items: [{ uuid: 'n1', content_type: 'Note', content: '004:x', enc_item_key: 'k' }] }, 'access')
    expect(sync.status).toBe(HttpStatusCode.Success)
    expect(sync.data.saved_items[0].user_uuid).toBe('user-1')

    // …and a new device can sign in with the same email and (derived) password.
    await call(HttpVerb.Post, '/v2/login-params', { email: 'me@example.com', code_challenge: pkce('v') })
    const login = await call(HttpVerb.Post, '/v2/login', { email: 'me@example.com', password: 'derived-server-password', code_verifier: 'v' })
    expect(login.status).toBe(HttpStatusCode.Success)
    expect(login.data.key_params).toMatchObject(keyParams)
    expect(JSON.stringify(await storage.load())).not.toContain('derived-server-password')
  })

  it('does nothing when the vault already has the account', async () => {
    const once = await restoreAccountIntoVault(undefined, account)
    expect(await restoreAccountIntoVault(once, account)).toBeUndefined()
  })
})
