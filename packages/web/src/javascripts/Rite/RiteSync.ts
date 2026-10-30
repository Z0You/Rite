import {
  registerRiteVaultStorage,
  RiteFilenHost,
  RiteMegaHost,
  setRiteDeviceInfo,
  VaultStorageInterface,
} from '@standardnotes/snjs'
import { MegaAccount } from './Mega/MegaAccount'
import { MegaVaultStorage } from './Mega/MegaVaultStorage'
import { MegaModuleLoader } from './Mega/MegaTypes'
import { FilenAccount } from './Filen/FilenAccount'
import { FilenVaultStorage } from './Filen/FilenVaultStorage'
import { FilenModuleLoader } from './Filen/FilenTypes'

export { RiteMegaHost, RiteFilenHost }

/** What the sign-in screens and preferences need from any storage account. */
export interface CloudAccount {
  readonly connectedEmail: string | undefined
  readonly isConnected: boolean
  onChange(listener: () => void): () => void
  connect(email: string, password: string, twoFactorCode?: string): Promise<void>
  disconnect(): Promise<void>
}

export type StorageProviderId = 'mega' | 'filen'

export type StorageProvider = {
  id: StorageProviderId
  /** Shown to people. */
  name: string
  /** The sync address the app uses for this provider. */
  host: string
  /** Where people create an account. */
  website: string
  account: CloudAccount
  createStorage(): VaultStorageInterface
}

type TestLoaders = { __riteMegaModuleLoader?: MegaModuleLoader; __riteFilenModuleLoader?: FilenModuleLoader }

let megaAccount: MegaAccount | undefined
let filenAccount: FilenAccount | undefined

export function getMegaAccount(): MegaAccount {
  if (!megaAccount) {
    // Automated end-to-end tests provide a stand-in MEGA drive before the app starts.
    const testLoader = (window as TestLoaders).__riteMegaModuleLoader
    megaAccount = testLoader ? new MegaAccount(window.localStorage, testLoader) : new MegaAccount()
  }
  return megaAccount
}

export function getFilenAccount(): FilenAccount {
  if (!filenAccount) {
    const testLoader = (window as TestLoaders).__riteFilenModuleLoader
    filenAccount = testLoader ? new FilenAccount(window.localStorage, testLoader) : new FilenAccount()
  }
  return filenAccount
}

let providers: StorageProvider[] | undefined

export function getStorageProviders(): StorageProvider[] {
  if (!providers) {
    providers = [
      {
        id: 'mega',
        name: 'MEGA',
        host: RiteMegaHost,
        website: 'mega.nz',
        account: getMegaAccount(),
        createStorage: () => new MegaVaultStorage(getMegaAccount()),
      },
      {
        id: 'filen',
        name: 'Filen',
        host: RiteFilenHost,
        website: 'filen.io',
        account: getFilenAccount(),
        createStorage: () => new FilenVaultStorage(getFilenAccount()),
      },
    ]
  }
  return providers
}

/** The storage provider behind a sync address, if it is one of Rite's (not a custom server). */
export function providerForHost(host: string | undefined): StorageProvider | undefined {
  if (!host) {
    return undefined
  }
  const scheme = host.trim().toLowerCase().split('://')[0]
  return getStorageProviders().find((provider) => provider.host.startsWith(`${scheme}://`))
}

/** True for addresses answered by a Rite storage provider (MEGA, Filen) rather than a server. */
export function isDriveHost(host: string | undefined): boolean {
  return providerForHost(host) !== undefined
}

/** @deprecated use isDriveHost */
export const isMegaHost = isDriveHost

/** Called once at startup: lets the sync engine keep vaults in each storage provider. */
export function registerRiteSyncBackends(platformDescription: string): void {
  setRiteDeviceInfo(`Rite on ${platformDescription}`)
  for (const provider of getStorageProviders()) {
    registerRiteVaultStorage(provider.id, () => provider.createStorage())
  }
}
