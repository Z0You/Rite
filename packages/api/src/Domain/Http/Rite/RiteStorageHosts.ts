import { RequestHandlerInterface } from '../RequestHandlerInterface'
import { RiteVirtualServer } from './RiteVirtualServer'
import { VaultStorageInterface } from './VaultStorageInterface'

/** Sync "server" address that stores the encrypted vault in the user's MEGA account. */
export const RiteMegaHost = 'mega://rite'

/** Schemes answered inside the app by the Rite virtual server rather than over HTTP. */
const RiteStorageSchemes = ['mega:']

type StorageFactory = (host: string) => VaultStorageInterface

const factories = new Map<string, StorageFactory>()
const servers = new Map<string, RiteVirtualServer>()
let deviceInfo = 'Rite'

/** Platforms (web, mobile) register the storage backend for each scheme at startup. */
export function registerRiteVaultStorage(scheme: string, factory: StorageFactory): void {
  factories.set(normalizeScheme(scheme), factory)
  servers.clear()
}

export function setRiteDeviceInfo(info: string): void {
  deviceInfo = info
}

export function isRiteStorageHost(host: string | undefined): boolean {
  if (!host) {
    return false
  }
  const scheme = schemeOf(host)
  return scheme !== undefined && RiteStorageSchemes.includes(scheme)
}

export function getRiteRequestHandler(host: string): RequestHandlerInterface {
  const key = host.replace(/\/+$/, '')
  let server = servers.get(key)
  if (!server) {
    const scheme = schemeOf(key)
    const factory = scheme ? factories.get(scheme) : undefined
    if (!factory) {
      throw new Error(`No storage backend is available for ${key} on this device.`)
    }
    server = new RiteVirtualServer(key, factory(key), deviceInfo)
    servers.set(key, server)
  }
  return server
}

/** `mega://rite/v1/items/sync?x` → `mega://rite` */
export function riteHostOfUrl(url: string): string {
  const match = url.trim().match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i)
  return match ? match[1].toLowerCase() : url
}

function schemeOf(host: string): string | undefined {
  const match = host.trim().match(/^([a-z][a-z0-9+.-]*:)\/\//i)
  return match ? match[1].toLowerCase() : undefined
}

function normalizeScheme(scheme: string): string {
  const lower = scheme.toLowerCase().replace(/\/+$/, '')
  return lower.endsWith(':') ? lower : `${lower}:`
}
