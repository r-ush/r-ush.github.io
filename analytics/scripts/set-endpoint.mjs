import { readFile, writeFile } from 'node:fs/promises';
const url = new URL(process.argv[2] || 'invalid');
if (url.protocol !== 'https:' || url.pathname !== '/collect' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS Worker URL ending in /collect, without credentials or query parameters.');
const path = new URL('../../assets/data/analytics-config.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
config.endpoint = url.href;
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log('Collector configured: ' + url.href);
