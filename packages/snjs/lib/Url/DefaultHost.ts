/**
 * Rite's default sync destination is the user's own MEGA drive (see RiteVirtualServer).
 * Rite never defaults to a third party's sync service.
 */
export enum DefaultHost {
  Api = 'mega://rite',
  WebSocket = '',
}
