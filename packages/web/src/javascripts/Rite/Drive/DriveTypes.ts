/**
 * The few operations Rite needs from a cloud drive (MEGA, Filen, …) to keep its vault there.
 * Each storage service provides a small adapter; the vault logic lives in DriveVaultStorage.
 */

export type DriveEntry = {
  /** Stable id of this exact file version (a new upload gets a new id). */
  id: string
  name: string
  isFolder: boolean
  /** Milliseconds since epoch, used only for ordering. */
  modified: number
}

export interface DriveFolder {
  /** Up-to-date list of the folder's direct children. */
  list(): Promise<DriveEntry[]>
  read(entry: DriveEntry): Promise<Uint8Array>
  /** Uploads a file. Services may replace an existing file of the same name or keep both. */
  write(name: string, data: Uint8Array): Promise<DriveEntry>
  remove(entry: DriveEntry): Promise<void>
}

export interface CloudDrive {
  /** Shown to people, e.g. "MEGA" or "Filen". */
  readonly displayName: string
  /** The named folder at the top of the drive; created when `create` is true and it is missing. */
  openFolder(name: string, create: boolean): Promise<DriveFolder | undefined>
  /** Service-specific facts for the "Check connection" report (no secrets, no note contents). */
  describe?(): Promise<string[]>
}
