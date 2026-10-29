import { registerRiteVaultStorage, RiteMegaHost, setRiteDeviceInfo } from '@standardnotes/snjs'
import { MegaAccount } from './Mega/MegaAccount'
import { MegaVaultStorage } from './Mega/MegaVaultStorage'

export { RiteMegaHost }

let megaAccount: MegaAccount | undefined

export function getMegaAccount(): MegaAccount {
  if (!megaAccount) {
    megaAccount = new MegaAccount()
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
