const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

console.log = (...args) => originalConsole.log('[INFO]', ...args);
console.warn = (...args) => originalConsole.warn('[WARN]', ...args);
console.error = (...args) => originalConsole.error('[ERROR]', ...args);
