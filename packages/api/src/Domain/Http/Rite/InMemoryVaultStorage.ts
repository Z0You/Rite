import { VaultStorageInterface } from './VaultStorageInterface'
import { VaultState } from './VaultTypes'

/**
 * Vault storage kept in memory (serialized, so callers can never share object references).
 * Used by tests and as a reference implementation for real backends.
 */
export class InMemoryVaultStorage implements VaultStorageInterface {
  private serialized: string | undefined

  public saveCount = 0

  constructor(readonly displayName: string = 'memory') {}

  async load(): Promise<VaultState | undefined> {
    return this.serialized ? (JSON.parse(this.serialized) as VaultState) : undefined
  }

  async save(state: VaultState): Promise<void> {
    this.serialized = JSON.stringify(state)
    this.saveCount++
  }
}
