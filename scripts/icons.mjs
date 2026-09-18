import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('assets', { recursive: true });
const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="218" fill="#18342f"/><rect x="40" y="40" width="944" height="944" rx="182" fill="none" stroke="#3b5346" stroke-width="3"/><path d="M240 752V514a272 272 0 0 1 544 0v238M370 752V514a142 142 0 0 1 284 0v238M240 630h544" fill="none" stroke="#e7eed7" stroke-width="58" stroke-linecap="round"/><circle cx="512" cy="168" r="17" fill="#bbd794"/></svg>';
await writeFile('assets/icon.svg', icon);
await writeFile('assets/icon.png', new Resvg(icon).render().asPng());
const tray = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M5 29V18a13 13 0 0 1 26 0v11M11 29V18a7 7 0 0 1 14 0v11M5 24h26" fill="none" stroke="black" stroke-width="2.6" stroke-linecap="round"/></svg>';
await writeFile('assets/trayTemplate.png', new Resvg(tray, { fitTo: { mode: 'width', value: 18 } }).render().asPng());
await writeFile('assets/trayTemplate@2x.png', new Resvg(tray).render().asPng());
