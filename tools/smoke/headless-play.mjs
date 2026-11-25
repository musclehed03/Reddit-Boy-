// Headless smoke + input-storm check for the snoo-boy client.
//
// Dynamic-first SOP (2026-11-24): this RUNS the built game in a real
// headless Chromium, drives it with real input, and fails on crashes,
// page errors, or a frozen render loop. It does not replace the bot army
// in testing-plan.md — it is the first rung: "does the built thing boot
// and survive being mashed on?"
//
// What it does:
//   1. Serves dist/client over HTTP with a stub /api/* (in-memory counter,
//      mirroring src/server/routes/api.ts) so the client's real fetch paths
//      run instead of 404ing.
//   2. Loads game.html in the cached headless Chromium (no new deps;
//      uses the Playwright browser cache + Node's built-in WebSocket).
//   3. Asserts: canvas exists, rAF loop advances, zero page errors,
//      zero console errors.
//   4. Clicks the Increment button and asserts the counter actually moves
//      (server-side stub counter is the source of truth).
//   5. Input storm: 60 random keys + 20 rapid random clicks, then asserts
//      the loop is still advancing, no new errors, count still finite.
//   6. Saves a screenshot + JSON summary to tools/smoke/last-run/.
//
// Run: `npm run test:smoke` (requires `npm run build` first).
// Exit 0 = all checks passed, 1 = any check failed.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist', 'client');
const OUT_DIR = path.join(ROOT, 'tools', 'smoke', 'last-run');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.map': 'application/json',
};

const failures = [];
const notes = [];
const check = (name, ok, detail = '') => {
  (ok ? notes : failures).push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- stub /api/* (mirrors src/server/routes/api.ts, in-memory) ---
let count = 0;
const apiHandler = (req, res) => {
  if (req.url === '/api/init' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'init', postId: 'smoke', count, username: 'smoke-test' }));
    return true;
  }
  if (req.url === '/api/increment' && req.method === 'POST') {
    count += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'increment', postId: 'smoke', count }));
    return true;
  }
  if (req.url === '/api/decrement' && req.method === 'POST') {
    count -= 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'decrement', postId: 'smoke', count }));
    return true;
  }
  return false;
};

const server = createServer(async (req, res) => {
  try {
    if (apiHandler(req, res)) return;
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(DIST, urlPath === '/' ? 'game.html' : urlPath);
    if (!file.startsWith(DIST)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

// --- find cached headless chromium (Playwright cache, no new downloads) ---
const home = process.env.HOME ?? '';
const candidates = [
  'chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell',
  'chromium-1255/chrome-linux/chrome',
].map((p) => path.join(home, '.cache', 'ms-playwright', p));
let chrome = null;
for (const c of candidates) {
  try {
    await fs.access(c);
    chrome = c;
    break;
  } catch {
    /* try next */
  }
}
if (!chrome) {
  console.error('No cached headless Chromium found under ~/.cache/ms-playwright.');
  console.error('Install one (e.g. `npx playwright install chromium`) and re-run.');
  server.close();
  process.exit(2);
}

const DEBUG_PORT = 9333;
const proc = spawn(chrome, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--remote-debugging-port=9333',
  '--remote-debugging-address=127.0.0.1',
  '--window-size=1024,768',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws = null;
try {
  // Wait for the DevTools endpoint.
  let targets = null;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      targets = await res.json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!targets) throw new Error('DevTools endpoint never came up');

  const pageTarget = targets.find((t) => t.type === 'page');
  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params.exceptionDetails));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  // Count animation frames from the moment the page loads.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__rafTicks = 0; const __tick = () => { window.__rafTicks++; requestAnimationFrame(__tick); }; requestAnimationFrame(__tick);`,
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/game.html` });
  await sleep(4000);

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result.value;
  };

  const canvas = await evalJs(`!!document.querySelector('#game-container canvas')`);
  check('canvas present', canvas === true);
  const raf1 = await evalJs(`window.__rafTicks`);
  await sleep(1000);
  const raf2 = await evalJs(`window.__rafTicks`);
  check('render loop advancing', raf2 > raf1, `rAF ${raf1} -> ${raf2} in 1s`);
  check('no page errors on boot', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 500));
  check('no console errors on boot', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 500));

  // MainMenu starts first and ANY pointerdown enters the Game scene
  // (MainMenu.create: input.once('pointerdown', () => scene.start('Game'))).
  // So: click once to enter the game, then click Increment.
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 512, y: 384, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 512, y: 384, button: 'left', clickCount: 1 });
  await sleep(1500);

  // Click Increment (button sits at 50% width, 55% height per Game.ts).
  const countBefore = count;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 512, y: 422, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 512, y: 422, button: 'left', clickCount: 1 });
  await sleep(1200);
  check('Increment click moves the counter', count === countBefore + 1, `count ${countBefore} -> ${count}`);

  // Input storm: random keys + rapid random clicks.
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'a', 'Escape', 'Tab'];
  for (let i = 0; i < 60; i++) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(Math.random() * 1024);
    const y = Math.floor(Math.random() * 768);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  await sleep(1500);
  const raf3 = await evalJs(`window.__rafTicks`);
  await sleep(500);
  const raf4 = await evalJs(`window.__rafTicks`);
  check('render loop still advancing after input storm', raf4 > raf3, `rAF ${raf3} -> ${raf4} in 0.5s`);
  check('no page errors after input storm', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 500));
  check('no console errors after input storm', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 500));
  check('counter still a finite number after storm', Number.isFinite(count), `count=${count}`);

  // Screenshot for the human pass.
  await fs.mkdir(OUT_DIR, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT_DIR, 'game.png'), Buffer.from(shot.data, 'base64'));
} catch (error) {
  failures.push(`FAIL harness error — ${error.message}`);
} finally {
  if (ws) ws.close();
  proc.kill('SIGKILL');
  server.close();
}

const summary = {
  at: new Date().toISOString(),
  passed: failures.length === 0,
  checks: [...notes, ...failures],
  finalCount: count,
};
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
for (const line of summary.checks) console.log(line);
console.log(`\n${failures.length === 0 ? 'SMOKE PASS' : 'SMOKE FAIL'} — summary + screenshot in tools/smoke/last-run/`);
process.exit(failures.length === 0 ? 0 : 1);
