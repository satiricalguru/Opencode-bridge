import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } from 'electron';
import { mkdir } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stateDir } from '../storage.js';
import { GatewaySupervisor } from '../runtime.js';
import { ClaudeClient } from '../clients/claude.js';
import { ClientRegistry } from '../clients/registry.js';
import { DesktopService } from './service.js';
import { parseDesktopRequest } from './requests.js';
import type { DesktopResponse } from './contracts.js';

app.setName('OpenCode Bridge');
mkdirSync(join(stateDir(), 'desktop'), { recursive: true, mode: 0o700 });
app.setPath('userData', join(stateDir(), 'desktop'));
// Finder launches do not inherit an interactive shell's PATH.
process.env.PATH = [...new Set([join(homedir(), '.opencode/bin'), join(homedir(), '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '').split(':')])].join(':');
protocol.registerSchemesAsPrivileged([{ scheme: 'bridge', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const rendererRoot = join(root, 'renderer-dist');
const service = new DesktopService(new ClientRegistry([new ClaudeClient()]), new GatewaySupervisor(stateDir(), process.execPath, { ...process.env, ELECTRON_RUN_AS_NODE: '1' }));
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
const show = () => { if (window) { window.show(); window.focus(); } };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* Menu bar companion stays available. */ });
  // Waiting for ready at module top level stalls Electron's ESM startup.
  void app.whenReady().then(async () => {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  protocol.handle('bridge', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(rendererRoot + sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(path).href);
  });
  window = new BrowserWindow({ width: 1180, height: 790, minWidth: 1040, minHeight: 690, show: false,
    title: 'OpenCode Bridge', backgroundColor: '#f7f7f2', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 19 },
    webPreferences: { preload: join(root, 'desktop', 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => { event.preventDefault(); });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide(); } });
  ipcMain.handle('desktop:request', async (event, input): Promise<DesktopResponse> => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'bridge://app/index.html') return { ok: false, error: 'Untrusted app request.' };
    try {
      const request = parseDesktopRequest(input);
      let state;
      switch (request.action) {
        case 'state': state = await service.state(); break;
        case 'refresh': state = await service.refresh(); break;
        case 'save': state = await service.save(request.client, request.selection, request.port); break;
        case 'launch': state = await service.launch(request.client, request.selection, request.port, request.restart); break;
        case 'disconnect': state = await service.disconnect(request.client, request.restart); break;
        case 'stop': state = await service.stop(); break;
        case 'open-state': await shell.openPath(stateDir()); state = await service.state(); break;
      }
      return { ok: true, state };
    } catch (error: any) {
      // No stacks, command output or arbitrary provider response bodies cross IPC.
      return { ok: false, error: error?.code ? 'The operation could not complete. Check your local configuration and refresh.' : error instanceof Error ? error.message : 'The operation could not complete.' };
    }
  });
  const icon = nativeImage.createFromPath(join(root, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon); tray.setToolTip('OpenCode Bridge');
  tray.on('click', show);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open OpenCode Bridge', click: show }, { type: 'separator' },
    { label: 'Connections stay running when the app closes', enabled: false },
    { label: 'Quit OpenCode Bridge', click: () => app.quit() },
  ]));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'OpenCode Bridge', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: 'Show Bridge', click: show }] },
  ]));
  await window.loadURL('bridge://app/index.html');
  show();
  }).catch(() => { console.error('Desktop startup failed. Rebuild the app and check its packaged assets.'); app.quit(); });
}
