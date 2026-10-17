/// <reference path="./global.d.ts" />
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AppWindow, ArrowRight, ArrowUpRight, Bot, Check, ChevronDown, CircleAlert, Cpu, FolderOpen, Gauge, Layers3, LoaderCircle, LogOut, Monitor, Moon, Radar, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, SquareTerminal, Sun, Undo2, X } from 'lucide-react';
import '@fontsource-variable/inter';
import '@fontsource/caveat/500.css';
import type { DesktopRequest, DesktopState, ModelChange, ModelItem, Selection } from '../../src/desktop/contracts';
import { CLAUDE_SLOTS } from '../../src/slots';
import type { AgentPermission, Effort, Slot } from '../../src/types';
import { Mark, MARK_LABEL, ModelMark, providerMark } from './icons';
import './style.css';

type ClientId = 'claude' | 'codex';
type Page = 'launch' | 'apps' | 'settings';
type Theme = 'system' | 'light' | 'dark';
interface Toast { id: number; tone: 'success' | 'info' | 'error'; title: string; body?: string; icon?: ReactNode }

const prettyProvider = (p: string) => ({ 'ollama-local': 'Ollama', lmstudio: 'LM Studio', opencode: 'OpenCode Zen', nvidia: 'NVIDIA', openrouter: 'OpenRouter', 'github-copilot': 'GitHub Copilot', 'ollama-cloud': 'Ollama Cloud', google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic' } as Record<string, string>)[p] || p.replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
const contextLabel = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1024)}K`;
const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Med', high: 'High', xhigh: 'XHigh', max: 'Max' };
const PERMISSIONS: Array<{ value: AgentPermission; label: string; detail: string }> = [
  { value: 'read-only', label: 'Read only', detail: 'Read, search and browse. Edits and commands are declined.' },
  { value: 'workspace-write', label: 'Edit & run', detail: 'Also edits files and runs commands in the working folder.' },
  { value: 'full', label: 'Full access', detail: 'Also reaches outside the working folder. Use with care.' },
];
const mappingRows = ['fable', 'opus', 'sonnet', 'haiku', 'sonnet46'] as const;
const auxiliarySlots = ['opus', 'haiku', 'fable', 'sonnet46'] as const;
const mappingRef = (selection: Selection, slot: Slot) => slot === 'sonnet' ? selection.model : selection[slot] || selection.model;
const normalizeSelection = (selection: Selection): Selection => ({ ...selection, opus: selection.opus || selection.model, haiku: selection.haiku || selection.model, fable: selection.fable || selection.model, sonnet46: selection.sonnet46 || selection.model, autoMode: selection.autoMode === true });
const withEffort = (selection: Selection, slot: Slot, effort: Effort | '') => {
  const next = { ...selection.effort }; if (effort) next[slot] = effort; else delete next[slot];
  return { ...selection, effort: Object.keys(next).length ? next : undefined };
};
const firstEnabled = (models: ModelItem[]) => models.find(m => m.enabled)?.ref || '';
const readTheme = (): Theme => { try { const t = localStorage.getItem('bridge-theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } };
const vars = (value: Record<string, string | number>) => value as CSSProperties;

function BridgeMark() {
  return <svg className="bridge-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M7 31V20C7 12.82 12.82 7 20 7s13 5.82 13 13v11M13 31V20a7 7 0 0 1 14 0v11M7 25h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
// Segmented control with a sliding thumb.
function Segmented<T extends string>({ options, value, onChange, label, disabled, size = 'md' }: { options: Array<{ value: T; label: ReactNode; title?: string }>; value: T; onChange: (value: T) => void; label: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  const index = Math.max(0, options.findIndex(o => o.value === value));
  return <div className={`segmented ${size}`} role="radiogroup" aria-label={label} style={vars({ '--count': options.length, '--index': index })}>
    <span className="segmented-thumb" aria-hidden="true" />
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={option.value === value} title={option.title} className={option.value === value ? 'active' : ''} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
function EffortPicker({ model, value, onChange, disabled, size = 'md' }: { model?: ModelItem; value?: Effort; onChange: (effort: Effort | '') => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  const levels = model?.efforts || [];
  if (!levels.length) return <span className="effort-none" title="This model does not advertise effort levels"><Gauge size={13} /> Effort fixed</span>;
  return <Segmented size={size} label="Effort level" disabled={disabled} value={(value && levels.includes(value) ? value : '') as Effort | ''} onChange={onChange}
    options={[{ value: '' as const, label: 'Auto', title: 'Let the app choose the effort' }, ...levels.map(level => ({ value: level, label: EFFORT_LABEL[level], title: `Pin ${level} effort` }))]} />;
}
function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}
function Tags({ model, isNew }: { model: ModelItem; isNew: boolean }) {
  return <span className="tags">
    {isNew && <span className="tag new">New</span>}
    {model.source !== 'opencode' && <span className="tag local">Local</span>}
    {model.free && model.source === 'opencode' && <span className="tag free">Free</span>}
    {model.enabled && model.via === 'agent' && <span className="tag agent" title="Runs inside OpenCode’s agent and tools">Agent</span>}
  </span>;
}
function useCount(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(); const origin = from.current;
    if (origin === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { from.current = target; setValue(target); return; }
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700); const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(origin + (target - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(step); else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function App() {
  const [data, setData] = useState<DesktopState>();
  const [page, setPage] = useState<Page>('launch');
  const [selections, setSelections] = useState<Record<ClientId, Selection>>({ claude: { model: '' }, codex: { model: '' } });
  const [client, setClient] = useState<ClientId>('claude');
  const [port, setPort] = useState(41415);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [readyOnly, setReadyOnly] = useState(true);
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(80);
  const [workspace, setWorkspace] = useState('');
  const [permission, setPermission] = useState<AgentPermission>('read-only');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const hydrated = useRef(false);
  const busyRef = useRef(false);
  const selection = selections[client];
  const setSelection = (update: (s: Selection) => Selection, id: ClientId = client) => setSelections(all => ({ ...all, [id]: update(all[id]) }));

  const toast = (item: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-3), { ...item, id }]);
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), item.tone === 'error' ? 9000 : 5200);
  };
  const hydrate = (next: DesktopState) => {
    if (hydrated.current) return;
    const id = next.preferences.selectedClient === 'codex' ? 'codex' : 'claude';
    setClient(id); setPort(next.preferences.port);
    setSelections({ claude: normalizeSelection(next.preferences.selections.claude || { model: firstEnabled(next.models) }), codex: next.preferences.selections.codex || { model: next.preferences.selections.claude?.model || firstEnabled(next.models) } });
    setWorkspace(next.preferences.agent.workspace); setPermission(next.preferences.agent.permission);
    hydrated.current = true;
  };
  async function request(value: DesktopRequest, label = '', success = '') {
    if (busyRef.current) return;
    busyRef.current = true;
    if (label) { setBusy(label); setError(''); }
    try {
      const response = await window.desktop.request(value);
      if (!response.ok) { setError(response.error); return; }
      const next = response.state;
      setData(next);
      hydrate(next);
      if (value.action === 'refresh') setSelections(all => ({ claude: all.claude.model ? all.claude : normalizeSelection({ model: firstEnabled(next.models) }), codex: all.codex.model ? all.codex : { model: firstEnabled(next.models) } }));
      if (success) toast({ tone: 'success', title: success });
    } catch { setError('The desktop service could not be reached. Reopen the app and try again.'); }
    finally { busyRef.current = false; setBusy(''); }
  }
  useEffect(() => {
    void (async () => { await request({ action: 'state' }); await request({ action: 'refresh' }, 'Reading your connections'); })();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void request({ action: 'state' }); }, 8000);
    const onFocus = () => { void request({ action: 'state' }); };
    window.addEventListener('focus', onFocus);
    // Live model arrivals from Ollama, LM Studio and OpenCode.
    const off = window.desktop.onChange?.((change: ModelChange) => {
      setData(change.state);
      if (change.added.length) {
        setFresh(set => new Set([...set, ...change.added.map(m => m.ref)]));
        const first = change.added[0];
        toast({ tone: 'info', title: change.added.length === 1 ? `${first.name} is ready` : `${change.added.length} new models are ready`, body: change.added.length === 1 ? `Added from ${prettyProvider(first.provider)}.` : change.added.slice(0, 3).map(m => m.name).join(', ') + (change.added.length > 3 ? '…' : ''), icon: <Mark name={providerMark(first.provider, first.source)} /> });
      }
      if (change.removed.length) toast({ tone: 'info', title: change.removed.length === 1 ? `${change.removed[0].name} was removed` : `${change.removed.length} models were removed`, body: `From ${prettyProvider(change.removed[0].provider)}.` });
    });
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); off?.(); };
  }, []);
  useEffect(() => { setLimit(80); }, [query, provider, readyOnly]);
  // Theme: system follows macOS; the native side matches so vibrancy and chrome agree.
  useEffect(() => {
    const root = document.documentElement;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { root.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme; };
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('bridge-theme', theme); } catch {}
    void window.desktop.request({ action: 'theme', theme }).catch(() => {});
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const models = data?.models || [];
  const enabled = models.filter(m => m.enabled);
  const find = (ref?: string) => models.find(m => m.ref === ref);
  const statusOf = (id: ClientId) => data?.clients.find(c => c.id === id)?.status;
  const claude = statusOf('claude'); const codex = statusOf('codex');
  const application = data?.clients.find(c => c.id === client);
  const status = application?.status;
  const claudeLocked = !!claude?.connected || !!claude?.recoveryNeeded;
  const locked = client === 'claude' && claudeLocked;
  const picked = find(selection.model);
  const claudeSelection = selections.claude;
  const claudeValid = !!find(claudeSelection.model)?.enabled && [claudeSelection.opus, claudeSelection.haiku, claudeSelection.fable, claudeSelection.sonnet46].filter(Boolean).every(ref => find(ref)?.enabled);
  const codexValid = !!find(selections.codex.model)?.enabled;
  const valid = client === 'claude' ? claudeValid : codexValid;
  const mappingChanged = data?.savedRoutes.length !== 5 || data.savedRoutes.some(route => route.ref !== mappingRef(claudeSelection, route.slot) || route.effort !== claudeSelection.effort?.[route.slot]) || (data.preferences.selections.claude?.autoMode === true) !== (claudeSelection.autoMode === true);
  const codexRoute = data?.codexRoutes[0];
  const codexChanged = !codexRoute || codexRoute.ref !== selections.codex.model || codexRoute.effort !== selections.codex.effort?.sonnet;
  const providers = useMemo(() => {
    const counts = new Map<string, { count: number; source: string }>();
    for (const m of models) if (!readyOnly || m.enabled) counts.set(m.provider, { count: (counts.get(m.provider)?.count || 0) + 1, source: m.source });
    return [...counts.entries()].sort((a, b) => Number(b[1].source !== 'opencode') - Number(a[1].source !== 'opencode') || b[1].count - a[1].count);
  }, [models, readyOnly]);
  const shown = models.filter(m => (!readyOnly || m.enabled) && (provider === 'all' || m.provider === provider) && `${m.name} ${m.ref} ${m.provider}`.toLowerCase().includes(query.toLowerCase()));
  const agentCount = enabled.filter(m => m.via === 'agent').length;
  const freeCount = enabled.filter(m => m.free).length;
  const readyCount = useCount(enabled.length);
  const changeSelection = (model: ModelItem) => {
    if (locked || !model.enabled) return;
    if (client === 'codex') setSelection(s => ({ ...s, model: model.ref, effort: s.effort?.sonnet && model.efforts.includes(s.effort.sonnet) ? s.effort : undefined }));
    else setSelection(s => normalizeSelection({ ...s, model: model.ref, effort: s.effort?.sonnet && model.efforts.includes(s.effort.sonnet) ? s.effort : withEffort(s, 'sonnet', '').effort, ...Object.fromEntries(auxiliarySlots.map(key => [key, !s[key] || s[key] === s.model ? model.ref : s[key]])) }));
    setError('');
  };
  const modelOptions = (ref: string) => <>{ref && !find(ref) && <option value={ref} disabled>{ref} · unavailable</option>}{models.filter(model => model.enabled || model.ref === ref).map(model => <option key={model.ref} value={model.ref} disabled={!model.enabled}>{model.name} — {prettyProvider(model.provider)}{model.via === 'agent' ? ' · agent' : ''}</option>)}</>;
  const launchCodex = (target: 'cli' | 'app') => request({ action: 'launch', client: 'codex', selection: selections.codex, port, restart: target === 'app', target }, target === 'app' ? 'Connecting the Codex app' : 'Opening Codex in Terminal', target === 'app' ? 'Codex app restarted with your model' : 'Codex opened in Terminal');
  const appName = client === 'codex' ? 'Codex' : 'Claude';
  const portValid = Number.isInteger(port) && port >= 1024 && port <= 65535;
  const pages: Array<{ id: Page; label: string; icon: ReactNode }> = [{ id: 'launch', label: 'Launchpad', icon: <Layers3 size={17} /> }, { id: 'apps', label: 'Applications', icon: <AppWindow size={17} /> }, { id: 'settings', label: 'Settings', icon: <Settings2 size={17} /> }];
  const discovering = busy.includes('Reading') || busy.includes('Refreshing');
  const appStatus = (id: ClientId) => { const s = statusOf(id); return !s ? 'checking' : s.recoveryNeeded ? 'warn' : s.connected ? 'on' : s.installed ? 'idle' : 'off'; };

  return <div className="app">
    <div className="sky" aria-hidden="true"><span className="cloud c1" /><span className="cloud c2" /><span className="cloud c3" /><span className="grain" /></div>
    <aside className="sidebar">
      <div className="drag" />
      <div className="brand"><BridgeMark /><div><strong>Bridge</strong><span>models → your apps</span></div></div>
      <nav className="nav" aria-label="Main navigation" style={vars({ '--index': pages.findIndex(p => p.id === page) })}>
        <span className="nav-indicator" aria-hidden="true" />
        {pages.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setError(''); }}>{item.icon}<span>{item.label}</span>{item.id === 'apps' && <span className="nav-count">{data?.clients.length || 2}</span>}</button>)}
      </nav>
      <div className="side-section">
        <div className="side-label">Connected apps</div>
        {(['claude', 'codex'] as const).map(id => <button key={id} className="side-app" onClick={() => { setClient(id); setPage('launch'); }}><span className="side-app-icon"><Mark name={id} /></span><span>{id === 'claude' ? 'Claude' : 'Codex'}</span><span className={`status-dot ${appStatus(id)}`} title={appStatus(id)} /></button>)}
      </div>
      <div className="sidebar-foot">
        <div className={`gateway-pill ${data?.gateway.ready ? 'live' : ''}`}><span className="pulse" /><span>{data?.gateway.ready ? <>Gateway <b>:{data.gateway.port}</b></> : 'Gateway idle'}</span>{data?.gateway.ready && <span className="routed">{data.gateway.routed}</span>}</div>
        <Segmented size="sm" label="Appearance" value={theme} onChange={setTheme} options={[{ value: 'system', label: <Monitor size={13} />, title: 'Match system' }, { value: 'light', label: <Sun size={13} />, title: 'Light' }, { value: 'dark', label: <Moon size={13} />, title: 'Dark' }]} />
        <button className="quit" disabled={!!busy || !!data?.gateway.active} onClick={() => request({ action: 'disconnect-quit', client: 'claude', restart: true }, 'Disconnecting and quitting')}><LogOut size={14} /> Disconnect & Quit</button>
        <span className="version">v{data?.version || '0.3.0'}</span>
      </div>
    </aside>
    <main>
      <div className="drag" />
      <header className="header">
        <div>
          <div className="eyebrow"><span className="live-dot" />{discovering ? 'Discovering models…' : `Watching Ollama, LM Studio & OpenCode`}</div>
          <h1 key={page}>{page === 'launch' ? <>Pick a model. Open something <em>good.</em></> : page === 'apps' ? <>Your apps, your <em>models.</em></> : <>Tuned just <em>right.</em></>}</h1>
        </div>
        <button className="ghost-button" aria-label="Refresh models and connections" onClick={() => request({ action: 'refresh' }, 'Refreshing connections', 'Models refreshed')} disabled={!!busy}><RefreshCw size={15} className={discovering ? 'spin' : ''} /> Refresh</button>
      </header>
      {error && <div className="alert" role="alert"><CircleAlert size={16} /><span>{error}</span><button aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></div>}
      {data?.notices.map(n => <div className="alert soft" key={n}><CircleAlert size={16} /><span>{n}</span></div>)}

      {page === 'launch' && <div className="page launch" key="launch">
        <section className="panel library" aria-label="Model library">
          <div className="panel-head">
            <div><h2>Model library</h2><p><b className="count">{readyCount}</b> ready{freeCount ? <> · <span className="hl-free">{freeCount} free</span></> : null}{agentCount ? <> · {agentCount} via OpenCode agent</> : null}</p></div>
            <label className="ready-toggle"><Switch checked={readyOnly} onChange={setReadyOnly} label="Show ready models only" /> Ready only</label>
          </div>
          <div className="search"><Search size={16} /><input aria-label="Search models" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${models.length} models…`} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}<kbd>{shown.length}</kbd></div>
          <div className="chips" role="tablist" aria-label="Filter by provider">
            <button role="tab" aria-selected={provider === 'all'} className={provider === 'all' ? 'chip active' : 'chip'} onClick={() => setProvider('all')}><Sparkles size={13} /> All</button>
            {providers.map(([id, info]) => <button role="tab" key={id} aria-selected={provider === id} className={provider === id ? 'chip active' : 'chip'} onClick={() => setProvider(provider === id ? 'all' : id)} title={prettyProvider(id)}><Mark name={providerMark(id, info.source)} label={prettyProvider(id)} /> {prettyProvider(id)} <span>{info.count}</span></button>)}
          </div>
          {locked && <button className="lock-note" onClick={() => setPage('apps')}><ShieldCheck size={14} /> Claude is connected — change its models in Applications <ArrowRight size={13} /></button>}
          <div className="model-list" role="radiogroup" aria-label={`Primary model for ${appName}`} key={`${provider}-${readyOnly}`}>
            {!models.length && discovering && Array.from({ length: 7 }, (_, i) => <div className="model-row skeleton" key={i} style={vars({ '--i': i })}><span className="sk-icon" /><span className="sk-lines"><span /><span /></span></div>)}
            {shown.slice(0, limit).map((model, i) => {
              const checked = selection.model === model.ref;
              return <button role="radio" aria-checked={checked} key={model.ref} style={vars({ '--i': Math.min(i, 14) })} className={`model-row ${checked ? 'selected' : ''} ${!model.enabled ? 'unavailable' : ''} ${fresh.has(model.ref) ? 'fresh' : ''}`} disabled={!!busy || locked || !model.enabled} onClick={() => changeSelection(model)} title={model.reason || model.ref}>
                <ModelMark provider={model.provider} source={model.source} id={model.ref} name={model.name} />
                <span className="model-copy"><strong>{model.name}</strong><span>{prettyProvider(model.provider)}<i>·</i>{model.enabled ? <>{contextLabel(model.context)} context{model.efforts.length ? <><i>·</i>{model.efforts.length} effort levels</> : null}</> : model.reason}</span></span>
                <Tags model={model} isNew={fresh.has(model.ref)} />
                <span className="radio" aria-hidden="true"><Check size={11} strokeWidth={3.2} /></span>
              </button>;
            })}
            {!shown.length && !discovering && <div className="empty"><Radar size={28} /><strong>No models here yet</strong><p>{query ? 'Try another name or provider.' : 'Pull a model in Ollama, download one in LM Studio, or connect a provider in OpenCode — it appears here automatically.'}</p>{readyOnly && <button className="link" onClick={() => setReadyOnly(false)}>Browse all models <ArrowUpRight size={13} /></button>}</div>}
            {shown.length > limit && <button className="load-more" onClick={() => setLimit(n => n + 80)}>Show {Math.min(80, shown.length - limit)} more <ChevronDown size={14} /></button>}
          </div>
        </section>

        <section className={`panel launcher ${client}`} aria-label="Launch application">
          <div className="launcher-hero">
            <div className="orb" aria-hidden="true"><span /><span /><span /></div>
            <div className="launcher-top"><span className="eyebrow">Open with</span><Segmented label="Application" value={client} onChange={id => { setClient(id); setError(''); }} disabled={!!busy} options={[{ value: 'claude', label: <><Mark name="claude" /> Claude</> }, { value: 'codex', label: <><Mark name="codex" /> Codex</> }]} /></div>
            <div className="app-id"><span className="app-icon"><Mark name={client} /></span><div><h2>{application?.name || 'Claude Desktop'}</h2><p>{application?.description || 'Chat, Code & Cowork'}</p></div></div>
            <div className="app-state">
              <span><span className={`status-dot ${appStatus(client)}`} />{!status ? 'Checking…' : !status.installed ? 'Not installed' : client === 'codex' ? [status.targets?.cli && 'CLI', status.targets?.app && 'App'].filter(Boolean).join(' + ') + ' found' : status.running ? 'Running' : 'Ready'}</span>
              <span className={status?.connected ? 'ok' : ''}>{status?.recoveryNeeded ? 'Restore needed' : status?.connected ? client === 'codex' ? status.appConnected ? 'App connected' : 'Profile ready' : 'Connected' : 'Not connected'}</span>
            </div>
          </div>
          <div className="pick" key={selection.model}>
            <span className="eyebrow">{client === 'codex' ? 'Codex model' : 'Primary · Sonnet 5'}</span>
            {picked ? <div className="selected-model"><ModelMark size="lg" provider={picked.provider} source={picked.source} id={picked.ref} name={picked.name} /><div><h3>{picked.name}</h3><p>{prettyProvider(picked.provider)}{picked.via === 'agent' ? ' · OpenCode agent' : ''}</p></div></div> : <div className="selected-model empty-pick"><h3>Choose a model</h3><p>Pick one from the library.</p></div>}
            {picked && <div className="facts"><span><Cpu size={12} />{picked.source !== 'opencode' ? 'On this Mac' : picked.via === 'agent' ? 'OpenCode tools' : `${appName} tools`}</span><span>{contextLabel(picked.context)} context</span>{picked.vision && <span>Vision</span>}{picked.free && <span className="hl-free">Free</span>}</div>}
            {picked?.enabled && <div className="effort-block"><span className="field-label"><Gauge size={13} /> Effort</span><EffortPicker model={picked} value={selection.effort?.sonnet} disabled={!!busy || locked} onChange={effort => setSelection(s => withEffort(s, 'sonnet', effort))} /></div>}
            {!picked?.enabled && picked && <p className="note warn">{picked.reason}</p>}
            {picked?.via === 'agent' && <p className="note agent"><Bot size={14} /> Answers come from OpenCode’s agent ({data?.preferences.agent.permission === 'read-only' ? 'read-only' : data?.preferences.agent.permission === 'full' ? 'full access' : 'can edit'}); {appName}’s own tools aren’t used.</p>}
          </div>
          <div className="actions">
            <label className="restart"><Switch checked={restart} onChange={setRestart} label={`Restart ${appName} if needed`} disabled={!!busy} /><span>Restart {appName} if needed<small>May interrupt active tasks</small></span></label>
            {client === 'claude' ? <>
              <button className="primary" disabled={!!busy || !valid || !status?.installed || !portValid} onClick={() => locked && mappingChanged ? setPage('apps') : request({ action: 'launch', client, selection, port, restart }, 'Connecting Claude', 'Claude is open on your model')}>
                {busy.includes('Connecting') ? <LoaderCircle className="spin" size={17} /> : <ArrowUpRight size={17} />}{busy.includes('Connecting') ? 'Connecting…' : locked && mappingChanged ? 'Configure Claude' : status?.connected ? 'Open Claude' : 'Launch Claude'}</button>
              <button className="secondary" disabled={!!busy || !valid || locked || !portValid} onClick={() => request({ action: 'save', client, selection, port }, 'Saving selection', 'Selection saved')}><Check size={14} /> Save for later</button>
            </> : <>
              <button className="primary" disabled={!!busy || !valid || !status?.targets?.cli || !portValid} onClick={() => launchCodex('cli')}>{busy.includes('Terminal') ? <LoaderCircle className="spin" size={17} /> : <SquareTerminal size={17} />}{busy.includes('Terminal') ? 'Opening…' : 'Launch Codex CLI'}</button>
              <button className="secondary" disabled={!!busy || !valid || !status?.targets?.app || !portValid} onClick={() => launchCodex('app')}>{busy.includes('Codex app') ? <LoaderCircle className="spin" size={14} /> : <AppWindow size={14} />} {status?.appConnected && !codexChanged ? 'Open Codex app' : 'Use in Codex app'}</button>
            </>}
            <button className="link center" disabled={!!busy || !(status?.connected || status?.recoveryNeeded)} onClick={() => request({ action: 'disconnect', client, restart }, `Restoring ${appName}`, `${appName} restored`)}><Undo2 size={13} /> {client === 'codex' ? 'Disconnect Codex' : 'Restore previous connection'}</button>
          </div>
        </section>
      </div>}

      {page === 'apps' && <div className="page apps" key="apps">
        <article className="panel integration" aria-label="Claude model configuration">
          <header className="integration-head"><span className="app-icon lg"><Mark name="claude" /></span><div><h2>Claude</h2><p>Claude keeps its own model names. Choose what really answers each one, and pin effort if you like.</p></div>
            <button className="primary compact" disabled={!!busy || !claudeValid || !claude?.installed || !!data?.gateway.active || !portValid} onClick={() => request({ action: 'apply', client: 'claude', selection: claudeSelection, port, restart: true }, 'Applying Claude models', 'Models applied — Claude restarted')}><RefreshCw size={14} className={busy.includes('Applying Claude') ? 'spin' : ''} />{busy.includes('Applying Claude') ? 'Applying…' : mappingChanged ? 'Apply & restart' : 'Restart Claude'}</button></header>
          <div className="mappings">{mappingRows.map((key, i) => {
            const slot = CLAUDE_SLOTS.find(slot => slot.key === key)!;
            const ref = mappingRef(claudeSelection, key); const model = find(ref);
            const applied = data?.savedRoutes.find(route => route.slot === key);
            const same = applied?.ref === ref && applied?.effort === claudeSelection.effort?.[key];
            return <div className="mapping" key={key} style={vars({ '--i': i })}>
              <div className="mapping-name"><span className="claude-chip"><Mark name="claude" /></span><div><label htmlFor={`model-${key}`}>{slot.label}</label><span className={same ? 'state ok' : 'state pending'}>{same ? 'Applied' : 'Pending restart'}</span></div></div>
              <ArrowRight size={16} className="mapping-arrow" aria-hidden="true" />
              <div className="mapping-pick">{model && <ModelMark provider={model.provider} source={model.source} id={model.ref} name={model.name} />}<div className="select"><select id={`model-${key}`} aria-label={`${slot.label} model`} value={ref} disabled={!!busy} onChange={event => { const value = event.target.value; setSelection(s => { const next = { ...s, [key === 'sonnet' ? 'model' : key]: value }; return find(value)?.efforts.includes(s.effort?.[key] as Effort) ? next : withEffort(next, key, ''); }, 'claude'); }}>{modelOptions(ref)}</select><ChevronDown size={14} /></div></div>
              <EffortPicker size="sm" model={model} value={claudeSelection.effort?.[key]} disabled={!!busy} onChange={effort => setSelection(s => withEffort(s, key, effort), 'claude')} />
            </div>;
          })}</div>
          <div className="integration-row"><div><strong>Auto mode</strong><p>Let Claude decide when to ask before making changes. Depends on model and Claude version.</p></div><Switch checked={claudeSelection.autoMode === true} disabled={!!busy} label="Enable auto mode" onChange={value => setSelection(s => ({ ...s, autoMode: value }), 'claude')} /></div>
          <footer className="integration-foot"><span>{data?.gateway.active ? 'Wait for the active request to finish before restarting.' : 'Changes stay here until you apply them. Restarting may interrupt tasks.'}</span><button className="link" disabled={!!busy || !claudeLocked} onClick={() => request({ action: 'disconnect', client: 'claude', restart: true }, 'Restoring Claude', 'Claude restored')}><Undo2 size={13} /> Disconnect</button></footer>
        </article>
        <article className="panel integration" aria-label="Codex model configuration">
          <header className="integration-head"><span className="app-icon lg"><Mark name="codex" /></span><div><h2>Codex</h2><p>Works like <code>ollama launch codex</code>: a private <code>opencode-bridge</code> profile for the CLI, or a reversible pick for the Codex app.</p></div>
            <button className="primary compact" disabled={!!busy || !codexValid || !codex?.targets?.cli || !portValid} onClick={() => launchCodex('cli')}><SquareTerminal size={14} /> Launch CLI</button></header>
          <div className="mappings"><div className="mapping">
            <div className="mapping-name"><span className="claude-chip"><Mark name="codex" /></span><div><label htmlFor="codex-model">Model</label><span className={codexChanged ? 'state pending' : 'state ok'}>{codexChanged ? 'Next launch' : codex?.appConnected ? 'App connected' : 'Profile ready'}</span></div></div>
            <ArrowRight size={16} className="mapping-arrow" aria-hidden="true" />
            <div className="mapping-pick">{find(selections.codex.model) && <ModelMark provider={find(selections.codex.model)!.provider} source={find(selections.codex.model)!.source} id={selections.codex.model} name={find(selections.codex.model)!.name} />}<div className="select"><select id="codex-model" aria-label="Codex model" value={selections.codex.model} disabled={!!busy} onChange={event => { const value = event.target.value; setSelection(s => ({ ...s, model: value, effort: find(value)?.efforts.includes(s.effort?.sonnet as Effort) ? s.effort : undefined }), 'codex'); }}>{modelOptions(selections.codex.model)}</select><ChevronDown size={14} /></div></div>
            <EffortPicker size="sm" model={find(selections.codex.model)} value={selections.codex.effort?.sonnet} disabled={!!busy} onChange={effort => setSelection(s => withEffort(s, 'sonnet', effort), 'codex')} />
          </div></div>
          <div className="targets"><span className={codex?.targets?.cli ? 'ok' : ''}><SquareTerminal size={14} /> CLI {codex?.targets?.cli ? 'found' : 'missing · npm i -g @openai/codex'}</span><span className={codex?.targets?.app ? 'ok' : ''}><AppWindow size={14} /> App {codex?.targets?.app ? 'found' : 'not installed'}</span><code>codex --profile opencode-bridge</code></div>
          <footer className="integration-foot"><span>The Codex app option edits its selected model in ~/.codex/config.toml and restarts it. Disconnect restores it exactly.</span><div className="foot-actions"><button className="link" disabled={!!busy || !codexValid || !codex?.targets?.app} onClick={() => launchCodex('app')}><AppWindow size={13} /> Use in app</button><button className="link" disabled={!!busy || !(codex?.connected || codex?.recoveryNeeded)} onClick={() => request({ action: 'disconnect', client: 'codex', restart: true }, 'Restoring Codex', 'Codex restored')}><Undo2 size={13} /> Disconnect</button></div></footer>
        </article>
        {agentCount > 0 && <div className="callout"><Bot size={18} /><p><b>Free OpenCode models run inside OpenCode.</b> OpenCode allows its free tier only within OpenCode, so Bridge uses a private OpenCode agent for them. It runs OpenCode’s own tools under your Settings policy, and app-side tools like Claude Code’s aren’t used.</p></div>}
      </div>}

      {page === 'settings' && <div className="page settings" key="settings">
        <section className="panel setting"><div className="setting-copy"><h3>Appearance</h3><p>Match macOS, or keep Bridge light or dark.</p></div>
          <div className="theme-cards" role="radiogroup" aria-label="Theme">{(['system', 'light', 'dark'] as const).map(t => <button key={t} role="radio" aria-checked={theme === t} className={`theme-card ${t} ${theme === t ? 'active' : ''}`} onClick={() => setTheme(t)}><span className="preview"><span /><span /><span /></span><span className="theme-name">{t === 'system' ? <Monitor size={13} /> : t === 'light' ? <Sun size={13} /> : <Moon size={13} />}{t[0].toUpperCase() + t.slice(1)}</span></button>)}</div></section>
        <section className="panel setting agent-setting"><div className="setting-copy"><h3><Bot size={16} /> OpenCode agent</h3><p>Used by free Zen models and anything else that runs inside OpenCode. It works in the app’s project folder when known, otherwise here.</p></div>
          <div className="agent-form">
            <label className="field"><span className="field-label">Workspace folder</span><input value={workspace} spellCheck={false} disabled={!!busy} onChange={e => setWorkspace(e.target.value)} aria-invalid={!workspace.startsWith('/')} /></label>
            <div className="perm-grid" role="radiogroup" aria-label="Tool permissions">{PERMISSIONS.map(option => <button key={option.value} role="radio" aria-checked={permission === option.value} className={`perm ${permission === option.value ? 'active' : ''}`} disabled={!!busy} onClick={() => setPermission(option.value)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}</div>
            <button className="primary compact self-end" disabled={!!busy || !workspace.startsWith('/') || (workspace === data?.preferences.agent.workspace && permission === data?.preferences.agent.permission)} onClick={() => request({ action: 'settings', agent: { workspace, permission } }, 'Saving agent settings', data?.gateway.ready ? 'Agent settings saved — gateway restarted' : 'Agent settings saved')}>Save agent settings</button>
          </div></section>
        <section className="panel setting"><div className="setting-copy"><h3>Gateway port</h3><p>The local address Claude and Codex use. Disconnect Claude to change it.</p></div><div className="inline-form"><input className="port" aria-label="Gateway port" aria-invalid={!portValid} type="number" min="1024" max="65535" value={Number.isFinite(port) ? port : ''} disabled={claudeLocked || !!busy} onChange={e => setPort(e.target.valueAsNumber)} /><button className="secondary" disabled={claudeLocked || !!busy || !claudeValid || !portValid} onClick={() => request({ action: 'save', client: 'claude', selection: claudeSelection, port }, 'Saving settings', 'Port saved — applies on next launch')}>Save</button></div></section>
        <section className="panel setting"><div className="setting-copy"><h3>Background gateway</h3><p>{data?.gateway.ready ? `Running on port ${data.gateway.port} · ${data.gateway.routed} requests routed. Closing the window keeps apps connected.` : 'Starts automatically when you launch an app.'}</p></div><button className="secondary" disabled={!!busy || !data?.gateway.ready || claudeLocked || !!codex?.connected} onClick={() => request({ action: 'stop' }, 'Stopping gateway', 'Gateway stopped')}><Activity size={14} /> Stop</button></section>
        <section className="panel setting"><div className="setting-copy"><h3>App data & recovery</h3><p>Saved selections, recovery journals and gateway logs.</p></div><button className="secondary" onClick={() => request({ action: 'open-state' })}><FolderOpen size={14} /> Open folder</button></section>
        <section className="panel setting danger"><div className="setting-copy"><h3>Disconnect & Quit</h3><p>Restore Claude and Codex, stop the gateway, and exit Bridge. Closing the window only hides it.</p></div><button className="secondary danger" disabled={!!busy || !!data?.gateway.active} onClick={() => request({ action: 'disconnect-quit', client: 'claude', restart: true }, 'Disconnecting and quitting')}><LogOut size={14} /> Disconnect & Quit</button></section>
      </div>}
      <footer className="statusbar"><span>{busy ? <><LoaderCircle size={12} className="spin" /> {busy}</> : <><span className={`status-dot ${data?.gateway.ready ? 'on' : 'idle'}`} />{data?.gateway.ready ? `${data.gateway.routed} requests routed${data.gateway.active ? ` · ${data.gateway.active} active` : ''}` : 'Ready when you are'}</>}</span><span>{models.length} models · {providers.length} sources</span></footer>
    </main>
    <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.tone}`}><span className="toast-icon">{t.icon || (t.tone === 'success' ? <Check size={15} /> : t.tone === 'error' ? <CircleAlert size={15} /> : <Sparkles size={15} />)}</span><div><strong>{t.title}</strong>{t.body && <p>{t.body}</p>}</div><button aria-label="Dismiss" onClick={() => setToasts(list => list.filter(x => x.id !== t.id))}><X size={13} /></button></div>)}</div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
