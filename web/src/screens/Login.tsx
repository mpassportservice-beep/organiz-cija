import { useEffect, useRef, useState } from 'react';
import type { Lang } from '@spray/shared';
import { api, HttpError, post } from '../data';
import { makeT } from '../i18n';
import { Btn, inputCls } from '../ui';

export interface AuthConfig { google: string | null; apple: string | null; dev: boolean }

declare global {
  interface Window {
    google?: any;
    AppleID?: any;
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { scripts.delete(src); reject(new Error(`load ${src}`)); };
      document.head.appendChild(el);
    }));
  }
  return scripts.get(src)!;
}

/** A fresh one-time nonce from the server (also set as an HttpOnly cookie); it ends up inside the ID token. */
const nonce = async () => (await api<{ nonce: string }>('/api/auth/nonce', undefined, 0)).nonce;

function AppleLogo() {
  return (
    <svg width="18" height="22" viewBox="0 0 170 210" aria-hidden fill="currentColor">
      <path d="M150.4 163.6c-2.9 6.7-6.3 12.9-10.3 18.5-5.4 7.7-9.9 13-13.3 15.9-5.3 4.9-11 7.4-17.1 7.5-4.4 0-9.6-1.2-15.8-3.8-6.2-2.5-11.9-3.8-17.1-3.8-5.5 0-11.3 1.3-17.6 3.8-6.3 2.5-11.3 3.9-15.2 4-5.9.3-11.7-2.3-17.6-7.8-3.7-3.3-8.4-8.8-14-16.7-6-8.4-10.9-18.2-14.8-29.4C4.4 130.1 2.3 118.3 2.3 107c0-13 2.8-24.2 8.4-33.6 4.4-7.5 10.3-13.4 17.6-17.8 7.3-4.4 15.3-6.6 23.8-6.8 4.7 0 10.8 1.4 18.5 4.3 7.6 2.9 12.5 4.3 14.7 4.3 1.6 0 7.1-1.7 16.4-5.2 8.8-3.2 16.2-4.5 22.3-4 16.5 1.3 28.9 7.8 37.1 19.6-14.8 9-22.1 21.5-21.9 37.5.1 12.5 4.7 22.9 13.6 31.1 4 3.8 8.5 6.8 13.5 8.9-1.1 3.1-2.2 6.1-3.4 9zM112.6 6.5c0 9.8-3.6 18.9-10.7 27.4-8.6 10-19 15.8-30.3 14.9-.1-1.2-.2-2.4-.2-3.7 0-9.4 4.1-19.4 11.4-27.7 3.6-4.2 8.3-7.6 13.9-10.4 5.6-2.7 10.9-4.2 15.9-4.5.1 1.3.1 2.6.1 4z" />
    </svg>
  );
}

export function Login({ config, lang, setLang, onSignedIn, offline }: {
  config: AuthConfig | null; lang: Lang; setLang: (l: Lang) => void; onSignedIn: () => void; offline: boolean;
}) {
  const t = makeT(lang);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const gBox = useRef<HTMLDivElement>(null);

  const fail = (e: unknown) => {
    setBusy(false);
    setErr(e instanceof HttpError && e.status === 401 ? t('loginFailed') : t('loginNetwork'));
  };

  // Google Identity Services draws its own button; it is re-initialised with a new nonce after every attempt.
  useEffect(() => {
    if (!config?.google || !gBox.current) return;
    let alive = true;
    const setup = async () => {
      try {
        await loadScript('https://accounts.google.com/gsi/client');
        const n = await nonce();
        if (!alive || !gBox.current) return;
        window.google.accounts.id.initialize({
          client_id: config.google, nonce: n, ux_mode: 'popup', auto_select: false, itp_support: true,
          callback: async (r: { credential: string }) => {
            setBusy(true); setErr('');
            try { await post('/api/auth/google', { credential: r.credential }); onSignedIn(); } catch (e) { fail(e); void setup(); }
          },
        });
        gBox.current.innerHTML = '';
        window.google.accounts.id.renderButton(gBox.current, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', logo_alignment: 'center',
          width: Math.min(320, gBox.current.clientWidth || 320), locale: lang === 'lv' ? 'lv' : 'en',
        });
      } catch { if (alive) setErr(t('loginNetwork')); }
    };
    void setup();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.google, lang]);

  const apple = async () => {
    if (!config?.apple) return;
    setBusy(true); setErr('');
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const n = await nonce();
      window.AppleID.auth.init({ clientId: config.apple, scope: 'name email', redirectURI: `${location.origin}/`, nonce: n, usePopup: true });
      const r = await window.AppleID.auth.signIn();
      await post('/api/auth/apple', { id_token: r.authorization?.id_token, user: r.user });
      onSignedIn();
    } catch (e: any) {
      if (e?.error === 'popup_closed_by_user' || e?.error === 'user_cancelled_authorize') { setBusy(false); return; }
      fail(e);
    }
  };

  const dev = async () => {
    setBusy(true); setErr('');
    try { await post('/api/auth/dev', { email: devEmail }); onSignedIn(); } catch (e) { fail(e); }
  };

  const none = config && !config.google && !config.apple && !config.dev;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5">
      <div className="safe-t flex justify-end py-2">
        <button className="min-h-11 min-w-14 rounded-lg border-2 border-neutral-900 px-2 text-sm font-black" onClick={() => setLang(lang === 'lv' ? 'en' : 'lv')}>
          {lang === 'lv' ? 'EN' : 'LV'}
        </button>
      </div>
      <div className="flex flex-1 flex-col justify-center pb-16">
        <img src="/icon.svg" alt="" width={72} height={72} className="mb-4 rounded-2xl" />
        <h1 className="text-3xl font-black leading-tight">{t('appName')}</h1>
        <p className="mt-2 text-base font-semibold text-neutral-700">{t('loginLead')}</p>

        <div className="mt-8 space-y-3">
          {offline && <div className="rounded-lg bg-neutral-950 px-3 py-2 text-sm font-bold text-white">⚠ {t('loginOffline')}</div>}
          {config?.google && <div ref={gBox} className="flex min-h-11 justify-center" aria-busy={busy} />}
          {config?.apple && (
            <button onClick={apple} disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-black px-4 text-base font-semibold text-white disabled:opacity-50">
              <AppleLogo /> {t('loginApple')}
            </button>
          )}
          {config?.dev && (
            <div className="space-y-2 rounded-lg border-2 border-dashed border-neutral-900 p-3">
              <div className="text-xs font-bold">DEV_LOGIN</div>
              <input className={inputCls} type="email" placeholder="e-pasts@piemers.lv" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
              <Btn className="w-full" disabled={busy || !devEmail} onClick={dev}>{t('loginDev')}</Btn>
            </div>
          )}
          {none && <p className="rounded-lg bg-amber-100 p-3 text-sm font-semibold">{t('loginNotConfigured')}</p>}
          {busy && <p className="text-center font-semibold">{t('loginBusy')}</p>}
          {err && <p className="rounded-lg bg-stop px-3 py-2 text-sm font-bold text-white" role="alert">{err}</p>}
        </div>
        <p className="mt-8 text-sm text-neutral-700">{t('loginPrivacy')}</p>
      </div>
    </div>
  );
}
