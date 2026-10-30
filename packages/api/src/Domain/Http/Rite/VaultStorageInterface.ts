import { VaultState } from './VaultTypes'

/**
 * Where a Rite vault lives (MEGA, or memory for tests).
 *
 * Implementations are responsible for any caching; the virtual server calls `load()`
 * before handling each request and `save()` after any request that changed state.
 */
export interface VaultStorageInterface {
  /** Human readable name of the backend, used in error messages (e.g. "MEGA"). */
  readonly displayName: string

  /** Returns the latest vault, or undefined if no vault has been created yet. */
  load(): Promise<VaultState | undefined>

  save(state: VaultState): Promise<void>
}

/**
 * Thrown by `save()` when the stored vault changed after the last `load()` (another device
 * wrote it). The virtual server reloads and replays the request.
 */
export class VaultStorageConflictError extends Error {
  constructor() {
    super('The vault was changed by another device.')
    this.name = 'VaultStorageConflictError'
  }
}

/** Thrown by storage backends when the user must (re)connect their storage account. */
export class VaultStorageAuthRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultStorageAuthRequiredError'
  }
}

export type RiteStorageProblem = {
  /** e.g. "MEGA" or "Filen". */
  displayName: string
  message: string
}

const storageProblemListeners = new Set<(problem: RiteStorageProblem) => void>()

/**
 * Lets the app show a "reconnect your storage" notice. Storage problems are reported here instead
 * of as "signed out" errors, which would make the app ask for the Rite password in a loop.
 */
export function onRiteStorageProblem(listener: (problem: RiteStorageProblem) => void): () => void {
  storageProblemListeners.add(listener)
  return () => storageProblemListeners.delete(listener)
}

export function notifyRiteStorageProblem(problem: RiteStorageProblem): void {
  storageProblemListeners.forEach((listener) => {
    try {
      listener(problem)
    } catch {
      // A broken listener must never break syncing.
    }
  })
}
