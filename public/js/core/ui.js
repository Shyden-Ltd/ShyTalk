/**
 * UI helpers: escapeHtml (unit-tested) + DOM helpers (Playwright-tested).
 */

/**
 * Escape a value for safe HTML output.
 * Converts non-strings to string first.
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {'success'|'error'|'info'} type
 */
export function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type} visible`;
  const delay = type === 'error' ? 7000 : 4000;
  setTimeout(() => {
    toast.className = `toast ${type}`;
  }, delay);
}

/**
 * Show a confirmation dialog.
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';

    const h3 = document.createElement('h3');
    h3.textContent = title;

    const p = document.createElement('p');
    p.textContent = message;

    const buttons = document.createElement('div');
    buttons.className = 'confirm-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'confirm-cancel';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.className = 'confirm-ok';
    okBtn.textContent = 'OK';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);

    dialog.appendChild(h3);
    dialog.appendChild(p);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    okBtn.addEventListener('click', () => cleanup(true));
    cancelBtn.addEventListener('click', () => cleanup(false));
  });
}

const _screens = new Map();

/**
 * Register a screen element by name.
 * @param {string} name
 * @param {Element} element
 */
export function registerScreen(name, element) {
  _screens.set(name, element);
}

/**
 * Show a registered screen, hiding all others.
 * @param {string} name
 */
export function showScreen(name) {
  for (const [, el] of _screens) {
    el.classList.remove('active');
  }
  const target = _screens.get(name);
  if (target) {
    target.classList.add('active');
  }
}
