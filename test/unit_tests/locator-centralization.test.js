import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scraperDir = path.resolve(testDir, '../src/scraper');

const literalLocatorPatterns = [
  /\.locator\(\s*['"`]/g,
  /\.getBy(?:Role|Text|Label|TestId|Placeholder|AltText|Title)\(\s*['"`]/g,
  /\.waitForSelector\(\s*['"`]/g,
  /\.\$eval\(\s*['"`]/g,
  /\.\$\$eval\(\s*['"`]/g,
  /\.querySelector\(\s*['"`]/g,
  /\.querySelectorAll\(\s*['"`]/g,
  /\.matches\(\s*['"`]/g,
  /\.closest\(\s*['"`]/g,
];

test('all scraper DOM locators are centralized in locators.js', async () => {
  const files = (await readdir(scraperDir))
    .filter((name) => name.endsWith('.js') && name !== 'locators.js');

  const violations = [];

  for (const file of files) {
    const source = await readFile(path.join(scraperDir, file), 'utf8');

    for (const pattern of literalLocatorPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${file}:${line}: ${match[0].trim()}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Literal DOM locators must live in src/scraper/locators.js:\n${violations.join('\n')}`
  );
});
