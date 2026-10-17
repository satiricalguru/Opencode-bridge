// OpenCode Bridge site: WebGL sky, scroll choreography, and small interactions.
const REPO = 'satiricalguru/Opencode-bridge';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ---------- WebGL night sky with the Bridge arch ---------- */
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uScroll; uniform float uDraw;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; } return v; }
// Distance to an arch: a half circle of radius R on legs of height h.
float arch(vec2 p, float R, float h){
  if (p.y > 0.0) return abs(length(p) - R);
  if (p.y > -h) return abs(abs(p.x) - R);
  return length(vec2(abs(p.x) - R, p.y + h));
}
float bar(vec2 p, float R, float y){ vec2 q = p - vec2(clamp(p.x, -R, R), y); return length(q); }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 par = uMouse * 0.04;
  float t = uTime * 0.035;
  // Sky gradient: midnight blue to abyss.
  vec3 col = mix(vec3(0.016, 0.02, 0.035), vec3(0.05, 0.07, 0.16), smoothstep(-0.6, 0.7, uv.y));
  // Two cloud layers drifting at different speeds (parallax with the pointer).
  vec2 q = uv * 1.6 + par;
  float c1 = fbm(q + vec2(t, t * 0.3) + fbm(q * 1.7 - t) * 0.6);
  float c2 = fbm(q * 2.4 - vec2(t * 1.6, 0.0) + par * 2.0);
  vec3 iris = vec3(0.518, 0.49, 1.0), peri = vec3(0.565, 0.722, 0.941), orchid = vec3(0.867, 0.565, 0.847);
  vec3 tint = mix(peri, iris, smoothstep(0.2, 0.8, c2));
  tint = mix(tint, orchid, smoothstep(0.55, 0.9, fbm(q * 0.8 + 3.0 + t)));
  float clouds = smoothstep(0.35, 0.9, c1) * (0.5 + 0.5 * c2);
  col += tint * clouds * 0.55 * smoothstep(-1.0, 0.5, uv.y);
  // Stars, twinkling, hidden behind clouds.
  // Round, sub-cell stars so they stay points at any render scale.
  vec2 cell = uv * 70.0; vec2 g = floor(cell); float h = hash(g);
  vec2 sp = vec2(hash(g + 7.1), hash(g + 3.7));
  float sd = length(fract(cell) - sp);
  float star = step(0.93, h) * smoothstep(0.09, 0.0, sd) * (0.55 + 0.45 * sin(uTime * (1.0 + h * 4.0) + h * 40.0));
  col += vec3(0.85, 0.9, 1.0) * star * (1.0 - clouds * 0.8) * smoothstep(-0.3, 0.6, uv.y);
  // The Bridge mark: two arches and a deck, drawn in and breathing.
  vec2 p = (uv - vec2(0.0, -0.08 + uScroll * 0.25)) * (1.0 + uScroll * 0.6);
  // Portrait screens: size the arch to the width so the whole mark stays visible.
  p *= max(1.0, uRes.y / uRes.x * 1.1);
  float R = 0.62, r = 0.40, legs = 0.55;
  float d = min(min(arch(p, R, legs), arch(p, r, legs)), bar(p, R, -legs * 0.42));
  float sweep = smoothstep(uDraw * 2.4 - 1.2, uDraw * 2.4 - 1.0, -p.y * 1.2 + abs(p.x) * 0.6 + 0.8);
  float reveal = clamp(uDraw * 1.4, 0.0, 1.0) * (1.0 - sweep * (1.0 - uDraw));
  float core = smoothstep(0.004, 0.0, d) * 0.32;
  float glow = exp(-d * 40.0) * 0.28 + exp(-d * 8.0) * 0.10;
  float travel = exp(-pow(fract(atan(p.y, p.x) / 6.2831 - uTime * 0.06) - 0.5, 2.0) * 60.0);
  vec3 archCol = mix(peri, vec3(1.0), 0.35) * (core + glow * (0.75 + 0.25 * sin(uTime * 0.8))) + iris * glow * travel * 0.9;
  col += archCol * reveal * (1.0 - uScroll * 0.7);
  // Vignette and gentle fade as the page scrolls.
  col *= 1.0 - 0.45 * dot(uv * 0.8, uv * 0.8);
  col *= 1.0 - uScroll * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;
function startSky() {
  const canvas = document.getElementById('sky');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) { canvas.style.background = 'radial-gradient(800px 500px at 50% 30%, #1b2a55, #07080b)'; return; }
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = name => gl.getUniformLocation(prog, name);
  const U = { res: u('uRes'), time: u('uTime'), mouse: u('uMouse'), scroll: u('uScroll'), draw: u('uDraw') };
  // Render below device resolution: the sky is soft, and this keeps laptops cool.
  const resize = () => { const scale = Math.min(devicePixelRatio, 1.5) * (innerWidth > 1600 ? 0.6 : 0.75); canvas.width = Math.round(canvas.clientWidth * scale); canvas.height = Math.round(canvas.clientHeight * scale); gl.viewport(0, 0, canvas.width, canvas.height); };
  resize(); addEventListener('resize', resize);
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', e => { mouse.tx = e.clientX / innerWidth - 0.5; mouse.ty = 0.5 - e.clientY / innerHeight; }, { passive: true });
  let visible = true; new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const start = performance.now();
  const frame = now => {
    const time = (now - start) / 1000;
    mouse.x += (mouse.tx - mouse.x) * 0.04; mouse.y += (mouse.ty - mouse.y) * 0.04;
    gl.uniform2f(U.res, canvas.width, canvas.height); gl.uniform1f(U.time, reduced ? 12 : time);
    gl.uniform2f(U.mouse, mouse.x, mouse.y); gl.uniform1f(U.scroll, clamp(scrollY / innerHeight));
    gl.uniform1f(U.draw, reduced ? 1 : clamp((time - 0.2) / 2.6));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  if (reduced) { frame(start); addEventListener('scroll', () => frame(performance.now()), { passive: true }); return; }
  const loop = now => { if (visible && !document.hidden) frame(now); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
try { startSky(); } catch (err) { console.warn('WebGL sky disabled:', err); }

/* ---------- Logos ---------- */
for (const el of document.querySelectorAll('[data-logo]')) el.style.setProperty('--logo', `url(logos/${el.dataset.logo}.svg)`);
const LOGOS = [['claude', 'Claude'], ['codex', 'Codex'], ['opencode', 'OpenCode'], ['ollama', 'Ollama'], ['lmstudio', 'LM Studio'], ['openrouter', 'OpenRouter'], ['nvidia', 'NVIDIA'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['kimi', 'Kimi'], ['zhipu', 'GLM'], ['gemini', 'Gemini'], ['openai', 'OpenAI'], ['githubcopilot', 'Copilot'], ['mistral', 'Mistral'], ['meta', 'Llama'], ['grok', 'Grok'], ['minimax', 'MiniMax']];
const track = document.getElementById('marquee');
track.innerHTML = [...LOGOS, ...LOGOS].map(([id, name], i) => `<span class="marquee-item"${i >= LOGOS.length ? ' aria-hidden="true"' : ''}><i data-logo="${id}" style="--logo:url(logos/${id}.svg)"></i>${name}</span>`).join('');

/* ---------- Reveal on scroll, staggered per group ---------- */
const reveal = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); reveal.unobserve(entry.target); count(entry.target); }
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
for (const el of document.querySelectorAll('[data-reveal]')) {
  const siblings = [...el.parentElement.children].filter(c => c.hasAttribute('data-reveal'));
  el.style.setProperty('--delay', `${siblings.indexOf(el) * 0.09}s`);
  reveal.observe(el);
}

/* ---------- Counters ---------- */
function count(root) {
  for (const el of root.querySelectorAll ? [root, ...root.querySelectorAll('[data-count]')] : []) {
    if (!el.dataset.count || el.dataset.done) continue;
    el.dataset.done = '1';
    const target = Number(el.dataset.count), suffix = el.dataset.suffix || '', t0 = performance.now();
    const tick = now => { const k = reduced ? 1 : clamp((now - t0) / 1600); el.textContent = `${Math.round(target * (1 - Math.pow(1 - k, 4)))}${suffix}`; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}

/* ---------- Scroll-linked: nav, hero tilt, pinned story ---------- */
const nav = document.getElementById('nav');
const heroShot = document.getElementById('heroShot');
const story = document.querySelector('.story');
const steps = [...document.querySelectorAll('#steps li')];
const frames = [...document.querySelectorAll('.story-frames img')];
const storyBar = document.getElementById('storyBar');
const storyTitle = document.getElementById('storyTitle');
const titles = ['Launchpad', 'Applications · Claude', 'Launchpad · Codex'];
let lastStep = 0, ticking = false;
function onScroll() {
  ticking = false;
  nav.classList.toggle('scrolled', scrollY > 24);
  const p = clamp(scrollY / (innerHeight * 0.75));
  heroShot.style.setProperty('--tilt', `${22 * (1 - p)}deg`);
  heroShot.style.setProperty('--scale', `${0.9 + 0.1 * p}`);
  heroShot.style.setProperty('--lift', `${-40 * p}px`);
  if (story && innerWidth > 960) {
    const rect = story.getBoundingClientRect();
    const progress = clamp(-rect.top / (rect.height - innerHeight));
    storyBar.style.width = `${progress * 100}%`;
    const step = Math.min(steps.length - 1, Math.floor(progress * steps.length * 0.999));
    if (step !== lastStep) {
      steps.forEach((li, i) => li.classList.toggle('active', i === step));
      frames.forEach((img, i) => img.classList.toggle('active', i === step));
      storyTitle.textContent = titles[step];
      lastStep = step;
    }
  }
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

/* ---------- Tile spotlight follows the pointer ---------- */
for (const tile of document.querySelectorAll('.tile')) {
  tile.addEventListener('pointermove', e => { const r = tile.getBoundingClientRect(); tile.style.setProperty('--mx', `${e.clientX - r.left}px`); tile.style.setProperty('--my', `${e.clientY - r.top}px`); });
}

/* ---------- Light / dark compare slider ---------- */
const compare = document.getElementById('compare');
const handle = document.getElementById('compareHandle');
const setPos = pct => { pct = clamp(pct, 0, 100); compare.style.setProperty('--pos', `${pct}%`); handle.setAttribute('aria-valuenow', String(Math.round(pct))); };
let dragging = false;
const fromEvent = e => { const r = compare.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
compare.addEventListener('pointerdown', e => { dragging = true; compare.setPointerCapture(e.pointerId); fromEvent(e); });
compare.addEventListener('pointermove', e => { if (dragging) fromEvent(e); });
compare.addEventListener('pointerup', () => { dragging = false; });
handle.addEventListener('keydown', e => { const now = Number(handle.getAttribute('aria-valuenow')); if (e.key === 'ArrowLeft') setPos(now - 5); if (e.key === 'ArrowRight') setPos(now + 5); });
// A gentle hint the first time it scrolls into view.
new IntersectionObserver(([e], obs) => {
  if (!e.isIntersecting || reduced) return; obs.disconnect();
  const t0 = performance.now();
  const sweep = now => { const k = clamp((now - t0) / 1800); if (!dragging) setPos(50 + Math.sin(k * Math.PI * 2) * 22 * (1 - k)); if (k < 1) requestAnimationFrame(sweep); };
  requestAnimationFrame(sweep);
}, { threshold: 0.5 }).observe(compare);

/* ---------- Copy button ---------- */
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Copied ✓'; } catch { button.textContent = 'Select & copy'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
}

/* ---------- Latest release: point Download at the real .dmg ---------- */
(async () => {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) return;
    const release = await response.json();
    const dmg = (release.assets || []).find(a => a.name.endsWith('.dmg'));
    document.getElementById('relName').textContent = `${release.tag_name} · ${new Date(release.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    if (dmg) {
      const link = document.getElementById('dmgLink');
      link.href = dmg.browser_download_url;
      document.getElementById('dmgSize').textContent = `${Math.round(dmg.size / 1024 / 1024)} MB`;
    }
  } catch { /* Offline or rate-limited: the link falls back to the releases page. */ }
})();
