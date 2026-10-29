import { Result, SyncUseCaseInterface } from '@standardnotes/domain-core'

import { GetHost } from './GetHost'

export class IsApplicationUsingThirdPartyHost implements SyncUseCaseInterface<boolean> {
  /**
   * Rite has no first-party hosted service: features that depend on a vendor's hosted
   * subscription (email backups, subscription management) are never offered. The desktop
   * home server is the only host treated as first party.
   */
  private readonly APPLICATION_DEFAULT_HOSTS = ['localhost:3123']

  private readonly FILES_DEFAULT_HOSTS: string[] = []

  constructor(private getHostUseCase: GetHost) {}

  execute(): Result<boolean> {
    const result = this.getHostUseCase.execute()
    if (result.isFailed()) {
      return Result.fail(result.getError())
    }

    const host = result.getValue()

    return Result.ok(!this.isUrlFirstParty(host))
  }

  private isUrlFirstParty(url: string): boolean {
    try {
      const { host } = new URL(url)
      return this.APPLICATION_DEFAULT_HOSTS.includes(host) || this.FILES_DEFAULT_HOSTS.includes(host)
    } catch {
      return false
    }
  }
}
