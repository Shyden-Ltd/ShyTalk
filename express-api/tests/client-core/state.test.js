const { createStore } = require('../../../public/js/core/state');

describe('createStore', () => {
  test('get returns undefined for unset key', () => {
    const store = createStore({});
    expect(store.get('missing')).toBeUndefined();
  });

  test('get returns initial value', () => {
    const store = createStore({ name: 'Alice' });
    expect(store.get('name')).toBe('Alice');
  });

  test('set updates value and get reflects it', () => {
    const store = createStore({ count: 0 });
    store.set('count', 5);
    expect(store.get('count')).toBe(5);
  });

  test('set fires change event with old and new value', () => {
    const store = createStore({ x: 1 });
    const handler = jest.fn();
    store.on('x:change', handler);
    store.set('x', 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ old: 1, value: 2 });
  });

  test('set does NOT fire event when value unchanged', () => {
    const store = createStore({ x: 1 });
    const handler = jest.fn();
    store.on('x:change', handler);
    store.set('x', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  test('off removes listener', () => {
    const store = createStore({ x: 1 });
    const handler = jest.fn();
    store.on('x:change', handler);
    store.off('x:change', handler);
    store.set('x', 2);
    expect(handler).not.toHaveBeenCalled();
  });

  test('multiple stores are independent', () => {
    const a = createStore({ val: 'a' });
    const b = createStore({ val: 'b' });
    a.set('val', 'changed');
    expect(a.get('val')).toBe('changed');
    expect(b.get('val')).toBe('b');
  });
});
