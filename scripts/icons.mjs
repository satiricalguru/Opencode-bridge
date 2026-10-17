import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('assets', { recursive: true });
// macOS icon grid: an 824px squircle centred on a 1024px canvas, leaving room for the shadow.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16294a"/><stop offset=".55" stop-color="#0b1322"/><stop offset="1" stop-color="#05080f"/></linearGradient>
  <radialGradient id="glowA" cx=".28" cy=".22" r=".62"><stop offset="0" stop-color="#3f7dff" stop-opacity=".75"/><stop offset="1" stop-color="#3f7dff" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx=".82" cy=".86" r=".55"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".55"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
  <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9cc2ff"/></linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".05"/><stop offset="1" stop-color="#ffffff" stop-opacity=".12"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="18"/><feOffset dy="14"/><feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="22"/></filter>
  <clipPath id="squircle"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
</defs>
<g filter="url(#shadow)">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#sky)"/>
  <g clip-path="url(#squircle)">
    <rect x="100" y="100" width="824" height="824" fill="url(#glowA)"/>
    <rect x="100" y="100" width="824" height="824" fill="url(#glowB)"/>
    <path d="M300 712V520a212 212 0 0 1 424 0v192M404 712V520a108 108 0 0 1 216 0v192M300 616h424" fill="none" stroke="#5b9dff" stroke-width="62" stroke-linecap="round" opacity=".55" filter="url(#soft)"/>
    <path d="M300 712V520a212 212 0 0 1 424 0v192M404 712V520a108 108 0 0 1 216 0v192M300 616h424" fill="none" stroke="url(#mark)" stroke-width="46" stroke-linecap="round"/>
    <circle cx="512" cy="232" r="16" fill="#7fb2ff"/>
  </g>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184" fill="none" stroke="url(#rim)" stroke-width="3"/>
</g>
</svg>`;
await writeFile('assets/icon.svg', icon);
await writeFile('assets/icon.png', new Resvg(icon).render().asPng());
const tray = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M5 29V18a13 13 0 0 1 26 0v11M11 29V18a7 7 0 0 1 14 0v11M5 24h26" fill="none" stroke="black" stroke-width="2.6" stroke-linecap="round"/></svg>';
await writeFile('assets/trayTemplate.png', new Resvg(tray, { fitTo: { mode: 'width', value: 18 } }).render().asPng());
await writeFile('assets/trayTemplate@2x.png', new Resvg(tray).render().asPng());
