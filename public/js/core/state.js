/**
 * Reactive state store factory.
 *
 * Each app (admin panel, MC Host panel, etc.) creates its own store
 * instance with app-specific keys. Changes fire events via EventTarget
 * so modules can subscribe to cross-cutting state updates.
 *
 * @param {Object} initial - Initial state keys and values
 * @returns {{ get, set, on, off }}
 */
export function createStore(initial) {
  const _state = { ...initial };
  const _listeners = new EventTarget();

  return {
    get(key) {
      return _state[key];
    },

    set(key, value) {
      const old = _state[key];
      if (old === value) return;
      _state[key] = value;
      _listeners.dispatchEvent(
        new CustomEvent(`${key}:change`, { detail: { old, value } }),
      );
    },

    on(event, handler) {
      _listeners.addEventListener(event, handler);
    },

    off(event, handler) {
      _listeners.removeEventListener(event, handler);
    },
  };
}
