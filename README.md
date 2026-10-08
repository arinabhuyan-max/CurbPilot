# CurbPilot

**The curb rule checker for NYC delivery vans.** A driver types the delivery address and when they'll arrive. CurbPilot answers in plain English: where it's legal to stop, for how long, and where not to.

> Park on the north side of W 28th St. Commercial vehicle parking is allowed until 7 PM, 3-hour limit — pay at the meter. Do NOT park on the south side of W 28th St: no standing 4–7 PM except Sunday.

The promise is **fewer parking tickets**, not guaranteed open spots.

- **Customer:** owners and fleet managers of small NYC delivery businesses (10–50 vans) who pay the tickets themselves.
- **User:** their drivers, on a phone browser. There's nothing to download.
- **Pilot area:** Midtown South / Flower District (W 23rd to W 34th St, 5th to 9th Ave).

## Run it

Needs Node 20 or newer. The app has no runtime dependencies.

```bash
npm start                 # http://localhost:3000, uses data/pilot.json, or else the demo data
npm test
npm run check -- "120 W 28th St" 17:00     # same answer, in the terminal
```

Out of the box the app runs on **demo data** (`data/demo.json`): sample signs written in NYC DOT's format but **placed on made-up curbs**. The page shows a "Demo mode" banner. Never use the demo data for real deliveries.

## Deploy on Vercel

Connect the GitHub repo in Vercel; no settings needed. `vercel.json` serves `public/` as the page, and `api/check.js` / `api/info.js` run as serverless functions (the same logic as `src/server.js`). The data file (`data/pilot.json`, or the demo data) ships with the functions, so rebuild and commit it to update the live app.

## Load the real city data

```bash
npm run fetch-data        # NYC Open Data "Parking Regulation Locations and Signs" -> data/raw-signs.json
npm run build-data        # -> data/pilot.json (the app picks it up automatically)
npm install && ANTHROPIC_API_KEY=... npm run build-data -- --ai   # optional AI step, see below
```

`build-data` lists every sign it couldn't read. Drivers are told to check those signs themselves; the app never guesses.

## How it works

```
address ─► geocode (NYC GeoSearch; offline fallback: Manhattan house-number grid)
time    ─► NYC weekday + minute
                │
data/pilot.json: block faces (one side of one block) + structured sign rules
                │
blockface.js: what may a commercial van do on each nearby face right now, and until when
                │
answer.js: best face on the address's own block → else nearest legal face nearby → else WARNING
```

- **`src/rules.js`** parses sign text (`NO STANDING 4PM-7PM EXCEPT SUNDAY`) into rules, using rules for a commercial van:
  - No Stopping, No Standing, bus stops, reserved spaces and passenger-only spaces: forbidden.
  - No Parking (including street cleaning): the van may stop only while it is loading or unloading.
  - Truck loading zones: allowed, with a 3-hour limit unless the sign posts a different one.
  - Commercial meters and general meters: park and pay, with the posted limit.
- **AI step (`scripts/ai-rules.js`)**: when the regular parser can't read a sign, Claude can turn its text into the same rule format. This runs while the data is built, not while a driver waits. Each answer is cached in `data/ai-rules-cache.json` so a person can review it. When Claude isn't sure, the sign stays "unreadable". Answers that rely on an AI-read sign tell the driver to double-check it. It uses `claude-opus-5-5` (override with `CURBPILOT_MODEL`), with server-side refusal fallback turned on.
- **Answers to drivers never call the AI.** The rules are evaluated the same way every time, so the same address and time always give the same answer, and you can test it.

### Known limits of this MVP

- Signs are judged per block face, not per exact spot. If one side of a block has different rules along its length, the answer says "signs differ along this side" and tells the driver to read the sign where they stop.
- Hydrants, crosswalks, driveways and holiday suspensions are not modeled. Every answer says so.
- One neighborhood only. Addresses outside it get a clear "not covered yet".
- Not included on purpose: live spot availability, maps and navigation, voice, fleet dashboard, fighting tickets, accounts and payments.

## Field test (how we'll know it works)

1. Load the real data (above) and confirm the page has **no** demo banner.
2. Ask the florist's driver for 3 addresses they deliver to often, and the usual arrival times.
3. Run each one: `npm run check -- "<address>" <HH:MM>`.
4. Go to each block (or ask about it). Does the answer match the real signs? Is it where the driver would actually have parked legally?
5. Ask the owner: *"If this worked on every delivery, would you pay for it, and how much do tickets cost you in a typical month?"*
6. Check the open guess: do they just pay tickets because they have no time to fight them or charge them to drivers? What do they really do?

**It works if** all 3 answers are correct **and** the driver says they'd check it before their next delivery.

## Layout

```
public/index.html      phone page (single file, no build step)
src/server.js          HTTP server: /, /api/check, /api/info
src/checker.js         the core job: address + time -> answer
src/rules.js           sign text -> rules; plain-English descriptions
src/blockface.js       status of one block face at a time; next change
src/answer.js          picks the recommendation and writes the sentence
src/geocode.js         GeoSearch + offline grid fallback
src/geo.js             distances; NY State Plane -> lat/lon
scripts/               fetch-data, build-data, ai-rules, make-demo-data, check
data/demo.json         illustrative demo data (not real signs)
test/                  node:test suites
```
