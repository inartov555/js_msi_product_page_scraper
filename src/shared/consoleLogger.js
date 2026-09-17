const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function timestamp() {
  return new Date().toISOString();
}

function write(level, output, args) {
  const prefix = `[${timestamp()}] [${level}]`;

  if (typeof args[0] === 'string' && args[0].includes('\n')) {
    output(`${prefix}\n${args[0]}`, ...args.slice(1));
    return;
  }

  output(prefix, ...args);
}

console.log = (...args) => write('INFO', originalConsole.log, args);
console.warn = (...args) => write('WARN', originalConsole.warn, args);
console.error = (...args) => write('ERROR', originalConsole.error, args);
