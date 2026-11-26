import { describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import type { ForecastSlot, Snapshot } from '@spray/shared';
import { currentFarmOf, signIn } from '../src/accounts';
import { db } from '../src/db';
import { notifyGreenWindow, subscribe, windowMessage } from '../src/push';

const Q = 15 * 60_000;
function snapshot(now: number): Snapshot {
  const t0 = Math.floor(now / Q) * Q;
  const slots: ForecastSlot[] = Array.from({ length: 60 }, (_, i) => {
    const windy = i < 8; // the first two hours: too windy (red), then a long calm, dry, mild spell
    return { t: new Date(t0 + i * Q).toISOString(), temp: 15, rh: 60, dewPoint: 7, wind: windy ? 7 : 2.5, gust: windy ? 11 : 4,
      windDir: 200, precip: 0, precipProb: 5, cloud: 50 };
  });
  return {
    generatedAt: new Date(now).toISOString(), farm: { name: 'X', lat: 57.3, lon: 25.3, timezone: 'Europe/Riga' }, observations: [],
    forecast: {
      sourceLabel: 'Open-Meteo', models: ['M'], fetchedAt: new Date(now).toISOString(), slots,
      hourlyTemps: Array.from({ length: 60 }, (_, i) => ({ t: new Date(t0 + (i - 24) * 3600_000).toISOString(), temp: 12, observed: false })),
      sunrise: [-1, 0, 1].map((d) => new Date(t0 + d * 86_400_000 - 6 * 3600_000).toISOString()),
      sunset: [-1, 0, 1].map((d) => new Date(t0 + d * 86_400_000 + 8 * 3600_000).toISOString()),
    },
    sources: [],
  };
}

describe('green-window notification', () => {
  it('is sent once per window to each subscribed phone', async () => {
    db.exec('DELETE FROM push_subs');
    const farm = currentFarmOf(signIn('google', 'push-test', 'push@x.lv', ''))!.id;
    const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    subscribe(farm, { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } }, 'lv');
    const snap = snapshot(Date.now());
    expect(await notifyGreenWindow(farm, snap)).toBe(1);
    const payload = JSON.parse(sent.mock.calls[0][1] as string);
    expect(payload.title).toBe('Smidzināšanas logs');
    expect(payload.body).toMatch(/^Zaļais logs atveras (rīt )?\d\d:\d\d \(līdz \d\d:\d\d\)$/);
    expect(await notifyGreenWindow(farm, snap)).toBe(0); // same window: not again
    sent.mockRestore();
  });
  it('says "rīt" for a window after midnight', () => {
    const now = Date.parse('2026-06-01T19:00:00Z'); // 22:00 in Riga
    expect(windowMessage('2026-06-02T03:30:00Z', '2026-06-02T06:00:00Z', 'lv', now).body).toBe('Zaļais logs atveras rīt 06:30 (līdz 09:00)');
    expect(windowMessage('2026-06-01T19:30:00Z', '2026-06-01T20:30:00Z', 'lv', now).body).toBe('Zaļais logs atveras 22:30 (līdz 23:30)');
  });
});
