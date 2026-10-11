/**
 * Centralized Application Configuration & Endpoints
 * 
 * Ensures production builds NEVER connect to localhost or mock instances,
 * while allowing local development with .env.development.local.
 */

export const DEFAULT_PROD_SERVER_URL = 'https://concord-repo-production.up.railway.app';
export const DEFAULT_DEV_SERVER_URL = 'http://localhost:3001';

/**
 * The target backend server URL for API requests and WebSockets / Socket.IO.
 * - In PROD (vite build / packaged electron): always connects to the cloud backend.
 * - In DEV (vite dev / electron dev): uses local backend override or localhost:3001.
 */
export const SERVER_URL: string = (() => {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PROD_SERVER_URL || DEFAULT_PROD_SERVER_URL;
  }
  return import.meta.env.VITE_SERVER_URL || DEFAULT_DEV_SERVER_URL;
})();

export const SOCKET_URL: string = SERVER_URL;

console.log('[Concord Config] Active SERVER_URL:', SERVER_URL, '| PROD mode:', import.meta.env.PROD);
