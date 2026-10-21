#!/usr/bin/env node
// Checks CurbPilot against real parking tickets. Takes recent NYC tickets
// written to commercial plates for "no standing" / "no parking", puts each
// on its block face, and asks: at that date and time, what would CurbPilot
// have told the driver?
//
//   warned      CurbPilot said don't stop here (or only on part of this side)
//   load only   CurbPilot said: stop only while loading/unloading (no parking
//               or truck loading zone). Consistent: the van likely stayed longer
//   missed      CurbPilot said OK to stop, but the city wrote a ticket: the
//               sign data or our reading of it may be wrong. Check these blocks.
//
// Source: NYC Open Data "Parking Violations Issued - Fiscal Year 2026"
// (pvqr-7yc4). Ticket addresses are geocoded with NYC GeoSearch.
//
//   npm run ticket-audit                    -> data/ticket-audit.md
//   TICKETS=5000 ADDRESSES=1500 npm run ticket-audit
//   CURBPILOT_TICKETS_DATASET=https://data.cityofnewyork.us/resource/<id>.json npm run ticket-audit

const fs = require('fs');
const path = require('path');
const { loadData, facesNear, faceId } = require('../src/data');
const { statusAt } = require('../src/blockface');
const { holidayOn } = require('../src/holidays');
const { blockKey, faceLabel } = require('../src/answer');
const { describeRule, formatClock } = require('../src/rules');
const { distanceToSegment } = require('../src/geo');
const { normalizeStreet } = require('../src/streets');
const { geocode } = require('../src/geocode');

const DATASET = process.env.CURBPILOT_TICKETS_DATASET || 'https://data.cityofnewyork.us/resource/pvqr-7yc4.json';
const OUT = path.join(__dirname, '..', 'data', 'ticket-audit.md');
const MAX_FACE_METERS = 60; // a geocoded building farther than this from its street's curb is not trusted

// Violation codes (NYC Department of Finance) the sign data can explain.
const CODES = {
  14: { rule: 'no standing', label: 'No standing (sign)' },
  19: { rule: 'no standing', label: 'No standing (bus stop)' },
  20: { rule: 'no parking', label: 'No parking (sign)' },
  21: { rule: 'no parking', label: 'No parking (street cleaning)' },
};

const BOROUGHS = { NY: 'Manhattan', MN: 'Manhattan', K: 'Brooklyn', BK: 'Brooklyn', Q: 'Queens', QN: 'Queens', BX: 'Bronx', R: 'Staten Island', ST: 'Staten Island' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pick = (row, names) => {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
  return undefined;
};

// "0523P" / "1145A" / "0005A" -> minutes after midnight.
function parseTicketTime(s) {
  const m = /^(\d{2})(\d{2})([AP])?$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 23) return null;
  if (m[3]) {
    if (h > 12) return null;
    h = (h % 12) + (m[3].toUpperCase() === 'P' ? 12 : 0);
  }
  return h * 60 + min;
}

// "2026-03-14T00:00:00.000" or "03/14/2026" -> "2026-03-14".
function parseTicketDate(s) {
  const str = String(s || '');
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(str);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// One dataset row -> a ticket we can check, or null.
function readTicket(row) {
  const code = Number(pick(row, ['violation_code']));
  if (!CODES[code]) return null;
  const date = parseTicketDate(pick(row, ['issue_date']));
  const minute = parseTicketTime(pick(row, ['violation_time']));
  const house = String(pick(row, ['house_number']) || '').trim();
  const street = String(pick(row, ['street_name']) || '').trim();
  if (!date || minute == null || !/^\d+[A-Z]?(-\d+)?$/i.test(house) || !street) return null;
  const county = String(pick(row, ['violation_county']) || '').toUpperCase();
  return {
    code,
    date,
    day: new Date(`${date}T12:00:00Z`).getUTCDay(),
    minute,
    house,
    street,
    borough: BOROUGHS[county] || '',
    opposite: String(pick(row, ['violation_in_front_of_or_opposite']) || '').toUpperCase() === 'O',
  };
}

const addressOf = (t) => `${t.house} ${t.street}${t.borough ? `, ${t.borough}` : ''}`;

// The block face a ticket was written on: the nearest curb of the ticket's
// street to the geocoded building, or the far side when the officer wrote
// "opposite".
function faceForTicket(data, ticket, place) {
  const street = normalizeStreet(ticket.street);
  const candidates = facesNear(data, place.lat, place.lon)
    .filter((f) => normalizeStreet(f.street) === street)
    .map((f) => ({ f, d: distanceToSegment([place.lat, place.lon], f.line[0], f.line[1] || f.line[0]) }))
    .sort((a, b) => a.d - b.d);
  if (!candidates.length || candidates[0].d > MAX_FACE_METERS) return null;
  const front = candidates[0].f;
  if (!ticket.opposite) return front;
  return candidates.map((c) => c.f).find((f) => f !== front && blockKey(f) === blockKey(front)) || null;
}

// What CurbPilot would have said on that face at the ticket's date and time.
function judge(face, ticket) {
  const holiday = holidayOn(ticket.date);
  const status = statusAt(face, ticket.day, ticket.minute, holiday);
  let outcome;
  if (['no', 'mixed', 'check'].includes(status.category)) outcome = 'warned';
  else if (status.category === 'load') outcome = 'load';
  else outcome = 'missed';
  return { outcome, category: status.category, holiday };
}

function summarize(results) {
  const count = (o) => results.filter((r) => r.outcome === o).length;
  const total = results.length;
  const byFace = new Map();
  for (const r of results.filter((x) => x.outcome === 'missed')) {
    const id = faceId(r.face);
    if (!byFace.has(id)) byFace.set(id, { face: r.face, tickets: [] });
    byFace.get(id).tickets.push(r);
  }
  const worst = [...byFace.values()].sort((a, b) => b.tickets.length - a.tickets.length);
  return { total, warned: count('warned'), load: count('load'), missed: count('missed'), worst };
}

const pct = (n, total) => (total ? `${((100 * n) / total).toFixed(1)}%` : '–');

function report(s, meta) {
  const lines = [
    '# CurbPilot ticket check',
    '',
    `Real NYC parking tickets written to **commercial plates** for no standing / no parking, checked against what CurbPilot would have told the driver at that exact date and time. Built ${meta.builtAt} from ${meta.fetched} recent commercial tickets (${meta.dateRange}); ${s.total} could be placed on a curb CurbPilot knows.`,
    '',
    '| What CurbPilot would have said | Tickets | Share |',
    '|---|---:|---:|',
    `| **Warned:** don't stop here (or only on part of this side) | ${s.warned} | ${pct(s.warned, s.total)} |`,
    `| **Stop only while loading** (no parking or truck loading zone; van likely stayed longer) | ${s.load} | ${pct(s.load, s.total)} |`,
    `| **Missed:** said OK to stop, but a ticket was written | ${s.missed} | ${pct(s.missed, s.total)} |`,
    '',
    `**CurbPilot would have warned the driver, or limited them to loading, for ${pct(s.warned + s.load, s.total)} of these tickets.**`,
    '',
    'A "missed" ticket is not always our mistake: officers sometimes write the nearest house number, the van may have been at a hydrant or crosswalk (not in the sign data), or a temporary sign was up. A curb with several misses is worth checking on the street.',
  ];
  if (s.worst.length) {
    lines.push('', '## Curbs to check first', '', '| Curb | Missed tickets | Example ticket | Signs CurbPilot has |', '|---|---:|---|---|');
    for (const { face, tickets } of s.worst.slice(0, 25)) {
      const t = tickets[0].ticket;
      const example = `${CODES[t.code].label}, ${DAYS[t.day]} ${t.date} ${formatClock(t.minute)} at ${addressOf(t)}${tickets[0].holiday ? ` (${tickets[0].holiday.name})` : ''}`;
      const signs = [...new Set(face.rules.filter((r) => r.kind !== 'info').map(describeRule))].join('; ') || 'none';
      lines.push(`| ${faceLabel(face)} | ${tickets.length} | ${example} | ${signs.replace(/\|/g, '/')} |`);
    }
  }
  lines.push('', `Not placed on a curb: ${meta.unplaced} tickets (address not found, or no sign data for that street nearby).`);
  return lines.join('\n') + '\n';
}

async function fetchTickets(limit) {
  const headers = process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {};
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  const PAGE = 50000;
  // Newest first; the code filter runs here so the query works whatever type the column has.
  for (let offset = 0; offset < limit * 20 && rows.length < limit; offset += PAGE) {
    const where = encodeURIComponent(`plate_type='COM' AND issue_date <= '${today}T23:59:59'`);
    const url = `${DATASET}?$where=${where}&$order=issue_date DESC&$limit=${PAGE}&$offset=${offset}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const page = await res.json();
    if (offset === 0) console.log(`columns: ${page[0] ? Object.keys(page[0]).join(', ') : '(no rows)'}`);
    for (const row of page) {
      const t = readTicket(row);
      if (t && rows.length < limit) rows.push(t);
    }
    console.log(`  fetched ${offset + page.length} commercial tickets, ${rows.length} usable`);
    if (page.length < PAGE) break;
  }
  return rows;
}

// Geocode each distinct address once, a few at a time.
async function geocodeAll(addresses, faces, { concurrency = 6 } = {}) {
  const found = new Map();
  const queue = [...addresses];
  async function worker() {
    while (queue.length) {
      const a = queue.shift();
      found.set(a, await geocode(a, faces).catch(() => null));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return found;
}

function audit(data, tickets, places) {
  const results = [];
  let unplaced = 0;
  for (const ticket of tickets) {
    const place = places.get(addressOf(ticket));
    const face = place && faceForTicket(data, ticket, place);
    if (!face) {
      unplaced++;
      continue;
    }
    results.push({ ticket, face, ...judge(face, ticket) });
  }
  return { results, unplaced };
}

async function main() {
  const maxTickets = Number(process.env.TICKETS) || 20000;
  const maxAddresses = Number(process.env.ADDRESSES) || 4000;
  const data = loadData(process.env.CURBPILOT_DATA);
  if (data.meta && data.meta.demo) throw new Error('Load the real city data first (npm run fetch-data && npm run build-data).');

  console.log(`Downloading up to ${maxTickets} recent commercial-plate tickets…`);
  let tickets = await fetchTickets(maxTickets);
  if (!tickets.length) throw new Error('No usable tickets. Check the column names printed above.');

  // The most-ticketed addresses first, so a capped run still covers the busiest curbs.
  const counts = new Map();
  for (const t of tickets) counts.set(addressOf(t), (counts.get(addressOf(t)) || 0) + 1);
  const addresses = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, maxAddresses);
  const kept = new Set(addresses);
  const fetched = tickets.length;
  tickets = tickets.filter((t) => kept.has(addressOf(t)));
  console.log(`Geocoding ${addresses.length} addresses…`);
  const places = await geocodeAll(addresses, data.blockfaces);

  const { results, unplaced } = audit(data, tickets, places);
  const dates = tickets.map((t) => t.date).sort();
  const md = report(summarize(results), {
    builtAt: new Date().toISOString().slice(0, 10),
    fetched,
    dateRange: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : 'no dates',
    unplaced: unplaced + (fetched - tickets.length),
  });
  fs.writeFileSync(OUT, md);
  console.log(`\n${md}\nWrote ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`ticket-audit failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { readTicket, parseTicketTime, parseTicketDate, faceForTicket, judge, audit, summarize, report, addressOf };
