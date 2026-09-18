import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowUpRight, Asterisk, Check, ChevronDown, CircleHelp, Cpu, FolderOpen, Layers3, LoaderCircle, Monitor, Plug, RefreshCw, Search, Settings2, ShieldCheck, Undo2, X } from 'lucide-react';
import type { DesktopRequest, DesktopState, ModelItem, Selection } from '../../src/desktop/contracts';
import './style.css';

function BridgeMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'bridge-mark small' : 'bridge-mark'} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M7 31V20C7 12.82 12.82 7 20 7s13 5.82 13 13v11M13 31V20a7 7 0 0 1 14 0v11M7 25h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
const prettyProvider = (p: string) => p === 'ollama-local' ? 'Ollama · local' : p === 'opencode' ? 'OpenCode Zen' : p === 'nvidia' ? 'NVIDIA' : p === 'openrouter' ? 'OpenRouter' : p.replaceAll('-', ' ');
const contextLabel = (n: number) => `${Math.round(n / 1024)}k context`;

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
  const [advanced, setAdvanced] = useState(false);
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
        setSelection(next.preferences.selections[id] || { model: next.models.find(m => m.enabled)?.ref || '' });
        hydrated.current = true;
      } else if (value.action === 'refresh') setSelection(s => s.model ? s : { model: next.models.find(m => m.enabled)?.ref || '' });
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
  const valid = picked?.enabled && [selection.opus, selection.haiku].filter(Boolean).every(ref => enabled.some(m => m.ref === ref));
  const shown = models.filter(m => (!readyOnly || m.enabled) && (provider === 'all' || m.provider === provider) && `${m.name} ${m.ref} ${m.provider}`.toLowerCase().includes(query.toLowerCase()));
  const providers = [...new Set(models.map(m => m.provider))];
  const changeSelection = (model: ModelItem) => { if (!locked && model.enabled) { setSelection(s => ({ ...s, model: model.ref })); setError(''); setMessage(''); } };
  const selectApp = (id: string) => {
    setClient(id); setSelection(data?.preferences.selections[id] || selection); setPage('launch'); setError('');
  };
  const auxOptions = <><option value="">Same as primary model</option>{enabled.map(m => <option key={m.ref} value={m.ref}>{m.name} · {prettyProvider(m.provider)}</option>)}</>;

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
      <div className="sidebar-bottom"><div className="sidebar-status"><span className={`dot ${data?.gateway.ready ? 'online' : ''}`} /> {data?.gateway.ready ? 'Gateway running' : 'Gateway idle'}</div><span className="version">OpenCode Bridge · {data?.version || '0.1.0'}</span></div>
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
          {locked && <div className="locked-note"><ShieldCheck size={14} /> Restore the connection to change models.</div>}
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
          <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}><Settings2 size={14} /> Model overrides <ChevronDown size={14} className={advanced ? 'rotate' : ''} /></button>
          {advanced && <div className="advanced-fields"><label>Opus tasks<select aria-label="Opus model override" disabled={locked || !!busy} value={selection.opus || ''} onChange={e => setSelection(s => ({ ...s, opus: e.target.value || undefined }))}>{auxOptions}</select></label><label>Haiku tasks<select aria-label="Haiku model override" disabled={locked || !!busy} value={selection.haiku || ''} onChange={e => setSelection(s => ({ ...s, haiku: e.target.value || undefined }))}>{auxOptions}</select></label><p>All tiers use your primary model unless changed here.</p></div>}
          <div className="launch-actions"><label className="restart-option"><input type="checkbox" checked={restart} onChange={e => setRestart(e.target.checked)} disabled={!!busy} /><span>Restart Claude if needed<small>Connection changes may interrupt active tasks.</small></span></label><button className="launch-button" disabled={!!busy || !valid || !status?.installed || !!status?.recoveryNeeded} onClick={() => request({ action: 'launch', client, selection, port, restart }, 'Connecting your desktop', 'Claude opened. Its bridge profile has been applied.')}>
            {busy.includes('Connecting') ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}{busy.includes('Connecting') ? 'Connecting…' : status?.connected ? 'Open Claude' : 'Launch Claude'}</button><button className="save-button" disabled={!!busy || !valid || locked} onClick={() => request({ action: 'save', client, selection, port }, 'Saving selection', 'Selection saved. Launch when you’re ready.')}><Check size={14} /> Save selection</button></div>
          <div className="restore-area"><button disabled={!!busy || !locked} onClick={() => request({ action: 'disconnect', client, restart }, 'Restoring your connection', 'Previous connection restored. Gateway stopped.')}><Undo2 size={14} /> Restore previous connection</button><p>Your previous setup is saved before connecting.</p></div>
        </section>
      </div>}
      {page === 'apps' && <section className="applications-page"><div className="section-title"><h2>Applications</h2><p>Choose where you want to use your models.</p></div><div className="application-cards">{data?.clients.map(app => <article className={`client-card ${app.availability === 'planned' ? 'planned' : ''}`} key={app.id}><div className="client-card-heading"><span className={app.id === 'claude' ? 'claude-emblem' : 'future-emblem'}>{app.id === 'claude' ? <Asterisk size={34} /> : <Monitor size={28} />}</span><span className={`tag ${app.availability === 'planned' ? '' : 'local'}`}>{app.availability === 'planned' ? 'Planned' : 'Available'}</span></div><h2>{app.name}</h2><p>{app.description}</p><div className="client-card-detail">{app.reason || 'Connect your chosen model and launch Chat, Code, or Cowork from one place.'}</div><button className="client-select" disabled={app.availability !== 'available'} onClick={() => selectApp(app.id)}>{app.availability === 'available' ? <>Use {app.name}<ArrowUpRight size={16} /></> : 'Coming later'}</button></article>)}</div><div className="future-note"><Layers3 size={20} /><div><strong>Built to make room.</strong><p>New desktop integrations can share the same model library and connection controls.</p></div></div></section>}
      {page === 'settings' && <section className="settings-page"><div className="section-title"><h2>Connection settings</h2><p>A small set of controls for your local bridge.</p></div><div className="settings-card"><div><h3>Gateway port</h3><p>The local address used by your desktop application.</p></div><input aria-label="Gateway port" type="number" min="1024" max="65535" value={port} disabled={locked || !!busy} onChange={e => setPort(Number(e.target.value))} /><button className="save-button" disabled={locked || !!busy || !valid} onClick={() => request({ action: 'save', client, selection, port }, 'Saving settings', 'Settings saved. They apply on your next launch.')}>Save settings</button></div><div className="settings-card"><div><h3>App data & recovery</h3><p>Saved selections, connection recovery, and gateway metadata logs.</p></div><button className="outline-button" onClick={() => request({ action: 'open-state' })}><FolderOpen size={15} /> Open folder</button></div><div className="settings-card"><div><h3>Background gateway</h3><p>{data?.gateway.ready ? 'Running. Closing this app keeps your connection available.' : 'Starts automatically when you launch an application.'}</p></div><button className="outline-button" disabled={!!busy || !data?.gateway.ready || locked} onClick={() => request({ action: 'stop' }, 'Stopping gateway', 'Background gateway stopped.')}><Activity size={15} /> Stop gateway</button></div><div className="settings-footnote"><ShieldCheck size={19} /><p>Restore an active Desktop connection before changing models, ports, or stopping the gateway. Closing the window keeps Bridge in the menu bar.</p></div></section>}
      <footer className="main-footer"><span><BridgeMark small /> A bridge from your models to your desktop.</span><span>{busy ? <><LoaderCircle size={12} className="spin" />{busy}</> : <><span className={`dot ${data?.gateway.ready ? 'online' : ''}`} />{data?.gateway.ready ? `${data.gateway.routed} requests routed` : 'Ready when you are'}<ArrowDownLeft size={13} /></>}</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
