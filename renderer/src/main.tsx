import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowUpRight, Asterisk, Check, ChevronDown, CircleHelp, Cpu, FolderOpen, Layers3, LoaderCircle, Monitor, Plug, RefreshCw, Search, Settings2, ShieldCheck, Undo2, X } from 'lucide-react';
import type { DesktopRequest, DesktopState, ModelItem, Selection } from '../../src/desktop/contracts';
import { CLAUDE_SLOTS } from '../../src/slots';
import type { Slot } from '../../src/types';
import './style.css';

function BridgeMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'bridge-mark small' : 'bridge-mark'} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M7 31V20C7 12.82 12.82 7 20 7s13 5.82 13 13v11M13 31V20a7 7 0 0 1 14 0v11M7 25h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
const prettyProvider = (p: string) => p === 'ollama-local' ? 'Ollama · local' : p === 'opencode' ? 'OpenCode Zen' : p === 'nvidia' ? 'NVIDIA' : p === 'openrouter' ? 'OpenRouter' : p.replaceAll('-', ' ');
const contextLabel = (n: number) => `${Math.round(n / 1024)}k context`;
const mappingRows = ['fable', 'opus', 'sonnet', 'haiku', 'sonnet46'] as const;
const auxiliarySlots = ['opus', 'haiku', 'fable', 'sonnet46'] as const;
const mappingRef = (selection: Selection, slot: Slot) => slot === 'sonnet' ? selection.model : selection[slot] || selection.model;
const normalizeSelection = (selection: Selection): Selection => ({ ...selection, opus: selection.opus || selection.model, haiku: selection.haiku || selection.model, fable: selection.fable || selection.model, sonnet46: selection.sonnet46 || selection.model, autoMode: selection.autoMode === true });

function App() {
  const [data, setData] = useState<DesktopState>();
  const [page, setPage] = useState<'launch' | 'apps' | 'settings'>('launch');
  const [selection, setSelection] = useState<Selection>({ model: '' });
  const [client, setClient] = useState('claude');
  const [port, setPort] = useState(41415);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [readyOnly, setReadyOnly] = useState(true);
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(80);
  const hydrated = useRef(false);
  const busyRef = useRef(false);

  async function request(value: DesktopRequest, label = '', success = '') {
    if (busyRef.current) return;
    busyRef.current = true;
    if (label) { setBusy(label); setError(''); setMessage(''); }
    try {
      const response = await window.desktop.request(value);
      if (!response.ok) { setError(response.error); return; }
      const next = response.state;
      setData(next);
      if (!hydrated.current) {
        const id = next.preferences.selectedClient;
        setClient(id);
        setPort(next.preferences.port);
        setSelection(normalizeSelection(next.preferences.selections[id] || { model: next.models.find(m => m.enabled)?.ref || '' }));
        hydrated.current = true;
      } else if (value.action === 'refresh') setSelection(s => s.model ? s : normalizeSelection({ model: next.models.find(m => m.enabled)?.ref || '' }));
      if (success) setMessage(success);
    } catch { setError('The desktop service could not be reached. Reopen the app and try again.'); }
    finally { busyRef.current = false; setBusy(''); }
  }
  useEffect(() => {
    void (async () => { await request({ action: 'state' }); await request({ action: 'refresh' }, 'Reading your connections'); })();
    const timer = setInterval(() => { void request({ action: 'state' }); }, 8000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setLimit(80); }, [query, provider, readyOnly]);

  const application = data?.clients.find(c => c.id === client);
  const status = application?.status;
  const locked = !!status?.connected || !!status?.recoveryNeeded;
  const models = data?.models || [];
  const enabled = models.filter(m => m.enabled);
  const picked = models.find(m => m.ref === selection.model);
  const valid = picked?.enabled && [selection.opus, selection.haiku, selection.fable, selection.sonnet46].filter(Boolean).every(ref => enabled.some(m => m.ref === ref));
  const mappingChanged = data?.savedRoutes.length !== 5 || data.savedRoutes.some(route => route.ref !== mappingRef(selection, route.slot)) || (data.preferences.selections.claude?.autoMode === true) !== (selection.autoMode === true);
  const shown = models.filter(m => (!readyOnly || m.enabled) && (provider === 'all' || m.provider === provider) && `${m.name} ${m.ref} ${m.provider}`.toLowerCase().includes(query.toLowerCase()));
  const providers = [...new Set(models.map(m => m.provider))];
  const changeSelection = (model: ModelItem) => { if (!locked && model.enabled) { setSelection(s => normalizeSelection({ ...s, model: model.ref, ...Object.fromEntries(auxiliarySlots.map(key => [key, !s[key] || s[key] === s.model ? model.ref : s[key]])) })); setError(''); setMessage(''); } };
  const selectApp = (id: string) => {
    setClient(id); setSelection(normalizeSelection(data?.preferences.selections[id] || selection)); setPage('launch'); setError('');
  };
  const modelOptions = (ref: string) => <>{ref && !models.some(model => model.ref === ref) && <option value={ref} disabled>{ref} · unavailable</option>}{models.filter(model => model.enabled || model.ref === ref || (model.provider === 'opencode' && model.free)).map(model => <option key={model.ref} value={model.ref} disabled={!model.enabled}>{model.name} · {prettyProvider(model.provider)}{!model.enabled ? ' · unavailable' : ''}</option>)}</>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="brand"><BridgeMark /><div><strong>Bridge</strong><span>by your connections</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        <button className={page === 'launch' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('launch')}><Layers3 size={18} /> Launchpad</button>
        <button className={page === 'apps' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('apps')}><Monitor size={18} /> Applications <span className="nav-count">1</span></button>
        <button className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')}><Settings2 size={18} /> Settings</button>
      </nav>
      <div className="sidebar-note"><Plug size={20} /><p>Bring your models.<br /><strong>Keep your workflow.</strong></p><span>OpenCode connections, a little closer to your desktop.</span></div>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className={`dot ${data?.gateway.ready ? 'online' : ''}`} /> {data?.gateway.ready ? 'Gateway running' : 'Gateway idle'}</div><span className="version">OpenCode Bridge · {data?.version || '0.1.0'}</span><button className="sidebar-quit" disabled={!!busy || !!data?.gateway.active} onClick={() => request({ action: 'disconnect-quit', client: 'claude', restart: true }, 'Disconnecting and quitting')}>Disconnect & Quit <ArrowDownLeft size={12} /></button></div>
    </aside>
    <main>
      <div className="title-drag" />
      <header className="page-header"><div><div className="eyebrow">YOUR DESKTOP, CONNECTED</div><h1>{page === 'launch' ? <>Pick a model.<br /><em>Open something good.</em></> : page === 'apps' ? <>A home for<br /><em>your applications.</em></> : <>A few things,<br /><em>just how you like them.</em></>}</h1></div><button className="refresh-button" aria-label="Refresh models and connections" onClick={() => request({ action: 'refresh' }, 'Refreshing connections')} disabled={!!busy}><RefreshCw size={16} className={busy.includes('Reading') || busy.includes('Refreshing') ? 'spin' : ''} /> Refresh connections</button></header>
      {(error || message) && <div className={`banner ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button aria-label="Dismiss message" onClick={() => { setError(''); setMessage(''); }}><X size={16} /></button></div>}
      {data?.notices.map(n => <div className="notice" key={n}><CircleHelp size={16} /><span>{n}</span></div>)}
      {page === 'launch' && <div className="launch-grid">
        <section className="model-panel" aria-label="Model picker">
          <div className="panel-heading"><div><h2>Your models <span className="count">{enabled.length}</span></h2><p>From your connections and installed local models.</p></div><span className="small-label">{models.length} discovered</span></div>
          <div className="filter-row"><div className="search"><Search size={17} /><input aria-label="Search models" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a model…" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><select aria-label="Filter by provider" value={provider} onChange={e => setProvider(e.target.value)}><option value="all">All connections</option>{providers.map(p => <option key={p} value={p}>{prettyProvider(p)}</option>)}</select></div>
          <div className="list-caption"><label><input type="checkbox" checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} /> Ready to connect</label><span>{shown.length} {shown.length === 1 ? 'model' : 'models'}</span></div>
          {locked && <div className="locked-note"><Settings2 size={14} /> <button className="text-button" onClick={() => setPage('apps')}>Change Claude’s models in Applications <ArrowUpRight size={13} /></button></div>}
          <div className="model-list" role="list" aria-label="Available models">
            {shown.slice(0, limit).map(model => <button role="listitem" key={model.ref} className={`model-row ${selection.model === model.ref ? 'selected' : ''} ${!model.enabled ? 'unavailable' : ''}`} disabled={!!busy || locked || !model.enabled} onClick={() => changeSelection(model)} aria-pressed={selection.model === model.ref} title={model.reason || model.ref}>
              <span className={`model-emblem ${model.source === 'ollama' ? 'local' : ''}`}>{model.source === 'ollama' ? <Cpu size={19} /> : model.provider === 'nvidia' ? 'N' : model.provider.slice(0, 1).toUpperCase()}</span>
              <span className="model-copy"><strong>{model.name}</strong><span>{prettyProvider(model.provider)} <span className="separator">·</span> {model.enabled ? contextLabel(model.context) : model.reason}</span></span>
              <span className="model-tags">{model.source === 'ollama' && <span className="tag local">Local</span>}{model.enabled && <span className="tag">Tools</span>}</span><span className={`radio ${selection.model === model.ref ? 'checked' : ''}`}>{selection.model === model.ref && <Check size={11} strokeWidth={3} />}</span>
            </button>)}
            {!shown.length && <div className="empty"><Search size={25} /><strong>{busy ? 'Reading your connections…' : 'No models here yet'}</strong><p>{query ? 'Try another name or connection.' : readyOnly ? 'Refresh connections, or browse all models to see what needs attention.' : 'Start OpenCode or your local Ollama service, then refresh.'}</p>{readyOnly && !busy && <button className="text-button" onClick={() => setReadyOnly(false)}>Browse all models <ArrowUpRight size={14} /></button>}</div>}
            {shown.length > limit && <button className="load-more" onClick={() => setLimit(n => n + 80)}>Show more models <ChevronDown size={15} /></button>}
          </div>
          <div className="panel-footer"><ShieldCheck size={14} /><span>Uses your existing connections. No keys to copy.</span></div>
        </section>
        <section className="launch-panel" aria-label="Launch application">
          <div className="launch-panel-top"><span className="eyebrow">OPEN WITH</span><button className="app-switch" onClick={() => setPage('apps')}>Change <ArrowUpRight size={13} /></button></div>
          <div className="application"><span className="claude-emblem"><Asterisk size={32} strokeWidth={1.7} /></span><div><h2>{application?.name || 'Claude Desktop'}</h2><p>{application?.description || 'Chat, Code & Cowork'}</p></div></div>
          <div className="app-status"><span><span className={`dot ${status?.installed ? 'online' : ''}`} /> {!status ? 'Checking app…' : status.installed ? status.running ? 'App running' : 'Ready to open' : 'App not installed'}</span><span className={status?.connected ? 'connected-label' : ''}>{status?.connected ? data?.gateway.routed ? 'Connected' : 'Profile applied' : status?.recoveryNeeded ? 'Restore needed' : 'Original connection'}</span></div>
          <div className="selected-model"><span className="small-label">PRIMARY MODEL</span><h3>{picked?.name || 'Choose a model'}</h3><p>{picked ? prettyProvider(picked.provider) : 'Select one from the list to get started.'}</p>{picked && <div className="selection-tags"><span><Cpu size={12} />{picked.source === 'ollama' ? 'Runs locally' : 'Provider connection'}</span><span>{contextLabel(picked.context)}</span></div>}</div>
          {!picked?.enabled && picked && <p className="capability-note">{picked.reason}</p>}
          <button className="advanced-toggle" onClick={() => setPage('apps')}><Settings2 size={14} /> Claude model mappings <ArrowUpRight size={14} /></button>
          <div className="launch-actions"><label className="restart-option"><input type="checkbox" checked={restart} onChange={e => setRestart(e.target.checked)} disabled={!!busy} /><span>Restart Claude if needed<small>Connection changes may interrupt active tasks.</small></span></label><button className="launch-button" disabled={!!busy || !valid || !status?.installed} onClick={() => locked && mappingChanged ? setPage('apps') : request({ action: 'launch', client, selection, port, restart }, 'Connecting your desktop', 'Claude opened. Its bridge profile has been applied.')}>
            {busy.includes('Connecting') ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}{busy.includes('Connecting') ? 'Connecting…' : locked && mappingChanged ? 'Configure Claude' : status?.connected ? 'Open Claude' : 'Launch Claude'}</button><button className="save-button" disabled={!!busy || !valid || locked} onClick={() => request({ action: 'save', client, selection, port }, 'Saving selection', 'Selection saved. Launch when you’re ready.')}><Check size={14} /> Save selection</button></div>
          <div className="restore-area"><button disabled={!!busy || !locked} onClick={() => request({ action: 'disconnect', client, restart }, 'Restoring your connection', 'Previous connection restored. Gateway stopped.')}><Undo2 size={14} /> Restore previous connection</button><p>Your previous setup is saved before connecting.</p></div>
        </section>
      </div>}
      {page === 'apps' && <section className="applications-page"><div className="section-title"><h2>Apps</h2><p>Your model choices, inside the applications you use.</p></div><article className="mapping-card" aria-label="Claude model configuration"><div className="mapping-header"><span className="claude-emblem"><Asterisk size={34} /></span><div><h2>Claude</h2><p>Choose which connected model Claude uses for each model option.</p></div><button className="outline-button" disabled={!!busy || !valid || !data?.clients.find(app => app.id === 'claude')?.status?.installed || !!data?.gateway.active} onClick={() => request({ action: 'apply', client: 'claude', selection, port, restart: true }, 'Applying Claude models', 'Models applied. Claude restarted. Your original connection remains saved.')}><RefreshCw size={15} className={busy.includes('Applying') ? 'spin' : ''} />{busy.includes('Applying') ? 'Applying…' : mappingChanged ? 'Apply & Restart Claude' : 'Restart Claude'}</button></div><div className="mapping-fields">{mappingRows.map(key => {
        const slot = CLAUDE_SLOTS.find(slot => slot.key === key)!;
        const ref = key === 'sonnet' ? selection.model : selection[key] || selection.model;
        const applied = data?.savedRoutes.find(route => route.slot === key)?.ref;
        return <div className="mapping-row" key={key}><label htmlFor={`model-${key}`}>{slot.label}</label><ArrowUpRight size={18} /><div><select id={`model-${key}`} aria-label={`${slot.label} model`} value={ref} disabled={!!busy} onChange={event => { setSelection(s => ({ ...s, [key === 'sonnet' ? 'model' : key]: event.target.value })); setMessage(''); }}>{modelOptions(ref)}</select><span className={applied === ref ? 'mapping-applied' : 'mapping-pending'}>{applied === ref ? 'Applied' : 'Applies after restart'}</span></div></div>;
      })}</div><div className="auto-mode-row"><div><label htmlFor="claude-auto-mode">Enable auto mode</label><p>Let Claude decide when to ask before making changes.</p><small>Availability depends on the selected model and Claude version.</small></div><input id="claude-auto-mode" type="checkbox" role="switch" checked={selection.autoMode === true} disabled={!!busy} onChange={event => { setSelection(s => ({ ...s, autoMode: event.target.checked })); setMessage(''); }} /></div><div className="mapping-footer"><span>{data?.gateway.active ? 'Wait for Claude’s active request to finish before restarting.' : 'Restarting Claude may interrupt tasks. Changes stay here until you apply them.'}</span><button className="text-button" disabled={!!busy || !data?.clients.find(app => app.id === 'claude')?.status?.connected && !data?.clients.find(app => app.id === 'claude')?.status?.recoveryNeeded} onClick={() => request({ action: 'disconnect', client: 'claude', restart: true }, 'Restoring Claude', 'Previous connection restored. Gateway stopped.')}><Undo2 size={14} /> Disconnect Claude</button></div></article>{models.some(model => model.provider === 'opencode' && model.free && !model.enabled) && <div className="notice zen-note"><CircleHelp size={16} /><span>Zen free models are listed but unavailable: OpenCode rejected the tested free routes with HTTP 403. They cannot be applied to Claude yet.</span></div>}<div className="application-cards">{data?.clients.filter(app => app.id !== 'claude').map(app => <article className={`client-card ${app.availability === 'planned' ? 'planned' : ''}`} key={app.id}><div className="client-card-heading"><span className="future-emblem"><Monitor size={28} /></span><span className="tag">{app.availability === 'planned' ? 'Planned' : 'Available'}</span></div><h2>{app.name}</h2><p>{app.description}</p><div className="client-card-detail">{app.reason}</div><button className="client-select" disabled={app.availability !== 'available'} onClick={() => selectApp(app.id)}>{app.availability === 'available' ? <>Use {app.name}<ArrowUpRight size={16} /></> : 'Coming later'}</button></article>)}</div></section>}
      {page === 'settings' && <section className="settings-page"><div className="section-title"><h2>Connection settings</h2><p>A small set of controls for your local bridge.</p></div><div className="settings-card"><div><h3>Gateway port</h3><p>The local address used by your desktop application.</p></div><input aria-label="Gateway port" type="number" min="1024" max="65535" value={port} disabled={locked || !!busy} onChange={e => setPort(Number(e.target.value))} /><button className="save-button" disabled={locked || !!busy || !valid} onClick={() => request({ action: 'save', client, selection, port }, 'Saving settings', 'Settings saved. They apply on your next launch.')}>Save settings</button></div><div className="settings-card"><div><h3>App data & recovery</h3><p>Saved selections, connection recovery, and gateway metadata logs.</p></div><button className="outline-button" onClick={() => request({ action: 'open-state' })}><FolderOpen size={15} /> Open folder</button></div><div className="settings-card"><div><h3>Background gateway</h3><p>{data?.gateway.ready ? 'Running. Closing the window hides Bridge in the menu bar and keeps Claude connected.' : 'Starts automatically when you launch an application.'}</p></div><button className="outline-button" disabled={!!busy || !data?.gateway.ready || locked} onClick={() => request({ action: 'stop' }, 'Stopping gateway', 'Background gateway stopped.')}><Activity size={15} /> Stop gateway</button></div><div className="settings-card"><div><h3>Disconnect & Quit</h3><p>Restore the previous Claude connection, restart Claude, stop the gateway, and exit Bridge.</p></div><button className="outline-button" disabled={!!busy || !!data?.gateway.active} onClick={() => request({ action: 'disconnect-quit', client: 'claude', restart: true }, 'Disconnecting and quitting')}><Undo2 size={15} /> Disconnect & Quit</button></div><div className="settings-footnote"><ShieldCheck size={19} /><p>The red close button hides the window; it does not disconnect Claude. Quit from the app menu to choose Disconnect & Quit or Keep Connected & Quit.</p></div></section>}
      <footer className="main-footer"><span><BridgeMark small /> A bridge from your models to your desktop.</span><span>{busy ? <><LoaderCircle size={12} className="spin" />{busy}</> : <><span className={`dot ${data?.gateway.ready ? 'online' : ''}`} />{data?.gateway.ready ? `${data.gateway.routed} requests routed` : 'Ready when you are'}<ArrowDownLeft size={13} /></>}</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
