// Backward-compatible entry point. Prefer `node src/cli.js scrape ...`.
process.argv.splice(2, 0, 'scrape');
await import('./cli.js');
