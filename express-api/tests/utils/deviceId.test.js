const { isValidDeviceId } = require('../../src/utils/deviceId');

describe('isValidDeviceId', () => {
  test.each([
    'abc-xyz',
    'ABC_123.def',
    'a',
    '0',
    'A'.repeat(200), // max length
    'fid-abc-123.456_789',
  ])('accepts a safe device id: %s', (id) => {
    expect(isValidDeviceId(id)).toBe(true);
  });

  test.each([
    ['contains a slash (path redirection)', 'a/b/c'],
    ['leading slash', '/etc'],
    ['whitespace only', '   '],
    ['embedded whitespace', 'a b'],
    ['empty string', ''],
    ['over 200 chars', 'A'.repeat(201)],
    ['a dot-dot segment with slash', '../secret'],
    ['special chars', 'a$b'],
    ['unicode', 'déviçe'],
  ])('rejects %s', (_label, id) => {
    expect(isValidDeviceId(id)).toBe(false);
  });

  test.each([
    ['a number', 123],
    ['null', null],
    ['undefined', undefined],
    ['an object', { evil: true }],
    ['an array', ['a', 'b']],
    ['a boolean', true],
  ])('rejects a non-string (%s)', (_label, id) => {
    expect(isValidDeviceId(id)).toBe(false);
  });
});
