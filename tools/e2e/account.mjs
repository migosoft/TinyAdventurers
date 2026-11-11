// Account helpers shared by the e2e scripts (smoke.mjs, r3d-run.mjs): throwaway e2e_* accounts.
import { execFileSync } from 'node:child_process';

export const PASSWORD = 'smoke-test-password';
export const tag = () => Math.random().toString(16).slice(2, 8);

/** Marks one of this script's own e2e_* accounts as a debug account. */
let adminCookie = null;
export async function markDebug(base, account) {
  if (!/^e2e_[0-9a-f]+$/.test(account)) throw new Error(`refusing to mark ${account}`);
  const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (ADMIN_USER && ADMIN_PASSWORD) {
    const api = async (path, method, body) => {
      const r = await fetch(new URL(path, base), { method, headers: { 'content-type': 'application/json', ...(adminCookie ? { cookie: adminCookie } : {}) }, body: body && JSON.stringify(body) });
      if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
      return r;
    };
    if (!adminCookie) {
      const r = await api('api/admin/login', 'POST', { name: ADMIN_USER, password: ADMIN_PASSWORD });
      adminCookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    }
    const found = await (await api(`api/admin/players?q=${account}`, 'GET')).json();
    const row = found.players.find((p) => p.name === account);
    if (!row) throw new Error(`admin list has no ${account}`);
    await api(`api/admin/players/${row.id}/debug`, 'POST', { debug: true });
    console.log(`marked ${account} as debug (admin API)`);
  } else {
    execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'tiny', '-d', 'tiny', '-c', `update accounts set debug = true where name = '${account}'`], { stdio: 'inherit' });
    console.log(`marked ${account} as debug (psql)`);
  }
}

export async function login(page, account, register) {
  if (register) await page.click('#auth-switch');
  await page.fill('#auth-name', account);
  await page.fill('#auth-password', PASSWORD);
  if (register) await page.fill('#auth-password2', PASSWORD);
  await page.click(register ? '#register' : '#login');
  await page.waitForSelector('.ui-roster');
}

/** From the roster: creates a character of `cls` (its hub opens and the Sheet tab shows). */
export async function createCharacter(page, name, cls) {
  await page.click('#new-char');
  await page.fill('#char-name', name);
  await page.click(`.ui-class.c-${cls.toLowerCase()}`);
  await page.click('#char-create');
  await page.waitForSelector('.ui-bar');
  await page.waitForSelector('[data-attr]'); // the Sheet tab, after the Character message
}

/** Deletes the logged-in account through the API (status 204 on success). */
export function deleteAccount(page) {
  return page.evaluate(
    (password) => fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }).then((r) => r.status),
    PASSWORD,
  );
}
