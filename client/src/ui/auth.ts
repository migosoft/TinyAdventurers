// Login and registration. Accounts are a name and a password only: no e-mail,
// so a forgotten password cannot be recovered (the form says so).
import { api, ApiFail } from '../api';
import type { Me } from '../generated/Me';

/** Shows the form until the player is logged in. */
export function showAuth(host: HTMLElement): Promise<Me> {
  const root = document.createElement('div');
  root.className = 'lobby';
  host.append(root);
  let register = false;

  return new Promise((resolve) => {
    const render = () => {
      root.innerHTML = `
        <h1>Tiny Adventurers</h1>
        <form class="panel auth" autocomplete="on">
          <h2>${register ? 'Create an account' : 'Log in'}</h2>
          <label>Name <input id="auth-name" name="username" maxlength="16" autocomplete="username" required></label>
          <label>Password <input id="auth-password" name="password" type="password" maxlength="128"
            autocomplete="${register ? 'new-password' : 'current-password'}" required></label>
          ${register ? '<label>Repeat password <input id="auth-password2" type="password" maxlength="128" autocomplete="new-password" required></label>' : ''}
          <div class="row actions">
            <button type="button" id="auth-switch">${register ? 'I have an account' : 'Create an account'}</button>
            <button type="submit" id="${register ? 'register' : 'login'}" class="primary">${register ? 'Create account' : 'Log in'}</button>
          </div>
          <div class="error"></div>
          ${
            register
              ? `<small class="hint">Names: 3 to 16 letters, digits, _ or -. Passwords: at least 8 characters.<br>
                 No e-mail or other personal data is stored. That also means a lost password cannot be recovered, so keep it safe.</small>`
              : ''
          }
        </form>`;
      const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
      $<HTMLInputElement>('#auth-name').focus();
      $('#auth-switch').onclick = () => {
        register = !register;
        render();
      };
      const form = $<HTMLFormElement>('form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const name = $<HTMLInputElement>('#auth-name').value.trim();
        const password = $<HTMLInputElement>('#auth-password').value;
        const error = $('.error');
        if (register && password !== $<HTMLInputElement>('#auth-password2').value) {
          error.textContent = 'The passwords do not match.';
          return;
        }
        form.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          const me = register ? await api.register(name, password) : await api.login(name, password);
          root.remove();
          resolve(me);
        } catch (err) {
          error.textContent = err instanceof ApiFail ? err.message : String(err);
          form.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      };
    };
    render();
  });
}
