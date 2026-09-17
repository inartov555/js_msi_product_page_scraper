const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function timestamp() {
  return new Date().toISOString();
}

console.log = (...args) => originalConsole.log(`[${timestamp()}] [INFO]`, ...args);
console.warn = (...args) => originalConsole.warn(`[${timestamp()}] [WARN]`, ...args);
console.error = (...args) => originalConsole.error(`[${timestamp()}] [ERROR]`, ...args);
