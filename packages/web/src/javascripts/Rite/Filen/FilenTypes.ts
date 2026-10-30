/**
 * The small part of Filen's official SDK (@filen/sdk) that Rite uses. The SDK itself is loaded
 * lazily from vendor/filen-sdk (see scripts/filen/build-filen-bundle.mjs).
 */

export type FilenCloudItem =
  | { type: 'directory'; uuid: string; name: string; timestamp: number; lastModified: number; parent: string }
  | {
      type: 'file'
      uuid: string
      name: string
      timestamp: number
      lastModified: number
      parent: string
      size: number
      mime: string
      version: number
      chunks: number
      key: string
      bucket: string
      region: string
    }

/** The session part of the SDK config that Rite keeps on the device (never the password). */
export type FilenSessionConfig = {
  email?: string
  masterKeys?: string[]
  apiKey?: string
  publicKey?: string
  privateKey?: string
  authVersion?: number
  baseFolderUUID?: string
  userId?: number
}

export interface FilenSDKInstance {
  config: FilenSessionConfig & Record<string, unknown>
  login(params: { email: string; password: string; twoFactorCode?: string }): Promise<void>
  logout?(): void
  cloud(): {
    listDirectory(params: { uuid: string; onlyDirectories?: boolean }): Promise<FilenCloudItem[]>
    createDirectory(params: { name: string; parent: string; renameIfExists?: boolean }): Promise<string>
    uploadWebFile(params: { file: File; parent: string; name?: string }): Promise<FilenCloudItem>
    downloadFileToReadableStream(params: {
      uuid: string
      bucket: string
      region: string
      version: number
      key: string
      size: number
      chunks: number
    }): ReadableStream<Uint8Array>
    deleteFile(params: { uuid: string }): Promise<void>
  }
}

export interface FilenModule {
  FilenSDK: new (config: Record<string, unknown>) => FilenSDKInstance
}

export type FilenModuleLoader = () => Promise<FilenModule>
