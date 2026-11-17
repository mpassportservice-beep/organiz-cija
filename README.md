# Smidzināšanas logs (Spray Window)

Mobile-first PWA for farmers in Latvia (default location Priekuļi, 57.315 N, 25.355 E; any point in Latvia can be chosen). One job: show **right now** whether
conditions suit pesticide spraying — a GREEN "Var smidzināt" / AMBER "Uzmanīgi" / RED "Nesmidzināt" flag with
the reason, a 10-row checklist, and the best window in the next 12 hours.

Latvian UI with an English toggle. Works offline with the last cached state.

> Decision support only. The product label and Latvian plant protection rules always take precedence.

## Run it

Needs Node.js ≥ 22.13 (uses the built-in `node:sqlite`; no native build step).

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:8787. The server fetches all sources immediately and then every 10 minutes.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | API on :8787 + Vite dev server on :5173 with hot reload |
| `npm test` | 93 unit tests: rules engine, stale/fallback logic, timeline, source parsers |
| `npm run typecheck` | TypeScript over all three packages |
| `npm run fetch-once -w server` | Fetch every source once and print what the app would decide |

Configuration is by environment variables — see `.env.example`. Nothing is required for the default farm.

## Deploying

The repo ships a `Dockerfile` (API + built web app in one container, port 8787) and a `render.yaml` blueprint.
The container needs **HTTPS in front** (required for PWA install, offline mode and push) and a **persistent
volume at `/data`** for the SQLite database (settings, log records, push keys) — without it every redeploy
wipes the log.

- **Render:** New → Blueprint → pick the GitHub repo. `render.yaml` creates the service with a 1 GB disk in
  Frankfurt and HTTPS. Set `VAPID_SUBJECT` to `mailto:<your address>` when asked.
- **Any Docker host / VPS:**
  `docker build -t smidzinasanas-logs . && docker run -d --restart unless-stopped -p 8787:8787 -v spraydata:/data smidzinasanas-logs`,
  then put Caddy or nginx with a certificate in front.
- **Without Docker:** Node ≥ 22.13, `npm ci && npm run build && npm start` behind an HTTPS reverse proxy.

There is **no login** and all settings are stored once on the server: everyone who has the link sees and can
change the same fields, products, thresholds and spraying log. That suits one farm sharing a link; for separate
farms run one instance each, or put the proxy's basic auth in front.

**Installing on a phone:** Android/Chrome → menu → *Install app*. iPhone/Safari → Share → *Add to Home Screen*
(on iOS push notifications only work after this step, iOS 16.4+).

## Layout

```
shared/   rules + types used by BOTH server and browser
  src/config.ts     ← THE rules config: every threshold, crops, BBCH stages
  src/engine.ts     pure rules engine: conditions → 10 checks → flag
  src/resolve.ts    observation-vs-forecast choice, rain windows, 12 h timeline, best window
  src/messages.ts   reason texts (lv/en)
  src/*.test.ts
server/   Fastify API, 10-min scheduler, SQLite cache + log, push, CSV/PDF
  src/sources/lvc.ts · lvgmc.ts · openMeteo.ts
  lvc-stations.json  coordinates for road stations (see below)
  test/              parser tests against recorded live responses
web/      React + Tailwind PWA
```

The browser never calls a weather API. It only talks to `/api/*` on this server.

## Data sources

Every value on screen carries source, station, distance from the farm and timestamp.

**Location:** tap the pin next to the place name in the header to choose any point in Latvia on a map (OpenStreetMap
tiles, loaded by the browser), or use the phone's GPS. Points outside Latvia are refused (Natural Earth 1:10m
border in `shared/src/latvia.ts`, 3 km tolerance for coast and border fields). The point is saved in the shared
settings; the server then fetches the Open-Meteo forecast for that exact point, and LVĢMC / LVC observations from
the stations nearest to it. Cached data is tagged with the coordinates it was fetched for, so another place's weather
is never shown — until the new place's data arrives the app says it is loading. "Noklusējums" goes back to the
configured farm (`FARM_LAT`/`FARM_LON`, Priekuļi by default). In remote parts of Latvia the nearest station that
measures wind can be 40–50 km away; its distance is shown on every row.

### 1a. LVC road weather stations — primary observations

- **Fetch:** CKAN REST on data.gov.lv. `package_show?id=aktualie-celu-meteorologisko-staciju-dati` to find the
  datastore resource (or `LVC_RESOURCE_ID` directly), then `datastore_search`. The latest row per station is kept,
  stations are ranked by distance, and the nearest 2 within 40 km are used.
- **Used for:** air temperature, wind speed, gusts, direction, humidity, dew point, precipitation intensity.
- **⚠ Status when this was built:** the dataset answered **HTTP 403 "Pieeja liegta"** to anonymous requests, so
  this fetcher could **not be tested against live data**. It is written and unit-tested against the column codes
  LVC uses in its published road-weather CSVs (`stacija, datums, AT, RH, DP, WS, WSM, WD, RI`; `999` = sensor
  missing) plus Latvian long-form headers. Until the dataset is readable the app runs on LVĢMC + forecast and
  shows the error under *Iestatījumi → Datu avoti*. To enable it:
  1. get access (data.gov.lv account / API key → `CKAN_API_KEY`, or the dataset being made public again);
  2. run `npm run fetch-once -w server` and read the line for `lvc`;
  3. if it reports unrecognised columns, add the names to `ALIASES` in `server/src/sources/lvc.ts`;
  4. if the feed has no coordinates, add the station codes to `server/lvc-stations.json`. The entries shipped
     there are approximate *locality* coordinates matched by name — verify them;
  5. timestamps without an offset are read as `Europe/Riga` (`LVC_TIMEZONE`). An observation stamped more than
     10 minutes in the future is rejected, so a wrong zone fails safe (falls back to forecast).

### 1b. LVĢMC operational data — reference station (verified live)

- **Fetch:** `datastore_search` on resource `17460efb-…` ("Meteoroloģiskie operatīvie dati") filtered to the
  station nearest the chosen location, found from the stations resource `c32c7afd-…` (default farm →
  **Priekuļi, RIPR99PA, 1 km**). Only ~25 of the 34 stations measure temperature and wind (the rest are
  precipitation posts), so the nearest 4 are tried in order and the first with current temperature and wind wins.
- **Used for:** `TDRY` temperature, `RLH` humidity, `WNS10` 10-min mean wind, `WPGST` gusts, `WNDD10` direction,
  `HPRAB` hourly precipitation, and `HATMN` hourly minimum temperature for the frost check.
  Timestamps are UTC.
- It is hourly and published about 15–20 minutes after the hour, so under the 30-minute rule it counts as fresh
  for only part of each hour. While LVC is unavailable expect the screen to say "prognoze" much of the time; the
  stale Priekuļi value stays visible next to it for comparison. Raising *Novērojums novecojis pēc* to 75 min
  in settings makes the app use LVĢMC continuously — your call.

### 2. Open-Meteo forecast (parser verified on a recorded live response)

- **Fetch:** one request to `api.open-meteo.com/v1/forecast` with `models=ecmwf_ifs025,icon_seamless`,
  `minutely_15` (temperature, humidity, dew point, precipitation, wind, gusts, direction) and `hourly`
  (precipitation probability, cloud cover, temperature −24 h…+40 h), plus sunrise/sunset.
- **Merge, deliberately cautious:** wind, gusts, rain amount and rain probability take the **higher** of the two
  models; cloud cover and hourly temperature the **lower** (clear sky → inversion, cold → frost); temperature,
  humidity and dew point the mean. If one model returns nothing, the other is used alone.
- Outside central Europe Open-Meteo's 15-minute values are interpolated from hourly model output.
- 144 calls/day, far inside the free tier. Note: Open-Meteo's free API is for non-commercial use.

## Stale and missing data

| Situation | What happens |
| --- | --- |
| Observation ≤ 30 min old | Used. Nearest station that reports that variable wins, per variable. |
| Observation > 30 min old | Marked stale. The **forecast** for the current 15 min is used instead, with a blue `PROGNOZE` badge, and the stale reading (value, station, time) shown beneath it. The flag panel says observations are stale. |
| No forecast either | A stale observation up to 3 h old is used with a black `NOVECOJIS` badge. |
| Nothing usable for a variable | That check shows "Nav datu" and is **AMBER** — missing data never yields green. |
| One source fails | The other sources are unaffected. The failed source keeps its last good payload in SQLite; its own timestamps decide staleness. The error text is shown in settings. |
| Server unreachable from the phone | Last snapshot from the phone's storage is shown under a black "BEZSAISTE" banner. Staleness keeps being re-evaluated on the phone every 30 s, so old observations age out into forecast, and the forecast itself runs out after ~24 h → "Nav datu". |
| Server up but upstream down > 25 min | Banner "Dati nav atjaunoti N min". |

The 30-minute limit is the threshold `staleMinutes` and is editable like the others.

## Rules

Overall flag = worst individual status. Defaults (all editable in *Iestatījumi → Robežvērtības*; changed values are
highlighted; they live in `shared/src/config.ts`):

| # | Check | GREEN | AMBER | RED |
| --- | --- | --- | --- | --- |
| 1 | Wind, 10-min mean | 1–3 m/s | < 1 or 3–5 m/s | > 5 m/s |
| 2 | Gusts | ≤ 7 m/s | – | > 7 m/s |
| 3 | Rain in the rain-free window (2 h) | below amber | ≥ 30 % or ≥ 0.1 mm | ≥ 60 % or ≥ 0.5 mm, or raining now |
| 4 | Air temperature | 8–25 °C | 5–8, 25–28 °C | < 5, > 28 °C |
| 5 | Relative humidity | ≥ 40 % | < 40 % | – |
| 6 | Delta T | 2–8 | < 2, 8–10 | > 10 |
| 7 | Inversion | otherwise | wind < 1.5 m/s **and** cloud ≤ 25 % **and** night or within 90 min of sunrise/sunset | – |
| 8 | Frost | none | min ≤ 0 °C within ±24 h | – |
| 9 | Dew | spread > 2 °C | temp − dew point ≤ 2 °C | – |
| 10 | Crop stage | BBCH inside product range | product has a range but BBCH unset | BBCH outside product range |

Choices I made where the brief was silent — change them if you disagree:
- **Rain thresholds** (30/60 %, 0.1/0.5 mm) are mine; the brief only asked for a configurable rain-free window.
- **5–8 °C is AMBER** (the brief defines green from 8 and red below 5).
- **Delta T** uses the Stull (2011) wet-bulb approximation.
- **Unknown cloud cover counts as clear sky** for the inversion check.
- **Best window** = the longest green run of ≥ 30 min in the next 12 h; if there is no green, the longest amber
  run is offered, labelled as "least bad".
- Without a crop or product, row 10 is informational and does not affect the flag.

**Product profile selected:** min/max temperature replace the red temperature limits, max wind replaces the red
wind limit, rain-free hours replace the window, BBCH range is enforced. Affected rows get a "līdzekļa robeža"
tag and the reason names the product, e.g. *"Vējš 3.5 m/s pārsniedz Xyz limitu 3.0 m/s"*.

## Log and export

"Sākt smidzināšanu" opens the pre-checks (bees, buffer zones with a wind-direction field map, nozzle class,
sprayer, certificate, soil; a red flag needs an explicit acknowledgement). Saving stores date, time, field, area,
crop, BBCH, product, registration number, dose, spray volume, target, operator, certificate number, nozzle class,
pre-harvest date, the flag with all 10 check results, and the full weather snapshot with the source of each value.
Records made without signal are queued on the phone and synced later.

**Field groups** (*Iestatījumi → Lauku grupas*): many small plots sprayed in one pass can be grouped. Pick the
group on the main screen; before spraying every field is listed with a tick box (group fields pre-ticked, any can
be added or removed). Saving creates one log record per ticked field — same weather, checks and treatment, each
with its own area, crop and BBCH — linked by a batch id and the column *Smidzināts kopā ar*. With a product that
limits the BBCH stage, a group is rated by its strictest field.

**Explanations:** tapping any row on the main screen opens what the value is, why it matters before spraying, and
the limits the app currently applies (`web/src/explain.ts`).

Export from *Žurnāls*: CSV (semicolon-separated, UTF-8 BOM — opens directly in Excel with Latvian settings) and
PDF. The field set is meant to cover a plant protection product usage register, but I have **not** checked it
line-by-line against the current VAAD form — do that before relying on it as the official record.

## Push notifications (optional)

*Iestatījumi → Paziņojumi*. After each fetch the server evaluates the 12 h timeline with your saved thresholds,
selected product and field; if it is not green now and a green window of ≥ 1 h lies ahead, each subscribed device
gets one message per window: "Zaļais logs atveras 18:30 (līdz 21:15)". VAPID keys are generated on first start
and kept in the database.

## Not done / known limits

- LVC live feed untested (see above).
- No authentication, single farm, single set of settings shared by all devices.
- The buffer-zone check shows only the wind direction on a compass; sensitive objects around fields are not marked
  in the app (removed on request) – check them on site.
- Log records cannot be edited or deleted in the UI (deliberate for a register; end time is not captured).
- The bee reminder is generic text; it does not encode specific legal hours or distances.
