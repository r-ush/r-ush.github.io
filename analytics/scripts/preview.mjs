// Local-only end-to-end preview. No Cloudflare account or external collection.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.mjs';
import { config } from '../src/metrics.mjs';
import { createDatabase } from '../test/database.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 8787);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };
async function file(base, path) {
  const full = resolve(base, '.' + path);
  if (!full.startsWith(resolve(base) + '\\') && !full.startsWith(resolve(base) + '/')) return new Response(null, { status: 403 });
  try { return new Response(await readFile(full), { headers: { 'Content-Type': mime[extname(full)] || 'application/octet-stream' } }); }
  catch { return new Response('Not found', { status: 404 }); }
}
const env = {
  DB: createDatabase(), ALLOW_LOCALHOST: 'true',
  ADMIN_TOKEN: 'local-preview-only-not-a-production-secret-12345',
  ASSETS: { fetch: async request => file(publicRoot, new URL(request.url).pathname.replace(/^\/admin\/?$/, '/index.html')) }
};
http.createServer(async (incoming, outgoing) => {
  try {
    const origin = 'http://127.0.0.1:' + port;
    const url = new URL(incoming.url, origin);
    const chunks = []; let size = 0;
    for await (const part of incoming) { size += part.length; if (size > 9000) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(part); }
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
    let result;
    if (url.pathname === '/assets/data/analytics-config.json') result = Response.json({ ...config, endpoint: origin + '/collect' });
    else if (url.pathname === '/') {
      const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replace('defer src="assets/js/visitor-map.js"', 'defer data-analytics-preview src="assets/js/visitor-map.js"');
      result = new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/') || ['/privacy.html', '/stylesheet.css', '/data/cv_seunghwan.pdf'].includes(url.pathname)) result = await file(root, url.pathname);
    else result = await worker.fetch(request, env);
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Local preview error'); }
}).listen(port, '127.0.0.1', () => {
  console.log('Homepage: http://127.0.0.1:' + port + '/');
  console.log('Dashboard: http://127.0.0.1:' + port + '/admin/');
  console.log('Local test key: ' + env.ADMIN_TOKEN);
  console.log('Temporary in-memory test database. No production data or cloud requests.');
});
