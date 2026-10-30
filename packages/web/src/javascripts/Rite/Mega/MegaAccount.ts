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
      throw new Error(describeMegaError(error, true))
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

    // Note: never call storage.close() here. In megajs, close() logs the session out on MEGA's
    // side, which would end the very session that was just saved.
    this.notify()
  }

  /** Forgets the MEGA session on this device and ends it on MEGA's side. */
  async disconnect(): Promise<void> {
    const persisted = this.readSession()
    this.store.removeItem(SessionStorageKey)
    this.notify()
    if (persisted) {
      try {
        const mega = await this.loadModule()
        await mega.Storage.fromJSON({ ...persisted.session, options: { ...persisted.session.options } }).close()
      } catch {
        // Ending the session on MEGA's side is best effort.
      }
    }
  }

  /** Returns a ready MEGA storage with an up-to-date file tree. */
  async openStorage(): Promise<MegaStorage> {
    const persisted = this.readSession()
    if (!persisted) {
      throw new VaultStorageAuthRequiredError(
        'Your MEGA account is not connected on this device. Connect it again to resume syncing.',
      )
    }

    // A fresh megajs Storage for every use: within one Storage object megajs never forgets files
    // that were deleted (it only learns about deletions over a live connection, which Rite does
    // not keep open), so reusing one would show old vault copies that no longer exist.
    const mega = await this.loadModule()
    const storage = mega.Storage.fromJSON({ ...persisted.session, options: { ...persisted.session.options } })

    try {
      await storage.reload(true)
    } catch (error) {
      if (isSessionError(error)) {
        // MEGA ended the session (for example "log out of all devices" on mega.nz). Forget it
        // locally only: it is already invalid on MEGA's side.
        this.store.removeItem(SessionStorageKey)
        this.notify()
        throw new VaultStorageAuthRequiredError('Your MEGA session has ended. Please connect your MEGA account again.')
      }
      throw new Error(describeMegaError(error))
    }

    return storage
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
  return /ESID|\(-15\)|EBLOCKED|\(-16\)/.test(errorText(error))
}

/** Turns megajs' terse error codes into messages people can act on. */
export function describeMegaError(error: unknown, duringLogin = false): string {
  const text = errorText(error)
  if (/EMFAREQUIRED|\(-26\)/.test(text)) {
    return 'Your MEGA account uses two-factor authentication. Enter the 6-digit code from your authenticator app.'
  }
  if (duringLogin && /ENOENT|\(-9\)|EINCOMPLETE|EARGS|\(-2\)/.test(text)) {
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
