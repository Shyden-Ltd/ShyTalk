/**
 * Device-shell quoting — the fix for a bug that had been live for months.
 *
 * `adb shell X Y Z` does not pass X Y Z as argv: adb JOINS them and hands the
 * result to `/system/bin/sh` on the phone. The driver escaped apostrophes for
 * the HOST shell and stopped there, so the host shell consumed the escaping
 * and the device shell got a bare quote. Verified against the connected
 * device on 2026-08-01:
 *
 *   adb -s … shell echo 'Selma'\''s%sroom'  →  /system/bin/sh: no closing quote
 *
 * Every journey step typing a name with an apostrophe was failing, and the
 * comment above the escaping claimed to fix exactly that case — it was
 * describing the wrong shell.
 *
 * The old tests could not have caught it: they re-implemented the escaping
 * locally and asserted on their own copy, which passes no matter what
 * production does. These call the real function.
 */
const { deviceShellArg, quoteAdbArgs } = require('../../scripts/drivers/device-shell');

/**
 * What `/system/bin/sh` yields for a single-quoted word, per POSIX: inside
 * single quotes every character is literal and a quote cannot appear at all,
 * so `'\''` is the only way to produce one.
 */
function posixSingleQuoteUnquote(word) {
  let out = '';
  let i = 0;
  while (i < word.length) {
    if (word[i] === "'") {
      i += 1;
      while (i < word.length && word[i] !== "'") {
        out += word[i];
        i += 1;
      }
      i += 1; // closing quote
    } else if (word[i] === '\\') {
      out += word[i + 1];
      i += 2;
    } else {
      out += word[i];
      i += 1;
    }
  }
  return out;
}

describe('deviceShellArg survives the device shell verbatim', () => {
  // Round-tripped against the REAL device for every one of these on
  // 2026-08-01 via `adb shell echo`.
  const CASES = [
    ["Selma's room", 'the apostrophe that was actually broken'],
    ["O'Brien", 'a name'],
    ["can't", 'a contraction'],
    ['hello world', 'a space'],
    ['plain', 'nothing special'],
    ['$HOME', 'a variable the shell would expand'],
    ['`whoami`', 'a command substitution'],
    ['a | b', 'a pipe'],
    ['a; rm -rf /', 'a command separator — the injection case'],
    ['a && b', 'an and-list'],
    ['a > /sdcard/x', 'a redirect'],
    ['*', 'a glob'],
    ['"double"', 'double quotes'],
    ["''", 'only quotes'],
    ['', 'the empty string'],
  ];

  it.each(CASES)('%s (%s)', (input) => {
    expect(posixSingleQuoteUnquote(deviceShellArg(input))).toBe(input);
  });

  it('always produces exactly one shell word', () => {
    // If the result split into two words, `input text` would receive only the
    // first and silently type half the string.
    for (const [input] of CASES) {
      const quoted = deviceShellArg(input);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });

  it('leaves no unescaped quote that could close the word early', () => {
    // The literal defect: a bare apostrophe ends the quoted run and the rest
    // of the string is parsed as shell syntax.
    const quoted = deviceShellArg("Selma's room");
    expect(quoted).toBe(`'Selma'\\''s room'`);
  });

  it('coerces non-strings rather than throwing', () => {
    expect(posixSingleQuoteUnquote(deviceShellArg(42))).toBe('42');
    expect(posixSingleQuoteUnquote(deviceShellArg(null))).toBe('null');
  });
});

describe('quoteAdbArgs quotes only what a device shell will parse', () => {
  it('quotes everything after `shell`', () => {
    expect(quoteAdbArgs(['shell', 'input', 'text', "Selma's"])).toEqual([
      'shell',
      "'input'",
      "'text'",
      `'Selma'\\''s'`,
    ]);
  });

  it('leaves a NON-shell subcommand completely alone', () => {
    // `adb reverse tcp:3000 tcp:3000` is read by adb itself. Quoting it would
    // make adb look for a port literally named `'tcp:3000'`, and the reverse
    // tunnels are what let the device reach the local API at all.
    expect(quoteAdbArgs(['reverse', 'tcp:3000', 'tcp:3000'])).toEqual([
      'reverse',
      'tcp:3000',
      'tcp:3000',
    ]);
  });

  it('does not quote the word `shell` itself', () => {
    // adb parses that one; a quoted `'shell'` is an unknown subcommand.
    expect(quoteAdbArgs(['shell', 'echo', 'hi'])[0]).toBe('shell');
  });

  it('handles a bare `shell` with no arguments', () => {
    expect(quoteAdbArgs(['shell'])).toEqual(['shell']);
  });

  it('stringifies non-shell arguments so execFileSync never sees a number', () => {
    expect(quoteAdbArgs(['reverse', 3000])).toEqual(['reverse', '3000']);
  });

  it('rejects a non-array rather than silently mangling it', () => {
    expect(() => quoteAdbArgs('shell echo hi')).toThrow(/must be an array/);
  });
});

describe('the curl format string is protected', () => {
  it('keeps %{http_code} literal', () => {
    // deviceCurl passes `-w %{http_code}`. Unquoted, the device shell treats
    // `{}` as a brace group and curl receives something else — the status
    // parse then reads garbage and every device-issued call looks like a 0.
    expect(posixSingleQuoteUnquote(deviceShellArg('%{http_code}'))).toBe('%{http_code}');
  });

  it('keeps a JSON body intact, braces quotes and all', () => {
    const body = '{"reason":"it\'s fine","n":1}';
    expect(posixSingleQuoteUnquote(deviceShellArg(body))).toBe(body);
  });
});
