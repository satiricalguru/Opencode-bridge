/// <reference path="./global.d.ts" />
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowUpRight, Asterisk, Bot, Check, ChevronDown, CircleHelp, Cpu, FolderOpen, Gauge, Layers3, LoaderCircle, Monitor, Plug, RefreshCw, Search, Settings2, ShieldCheck, SquareTerminal, Undo2, X } from 'lucide-react';
import type { DesktopRequest, DesktopState, ModelItem, Selection } from '../../src/desktop/contracts';
import { CLAUDE_SLOTS } from '../../src/slots';
import type { AgentPermission, Effort, Slot } from '../../src/types';
import './style.css';

type ClientId = 'claude' | 'codex';
function BridgeMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'bridge-mark small' : 'bridge-mark'} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M7 31V20C7 12.82 12.82 7 20 7s13 5.82 13 13v11M13 31V20a7 7 0 0 1 14 0v11M7 25h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
const prettyProvider = (p: string) => p === 'ollama-local' ? 'Ollama · local' : p === 'opencode' ? 'OpenCode Zen' : p === 'nvidia' ? 'NVIDIA' : p === 'openrouter' ? 'OpenRouter' : p === 'github-copilot' ? 'GitHub Copilot' : p.replaceAll('-', ' ');
const contextLabel = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M context` : `${Math.round(n / 1024)}k context`;
const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const PERMISSIONS: Array<{ value: AgentPermission; label: string; detail: string }> = [
  { value: 'read-only', label: 'Read only', detail: 'OpenCode may read, search and browse. Edits and commands are declined.' },
  { value: 'workspace-write', label: 'Edit & run commands', detail: 'Also allows file edits and shell commands inside the working directory.' },
  { value: 'full', label: 'Full access', detail: 'Also allows reaching outside the working directory. Use with care.' },
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

function ModelTags({ model }: { model: ModelItem }) {
  return <span className="model-tags">
    {model.source === 'ollama' && <span className="tag local">Local</span>}
    {model.free && model.source !== 'ollama' && <span className="tag free">Free</span>}
    {model.enabled && model.via === 'agent' && <span className="tag agent" title="Runs inside OpenCode’s own agent and tools">OpenCode agent</span>}
    {model.enabled && model.via === 'direct' && <span className="tag">Tools</span>}
  </span>;
}
function EffortSelect({ id, model, value, onChange, disabled }: { id: string; model?: ModelItem; value?: Effort; onChange: (effort: Effort | '') => void; disabled?: boolean }) {
  const levels = model?.efforts || [];
  return <select id={id} className="effort-select" aria-label="Effort level" value={value && levels.includes(value) ? value : ''} disabled={disabled || !levels.length} onChange={event => onChange(event.target.value as Effort | '')} title={levels.length ? 'Pin an effort level, or let the app choose' : 'This model does not advertise effort levels'}>
    <option value="">{levels.length ? 'Effort: app decides' : 'Effort: not adjustable'}</option>
    {levels.map(level => <option key={level} value={level}>Effort: {EFFORT_LABEL[level]}</option>)}
  </select>;
}

function App() {
  const [data, setData] = useState<DesktopState>();
  const [page, setPage] = useState<'launch' | 'apps' | 'settings'>('launch');
  const [selections, setSelections] = useState<Record<ClientId, Selection>>({ claude: { model: '' }, codex: { model: '' } });
  const [client, setClient] = useState<ClientId>('claude');
  const [port, setPort] = useState(41415);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [readyOnly, setReadyOnly] = useState(true);
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(80);
  const [workspace, setWorkspace] = useState('');
  const [permission, setPermission] = useState<AgentPermission>('read-only');
  const hydrated = useRef(false);
  const busyRef = useRef(false);
  const selection = selections[client];
  const setSelection = (update: (s: Selection) => Selection, id: ClientId = client) => setSelections(all => ({ ...all, [id]: update(all[id]) }));

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
        const id = next.preferences.selectedClient === 'codex' ? 'codex' : 'claude';
        setClient(id);
        setPort(next.preferences.port);
        setSelections({ claude: normalizeSelection(next.preferences.selections.claude || { model: firstEnabled(next.models) }), codex: next.preferences.selections.codex || { model: next.preferences.selections.claude?.model || firstEnabled(next.models) } });
        setWorkspace(next.preferences.agent.workspace); setPermission(next.preferences.agent.permission);
        hydrated.current = true;
      } else if (value.action === 'refresh') setSelections(all => ({ claude: all.claude.model ? all.claude : normalizeSelection({ model: firstEnabled(next.models) }), codex: all.codex.model ? all.codex : { model: firstEnabled(next.models) } }));
      if (success) setMessage(success);
    } catch { setError('The desktop service could not be reached. Reopen the app and try again.'); }
    finally { busyRef.current = false; setBusy(''); }
  }
  useEffect(() => {
    void (async () => { await request({ action: 'state' }); await request({ action: 'refresh' }, 'Reading your connections'); })();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void request({ action: 'state' }); }, 8000);
    const onFocus = () => { void request({ action: 'state' }); };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void request({ action: 'state' }); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, []);
  useEffect(() => { setLimit(80); }, [query, provider, readyOnly]);
  // Success notes belong to the page that produced them; errors stay until dismissed.
  useEffect(() => { setMessage(''); }, [page]);

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
  const savedClaudeEffort = (slot: Slot) => data?.savedRoutes.find(r => r.slot === slot)?.effort;
  const mappingChanged = data?.savedRoutes.length !== 5 || data.savedRoutes.some(route => route.ref !== mappingRef(claudeSelection, route.slot) || route.effort !== claudeSelection.effort?.[route.slot]) || (data.preferences.selections.claude?.autoMode === true) !== (claudeSelection.autoMode === true);
  const codexRoute = data?.codexRoutes[0];
  const codexChanged = !codexRoute || codexRoute.ref !== selections.codex.model || codexRoute.effort !== selections.codex.effort?.sonnet;
  const shown = models.filter(m => (!readyOnly || m.enabled) && (provider === 'all' || m.provider === provider) && `${m.name} ${m.ref} ${m.provider}`.toLowerCase().includes(query.toLowerCase()));
  const providers = [...new Set(models.map(m => m.provider))].sort((a, b) => prettyProvider(a).localeCompare(prettyProvider(b)));
  const agentCount = enabled.filter(m => m.via === 'agent').length;
  const freeCount = enabled.filter(m => m.free).length;
  const changeSelection = (model: ModelItem) => {
    if (locked || !model.enabled) return;
    if (client === 'codex') setSelection(s => ({ ...s, model: model.ref, effort: undefined }));
    else setSelection(s => normalizeSelection({ ...s, model: model.ref, effort: s.effort?.sonnet && model.efforts.includes(s.effort.sonnet) ? s.effort : withEffort(s, 'sonnet', '').effort, ...Object.fromEntries(auxiliarySlots.map(key => [key, !s[key] || s[key] === s.model ? model.ref : s[key]])) }));
    setError(''); setMessage('');
  };
  const modelOptions = (ref: string) => <>{ref && !find(ref) && <option value={ref} disabled>{ref} · unavailable</option>}{models.filter(model => model.enabled || model.ref === ref).map(model => <option key={model.ref} value={model.ref} disabled={!model.enabled}>{model.name} · {prettyProvider(model.provider)}{model.via === 'agent' ? ' · OpenCode agent' : ''}{!model.enabled ? ' · unavailable' : ''}</option>)}</>;
  const launchCodex = (target: 'cli' | 'app') => request({ action: 'launch', client: 'codex', selection: selections.codex, port, restart: target === 'app' ? restart || true : false, target }, target === 'app' ? 'Connecting the Codex app' : 'Opening Codex in Terminal', target === 'app' ? 'Codex app restarted with your model. Disconnect Codex to restore its previous model.' : 'Codex opened in Terminal with the opencode-bridge profile.');
  const appName = client === 'codex' ? 'Codex' : 'Claude';
  const portValid = Number.isInteger(port) && port >= 1024 && port <= 65535;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="brand"><BridgeMark /><div><strong>Bridge</strong><span>by your connections</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        <button className={page === 'launch' ? 'nav-item active' : 'nav-item'} aria-current={page === 'launch' ? 'page' : undefined} onClick={() => setPage('launch')}><Layers3 size={18} /> Launchpad</button>
        <button className={page === 'apps' ? 'nav-item active' : 'nav-item'} aria-current={page === 'apps' ? 'page' : undefined} onClick={() => setPage('apps')}><Monitor size={18} /> Applications <span className="nav-count">{data?.clients.length || 2}</span></button>
        <button className={page === 'settings' ? 'nav-item active' : 'nav-item'} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}><Settings2 size={18} /> Settings</button>
      </nav>
      <div className="sidebar-note"><Plug size={20} /><p>Bring your models.<br /><strong>Keep your workflow.</strong></p><span>OpenCode, Ollama and free models inside Claude and Codex.</span></div>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className={`dot ${data?.gateway.ready ? 'online' : ''}`} /> {data?.gateway.ready ? `Gateway on :${data.gateway.port}` : 'Gateway idle'}</div><span className="version">OpenCode Bridge · {data?.version || '0.2.0'}</span><button className="sidebar-quit" disabled={!!busy || !!data?.gateway.active} onClick={() => request({ action: 'disconnect-quit', client: 'claude', restart: true }, 'Disconnecting and quitting')}>Disconnect & Quit <ArrowDownLeft size={12} /></button></div>
    </aside>
    <main>
      <div className="title-drag" />
      <header className="page-header"><div><div className="eyebrow">YOUR DESKTOP, CONNECTED</div><h1>{page === 'launch' ? <>Pick a model.<br /><em>Open something good.</em></> : page === 'apps' ? <>A home for<br /><em>your applications.</em></> : <>A few things,<br /><em>just how you like them.</em></>}</h1></div><button className="refresh-button" aria-label="Refresh models and connections" onClick={() => request({ action: 'refresh' }, 'Refreshing connections')} disabled={!!busy}><RefreshCw size={16} className={busy.includes('Reading') || busy.includes('Refreshing') ? 'spin' : ''} /> Refresh connections</button></header>
      {(error || message) && <div className={`banner ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button aria-label="Dismiss message" onClick={() => { setError(''); setMessage(''); }}><X size={16} /></button></div>}
      {data?.notices.map(n => <div className="notice" key={n}><CircleHelp size={16} /><span>{n}</span></div>)}
      {page === 'launch' && <div className="launch-grid">
        <section className="model-panel" aria-label="Model picker">
          <div className="panel-heading"><div><h2>Your models <span className="count">{enabled.length}</span></h2><p>{freeCount ? `${freeCount} free · ` : ''}{agentCount ? `${agentCount} run through the OpenCode agent · ` : ''}from your connections and local models.</p></div><span className="small-label">{models.length} discovered</span></div>
          <div className="filter-row"><div className="search"><Search size={17} /><input aria-label="Search models" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a model…" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><select aria-label="Filter by provider" value={provider} onChange={e => setProvider(e.target.value)}><option value="all">All connections</option>{providers.map(p => <option key={p} value={p}>{prettyProvider(p)}</option>)}</select></div>
          <div className="list-caption"><label><input type="checkbox" checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} /> Ready to connect</label><span>{shown.length} {shown.length === 1 ? 'model' : 'models'}</span></div>
          {locked && <div className="locked-note"><Settings2 size={14} /> <button className="text-button" onClick={() => setPage('apps')}>Claude is connected. Change its models in Applications <ArrowUpRight size={13} /></button></div>}
          <div className="model-list" role="radiogroup" aria-label={`Primary model for ${appName}`}>
            {shown.slice(0, limit).map(model => <button role="radio" key={model.ref} className={`model-row ${selection.model === model.ref ? 'selected' : ''} ${!model.enabled ? 'unavailable' : ''}`} disabled={!!busy || locked || !model.enabled} onClick={() => changeSelection(model)} aria-checked={selection.model === model.ref} title={model.reason || model.ref}>
              <span className={`model-emblem ${model.source === 'ollama' ? 'local' : ''}`} aria-hidden="true">{model.source === 'ollama' ? <Cpu size={19} /> : model.via === 'agent' ? <Bot size={17} /> : model.provider.slice(0, 1).toUpperCase()}</span>
              <span className="model-copy"><strong>{model.name}</strong><span>{prettyProvider(model.provider)} <span className="separator">·</span> {model.enabled ? `${contextLabel(model.context)}${model.efforts.length ? ` · effort ${model.efforts.map(e => EFFORT_LABEL[e]).join('/')}` : ''}` : model.reason}</span></span>
              <ModelTags model={model} /><span className={`radio ${selection.model === model.ref ? 'checked' : ''}`} aria-hidden="true">{selection.model === model.ref && <Check size={11} strokeWidth={3} />}</span>
            </button>)}
            {!shown.length && <div className="empty"><Search size={25} /><strong>{busy ? 'Reading your connections…' : 'No models here yet'}</strong><p>{query ? 'Try another name or connection.' : readyOnly ? 'Refresh connections, or browse all models to see what needs attention.' : 'Start OpenCode or your local Ollama service, then refresh.'}</p>{readyOnly && !busy && <button className="text-button" onClick={() => setReadyOnly(false)}>Browse all models <ArrowUpRight size={14} /></button>}</div>}
            {shown.length > limit && <button className="load-more" onClick={() => setLimit(n => n + 80)}>Show more models <ChevronDown size={15} /></button>}
          </div>
          <div className="panel-footer"><ShieldCheck size={14} /><span>Uses your existing OpenCode connections. No keys to copy.</span></div>
        </section>
        <section className="launch-panel" aria-label="Launch application">
          <div className="launch-panel-top"><span className="eyebrow">OPEN WITH</span>
            <div className="segmented" role="tablist" aria-label="Application">{(['claude', 'codex'] as const).map(id => <button key={id} role="tab" aria-selected={client === id} className={client === id ? 'active' : ''} disabled={!!busy} onClick={() => { setClient(id); setError(''); setMessage(''); }}>{id === 'claude' ? 'Claude' : 'Codex'}</button>)}</div>
          </div>
          <div className="application"><span className={client === 'codex' ? 'codex-emblem' : 'claude-emblem'}>{client === 'codex' ? <SquareTerminal size={28} strokeWidth={1.7} /> : <Asterisk size={32} strokeWidth={1.7} />}</span><div><h2>{application?.name || 'Claude Desktop'}</h2><p>{application?.description || 'Chat, Code & Cowork'}</p></div></div>
          <div className="app-status"><span><span className={`dot ${status?.installed ? 'online' : ''}`} /> {!status ? 'Checking app…' : !status.installed ? 'Not installed' : client === 'codex' ? [status.targets?.cli && 'CLI', status.targets?.app && 'App'].filter(Boolean).join(' & ') + ' found' : status.running ? 'App running' : 'Ready to open'}</span><span className={status?.connected ? 'connected-label' : ''}>{status?.recoveryNeeded ? 'Restore needed' : status?.connected ? client === 'codex' ? status.appConnected ? 'App connected' : 'Profile ready' : data?.gateway.routed ? 'Connected' : 'Profile applied' : 'Original connection'}</span></div>
          <div className="selected-model"><span className="small-label">{client === 'codex' ? 'CODEX MODEL' : 'PRIMARY MODEL · SONNET'}</span><h3>{picked?.name || 'Choose a model'}</h3><p>{picked ? `${prettyProvider(picked.provider)}${picked.via === 'agent' ? ' · via OpenCode agent' : ''}` : 'Select one from the list to get started.'}</p>{picked && <div className="selection-tags"><span><Cpu size={12} />{picked.source === 'ollama' ? 'Runs locally' : picked.via === 'agent' ? 'OpenCode runs tools' : `${appName} runs tools`}</span><span>{contextLabel(picked.context)}</span></div>}
            {picked?.enabled && <div className="effort-row"><Gauge size={14} /><EffortSelect id="primary-effort" model={picked} value={selection.effort?.sonnet} disabled={!!busy || locked} onChange={effort => setSelection(s => withEffort(s, 'sonnet', effort))} /></div>}
          </div>
          {!picked?.enabled && picked && <p className="capability-note">{picked.reason}</p>}
          {picked?.via === 'agent' && <p className="capability-note agent-note">OpenCode’s agent answers using its own tools ({data?.preferences.agent.permission === 'read-only' ? 'read-only' : data?.preferences.agent.permission === 'full' ? 'full access' : 'edits allowed'}). {appName}’s own tool calls are not used with this model.</p>}
          {client === 'claude' && <button className="advanced-toggle" onClick={() => setPage('apps')}><Settings2 size={14} /> Claude model mappings & effort <ArrowUpRight size={14} /></button>}
          <div className="launch-actions">
            <label className="restart-option"><input type="checkbox" checked={restart} onChange={e => setRestart(e.target.checked)} disabled={!!busy} /><span>Restart {appName} if needed<small>Connection changes may interrupt active tasks.</small></span></label>
            {client === 'claude' ? <>
              <button className="launch-button" disabled={!!busy || !valid || !status?.installed || !portValid} onClick={() => locked && mappingChanged ? setPage('apps') : request({ action: 'launch', client, selection, port, restart }, 'Connecting your desktop', 'Claude opened. Its bridge profile has been applied.')}>
                {busy.includes('Connecting') ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}{busy.includes('Connecting') ? 'Connecting…' : locked && mappingChanged ? 'Configure Claude' : status?.connected ? 'Open Claude' : 'Launch Claude'}</button>
              <button className="save-button" disabled={!!busy || !valid || locked || !portValid} onClick={() => request({ action: 'save', client, selection, port }, 'Saving selection', 'Selection saved. Launch when you’re ready.')}><Check size={14} /> Save selection</button>
            </> : <>
              <button className="launch-button" disabled={!!busy || !valid || !status?.targets?.cli || !portValid} onClick={() => launchCodex('cli')}>{busy.includes('Terminal') ? <LoaderCircle className="spin" size={18} /> : <SquareTerminal size={18} />}{busy.includes('Terminal') ? 'Opening…' : 'Launch Codex CLI'}</button>
              <button className="save-button" disabled={!!busy || !valid || !status?.targets?.app || !portValid} onClick={() => launchCodex('app')}>{busy.includes('Codex app') ? <LoaderCircle className="spin" size={14} /> : <ArrowUpRight size={14} />} {status?.appConnected && !codexChanged ? 'Open Codex app' : 'Use in Codex app (restarts it)'}</button>
            </>}
          </div>
          <div className="restore-area"><button disabled={!!busy || !(status?.connected || status?.recoveryNeeded)} onClick={() => request({ action: 'disconnect', client, restart }, `Restoring ${appName}`, `${appName} restored to its previous connection.`)}><Undo2 size={14} /> {client === 'codex' ? 'Disconnect Codex' : 'Restore previous connection'}</button><p>Your previous setup is saved before connecting.</p></div>
        </section>
      </div>}
      {page === 'apps' && <section className="applications-page"><div className="section-title"><h2>Apps</h2><p>Your model choices and effort levels, inside the applications you use.</p></div>
        <article className="mapping-card" aria-label="Claude model configuration"><div className="mapping-header"><span className="claude-emblem"><Asterisk size={34} /></span><div><h2>Claude</h2><p>Claude shows its familiar model names. Choose which model actually answers each one, and optionally pin its effort.</p></div><button className="outline-button" disabled={!!busy || !claudeValid || !claude?.installed || !!data?.gateway.active || !portValid} onClick={() => request({ action: 'apply', client: 'claude', selection: claudeSelection, port, restart: true }, 'Applying Claude models', 'Models applied. Claude restarted. Your original connection remains saved.')}><RefreshCw size={15} className={busy.includes('Applying Claude') ? 'spin' : ''} />{busy.includes('Applying Claude') ? 'Applying…' : mappingChanged ? 'Apply & Restart Claude' : 'Restart Claude'}</button></div>
          <div className="mapping-fields">{mappingRows.map(key => {
            const slot = CLAUDE_SLOTS.find(slot => slot.key === key)!;
            const ref = mappingRef(claudeSelection, key);
            const applied = data?.savedRoutes.find(route => route.slot === key);
            const same = applied?.ref === ref && applied?.effort === claudeSelection.effort?.[key];
            return <div className="mapping-row" key={key}><label htmlFor={`model-${key}`}>{slot.label}</label><ArrowUpRight size={18} aria-hidden="true" /><div><div className="mapping-controls"><select id={`model-${key}`} aria-label={`${slot.label} model`} value={ref} disabled={!!busy} onChange={event => { const value = event.target.value; setSelection(s => { const next = { ...s, [key === 'sonnet' ? 'model' : key]: value }; return find(value)?.efforts.includes(s.effort?.[key] as Effort) ? next : withEffort(next, key, ''); }, 'claude'); setMessage(''); }}>{modelOptions(ref)}</select><EffortSelect id={`effort-${key}`} model={find(ref)} value={claudeSelection.effort?.[key]} disabled={!!busy} onChange={effort => { setSelection(s => withEffort(s, key, effort), 'claude'); setMessage(''); }} /></div><span className={same ? 'mapping-applied' : 'mapping-pending'}>{same ? 'Applied' : 'Applies after restart'}{find(ref)?.via === 'agent' ? ' · runs in the OpenCode agent' : ''}</span></div></div>;
          })}</div>
          <div className="auto-mode-row"><div><label htmlFor="claude-auto-mode">Enable auto mode</label><p>Let Claude decide when to ask before making changes.</p><small>Availability depends on the selected model and Claude version.</small></div><input id="claude-auto-mode" type="checkbox" role="switch" aria-checked={claudeSelection.autoMode === true} checked={claudeSelection.autoMode === true} disabled={!!busy} onChange={event => { setSelection(s => ({ ...s, autoMode: event.target.checked }), 'claude'); setMessage(''); }} /></div>
          <div className="mapping-footer"><span>{data?.gateway.active ? 'Wait for the active request to finish before restarting.' : 'Restarting Claude may interrupt tasks. Changes stay here until you apply them.'}</span><button className="text-button" disabled={!!busy || !claudeLocked} onClick={() => request({ action: 'disconnect', client: 'claude', restart: true }, 'Restoring Claude', 'Previous Claude connection restored.')}><Undo2 size={14} /> Disconnect Claude</button></div>
        </article>
        <article className="mapping-card" aria-label="Codex model configuration"><div className="mapping-header"><span className="codex-emblem"><SquareTerminal size={30} /></span><div><h2>Codex</h2><p>Like <code>ollama launch codex</code>: a dedicated <code>opencode-bridge</code> profile for the CLI, or a reversible model selection for the Codex app.</p></div><button className="outline-button" disabled={!!busy || !codexValid || !codex?.installed || !portValid} onClick={() => launchCodex('cli')}><SquareTerminal size={15} /> Launch Codex CLI</button></div>
          <div className="mapping-fields"><div className="mapping-row"><label htmlFor="codex-model">Model</label><ArrowUpRight size={18} aria-hidden="true" /><div><div className="mapping-controls"><select id="codex-model" aria-label="Codex model" value={selections.codex.model} disabled={!!busy} onChange={event => { const value = event.target.value; setSelection(s => ({ ...s, model: value, effort: find(value)?.efforts.includes(s.effort?.sonnet as Effort) ? s.effort : undefined }), 'codex'); setMessage(''); }}>{modelOptions(selections.codex.model)}</select><EffortSelect id="codex-effort" model={find(selections.codex.model)} value={selections.codex.effort?.sonnet} disabled={!!busy} onChange={effort => { setSelection(s => withEffort(s, 'sonnet', effort), 'codex'); setMessage(''); }} /></div><span className={codexChanged ? 'mapping-pending' : 'mapping-applied'}>{codexChanged ? 'Applies on next launch' : `Applied${codex?.appConnected ? ' · Codex app connected' : ' · CLI profile ready'}`}{find(selections.codex.model)?.via === 'agent' ? ' · runs in the OpenCode agent' : ''}</span></div></div></div>
          <div className="codex-targets"><span><SquareTerminal size={14} /> CLI {codex?.targets?.cli ? <strong>found</strong> : 'not found — npm install -g @openai/codex'}</span><span><Monitor size={14} /> App {codex?.targets?.app ? <strong>found</strong> : 'not installed'}</span><code>codex --profile opencode-bridge</code></div>
          <div className="mapping-footer"><span>Using the Codex app changes its selected model in ~/.codex/config.toml and restarts it. Disconnect restores your previous selection exactly.</span><div className="footer-actions"><button className="text-button" disabled={!!busy || !codexValid || !codex?.targets?.app} onClick={() => launchCodex('app')}><ArrowUpRight size={14} /> Use in Codex app</button><button className="text-button" disabled={!!busy || !(codex?.connected || codex?.recoveryNeeded)} onClick={() => request({ action: 'disconnect', client: 'codex', restart: true }, 'Restoring Codex', 'Codex restored to its previous model.')}><Undo2 size={14} /> Disconnect Codex</button></div></div>
        </article>
        {agentCount > 0 && <div className="notice zen-note"><Bot size={16} /><span>Free OpenCode Zen models (and logins OpenCode handles itself) run through a private OpenCode server, so they stay “within OpenCode” as its free tier requires. OpenCode uses its own tools under the policy set in Settings; app-side tools such as Claude Code’s are not used with these models.</span></div>}
      </section>}
      {page === 'settings' && <section className="settings-page"><div className="section-title"><h2>Connection settings</h2><p>A small set of controls for your local bridge.</p></div>
        <div className="settings-card"><div><h3>Gateway port</h3><p>The local address Claude and Codex use. Changing it requires disconnecting Claude first.</p></div><input aria-label="Gateway port" aria-invalid={!portValid} type="number" min="1024" max="65535" value={Number.isFinite(port) ? port : ''} disabled={claudeLocked || !!busy} onChange={e => setPort(e.target.valueAsNumber)} /><button className="save-button" disabled={claudeLocked || !!busy || !claudeValid || !portValid} onClick={() => request({ action: 'save', client: 'claude', selection: claudeSelection, port }, 'Saving settings', 'Settings saved. They apply on your next launch.')}>Save port</button></div>
        <div className="settings-card agent-settings"><div><h3>OpenCode agent</h3><p>Used by free Zen models and other models that run inside OpenCode. It works in the app’s project folder when one is known (Claude Code, Codex), otherwise in this workspace.</p>
          <div className="agent-fields"><label htmlFor="agent-workspace">Workspace folder<input id="agent-workspace" value={workspace} spellCheck={false} disabled={!!busy} onChange={e => setWorkspace(e.target.value)} aria-invalid={!workspace.startsWith('/')} /></label>
            <fieldset><legend>Tool permissions</legend>{PERMISSIONS.map(option => <label key={option.value} className="permission-option"><input type="radio" name="agent-permission" value={option.value} checked={permission === option.value} disabled={!!busy} onChange={() => setPermission(option.value)} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</fieldset></div></div>
          <button className="save-button" disabled={!!busy || !workspace.startsWith('/') || (workspace === data?.preferences.agent.workspace && permission === data?.preferences.agent.permission)} onClick={() => request({ action: 'settings', agent: { workspace, permission } }, 'Saving agent settings', data?.gateway.ready ? 'Agent settings saved. The gateway restarted to apply them.' : 'Agent settings saved.')}>Save agent settings</button></div>
        <div className="settings-card"><div><h3>App data & recovery</h3><p>Saved selections, connection recovery, and gateway metadata logs.</p></div><button className="outline-button" onClick={() => request({ action: 'open-state' })}><FolderOpen size={15} /> Open folder</button></div>
        <div className="settings-card"><div><h3>Background gateway</h3><p>{data?.gateway.ready ? `Running on port ${data.gateway.port} · ${data.gateway.routed} requests routed. Closing the window keeps apps connected.` : 'Starts automatically when you launch an application.'}</p></div><button className="outline-button" disabled={!!busy || !data?.gateway.ready || claudeLocked || !!codex?.connected} onClick={() => request({ action: 'stop' }, 'Stopping gateway', 'Background gateway stopped.')}><Activity size={15} /> Stop gateway</button></div>
        <div className="settings-card"><div><h3>Disconnect & Quit</h3><p>Restore Claude and Codex to their previous connections, stop the gateway, and exit Bridge.</p></div><button className="outline-button" disabled={!!busy || !!data?.gateway.active} onClick={() => request({ action: 'disconnect-quit', client: 'claude', restart: true }, 'Disconnecting and quitting')}><Undo2 size={15} /> Disconnect & Quit</button></div>
        <div className="settings-footnote"><ShieldCheck size={19} /><p>The red close button hides the window; it does not disconnect your apps. Quit from the app menu to choose Disconnect & Quit or Keep Connected & Quit.</p></div></section>}
      <footer className="main-footer"><span><BridgeMark small /> A bridge from your models to your desktop.</span><span>{busy ? <><LoaderCircle size={12} className="spin" />{busy}</> : <><span className={`dot ${data?.gateway.ready ? 'online' : ''}`} />{data?.gateway.ready ? `${data.gateway.routed} requests routed` : 'Ready when you are'}</>}</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
