import { isVaultState, VaultState } from '@standardnotes/snjs'
import { BackupPrefix, RiteFolderName, VaultFileName } from './Drive/DriveVaultStorage'
import { StorageProvider } from './RiteSync'

export type DeviceAccount = {
  email?: string
  userUuid?: string
  /** First characters of this device's access token, to check the vault knows the session. */
  accessToken?: string
}

/**
 * Reads the storage the way sync does and describes what it finds, for troubleshooting. The
 * report never includes passwords, tokens or note contents.
 */
export async function diagnoseStorage(provider: StorageProvider, device: DeviceAccount): Promise<string[]> {
  const lines: string[] = [`Rite storage check — ${provider.name} — ${new Date().toISOString()}`]
  lines.push(`Connected ${provider.name} account: ${provider.account.connectedEmail ?? 'NONE'}`)
  lines.push(`This device's Rite account: ${device.email ?? 'not signed in'}`)

  const drive = provider.createDrive()
  try {
    if (drive.describe) {
      lines.push(...(await drive.describe()))
    }
    const folder = await drive.openFolder(RiteFolderName, false)
    if (!folder) {
      lines.push(`"${RiteFolderName}" folder: NOT FOUND at the top of the drive`)
      return lines
    }
    const entries = await folder.list()
    lines.push(`"${RiteFolderName}" folder: found, ${entries.length} item(s)`)
    for (const entry of entries) {
      lines.push(`  - ${entry.isFolder ? '[folder] ' : ''}${entry.name}`)
    }

    const vaults = entries.filter((entry) => !entry.isFolder && entry.name === VaultFileName)
    const backups = entries.filter((entry) => !entry.isFolder && entry.name.startsWith(BackupPrefix))
    lines.push(`Vault files: ${vaults.length}; daily backups: ${backups.length}`)

    for (const entry of [...vaults, ...backups.slice(-1)]) {
      try {
        const bytes = await folder.read(entry)
        const text = new TextDecoder().decode(bytes)
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        if (!isVaultState(parsed)) {
          lines.push(`${entry.name}: ${bytes.byteLength} bytes, NOT a readable Rite vault`)
          continue
        }
        lines.push(`${entry.name}: ${bytes.byteLength} bytes, ${describeVault(parsed, device)}`)
      } catch (error) {
        lines.push(`${entry.name}: could not be read (${error instanceof Error ? error.message : String(error)})`)
      }
    }
  } catch (error) {
    lines.push(`Error: ${error instanceof Error ? error.message : String(error)}`)
  }
  return lines
}

function describeVault(vault: VaultState, device: DeviceAccount): string {
  const notes = Object.values(vault.items).filter((item) => item.content_type === 'Note' && !item.deleted).length
  const email = device.email?.toLowerCase()
  const user = vault.users.find((candidate) => candidate.email === email)
  const sameUuid = vault.users.some((candidate) => candidate.uuid === device.userUuid)
  const sessionKnown =
    !!device.accessToken && vault.sessions.some((session) => session.accessToken.startsWith(device.accessToken as string))
  return [
    `accounts: ${vault.users.length}`,
    `this account: ${user ? 'yes' : 'NO'}${sameUuid ? '' : ' (id differs)'}`,
    `this device's session: ${sessionKnown ? 'yes' : 'NO'}`,
    `notes: ${notes}`,
    vault.movedTo ? `moved to ${vault.movedTo.displayName}` : '',
  ]
    .filter(Boolean)
    .join(', ')
}
