// JSON calls to the admin API (/api/admin/*). The admin session is an HttpOnly
// cookie scoped to /api/admin; this code never sees it.
import { ApiFail } from '../api';
import type { AdminAction } from '../generated/AdminAction';
import type { AdminMe } from '../generated/AdminMe';
import type { AdminStats } from '../generated/AdminStats';
import type { ApiError } from '../generated/ApiError';
import type { PlayerDetail } from '../generated/PlayerDetail';
import type { PlayerPage } from '../generated/PlayerPage';

export { ApiFail };

/** `background`: a request the page makes by itself; it does not keep the session alive. */
async function call<T>(method: string, path: string, body?: unknown, background = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(background ? { 'X-Admin-Background': '1' } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiFail(0, 'Cannot reach the game server. Is it running?');
  }
  if (!res.ok) {
    if (res.status === 404 && path === 'me') throw new ApiFail(404, 'The admin area is not enabled on this server (set ADMIN_USER and ADMIN_PASSWORD).');
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiFail(res.status, err?.error ?? `Request failed (${res.status}).`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export type PlayerSort = 'name' | 'created' | 'active';

export const adminApi = {
  /** The logged-in admin, or null without a valid admin session. */
  async me(): Promise<AdminMe | null> {
    try {
      return await call<AdminMe>('GET', 'me');
    } catch (e) {
      if (e instanceof ApiFail && e.status === 401) return null;
      throw e;
    }
  },
  login: (name: string, password: string) => call<AdminMe>('POST', 'login', { name, password }),
  logout: () => call<void>('POST', 'logout'),
  stats: (background = false) => call<AdminStats>('GET', 'stats', undefined, background),
  players: (q: string, sort: PlayerSort, page: number) => call<PlayerPage>('GET', `players?${new URLSearchParams({ q, sort, page: String(page) })}`),
  player: (id: number) => call<PlayerDetail>('GET', `players/${id}`),
  setPassword: (id: number, password: string) => call<void>('POST', `players/${id}/password`, { password }),
  deletePlayer: (id: number) => call<void>('DELETE', `players/${id}`),
  deleteCharacter: (id: number) => call<void>('DELETE', `characters/${id}`),
  actions: () => call<AdminAction[]>('GET', 'actions'),
};
