import { config } from './config';

/** GET JSON with timeout and one retry. Throws a short, user-presentable error. */
export async function getJson<T = any>(url: string, headers: Record<string, string> = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(config.fetchTimeoutMs) });
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* not json */ }
      if (!res.ok) {
        const msg = body?.error?.message ?? body?.reason ?? text.slice(0, 120);
        const err = new Error(`HTTP ${res.status}: ${msg}`);
        if (res.status >= 400 && res.status < 500) throw Object.assign(err, { noRetry: true });
        throw err;
      }
      if (body === null) throw new Error('Response is not JSON');
      return body as T;
    } catch (e: any) {
      lastErr = e;
      if (e?.noRetry) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  const e = lastErr as any;
  throw new Error(e?.name === 'TimeoutError' ? 'Timeout' : (e?.cause?.code ? `${e.message} (${e.cause.code})` : (e?.message ?? String(e))));
}

/** Parse a timestamp; strings without an offset are interpreted in `tz`. Returns epoch ms or NaN. */
export function parseTime(raw: unknown, tz: string): number {
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw !== 'string' || !raw.trim()) return NaN;
  let s = raw.trim().replace(' ', 'T');
  const dm = s.match(/^(\d{2})\.(\d{2})\.(\d{4})T?(.*)$/); // dd.mm.yyyy hh:mm
  if (dm) s = `${dm[3]}-${dm[2]}-${dm[1]}T${dm[4] || '00:00'}`;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  const asUtc = Date.parse(s + 'Z');
  if (Number.isNaN(asUtc) || tz === 'UTC') return asUtc;
  return asUtc - tzOffsetMs(asUtc, tz);
}

function tzOffsetMs(at: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
}
