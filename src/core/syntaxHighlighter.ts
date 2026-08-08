// Earendel Terminal Real-Time Command Syntax Highlighter
export function highlightCommandLine(cmdStr: string): string {
  if (!cmdStr) return '';

  const tokens = cmdStr.split(/(\s+|"[^"]*"|'[^']*'|>>|>|\||&&)/).filter(Boolean);
  let isFirstToken = true;

  return tokens
    .map((token) => {
      // 1. Strings: "hello" or 'world'
      if (token.startsWith('"') || token.startsWith("'")) {
        return `\x1b[38;5;120m${token}\x1b[0m`;
      }
      // 2. Operators: |, >, >>, &&
      if (token === '|' || token === '>' || token === '>>' || token === '&&') {
        isFirstToken = true; // Next token after pipe/operator will be command name!
        return `\x1b[1;35m${token}\x1b[0m`;
      }
      // 3. Flags / Options: -a, -la, --max, -h
      if (token.startsWith('-')) {
        return `\x1b[1;33m${token}\x1b[0m`;
      }
      // 4. Variables: $USER, $HOME, $?
      if (token.startsWith('$')) {
        return `\x1b[1;32m${token}\x1b[0m`;
      }
      // 5. Command Name (First word of line or after operator)
      if (isFirstToken && !token.match(/^\s+$/)) {
        isFirstToken = false;
        return `\x1b[1;36m${token}\x1b[0m`;
      }

      // 6. Default Normal Arguments (Paths, numbers)
      return `\x1b[37m${token}\x1b[0m`;
    })
    .join('');
}
