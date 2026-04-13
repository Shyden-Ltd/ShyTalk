const { escapeHtml } = require('../../../public/js/core/ui');

describe('escapeHtml', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  test('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;');
  });
  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
  test('converts non-string to string first', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });
  test('preserves safe characters', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});
