/**
 * Minimal Jest transform: ESM → CJS for public/js/core/*.js files.
 *
 * Converts `export function foo()` / `export const bar` / `export { x, y }`
 * into plain declarations + `module.exports = { foo, bar, x, y }` at the end.
 *
 * Only applied to files matching the transform pattern in jest.config.js.
 */
module.exports = {
  process(src) {
    const names = [];

    // export function foo(...) / export class Foo / export const x = ...
    let code = src.replace(
      /^export\s+(function|const|let|var|class)\s+(\w+)/gm,
      (_match, keyword, name) => {
        names.push(name);
        return `${keyword} ${name}`;
      },
    );

    // export { a, b, c }
    code = code.replace(/^export\s*\{([^}]+)\}/gm, (_match, list) => {
      for (const name of list.split(',').map((n) => n.trim())) {
        if (name && !names.includes(name)) names.push(name);
      }
      return '';
    });

    if (names.length > 0) {
      code += `\nmodule.exports = { ${names.join(', ')} };\n`;
    }

    return { code };
  },
};
