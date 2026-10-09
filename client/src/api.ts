// JSON calls to the account API (/api/*). The session lives in an HttpOnly cookie
// the browser sends by itself; this code never sees the token.
import type { ApiError } from './generated/ApiError';
import type { CharacterInfo } from './generated/CharacterInfo';
import type { ClassId } from './generated/ClassId';
import type { Me } from './generated/Me';

export class ApiFail extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiFail(0, 'Cannot reach the game server. Is it running?');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiFail(res.status, err?.error ?? `Request failed (${res.status}).`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  /** The logged-in account, or null without a valid session. */
  async me(): Promise<Me | null> {
    try {
      return await call<Me>('GET', 'me');
    } catch (e) {
      if (e instanceof ApiFail && e.status === 401) return null;
      throw e;
    }
  },
  register: (name: string, password: string) => call<Me>('POST', 'register', { name, password }),
  login: (name: string, password: string) => call<Me>('POST', 'login', { name, password }),
  logout: () => call<void>('POST', 'logout'),
  deleteAccount: (password: string) => call<void>('DELETE', 'account', { password }),
  createCharacter: (name: string, cls: ClassId) => call<CharacterInfo>('POST', 'characters', { name, class: cls }),
  deleteCharacter: (id: number) => call<void>('DELETE', `characters/${id}`),
};
