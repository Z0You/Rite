import { HttpRequest, HttpRequestParams, HttpResponse, HttpStatusCode, HttpVerb } from '@standardnotes/responses'
import { RequestHandlerInterface } from '../RequestHandlerInterface'
import { VaultStorageAuthRequiredError, VaultStorageConflictError, VaultStorageInterface } from './VaultStorageInterface'
import { createEmptyVault, VaultItem, VaultSession, VaultState, VaultUser } from './VaultTypes'

type Params = Record<string, unknown>

type RouteContext = {
  verb: HttpVerb
  path: string
  params: Params
  authentication?: string
}

type RouteResult = {
  status: number
  data: unknown
  /** Set when the vault was modified and must be persisted. */
  changed?: boolean
  userUuid?: string
}

const ACCESS_TOKEN_LIFETIME_MS = 60 * 24 * 3600 * 1000 // 60 days
const REFRESH_TOKEN_LIFETIME_MS = 365 * 24 * 3600 * 1000 // 1 year
const DEFAULT_SYNC_LIMIT = 150
const MAX_SYNC_LIMIT = 500
const SYNC_TOKEN_PREFIX = 'rite:'
const MAX_CONFLICT_RETRIES = 4

const InvalidLoginMessage = 'Invalid email or password.'

/**
 * A complete Standard Notes–compatible sync server that runs inside the app.
 *
 * Instead of talking to a remote API, requests addressed to a Rite storage host
 * (for example `mega://rite`) are answered here, and the resulting state is persisted
 * through a `VaultStorageInterface` (for example a file in the user's MEGA account).
 *
 * Because the client encrypts every item before syncing, the vault only ever contains
 * ciphertext. The server password received here is a value derived with Argon2id from the
 * user's password; it is stored only as a salted SHA-256 hash.
 */
/**
 * Optional item fields are omitted rather than sent as null: the client treats any value other
 * than `undefined` (for example `key_system_identifier: null`) as "this item belongs to a vault".
 */
const OptionalItemFields = [
  'items_key_id',
  'auth_hash',
  'duplicate_of',
  'key_system_identifier',
  'shared_vault_uuid',
  'last_edited_by_uuid',
] as const

export function publicItem(item: VaultItem): VaultItem {
  const copy = { ...item }
  for (const field of OptionalItemFields) {
    if (copy[field] === null || copy[field] === undefined) {
      delete copy[field]
    }
  }
  return copy
}

export class RiteVirtualServer implements RequestHandlerInterface {
  private queue: Promise<unknown> = Promise.resolve()
  private codeChallenges = new Map<string, string>()

  constructor(
    private readonly host: string,
    private readonly storage: VaultStorageInterface,
    private readonly deviceInfo: string = 'Rite',
  ) {}

  handleRequest<T>(httpRequest: HttpRequest): Promise<HttpResponse<T>> {
    // Requests are processed one at a time so read-modify-write cycles never interleave.
    const run = this.queue.then(() => this.process<T>(httpRequest))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async process<T>(httpRequest: HttpRequest): Promise<HttpResponse<T>> {
    const context: RouteContext = {
      verb: httpRequest.verb,
      path: this.extractPath(httpRequest.url),
      params: (httpRequest.params as Params) ?? {},
      authentication: httpRequest.authentication,
    }

    try {
      for (let attempt = 1; ; attempt++) {
        const challengesSnapshot = new Map(this.codeChallenges)
        const state = (await this.storage.load()) ?? createEmptyVault()
        const result = await this.route(state, context)
        this.debugTrace(context, result, attempt)

        if (result.changed) {
          try {
            await this.storage.save(state)
          } catch (error) {
            if (error instanceof VaultStorageConflictError && attempt < MAX_CONFLICT_RETRIES) {
              // Another device wrote the vault after we loaded it: replay on the fresh copy.
              this.codeChallenges = challengesSnapshot
              continue
            }
            throw error
          }
        }

        return this.toResponse<T>(result)
      }
    } catch (error) {
      if (error instanceof VaultStorageAuthRequiredError) {
        return this.toResponse<T>(this.error(HttpStatusCode.Unauthorized, error.message))
      }
      const message = error instanceof Error ? error.message : String(error)
      return this.toResponse<T>(
        this.error(HttpStatusCode.InternalServerError, `${this.storage.displayName} sync failed: ${message}`),
      )
    }
  }

  /** Opt-in request trace for troubleshooting: set `window.__riteDebugSync = true` in the console. */
  private debugTrace(context: RouteContext, result: RouteResult, attempt: number): void {
    if (!(globalThis as { __riteDebugSync?: boolean }).__riteDebugSync) {
      return
    }
    const short = (value: unknown) => (typeof value === 'string' ? value.slice(0, 8) : String(value))
    const items = Array.isArray(context.params.items) ? (context.params.items as Params[]) : []
    const data = (result.data ?? {}) as Params
    const list = (value: unknown) =>
      Array.isArray(value)
        ? (value as Params[]).map((item) => {
            const inner = (item.server_item ?? item.unsaved_item ?? item) as Params
            return `${item.type ? item.type + ':' : ''}${short(inner.uuid)}@${inner.updated_at_timestamp}`
          })
        : []
    // eslint-disable-next-line no-console
    console.debug(
      `[Rite sync] ${context.verb} ${context.path} → ${result.status}` +
        (attempt > 1 ? ` (attempt ${attempt})` : '') +
        (items.length ? ` | sent ${items.map((i) => `${short(i.uuid)}@${i.updated_at_timestamp}`).join(', ')}` : '') +
        (Array.isArray(data.saved_items) ? ` | saved ${list(data.saved_items).join(', ')}` : '') +
        (Array.isArray(data.conflicts) && data.conflicts.length ? ` | CONFLICTS ${list(data.conflicts).join(', ')}` : '') +
        (Array.isArray(data.retrieved_items) && data.retrieved_items.length
          ? ` | retrieved ${list(data.retrieved_items).join(', ')}`
          : ''),
    )
  }

  private extractPath(url: string): string {
    let path = url.startsWith(this.host) ? url.slice(this.host.length) : url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
    const queryIndex = path.indexOf('?')
    if (queryIndex !== -1) {
      path = path.slice(0, queryIndex)
    }
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    return path.replace(/\/+$/, '')
  }

  private toResponse<T>(result: RouteResult): HttpResponse<T> {
    const response = {
      status: result.status,
      headers: new Map<string, string | null>(),
      data: result.data,
    } as HttpResponse<T>

    if (result.userUuid) {
      response.meta = {
        auth: { userUuid: result.userUuid, roles: [{ uuid: 'rite-core-user', name: 'CORE_USER' }] },
        server: {},
      }
    }

    return response
  }

  private error(status: number, message: string, tag?: string): RouteResult {
    return { status, data: { error: { message, tag } } }
  }

  private ok(data: unknown, extra: Partial<RouteResult> = {}): RouteResult {
    return { status: HttpStatusCode.Success, data, ...extra }
  }

  /* ------------------------------------------------------------------ routing */

  private async route(state: VaultState, ctx: RouteContext): Promise<RouteResult> {
    const { verb, path } = ctx
    const post = verb === HttpVerb.Post

    if (state.movedTo) {
      const where = state.movedTo.displayName
      return this.error(
        HttpStatusCode.BadRequest,
        `Your Rite notes were moved to ${where}. On this device, open Preferences → Account → Sync storage and choose “Move to ${where}” to switch this device over.`,
        'rite-vault-moved',
      )
    }

    // Unauthenticated endpoints
    if (post && path === '/v1/users') {
      return this.register(state, ctx.params)
    }
    if (post && (path === '/v2/login-params' || path === '/v1/login-params')) {
      return this.loginParams(state, ctx.params)
    }
    if (post && (path === '/v2/login' || path === '/v1/login')) {
      return this.login(state, ctx.params, path === '/v2/login')
    }
    if (post && path === '/v1/sessions/refresh') {
      return this.refreshSession(state, ctx.params)
    }
    if (verb === HttpVerb.Get && path === '/v1/meta') {
      return this.ok({ captchaUIUrl: null })
    }

    // Authenticated endpoints
    const auth = this.authenticate(state, ctx.authentication)
    if ('status' in auth) {
      return auth
    }
    const { user, session } = auth
    const withUser = (result: RouteResult): RouteResult => ({ ...result, userUuid: user.uuid })

    if (post && (path === '/v1/items' || path === '/v1/items/sync')) {
      return withUser(this.sync(state, user, ctx.params))
    }
    if (post && path === '/v1/items/check-integrity') {
      return withUser(this.checkIntegrity(state, user, ctx.params))
    }
    if (post && path === '/v1/logout') {
      state.sessions = state.sessions.filter((candidate) => candidate.uuid !== session.uuid)
      return this.ok({}, { status: HttpStatusCode.NoContent, changed: true })
    }

    const itemMatch = path.match(/^\/v1\/items\/([0-9a-f-]+)$/i)
    if (verb === HttpVerb.Get && itemMatch) {
      const item = state.items[itemMatch[1]]
      if (!item || item.user_uuid !== user.uuid) {
        return this.error(404, 'Item not found.')
      }
      return withUser(this.ok({ item: publicItem(item) }))
    }

    if (/^\/v[12]\/items\/[0-9a-f-]+\/revisions(\/.*)?$/i.test(path)) {
      // Rite keeps note history on each device; the MEGA vault does not store server revisions.
      return withUser(verb === HttpVerb.Get && path.endsWith('/revisions') ? this.ok([]) : this.ok({}))
    }

    const userMatch = path.match(/^\/v1\/users\/([0-9a-f-]+)(\/.*)?$/i)
    if (userMatch) {
      if (userMatch[1] !== user.uuid) {
        return this.error(HttpStatusCode.Forbidden, 'Operation not allowed.')
      }
      const sub = userMatch[2] ?? ''

      if (verb === HttpVerb.Put && sub === '/attributes/credentials') {
        return withUser(await this.changeCredentials(state, user, session, ctx.params))
      }
      if (verb === HttpVerb.Delete && sub === '') {
        this.deleteAccount(state, user)
        return this.ok({ message: 'Account deleted.' }, { changed: true })
      }
      if (verb === HttpVerb.Get && sub === '/subscription') {
        return withUser(this.ok({}))
      }
      if (verb === HttpVerb.Get && sub === '/settings') {
        return withUser(this.ok({ settings: [] }))
      }
      if (verb === HttpVerb.Get && sub.startsWith('/settings/')) {
        return this.error(404, 'Setting not found.')
      }
      if (verb === HttpVerb.Get && sub.startsWith('/subscription-settings')) {
        return this.error(404, 'Setting not found.')
      }
      if (verb === HttpVerb.Get && sub === '/requests') {
        return withUser(this.ok({}))
      }
    }

    if (verb === HttpVerb.Get && path === '/v1/sessions') {
      return withUser(
        this.ok(
          state.sessions
            .filter((candidate) => candidate.userUuid === user.uuid)
            .map((candidate) => ({
              uuid: candidate.uuid,
              created_at: candidate.createdAt,
              updated_at: candidate.createdAt,
              device_info: candidate.deviceInfo,
              current: candidate.uuid === session.uuid,
            })),
        ),
      )
    }

    const sessionMatch = path.match(/^\/v1\/sessions\/([0-9a-f-]+)$/i)
    if (verb === HttpVerb.Delete && sessionMatch) {
      state.sessions = state.sessions.filter(
        (candidate) => !(candidate.uuid === sessionMatch[1] && candidate.userUuid === user.uuid),
      )
      return this.ok({}, { status: HttpStatusCode.NoContent, changed: true })
    }
    if (verb === HttpVerb.Delete && path === '/v1/sessions') {
      state.sessions = state.sessions.filter(
        (candidate) => candidate.userUuid !== user.uuid || candidate.uuid === session.uuid,
      )
      return this.ok({}, { status: HttpStatusCode.NoContent, changed: true })
    }

    if (verb === HttpVerb.Get && (path === '/v2/subscriptions' || path === '/v1/authenticators')) {
      return withUser(this.ok(path === '/v1/authenticators' ? [] : {}))
    }

    if (verb === HttpVerb.Get && (path === '/v1/messages/inbound' || path === '/v1/messages/outbound')) {
      return withUser(this.ok({ messages: [] }))
    }
    if (verb === HttpVerb.Get && (path === '/v1/shared-vaults' || path.startsWith('/v1/shared-vaults/invites'))) {
      return withUser(this.ok(path === '/v1/shared-vaults' ? { sharedVaults: [] } : { invites: [] }))
    }

    // eslint-disable-next-line no-console
    console.warn(`[Rite] ${this.storage.displayName} sync does not support ${verb} ${path}`)
    return this.error(
      HttpStatusCode.BadRequest,
      `This feature is not available when syncing with ${this.storage.displayName}.`,
      'rite-unsupported',
    )
  }

  /* ------------------------------------------------------------ authentication */

  private async register(state: VaultState, params: Params): Promise<RouteResult> {
    const email = this.normalizeEmail(params.email)
    const password = params.password
    if (!email || typeof password !== 'string' || password.length === 0) {
      return this.error(HttpStatusCode.BadRequest, 'Please provide an email address and a password.')
    }
    if (this.findUser(state, email)) {
      return this.error(HttpStatusCode.BadRequest, 'This email is already registered in this vault.')
    }

    const keyParams = this.extractKeyParams(params)
    const passwordSalt = this.randomHex(16)
    const now = new Date().toISOString()

    const user: VaultUser = {
      uuid: this.uuid(),
      email,
      passwordSalt,
      passwordHash: await this.hashPassword(passwordSalt, password),
      keyParams: { ...keyParams, identifier: keyParams.identifier ?? email, created: keyParams.created ?? now },
      createdAt: now,
    }
    state.users.push(user)

    const session = this.createSession(state, user, params.ephemeral === true)

    return this.ok(
      { session: this.sessionBody(session), key_params: user.keyParams, user: { uuid: user.uuid, email: user.email } },
      { changed: true, userUuid: user.uuid },
    )
  }

  private loginParams(state: VaultState, params: Params): RouteResult {
    const email = this.normalizeEmail(params.email)
    const user = email ? this.findUser(state, email) : undefined
    if (!user) {
      return this.error(HttpStatusCode.Unauthorized, InvalidLoginMessage)
    }

    if (typeof params.code_challenge === 'string') {
      this.codeChallenges.set(user.email, params.code_challenge)
    }

    return this.ok({ ...user.keyParams })
  }

  private async login(state: VaultState, params: Params, requirePkce: boolean): Promise<RouteResult> {
    const email = this.normalizeEmail(params.email)
    const user = email ? this.findUser(state, email) : undefined
    if (!user || typeof params.password !== 'string') {
      return this.error(HttpStatusCode.Unauthorized, InvalidLoginMessage)
    }

    if (requirePkce) {
      const challenge = this.codeChallenges.get(user.email)
      this.codeChallenges.delete(user.email)
      const verifier = params.code_verifier
      if (!challenge || typeof verifier !== 'string' || (await this.pkceChallenge(verifier)) !== challenge) {
        return this.error(HttpStatusCode.Unauthorized, 'Sign in request expired. Please try again.')
      }
    }

    const hash = await this.hashPassword(user.passwordSalt, params.password)
    if (!this.constantTimeEquals(hash, user.passwordHash)) {
      return this.error(HttpStatusCode.Unauthorized, InvalidLoginMessage)
    }

    const session = this.createSession(state, user, params.ephemeral === true)

    return this.ok(
      { session: this.sessionBody(session), key_params: user.keyParams, user: { uuid: user.uuid, email: user.email } },
      { changed: true, userUuid: user.uuid },
    )
  }

  private refreshSession(state: VaultState, params: Params): RouteResult {
    const session = state.sessions.find(
      (candidate) => candidate.accessToken === params.access_token && candidate.refreshToken === params.refresh_token,
    )
    if (!session || session.refreshExpiration < Date.now()) {
      return this.error(HttpStatusCode.Unauthorized, 'Your session has expired. Please sign in again.', 'invalid-auth')
    }

    const now = Date.now()
    session.accessToken = this.randomHex(32)
    session.refreshToken = this.randomHex(32)
    session.accessExpiration = now + ACCESS_TOKEN_LIFETIME_MS
    session.refreshExpiration = now + REFRESH_TOKEN_LIFETIME_MS

    return this.ok({ session: this.sessionBody(session) }, { changed: true, userUuid: session.userUuid })
  }

  private authenticate(
    state: VaultState,
    accessToken: string | undefined,
  ): { user: VaultUser; session: VaultSession } | RouteResult {
    const session = accessToken ? state.sessions.find((candidate) => candidate.accessToken === accessToken) : undefined
    const user = session ? state.users.find((candidate) => candidate.uuid === session.userUuid) : undefined

    if (!session || !user) {
      return this.error(HttpStatusCode.Unauthorized, 'Invalid login credentials.', 'invalid-auth')
    }
    if (session.accessExpiration < Date.now()) {
      return this.error(HttpStatusCode.ExpiredAccessToken, 'The provided access token has expired.', 'expired-access-token')
    }
    return { user, session }
  }

  private async changeCredentials(
    state: VaultState,
    user: VaultUser,
    session: VaultSession,
    params: Params,
  ): Promise<RouteResult> {
    if (typeof params.current_password !== 'string' || typeof params.new_password !== 'string') {
      return this.error(HttpStatusCode.BadRequest, 'Please provide your current and new password.')
    }
    const currentHash = await this.hashPassword(user.passwordSalt, params.current_password)
    if (!this.constantTimeEquals(currentHash, user.passwordHash)) {
      return this.error(HttpStatusCode.Unauthorized, 'The current password you entered is incorrect.')
    }

    const newEmail = this.normalizeEmail(params.new_email)
    if (newEmail && newEmail !== user.email) {
      if (this.findUser(state, newEmail)) {
        return this.error(HttpStatusCode.BadRequest, 'This email is already registered in this vault.')
      }
      user.email = newEmail
    }

    user.passwordSalt = this.randomHex(16)
    user.passwordHash = await this.hashPassword(user.passwordSalt, params.new_password)
    user.keyParams = { ...this.extractKeyParams(params) }

    // Sign out every other device, like the hosted server does after a password change.
    state.sessions = state.sessions.filter((candidate) => candidate.userUuid !== user.uuid)
    const newSession = this.createSession(state, user, session.readonlyAccess)

    return this.ok(
      { session: this.sessionBody(newSession), key_params: user.keyParams, user: { uuid: user.uuid, email: user.email } },
      { changed: true },
    )
  }

  private deleteAccount(state: VaultState, user: VaultUser): void {
    state.users = state.users.filter((candidate) => candidate.uuid !== user.uuid)
    state.sessions = state.sessions.filter((candidate) => candidate.userUuid !== user.uuid)
    for (const uuid of Object.keys(state.items)) {
      if (state.items[uuid].user_uuid === user.uuid) {
        delete state.items[uuid]
      }
    }
  }

  /* ---------------------------------------------------------------------- sync */

  private sync(state: VaultState, user: VaultUser, params: Params): RouteResult {
    const incoming = Array.isArray(params.items) ? (params.items as Params[]) : []
    const limit = Math.min(
      MAX_SYNC_LIMIT,
      typeof params.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_SYNC_LIMIT,
    )

    const savedItems: VaultItem[] = []
    const conflicts: Params[] = []
    let changed = false

    for (const raw of incoming) {
      const uuid = typeof raw.uuid === 'string' ? raw.uuid : undefined
      if (!uuid || typeof raw.content_type !== 'string') {
        conflicts.push({ type: 'content_type_error', unsaved_item: raw })
        continue
      }

      const existing = state.items[uuid]

      if (existing && existing.user_uuid !== user.uuid) {
        conflicts.push({ type: 'uuid_conflict', unsaved_item: raw })
        continue
      }

      if (existing) {
        const incomingTimestamp = typeof raw.updated_at_timestamp === 'number' ? raw.updated_at_timestamp : undefined
        if (incomingTimestamp !== existing.updated_at_timestamp) {
          if (this.sameContent(existing, raw)) {
            savedItems.push(existing)
            continue
          }
          conflicts.push({ type: 'sync_conflict', server_item: existing })
          continue
        }
      }

      const timestamp = this.tick(state)
      const deleted = raw.deleted === true
      const iso = new Date(Math.floor(timestamp / 1000)).toISOString()

      const item: VaultItem = {
        uuid,
        user_uuid: user.uuid,
        content_type: raw.content_type,
        content: deleted ? null : (raw.content as string | null) ?? null,
        enc_item_key: deleted ? null : (raw.enc_item_key as string | null) ?? null,
        items_key_id: deleted ? null : (raw.items_key_id as string | null) ?? null,
        auth_hash: (raw.auth_hash as string | null) ?? null,
        duplicate_of: (raw.duplicate_of as string | null) ?? null,
        key_system_identifier: (raw.key_system_identifier as string | null) ?? null,
        shared_vault_uuid: null,
        last_edited_by_uuid: user.uuid,
        deleted,
        created_at_timestamp: existing?.created_at_timestamp ?? this.createdTimestamp(raw, timestamp),
        updated_at_timestamp: timestamp,
        created_at: existing?.created_at ?? this.createdIso(raw, iso),
        updated_at: iso,
      }

      state.items[uuid] = item
      savedItems.push(item)
      changed = true
    }

    const savedUuids = new Set(savedItems.map((item) => item.uuid))
    const since = this.decodeToken(params.cursor_token) ?? this.decodeToken(params.sync_token) ?? 0
    const isInitialDownload = params.sync_token === undefined && params.cursor_token === undefined

    const candidates = Object.values(state.items)
      .filter(
        (item) =>
          item.user_uuid === user.uuid &&
          item.updated_at_timestamp > since &&
          !savedUuids.has(item.uuid) &&
          !(isInitialDownload && item.deleted),
      )
      .sort((a, b) => a.updated_at_timestamp - b.updated_at_timestamp)

    const retrieved = candidates.slice(0, limit)
    const hasMore = candidates.length > limit

    const data: Params = {
      retrieved_items: retrieved.map(publicItem),
      saved_items: savedItems.map(publicItem),
      conflicts: conflicts.map((conflict) =>
        conflict.server_item ? { ...conflict, server_item: publicItem(conflict.server_item as VaultItem) } : conflict,
      ),
      unsaved: [],
      sync_token: this.encodeToken(state.clock),
    }
    if (hasMore) {
      data.cursor_token = this.encodeToken(retrieved[retrieved.length - 1].updated_at_timestamp)
    }

    return this.ok(data, { changed })
  }

  private checkIntegrity(state: VaultState, user: VaultUser, params: Params): RouteResult {
    const payloads = Array.isArray(params.integrityPayloads)
      ? (params.integrityPayloads as { uuid: string; updated_at_timestamp: number }[])
      : []
    const clientMap = new Map(payloads.map((payload) => [payload.uuid, payload.updated_at_timestamp]))

    const mismatches: { uuid: string; updated_at_timestamp: number }[] = []
    for (const item of Object.values(state.items)) {
      if (item.user_uuid !== user.uuid || item.deleted || this.isNonSyncedType(item.content_type)) {
        continue
      }
      if (clientMap.get(item.uuid) !== item.updated_at_timestamp) {
        mismatches.push({ uuid: item.uuid, updated_at_timestamp: item.updated_at_timestamp })
      }
    }

    return this.ok({ mismatches })
  }

  /* ------------------------------------------------------------------- helpers */

  private isNonSyncedType(contentType: string): boolean {
    return contentType === 'SF|Extension' || contentType === 'SF|MFA'
  }

  private sameContent(existing: VaultItem, raw: Params): boolean {
    return (
      existing.deleted === (raw.deleted === true) &&
      (existing.content ?? null) === ((raw.content as string | null) ?? null) &&
      (existing.enc_item_key ?? null) === ((raw.enc_item_key as string | null) ?? null)
    )
  }

  private createdTimestamp(raw: Params, fallback: number): number {
    return typeof raw.created_at_timestamp === 'number' && raw.created_at_timestamp > 0
      ? raw.created_at_timestamp
      : fallback
  }

  private createdIso(raw: Params, fallback: string): string {
    if (typeof raw.created_at === 'string' && !isNaN(Date.parse(raw.created_at))) {
      return new Date(raw.created_at).toISOString()
    }
    return fallback
  }

  /** Strictly increasing microsecond clock. */
  private tick(state: VaultState): number {
    const now = Date.now() * 1000
    state.clock = Math.max(now, (state.clock ?? 0) + 1)
    return state.clock
  }

  private encodeToken(timestamp: number): string {
    return this.base64Encode(`${SYNC_TOKEN_PREFIX}${timestamp}`)
  }

  private decodeToken(token: unknown): number | undefined {
    if (typeof token !== 'string' || token.length === 0) {
      return undefined
    }
    try {
      const decoded = this.base64Decode(token)
      if (!decoded.startsWith(SYNC_TOKEN_PREFIX)) {
        return undefined
      }
      const value = Number(decoded.slice(SYNC_TOKEN_PREFIX.length))
      return Number.isFinite(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  private extractKeyParams(params: Params): Record<string, unknown> {
    const excluded = new Set([
      'password',
      'new_password',
      'current_password',
      'email',
      'new_email',
      'api',
      'ephemeral',
      'hvm_token',
      'code_challenge',
      'code_verifier',
    ])
    const keyParams: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (!excluded.has(key) && value !== undefined) {
        keyParams[key] = value
      }
    }
    return keyParams
  }

  private createSession(state: VaultState, user: VaultUser, readonly: boolean): VaultSession {
    const now = Date.now()
    const session: VaultSession = {
      uuid: this.uuid(),
      userUuid: user.uuid,
      accessToken: this.randomHex(32),
      refreshToken: this.randomHex(32),
      accessExpiration: now + ACCESS_TOKEN_LIFETIME_MS,
      refreshExpiration: now + REFRESH_TOKEN_LIFETIME_MS,
      readonlyAccess: readonly,
      createdAt: new Date(now).toISOString(),
      deviceInfo: this.deviceInfo,
    }
    state.sessions.push(session)
    return session
  }

  private sessionBody(session: VaultSession) {
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      access_expiration: session.accessExpiration,
      refresh_expiration: session.refreshExpiration,
      readonly_access: session.readonlyAccess,
    }
  }

  private findUser(state: VaultState, email: string): VaultUser | undefined {
    return state.users.find((candidate) => candidate.email === email)
  }

  private normalizeEmail(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim().toLowerCase()
    return trimmed.length > 0 ? trimmed : undefined
  }

  private async hashPassword(salt: string, password: string): Promise<string> {
    return this.sha256Hex(`${salt}:${password}`)
  }

  private async pkceChallenge(verifier: string): Promise<string> {
    const digest = await this.subtle().digest('SHA-256', new TextEncoder().encode(verifier))
    // The client hashes to hex and base64url-encodes that string.
    const hex = this.bytesToHex(new Uint8Array(digest))
    return this.base64Encode(hex).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  private async sha256Hex(value: string): Promise<string> {
    const digest = await this.subtle().digest('SHA-256', new TextEncoder().encode(value))
    return this.bytesToHex(new Uint8Array(digest))
  }

  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false
    }
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  private subtle(): SubtleCrypto {
    const cryptoObject = (globalThis as unknown as { crypto?: Crypto }).crypto
    if (!cryptoObject?.subtle) {
      throw new Error('Secure cryptography is not available in this environment.')
    }
    return cryptoObject.subtle
  }

  private randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    ;(globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(bytes)
    return bytes
  }

  private randomHex(length: number): string {
    return this.bytesToHex(this.randomBytes(length))
  }

  private uuid(): string {
    const bytes = this.randomBytes(16)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = this.bytesToHex(bytes)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  private base64Encode(value: string): string {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
    return btoa(binary)
  }

  private base64Decode(value: string): string {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
}

export type { HttpRequestParams }
