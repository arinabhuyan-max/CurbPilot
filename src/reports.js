// Driver reports on a block face, sent from the answer card:
//   ok     "Parked fine": the signs matched and there was room
//   full   "Spot was full"
//   wrong  "Signs didn't match": the street disagrees with the city data
//
// They never change which curb CurbPilot recommends (that stays the same
// sign-based answer every time). They are shown next to it, so a driver sees
// that others confirmed a spot, or that someone found the signs different,
// and "wrong" reports are kept in one list for a person to check and fix.
//
// Storage: Upstash Redis over its REST API (KV_REST_API_URL / KV_REST_API_TOKEN,
// set by Vercel's Upstash integration, or UPSTASH_REDIS_REST_URL / _TOKEN).
// Without it: kept in memory, which is fine locally but would lose reports on
// Vercel, so there reports are switched off until a store is connected.

const KINDS = ['ok', 'full', 'wrong'];
const KEEP_PER_FACE = 200;
const KEEP_WRONG = 1000;
const MAX_AGE_DAYS = 90;
const FULL_WINDOW_MIN = 60; // "full around this time": within an hour of the arrival time
const FULL_MAX_AGE_DAYS = 60;
const DAY_MS = 864e5;

const faceKey = (id) => `reports:face:${id}`;
const WRONG_KEY = 'reports:wrong';

function upstashStore(url, token) {
  async function pipeline(commands) {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`Report store HTTP ${res.status}`);
    const out = await res.json();
    const failed = out.find((r) => r.error);
    if (failed) throw new Error(`Report store: ${failed.error}`);
    return out.map((r) => r.result);
  }
  const parse = (items) =>
    (items || []).flatMap((s) => {
      try {
        return [JSON.parse(s)];
      } catch {
        return [];
      }
    });
  return {
    kind: 'upstash',
    async add(id, report) {
      const json = JSON.stringify(report);
      const commands = [
        ['LPUSH', faceKey(id), json],
        ['LTRIM', faceKey(id), 0, KEEP_PER_FACE - 1],
      ];
      if (report.k === 'wrong') {
        commands.push(['LPUSH', WRONG_KEY, JSON.stringify({ id, ...report })], ['LTRIM', WRONG_KEY, 0, KEEP_WRONG - 1]);
      }
      await pipeline(commands);
    },
    async recent(ids) {
      if (!ids.length) return new Map();
      const lists = await pipeline(ids.map((id) => ['LRANGE', faceKey(id), 0, KEEP_PER_FACE - 1]));
      return new Map(ids.map((id, i) => [id, parse(lists[i])]));
    },
    async wrongList() {
      const [items] = await pipeline([['LRANGE', WRONG_KEY, 0, KEEP_WRONG - 1]]);
      return parse(items);
    },
  };
}

function memoryStore() {
  const byFace = new Map();
  const wrong = [];
  return {
    kind: 'memory',
    async add(id, report) {
      const list = byFace.get(id) || [];
      list.unshift(report);
      byFace.set(id, list.slice(0, KEEP_PER_FACE));
      if (report.k === 'wrong') wrong.unshift({ id, ...report });
    },
    async recent(ids) {
      return new Map(ids.map((id) => [id, byFace.get(id) || []]));
    },
    async wrongList() {
      return wrong.slice(0, KEEP_WRONG);
    },
  };
}

// The store for this process, or null when reports are off.
function createStore(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore(url, token);
  if (env.VERCEL && env.CURBPILOT_REPORTS !== 'memory') return null;
  return memoryStore();
}

function ago(ms) {
  const days = Math.floor(ms / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

// Minutes between two times of day, the short way round midnight.
function clockGap(a, b) {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

// Reports on one face -> what to show next to it: { confirmed, wrong, full, notes }.
// `minute` is the arrival time, for "full around this time".
function summarize(reports, minute, now = Date.now()) {
  const recent = reports.filter((r) => KINDS.includes(r.k) && now - r.t <= MAX_AGE_DAYS * DAY_MS && now >= r.t - DAY_MS);
  const of = (k) => recent.filter((r) => r.k === k);
  const ok = of('ok');
  const wrong = of('wrong');
  const full = of('full').filter((r) => now - r.t <= FULL_MAX_AGE_DAYS * DAY_MS && clockGap(r.m, minute) <= FULL_WINDOW_MIN);
  const latest = (list) => Math.max(...list.map((r) => r.t));
  const notes = [];
  if (wrong.length) {
    const fixedSince = ok.length && latest(ok) > latest(wrong);
    notes.push({
      tone: 'warn',
      text: `${wrong.length === 1 ? 'A driver' : `${wrong.length} drivers`} reported the signs here don't match (last ${ago(now - latest(wrong))})${
        fixedSince ? ', but a driver parked fine here since' : ''
      }. Read the sign before you stop.`,
    });
  }
  if (ok.length) {
    notes.push({
      tone: 'good',
      text: `Confirmed by drivers ${times(ok.length)} in the last ${MAX_AGE_DAYS} days (last ${ago(now - latest(ok))}).`,
    });
  }
  if (full.length) {
    notes.push({ tone: 'info', text: `Reported full around this time ${times(full.length)} recently. Keep a backup in mind.` });
  }
  return { confirmed: ok.length, wrong: wrong.length, full: full.length, notes };
}

module.exports = { KINDS, createStore, memoryStore, summarize };
