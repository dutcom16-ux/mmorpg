import { useState, type FormEvent } from 'react';
import { FACTIONS, FACTION_IDS, GAME_SUBTITLE, GAME_TITLE, ROLES, ROLE_IDS, type FactionId, type RoleId } from '../../../shared/content';
import { FactionEmblem, PilotPortrait } from '../art/Art';
import { isNativeApp, setServerUrl, signIn, useStore } from '../net';

export function Login() {
  const conn = useStore((s) => s.conn);
  const serverUrl = useStore((s) => s.serverUrl);
  const devTools = useStore((s) => s.devTools);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [faction, setFaction] = useState<FactionId>('aurex');
  const [role, setRole] = useState<RoleId>('assault');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editServer, setEditServer] = useState(conn === 'offline');
  const [draftUrl, setDraftUrl] = useState(serverUrl);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await signIn('auth.login', { username, password });
      else await signIn('auth.register', { username, password, name, faction, role });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login" data-faction={faction}>
      <header className="login-hero">
        <div className="login-emblems">
          {FACTION_IDS.map((f) => (
            <FactionEmblem key={f} faction={f} size={44} />
          ))}
        </div>
        <h1 className="title">{GAME_TITLE}</h1>
        <p className="subtitle">{GAME_SUBTITLE} — three banners, one buried world.</p>
      </header>

      <div className="server-row">
        <span className={`dot dot-${conn}`} aria-hidden="true" />
        <span className="server-text">
          {conn === 'online' ? 'Connected to' : conn === 'connecting' ? 'Connecting to' : 'Can’t reach'} <b>{serverUrl}</b>
        </span>
        <button className="link" onClick={() => setEditServer(!editServer)}>
          {editServer ? 'Hide' : 'Change server'}
        </button>
      </div>
      {editServer && (
        <div className="panel server-edit">
          <label className="field">
            <span>Server address</span>
            <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          <div className="chip-row">
            <button className="chip" onClick={() => setDraftUrl('http://10.0.2.2:3000')}>
              Android emulator
            </button>
            <button className="chip" onClick={() => setDraftUrl('http://192.168.1.10:3000')}>
              Phone on Wi-Fi
            </button>
            {!isNativeApp() && (
              <button className="chip" onClick={() => setDraftUrl(location.origin)}>
                This page’s server
              </button>
            )}
          </div>
          <p className="hint">On a phone, use your computer’s Wi-Fi address. The server prints it when it starts.</p>
          <button className="btn btn-primary" onClick={() => setServerUrl(draftUrl)}>
            Connect
          </button>
        </div>
      )}

      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
          New pilot
        </button>
      </div>

      <form onSubmit={submit} className="login-form">
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        </label>

        {mode === 'register' && (
          <>
            <label className="field">
              <span>Pilot name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} required />
            </label>
            <h3 className="pick-title">Choose your banner</h3>
            <div className="faction-pick">
              {FACTION_IDS.map((f) => (
                <button type="button" key={f} className={`faction-card ${faction === f ? 'on' : ''}`} data-faction={f} onClick={() => setFaction(f)} aria-pressed={faction === f}>
                  <FactionEmblem faction={f} size={48} />
                  <b>{FACTIONS[f].name}</b>
                  <i>{FACTIONS[f].motto}</i>
                </button>
              ))}
            </div>
            <p className="lore">{FACTIONS[faction].lore}</p>
            <h3 className="pick-title">Choose your role</h3>
            <div className="role-pick">
              {ROLE_IDS.map((r) => (
                <button type="button" key={r} className={`role-card ${role === r ? 'on' : ''}`} onClick={() => setRole(r)} aria-pressed={role === r}>
                  <PilotPortrait faction={faction} role={r} size={56} />
                  <div>
                    <b>{ROLES[r].name}</b>
                    <span>{ROLES[r].tagline}</span>
                    <small>Ability: {ROLES[r].ability.name}</small>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-big" disabled={busy || conn !== 'online'}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create pilot and play'}
        </button>
        {devTools && mode === 'login' && (
          <p className="hint">
            Test accounts: <code>aurex_pilot</code>, <code>kreth_pilot</code>, <code>vessari_pilot</code> — password <code>chipfall</code>.
          </p>
        )}
      </form>
    </div>
  );
}
