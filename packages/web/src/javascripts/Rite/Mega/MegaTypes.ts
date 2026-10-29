/**
 * The small part of the `megajs` API that Rite uses. Declaring it here keeps the rest of the
 * app independent of megajs internals and lets tests substitute an in-memory fake.
 */

export interface MegaNode {
  nodeId?: string
  name: string | null
  /** Seconds since epoch */
  timestamp?: number
  size?: number
  directory: boolean
  children?: MegaNode[]
  downloadBuffer(options: Record<string, unknown>): Promise<Uint8Array>
  delete(permanent?: boolean): Promise<void>
  upload(options: { name: string; size: number }, data: Uint8Array): { complete: Promise<MegaNode> }
  mkdir(name: string): Promise<MegaNode>
}

export interface MegaStorage {
  root: MegaNode
  ready: Promise<unknown>
  reload(force?: boolean): Promise<unknown>
  toJSON(): MegaSessionJSON
  close(): Promise<void>
}

export type MegaSessionJSON = {
  key: string
  sid: string
  name: string
  user: string
  options: Record<string, unknown>
}

export interface MegaModule {
  Storage: {
    new (options: {
      email: string
      password: string
      secondFactorCode?: string
      keepalive?: boolean
      autoload?: boolean
    }): MegaStorage
    fromJSON(json: MegaSessionJSON): MegaStorage
  }
}

export type MegaModuleLoader = () => Promise<MegaModule>
