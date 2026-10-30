import { VaultStorageAuthRequiredError } from '@standardnotes/snjs'
import { KeyValueStore } from '../Mega/MegaAccount'
import { FilenModule, FilenModuleLoader, FilenSDKInstance, FilenSessionConfig } from './FilenTypes'

const SessionStorageKey = 'rite.filen.session.v1'

/** Loaded lazily so the Filen SDK is only downloaded by people who use Filen sync. */
const defaultLoader: FilenModuleLoader = async () =>
  (await import(
    /* webpackChunkName: "filen-sdk" */ '../../../../vendor/filen-sdk/filen-sdk.browser.mjs'
  )) as unknown as FilenModule

const SessionFields: (keyof FilenSessionConfig)[] = [
  'email',
  'masterKeys',
  'apiKey',
  'publicKey',
  'privateKey',
  'authVersion',
  'baseFolderUUID',
  'userId',
]

/**
 * Manages the connection to the user's Filen account through Filen's official SDK.
 *
 * Only Filen's session (API key and the account's master keys) is kept on the device — never
 * the Filen password. Disconnecting removes it.
 */
export class FilenAccount {
  private sdk: FilenSDKInstance | undefined
  private listeners = new Set<() => void>()

  constructor(
    private readonly store: KeyValueStore = window.localStorage,
    private readonly loadModule: FilenModuleLoader = defaultLoader,
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

  async connect(email: string, password: string, twoFactorCode?: string): Promise<void> {
    const { FilenSDK } = await this.loadModule()
    const sdk = new FilenSDK({ metadataCache: true, connectToSocket: false })

    try {
      await sdk.login({
        email: email.trim(),
        password,
        twoFactorCode: twoFactorCode?.trim() || undefined,
      })
    } catch (error) {
      throw new Error(describeFilenError(error))
    }

    const session: FilenSessionConfig = {}
    for (const field of SessionFields) {
      const value = sdk.config[field]
      if (value !== undefined) {
        ;(session as Record<string, unknown>)[field] = value
      }
    }
    session.email = email.trim().toLowerCase()

    if (!session.apiKey || !session.masterKeys?.length || !session.baseFolderUUID) {
      throw new Error('Filen sign-in did not complete. Please try again.')
    }

    this.store.setItem(SessionStorageKey, JSON.stringify(session))
    this.sdk = sdk
    this.notify()
  }

  async disconnect(): Promise<void> {
    this.sdk = undefined
    this.store.removeItem(SessionStorageKey)
    this.notify()
  }

  /** The SDK signed in with the saved session, and the id of the drive's top folder. */
  async open(): Promise<{ sdk: FilenSDKInstance; rootFolder: string }> {
    const session = this.readSession()
    if (!session) {
      throw new VaultStorageAuthRequiredError(
        'Connect your Filen account first: on the sign-in screen, choose Filen, then Connect.',
      )
    }
    if (!this.sdk) {
      const { FilenSDK } = await this.loadModule()
      this.sdk = new FilenSDK({ ...session, metadataCache: true, connectToSocket: false })
    }
    return { sdk: this.sdk, rootFolder: session.baseFolderUUID as string }
  }

  /** Called by the drive adapter when Filen rejects the saved session. */
  async handleRequestError(error: unknown): Promise<never> {
    if (isSessionError(error)) {
      await this.disconnect()
      throw new VaultStorageAuthRequiredError('Your Filen session has ended. Please connect your Filen account again.')
    }
    throw new Error(describeFilenError(error))
  }

  private readSession(): FilenSessionConfig | undefined {
    try {
      const raw = this.store.getItem(SessionStorageKey)
      if (!raw) {
        return undefined
      }
      const parsed = JSON.parse(raw) as FilenSessionConfig
      return parsed?.apiKey && parsed.masterKeys?.length && parsed.baseFolderUUID ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }
}

function errorParts(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown }
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : '',
    message: error instanceof Error ? error.message : String(error),
  }
}

function isSessionError(error: unknown): boolean {
  const { code, message } = errorParts(error)
  return /api_key_not_found|invalid_api_key|unauthorized/i.test(`${code} ${message}`)
}

/** Turns Filen's error codes into messages people can act on. */
export function describeFilenError(error: unknown): string {
  const { code, message } = errorParts(error)
  const text = `${code} ${message}`
  if (/enter_2fa|2fa.*required|two.?factor.*required/i.test(text)) {
    return 'Your Filen account uses two-factor authentication. Enter the 6-digit code from your authenticator app.'
  }
  if (/wrong_2fa|invalid.*2fa|2fa.*(wrong|invalid)/i.test(text)) {
    return 'That two-factor code was not accepted. Check the code and try again.'
  }
  if (/email_or_password_wrong|wrong.*password|invalid.*(email|password|credentials)|account_not_found/i.test(text)) {
    return 'Filen did not accept that email and password.'
  }
  if (/storage|quota|max_storage/i.test(code)) {
    return 'Your Filen storage is full. Free up space on filen.io to keep syncing.'
  }
  if (/rate|too.?many/i.test(text)) {
    return 'Filen is limiting requests right now. Please try again in a few minutes.'
  }
  if (/Failed to fetch|NetworkError|Network Error|ECONN|timeout/i.test(text)) {
    return 'Could not reach Filen. Check your internet connection.'
  }
  return `Filen error: ${message}`
}
