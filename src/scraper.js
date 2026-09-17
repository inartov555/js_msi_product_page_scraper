process.argv.splice(2, 0, 'scrape');
await import('./cli.js');
