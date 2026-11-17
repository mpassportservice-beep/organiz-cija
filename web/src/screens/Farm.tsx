import { useState } from 'react';
import type { Ctx } from '../App';
import { api, HttpError, post, unsyncedCount } from '../data';
import { DEMO } from '../demo';
import type { Me } from '../session';
import { Btn, Card, inputCls, Labeled } from '../ui';

/** Farm name, people with access, invitations, switching farm; account sign-out and deletion. */
export function FarmCard({ ctx }: { ctx: Ctx }) {
  const { t, session } = ctx;
  const { me, setMe } = session;
  const owner = me.farm.role === 'owner';
  const [name, setName] = useState(me.farm.name);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<Me & { result?: string }>, ok?: (r: Me & { result?: string }) => string) => {
    if (DEMO) { setMsg(t('demoNoAccounts')); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fn();
      setMe({ user: r.user, farm: r.farm, farms: r.farms, members: r.members, invites: r.invites });
      if (ok) setMsg(ok(r));
    } catch (e) {
      const code = e instanceof HttpError ? e.code : '';
      setMsg(code === 'lastOwner' ? t('farmLastOwner') : code === 'onlyFarm' ? t('farmOnlyFarm') : code === 'E-mail' ? t('farmBadEmail') : t('farmError'));
    } finally { setBusy(false); }
  };

  return (
    <Card title={t('farmTitle')}>
      <div className="space-y-3">
        {me.farms.length > 1 && (
          <Labeled label={t('farmSwitch')}>
            <select className={inputCls} value={me.farm.id} disabled={busy}
              onChange={(e) => void run(() => post('/api/farm/switch', { farmId: Number(e.target.value) }))}>
              {me.farms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.role === 'owner' ? '' : ` (${t('roleMember')})`}</option>)}
            </select>
          </Labeled>
        )}
        {owner ? (
          <Labeled label={t('farmName')}>
            <div className="flex gap-2">
              <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <Btn kind="ghost" disabled={busy || !name.trim() || name === me.farm.name} onClick={() => void run(() => api<Me>('/api/farm', { method: 'PUT', body: JSON.stringify({ name }) }), () => t('farmRenamed'))}>{t('save')}</Btn>
            </div>
          </Labeled>
        ) : (
          <p className="font-bold">{me.farm.name} · <span className="font-semibold text-neutral-700">{t('roleMember')}</span></p>
        )}

        <div>
          <div className="mb-1 text-sm font-semibold">{t('farmPeople')}</div>
          <ul className="divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
            {me.members.map((m) => (
              <li key={m.id} className="flex min-h-12 items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{m.name || m.email}{m.id === me.user.id ? ` (${t('you')})` : ''}</span>
                  {m.name && <span className="block truncate text-sm text-neutral-700">{m.email}</span>}
                  <span className="text-xs font-bold uppercase text-neutral-600">{m.role === 'owner' ? t('roleOwner') : t('roleMember')}</span>
                </span>
                {owner && m.id !== me.user.id && (
                  <span className="flex shrink-0 gap-1">
                    <button className="min-h-10 rounded-md border-2 border-neutral-900 px-2 text-xs font-bold" disabled={busy}
                      onClick={() => void run(() => post('/api/farm/member/role', { userId: m.id, role: m.role === 'owner' ? 'member' : 'owner' }))}>
                      {m.role === 'owner' ? t('makeMember') : t('makeOwner')}
                    </button>
                    <button className="min-h-10 rounded-md border-2 border-stop px-2 text-xs font-bold text-stop" disabled={busy}
                      onClick={() => { if (confirm(t('removeConfirm', { who: m.name || m.email }))) void run(() => post('/api/farm/member/remove', { userId: m.id })); }}>
                      {t('remove')}
                    </button>
                  </span>
                )}
              </li>
            ))}
            {me.invites.map((i) => (
              <li key={i.email} className="flex min-h-12 items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{i.email}</span>
                  <span className="text-xs font-bold uppercase text-neutral-600">{t('invitePending')}</span>
                </span>
                {owner && (
                  <button className="min-h-10 shrink-0 rounded-md border-2 border-neutral-900 px-2 text-xs font-bold" disabled={busy}
                    onClick={() => void run(() => post('/api/farm/invite/cancel', { email: i.email }))}>{t('cancel')}</button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {owner && (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            void run(() => post('/api/farm/invite', { email }), (r) => { setEmail(''); return r.result === 'added' ? t('inviteAdded') : r.result === 'already' ? t('inviteAlready') : t('inviteSent'); });
          }}>
            <Labeled label={t('inviteLabel')} hint={t('inviteHint')}>
              <div className="flex gap-2">
                <input className={inputCls} type="email" inputMode="email" autoComplete="off" placeholder="vards@piemers.lv" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Btn type="submit" disabled={busy || !email.includes('@')}>{t('invite')}</Btn>
              </div>
            </Labeled>
          </form>
        )}
        {msg && <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-bold" role="status">{msg}</p>}

        <div className="grid grid-cols-2 gap-2">
          <Btn kind="ghost" disabled={busy} onClick={() => { const n = prompt(t('newFarmName'), ''); if (n !== null) void run(() => post('/api/farm/new', { name: n }), () => t('newFarmDone')); }}>
            + {t('newFarm')}
          </Btn>
          {me.farms.length > 1 && (
            <Btn kind="danger" disabled={busy} onClick={() => { if (confirm(t('leaveConfirm', { farm: me.farm.name }))) void run(() => post('/api/farm/leave')); }}>{t('leaveFarm')}</Btn>
          )}
        </div>
      </div>
    </Card>
  );
}

export function AccountCard({ ctx }: { ctx: Ctx }) {
  const { t, session } = ctx;
  const [busy, setBusy] = useState(false);
  return (
    <Card title={t('accountTitle')}>
      <div className="space-y-3">
        <p className="text-sm"><span className="font-semibold">{t('signedInAs')}:</span> <strong className="break-all">{session.me.user.email}</strong></p>
        <Btn className="w-full" kind="ghost" disabled={busy || DEMO} onClick={async () => {
          const n = unsyncedCount();
          if (n > 0 && !confirm(t('signOutUnsynced', { n }))) return;
          setBusy(true); await session.signOut();
        }}>{t('signOut')}</Btn>
        <Btn className="w-full" kind="danger" disabled={busy || DEMO} onClick={async () => {
          if (!confirm(t('deleteAccountConfirm'))) return;
          setBusy(true);
          if (!(await session.deleteAccount())) { setBusy(false); alert(t('farmError')); }
        }}>{t('deleteAccount')}</Btn>
        <p className="text-xs text-neutral-700">{t('deleteAccountHint')}</p>
      </div>
    </Card>
  );
}
