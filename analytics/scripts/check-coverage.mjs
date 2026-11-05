// Read-only coverage audit. HTTP reads do not execute trackers or record visits.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import config from '../../assets/data/analytics-config.json' with { type: 'json' };

const site = fileURLToPath(new URL('../../', import.meta.url));
const live = process.argv.includes('--live');
const paths = [...Object.keys(config.pages), ...Object.keys(config.pageAliases || {})];
const tracker = new URL('/assets/js/visitor-map.js', config.siteOrigin).href;
let failures = 0;
async function check(path) {
  try {
    const url = new URL(path, config.siteOrigin);
    let html;
    if (live) {
      const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      html = await response.text();
    } else {
      const local = path === '/' ? resolve(site, 'index.html') : resolve(dirname(site), path.slice(1), ...(path.endsWith('/') ? ['index.html'] : []));
      html = await readFile(local, 'utf8');
    }
    const imports = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
      .filter(match => { const source = new URL(match[1], url); source.search = ''; source.hash = ''; return source.href === tracker; });
    if (imports.length !== 1) throw new Error('Expected one shared tracker, found ' + imports.length);
    console.log('OK ' + path);
  } catch (error) {
    failures++;
    console.error('FAIL ' + path + ': ' + error.message);
  }
}
for (let i = 0; i < paths.length; i += 4) await Promise.all(paths.slice(i, i + 4).map(check));
console.log(`${live ? 'Live' : 'Local'} coverage: ${paths.length - failures}/${paths.length}`);
if (failures) process.exitCode = 1;
