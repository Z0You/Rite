import { VaultStorageAuthRequiredError } from '@standardnotes/snjs'
import { MegaModule, MegaModuleLoader, MegaSessionJSON, MegaStorage } from './MegaTypes'

const SessionStorageKey = 'rite.mega.session.v1'

type PersistedSession = {
  email: string
  session: MegaSessionJSON
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Loaded lazily so the ~500 KB MEGA library is only downloaded by people who use MEGA sync. */
const defaultLoader: MegaModuleLoader = async () => (await import('megajs')) as unknown as MegaModule

/**
 * Manages the connection to the user's MEGA account.
 *
 * Only MEGA's session id and session key are kept on the device — never the MEGA password.
 * Signing out of MEGA (or MEGA expiring the session) requires connecting again.
 */
export class MegaAccount {
  private storage: MegaStorage | undefined
  private listeners = new Set<() => void>()

  constructor(
    private readonly store: KeyValueStore = window.localStorage,
    private readonly loadModule: MegaModuleLoader = defaultLoader,
  ) {}

  get connectedEmail(): string | undefined {
    return this.readSession()?.email
  }

  get isConnected(): boolean {
    return this.readSession() !== undefined
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async connect(email: string, password: string, secondFactorCode?: string): Promise<void> {
    const mega = await this.loadModule()
    const storage = new mega.Storage({
      email: email.trim(),
      password,
      secondFactorCode: secondFactorCode?.trim() || undefined,
      keepalive: false,
      autoload: true,
    })

    try {
      await storage.ready
    } catch (error) {
      throw new Error(describeMegaError(error))
    }

    const session = storage.toJSON()
    this.writeSession({
      email: email.trim().toLowerCase(),
      session: {
        key: session.key,
        sid: session.sid,
        name: session.name,
        user: session.user,
        // megajs keeps the login options (including the password) here; never persist them.
        options: { email: email.trim(), keepalive: false },
      },
    })

    await this.closeQuietly()
    this.storage = storage
    this.notify()
  }

  async disconnect(): Promise<void> {
    await this.closeQuietly()
    this.store.removeItem(SessionStorageKey)
    this.notify()
  }

  /** Returns a ready MEGA storage with an up-to-date file tree. */
  async openStorage(): Promise<MegaStorage> {
    const persisted = this.readSession()
    if (!persisted) {
      throw new VaultStorageAuthRequiredError(
        'Your MEGA account is not connected on this device. Connect it again to resume syncing.',
      )
    }

    if (!this.storage) {
      const mega = await this.loadModule()
      this.storage = mega.Storage.fromJSON({ ...persisted.session, options: { ...persisted.session.options } })
    }

    try {
      await this.storage.reload(true)
    } catch (error) {
      if (isSessionError(error)) {
        await this.disconnect()
        throw new VaultStorageAuthRequiredError('Your MEGA session has expired. Please connect your MEGA account again.')
      }
      throw new Error(describeMegaError(error))
    }

    return this.storage
  }

  private readSession(): PersistedSession | undefined {
    try {
      const raw = this.store.getItem(SessionStorageKey)
      if (!raw) {
        return undefined
      }
      const parsed = JSON.parse(raw) as PersistedSession
      return parsed?.session?.sid && parsed.session.key ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private writeSession(session: PersistedSession): void {
    this.store.setItem(SessionStorageKey, JSON.stringify(session))
  }

  private async closeQuietly(): Promise<void> {
    const storage = this.storage
    this.storage = undefined
    try {
      await storage?.close()
    } catch {
      // Closing is best effort.
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function isSessionError(error: unknown): boolean {
  return /ESID|\(-15\)|EKEY|\(-14\)|EBLOCKED|\(-16\)/.test(errorText(error))
}

/** Turns megajs' terse error codes into messages people can act on. */
export function describeMegaError(error: unknown): string {
  const text = errorText(error)
  if (/EMFAREQUIRED|\(-26\)/.test(text)) {
    return 'Your MEGA account uses two-factor authentication. Enter the 6-digit code from your authenticator app.'
  }
  if (/ENOENT|\(-9\)|EINCOMPLETE|EARGS|\(-2\)/.test(text)) {
    return 'MEGA did not accept that email and password.'
  }
  if (/EBLOCKED|\(-16\)/.test(text)) {
    return 'This MEGA account is blocked. Check your account on mega.nz.'
  }
  if (/EOVERQUOTA|\(-17\)/.test(text)) {
    return 'Your MEGA storage is full. Free up space on mega.nz to keep syncing.'
  }
  if (/ETOOMANY|ERATELIMIT|\(-4\)|\(-6\)/.test(text)) {
    return 'MEGA is limiting requests right now. Please try again in a few minutes.'
  }
  if (/Failed to fetch|NetworkError|network/i.test(text)) {
    return 'Could not reach MEGA. Check your internet connection.'
  }
  return `MEGA error: ${text}`
}
