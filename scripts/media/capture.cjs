// README media: drives the built renderer with demo data in an offscreen Electron
// window and records stills, GIFs and MP4s. Run: npm run media (requires ffmpeg).
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFile, mkdir, rm, writeFile } = require('node:fs/promises');
const { join, extname, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '../..');
const out = join(root, 'docs', 'media');
const W = 1240, H = 820;
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Electron 44 rejects loadURL in a new offscreen window after another was destroyed,
// so finished windows are parked and closed together at the end.
const parked = [];
const retire = win => { win.webContents.setFrameRate(1); parked.push(win); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      const path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path));
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
function makeWindow(width = W, height = H, preload) {
  const win = new BrowserWindow({ width, height, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, ...(preload ? { preload, contextIsolation: true, sandbox: false } : {}) } });
  win.webContents.setFrameRate(30);
  return win;
}
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const click = (win, selector, text) => js(win, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text ? `e.textContent.trim().includes(${JSON.stringify(text)})` : 'true'}); if (!el) throw new Error('missing ' + ${JSON.stringify(`${selector} ${text || ''}`)}); el.click(); })()`);
async function still(win, name) { const image = await win.webContents.capturePage(); await writeFile(join(out, `${name}.png`), image.toPNG()); console.log('still', name); return image; }
// Records paint events into numbered PNGs while `script` runs, then encodes GIF (+ MP4).
async function record(win, name, script, { fps = 20, gifWidth = 860, gifFps = 12, mp4 = false } = {}) {
  const dir = join(tmpdir(), `bridge-media-${name}`); await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  let frame = 0; let last; let latest;
  // A drifting sky and grain change every pixel per frame, which bloats GIFs.
  const css = await win.webContents.insertCSS('.cloud{animation-play-state:paused!important}.grain{display:none!important}');
  const onPaint = (_e, _dirty, image) => { latest = image; };
  win.webContents.on('paint', onPaint); win.webContents.invalidate();
  let stop = false;
  const sampler = (async () => {
    const step = 1000 / fps; let next = Date.now();
    while (!stop) {
      const image = latest || last; if (image) { last = image; await writeFile(join(dir, `f${String(frame++).padStart(5, '0')}.jpg`), image.toJPEG(92)); }
      next += step; await sleep(Math.max(0, next - Date.now()));
    }
  })();
  const began = Date.now();
  await script(); stop = true; await sampler; win.webContents.off('paint', onPaint);
  await win.webContents.removeInsertedCSS(css);
  // Encode at the rate actually achieved so playback runs in real time.
  const rate = (frame / ((Date.now() - began) / 1000)).toFixed(3);
  const input = ['-y', '-loglevel', 'error', '-framerate', rate, '-i', join(dir, 'f%05d.jpg')];
  execFileSync('ffmpeg', [...input, '-vf', `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, join(out, `${name}.gif`)]);
  if (mp4) execFileSync('ffmpeg', [...input, '-vf', 'fps=30,scale=1240:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
  await rm(dir, { recursive: true, force: true });
  console.log('recorded', name, frame, 'frames at', rate, 'fps');
}
async function openApp(url, theme) {
  const win = makeWindow(W, H, join(__dirname, 'demo-preload.cjs'));
  await win.loadURL(`${url}/?theme=${theme}`);
  await sleep(2600);
  return win;
}
async function framed(url, image, name, theme) {
  const win = makeWindow(1560, 1080);
  await win.loadURL(`${url}/frame.html`);
  await js(win, `document.getElementById('stage').className = 'stage ${theme}'; const img = document.getElementById('shot'); img.src = ${JSON.stringify(image.toDataURL())}; new Promise(r => img.complete ? r() : img.onload = r)`);
  await sleep(300); await still(win, name); retire(win);
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  const { server, url } = await serve(join(root, 'renderer-dist'));
  const pages = await serve(__dirname);
  try {
    for (const theme of ['dark', 'light']) {
      const win = await openApp(url, theme);
      const launch = await still(win, `launchpad-${theme}`);
      await framed(pages.url, launch, `hero-${theme}`, theme);
      await click(win, '.nav button', 'Applications'); await sleep(1500); await still(win, `applications-${theme}`);
      await js(win, `document.querySelector('[aria-label="Codex model configuration"]').scrollIntoView({ block: 'start' })`); await sleep(900); await still(win, `codex-names-${theme}`);
      await js(win, `document.querySelector('main').scrollTo(0, 0)`);
      await click(win, '.nav button', 'Settings'); await sleep(1500); await still(win, `settings-${theme}`);
      await click(win, '.nav button', 'Launchpad'); await click(win, '.segmented button', 'Codex'); await sleep(1200); await still(win, `codex-${theme}`);
      retire(win);
    }
    // Guided tour (GIF + MP4).
    let win = await openApp(url, 'dark');
    await record(win, 'tour', async () => {
      await sleep(900);
      await click(win, '.model-row', 'Qwen3 Coder 30B'); await sleep(900);
      await click(win, '.model-row', 'DeepSeek V4.1 Flash Free'); await sleep(700);
      await click(win, '.effort-block .segmented button', 'Max'); await sleep(900);
      await click(win, '.chip', 'Ollama'); await sleep(1100); await click(win, '.chip', 'All'); await sleep(700);
      await click(win, '.launcher-top .segmented button', 'Codex'); await sleep(1300);
      await click(win, '.launcher-top .segmented button', 'Claude'); await sleep(700);
      await click(win, '.nav button', 'Applications'); await sleep(1800);
      await click(win, '.nav button', 'Settings'); await sleep(1200);
      await click(win, '.theme-card', 'Light'); await sleep(1500);
      await click(win, '.nav button', 'Launchpad'); await sleep(1500);
      await click(win, '.theme-card, .sidebar-foot .segmented button[title="Dark"]').catch(() => {});
      await js(win, `document.querySelector('.sidebar-foot .segmented button[title="Dark"]').click()`); await sleep(1300);
    }, { fps: 20, mp4: true });
    retire(win);
    // A model appears live after `ollama pull`.
    win = await openApp(url, 'dark');
    await record(win, 'live-models', async () => { await sleep(700); await js(win, 'window.demo.arrive()'); await sleep(3600); }, { fps: 20 });
    retire(win);
    // Real Codex session replay (timings from docs/media/codex-session.json, long waits shortened).
    const session = JSON.parse(await readFile(join(out, 'codex-session.json'), 'utf8'));
    const term = makeWindow(1240, 760);
    await term.loadURL(`${pages.url}/terminal.html`); await sleep(400);
    await record(term, 'codex-cli', async () => {
      const cmd = `$ ${session.command.replace(/^codex/, 'codex')}`;
      for (let i = 0; i <= cmd.length; i += 3) { await js(term, `show(${JSON.stringify(cmd.slice(0, i))}, true)`); await sleep(28); }
      let text = cmd + '\n'; let previous = 0;
      for (const [time, chunk] of session.chunks) {
        await sleep(Math.min(1300, Math.max(120, (time - previous) / 6))); previous = time;
        text += chunk; await js(term, `show(${JSON.stringify(text)}, false)`);
      }
      await js(term, `show(${JSON.stringify(text + '$ ')}, true)`); await sleep(2400);
    }, { fps: 15, gifWidth: 900, mp4: true });
    retire(term);
  } finally { for (const win of parked) win.destroy(); server.close(); pages.server.close(); app.quit(); }
}).catch(err => { console.error(err); app.exit(1); });
