import { registerRiteVaultStorage, RiteMegaHost, setRiteDeviceInfo } from '@standardnotes/snjs'
import { MegaAccount } from './Mega/MegaAccount'
import { MegaVaultStorage } from './Mega/MegaVaultStorage'
import { MegaModuleLoader } from './Mega/MegaTypes'

export { RiteMegaHost }

let megaAccount: MegaAccount | undefined

export function getMegaAccount(): MegaAccount {
  if (!megaAccount) {
    // Automated end-to-end tests provide a stand-in MEGA drive before the app starts.
    const testLoader = (window as { __riteMegaModuleLoader?: MegaModuleLoader }).__riteMegaModuleLoader
    megaAccount = testLoader ? new MegaAccount(window.localStorage, testLoader) : new MegaAccount()
  }
  return megaAccount
}

export function isMegaHost(host: string | undefined): boolean {
  return !!host && host.toLowerCase().startsWith('mega://')
}

/** Called once at startup: lets the sync engine store vaults addressed to mega:// in MEGA. */
export function registerRiteSyncBackends(platformDescription: string): void {
  setRiteDeviceInfo(`Rite on ${platformDescription}`)
  registerRiteVaultStorage('mega', () => new MegaVaultStorage(getMegaAccount()))
}
