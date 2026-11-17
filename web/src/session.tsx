import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '@spray/shared';
import { App } from './App';
import { api, clearLocalData, HttpError, post, setFarmStorage } from './data';
import { DEMO } from './demo';
import { Login, type AuthConfig } from './screens/Login';

export type Role = 'owner' | 'member';
export interface Me {
  user: { id: number; email: string; name: string };
  farm: { id: number; name: string; role: Role };
  farms: { id: number; name: string; role: Role }[];
  members: { id: number; email: string; name: string; role: Role }[];
  invites: { email: string; createdAt: string }[];
}

const ME_KEY = 'spray.me';
const LANG_KEY = 'spray.lang';
const DEMO_ME: Me = {
  user: { id: 1, email: 'demo@example.lv', name: 'Demo' }, farm: { id: 1, name: 'Demo saimniecība', role: 'owner' },
  farms: [{ id: 1, name: 'Demo saimniecība', role: 'owner' }], members: [{ id: 1, email: 'demo@example.lv', name: 'Demo', role: 'owner' }], invites: [],
};

function readMe(): Me | null {
  try { const v = localStorage.getItem(ME_KEY); return v ? (JSON.parse(v) as Me) : null; } catch { return null; }
}
function saveMe(me: Me | null) {
  try { if (me) localStorage.setItem(ME_KEY, JSON.stringify(me)); else localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
}

export interface Session {
  me: Me;
  setMe: (m: Me) => void;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
  offlineSession: boolean;
  /** Language is personal (per phone), not a farm setting. */
  lang: Lang;
  setLang: (l: Lang) => void;
}

/**
 * Who is signed in and which farm they work on. Without a network the last known account is used
 * (read-only data from the phone's cache); a 401 from the server sends the user to the sign-in screen.
 */
export function Root() {
  const [status, setStatus] = useState<'loading' | 'in' | 'out'>(DEMO ? 'in' : 'loading');
  const [me, setMeState] = useState<Me | null>(DEMO ? DEMO_ME : null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [offline, setOffline] = useState(false);
  const [lang, setLangState] = useState<Lang>(() => {
    try { const l = localStorage.getItem(LANG_KEY); if (l === 'lv' || l === 'en') return l; } catch { /* ignore */ }
    return 'lv'; // the app is made for Latvian farms; English is one tap away
  });
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } };

  const setMe = useCallback((m: Me) => { saveMe(m); setMeState(m); }, []);

  const load = useCallback(async () => {
    if (DEMO) return;
    try {
      const m = await api<Me>('/api/me', undefined, 0);
      setMe(m); setOffline(false); setStatus('in');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        saveMe(null); setMeState(null); setStatus('out');
        try { setConfig(await api<AuthConfig>('/api/auth/config', undefined, 0)); } catch { setOffline(true); }
      } else {
        // No network: carry on with the account and data cached on this phone.
        const cached = readMe();
        setOffline(true);
        if (cached) { setMeState(cached); setStatus('in'); } else setStatus('out');
      }
    }
  }, [setMe]);

  useEffect(() => {
    void load();
    const out = () => { setStatus('out'); setMeState(null); saveMe(null); void api<AuthConfig>('/api/auth/config', undefined, 0).then(setConfig).catch(() => {}); };
    const online = () => { if (offline) void load(); };
    window.addEventListener('spray:signed-out', out);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('spray:signed-out', out); window.removeEventListener('online', online); };
  }, [load, offline]);

  const signOut = async () => {
    try { await post('/api/auth/logout'); } catch { /* signed out locally anyway */ }
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* ignore */ }
    clearLocalData();
    saveMe(null); setMeState(null); setStatus('out');
    try { setConfig(await api<AuthConfig>('/api/auth/config', undefined, 0)); } catch { setOffline(true); }
  };
  const deleteAccount = async () => {
    try { await post('/api/account/delete'); } catch { return false; }
    clearLocalData();
    saveMe(null); setMeState(null); setStatus('out');
    try { setConfig(await api<AuthConfig>('/api/auth/config', undefined, 0)); } catch { /* ignore */ }
    return true;
  };

  if (status === 'loading') {
    return <div className="flex min-h-dvh items-center justify-center text-lg font-bold">…</div>;
  }
  if (status === 'out' || !me) {
    return <Login config={config} lang={lang} setLang={setLang} offline={offline} onSignedIn={() => void load()} />;
  }
  setFarmStorage(me.farm.id);
  return <App key={`${me.user.id}:${me.farm.id}`} session={{ me, setMe, signOut, deleteAccount, offlineSession: offline, lang, setLang }} />;
}
