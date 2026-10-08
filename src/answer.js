// Builds the plain-English answer a driver sees for one address and time.

const { distanceToSegment } = require('./geo');
const { KINDS, describeRule, formatClock } = require('./rules');
const { statusAt, nextChange, nextLegal, timeLimit, RANK } = require('./blockface');
const { normalizeStreet, prettyStreet, sideName } = require('./streets');

const NEARBY_METERS = 200; // about one avenue block / two street blocks
const COVERAGE_METERS = 300; // farther than this from any known curb = outside pilot area
const WALK_METERS_PER_MIN = 80;

function blockKey(face) {
  const ends = [normalizeStreet(face.from), normalizeStreet(face.to)].sort();
  return `${normalizeStreet(face.street)}|${ends.join('|')}`;
}

function faceDistance(face, point) {
  const [a, b] = face.line;
  return distanceToSegment(point, a, b || a);
}

function faceLabel(face, { withBlock = true } = {}) {
  const base = `the ${sideName(face.side)} side of ${prettyStreet(face.street)}`;
  if (!withBlock || !face.from || !face.to) return base;
  return `${base} (between ${prettyStreet(face.from)} & ${prettyStreet(face.to)})`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function untilPhrase(change, when) {
  if (!change) return 'for the next 24 hours';
  const clock = formatClock(change.minute);
  if (change.day === when.day) return `until ${clock}`;
  if (change.minute === 0 && change.ahead <= 1440) return 'until midnight';
  return `until ${clock} tomorrow`;
}

function atPhrase(at, when) {
  const clock = formatClock(at.minute);
  return at.day === when.day ? `at ${clock}` : `at ${clock} tomorrow`;
}

function limitPhrase(minutes) {
  if (!minutes) return '';
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function joinRules(rules) {
  const unique = [...new Map(rules.map((r) => [describeRule(r), r])).keys()];
  return unique.join('; ');
}

// One sentence on what the van may do on this face right now.
function describeStatus(face, status, when) {
  const until = untilPhrase(nextChange(face, when.day, when.minute), when);
  const limit = limitPhrase(timeLimit(status));
  switch (status.category) {
    case 'park': {
      const commercial = status.park.some((r) => r.kind === 'commercial_parking');
      const paid = status.park.some((r) => r.paid);
      const what = commercial
        ? 'Commercial vehicle parking is allowed'
        : `${paid ? 'Metered' : 'Time-limited'} parking is allowed (commercial vans OK)`;
      return `${what} ${until}${limit ? `, ${limit}` : ''}${paid ? ' — pay at the meter' : ''}.`;
    }
    case 'free':
      // Citywide rules for commercial vehicles still apply where no sign is posted.
      return `No posted parking restriction ${until}. City rules for commercial vans still apply: 3-hour limit, and no parking 9 PM–5 AM on residential streets.`;
    case 'load': {
      const trucks = status.load.every((r) => r.kind === 'truck_loading');
      if (trucks) {
        return `Truck loading/unloading is allowed ${until}${limit ? `, ${limit}` : ''}. Only while loading or unloading.`;
      }
      return `It's "${joinRules(status.load)}", but a commercial van may stop ${until} to make a delivery — only while actively loading or unloading, then move.`;
    }
    case 'mixed': {
      // Usual Midtown block: no standing near the corners, meters or loading mid-block.
      const allowed = allowedPart(status);
      const what = describeStatus(face, allowed, when);
      return `On the ${stretchName(allowed)} stretch: ${lowerFirst(what)} The rest of this side is ${joinRules(
        status.forbid
      )}. Only stop under a sign that allows it.`;
    }
    case 'check':
      return `Has a sign CurbPilot can't read ("${status.unknown[0].text}"). Read it before you stop.`;
    case 'no':
    default: {
      // Other signs on this side (e.g. meters) that aren't in effect now: their
      // stretch may be free, but the city data can't confirm it, so stay cautious.
      const idle = face.rules.filter((r) => ['park', 'load'].includes(KINDS[r.kind].effect) && !status.load.includes(r) && !status.park.includes(r));
      if (!idle.length) return `${capitalize(joinRules(status.forbid))}.`;
      return `${capitalize(joinRules(status.forbid))} on part of this side; the other signs (${joinRules(idle)}) aren't in effect now, so CurbPilot can't confirm the rest. Check the sign at your spot.`;
    }
  }
}

// The legal part of a "mixed" side, as a status of its own.
function allowedPart(status) {
  return status.park.length
    ? { category: 'park', forbid: [], load: [], park: status.park, unknown: [] }
    : { category: 'load', forbid: [], load: status.load, park: [], unknown: [] };
}

function stretchName(allowed) {
  if (allowed.category === 'park') {
    if (allowed.park.some((r) => r.kind === 'commercial_parking')) return '"commercial vehicles only"';
    return allowed.park.some((r) => r.paid) ? 'metered' : 'time-limited parking';
  }
  return allowed.load.every((r) => r.kind === 'truck_loading') ? '"truck loading"' : '"no parking"';
}

// A mixed side still has a legal stretch, so it ranks with loading zones
// (or just above, when the legal stretch is parking).
function faceRank(status) {
  if (status.category !== 'mixed') return RANK[status.category];
  return status.park.length ? RANK.load + 0.5 : RANK.load;
}

function evaluateFace(face, point, when) {
  const status = statusAt(face, when.day, when.minute);
  return {
    face,
    status,
    distance: faceDistance(face, point),
    rank: faceRank(status),
    label: faceLabel(face),
    text: describeStatus(face, status, when),
  };
}

function walk(meters) {
  const mins = Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
  return `about ${Math.round(meters / 10) * 10} m, ${mins} min walk`;
}

function buildAnswer({ place, faces, when, meta = {} }) {
  const point = [place.lat, place.lon];
  const withDist = faces
    .map((face) => ({ face, distance: faceDistance(face, point) }))
    .sort((a, b) => a.distance - b.distance);

  const caveats = [
    'Always obey the sign at your exact spot. Hydrants (15 ft), crosswalks, driveways and bus stops are not in the sign data.',
    'Holiday rule suspensions are not applied — answers assume a normal day.',
  ];
  if (meta.demo) caveats.unshift('DEMO DATA: these are sample signs, not real NYC signs. Do not rely on them.');

  if (!withDist.length || withDist[0].distance > COVERAGE_METERS) {
    return {
      ok: false,
      verdict: 'outside',
      summary: `CurbPilot has no curb sign data within ${COVERAGE_METERS} m of this address. It covers ${meta.area || 'the pilot area'}, wherever the city has sign records.`,
      caveats,
    };
  }

  // The address's own block: nearest face on the address's street, plus the far side.
  const street = normalizeStreet(place.street);
  const homeAnchor =
    withDist.find((x) => street && normalizeStreet(x.face.street) === street && x.distance <= NEARBY_METERS) || withDist[0];
  const homeKey = blockKey(homeAnchor.face);

  const home = faces.filter((f) => blockKey(f) === homeKey).map((f) => evaluateFace(f, point, when));
  home.sort((a, b) => b.rank - a.rank || a.distance - b.distance);
  const nearby = withDist
    .filter((x) => x.distance <= NEARBY_METERS && blockKey(x.face) !== homeKey)
    .map((x) => evaluateFace(x.face, point, when));

  const blockName = `${prettyStreet(homeAnchor.face.street)}${
    homeAnchor.face.from && homeAnchor.face.to
      ? ` (${prettyStreet(homeAnchor.face.from)} to ${prettyStreet(homeAnchor.face.to)})`
      : ''
  }`;
  const doNot = home
    .filter((x) => x.rank < RANK.load)
    .map((x) => ({ label: x.label, text: x.text, category: x.status.category }));
  const usedAi = [...home, ...nearby].some((x) => x.face.rules.some((r) => r.source === 'ai'));
  if (usedAi) caveats.push('Some signs here were interpreted by AI from the city data. Double-check them on the street.');

  const best = home[0];
  let verdict;
  let recommendation = null;
  let summaryParts = [];
  const alternatives = [];

  if (best && best.rank >= RANK.load) {
    const legal = best.status.category === 'mixed' ? allowedPart(best.status).category : best.status.category;
    verdict = legal === 'load' ? 'load' : 'go';
    recommendation = { label: best.label, text: best.text, category: best.status.category };
    const action = verdict === 'load' ? 'Stop on' : 'Park on';
    summaryParts.push(`${action} ${faceLabel(best.face, { withBlock: false })}. ${best.text}`);
    for (const x of doNot) summaryParts.push(`Do NOT park on ${x.label.replace(/ \(between.*\)$/, '')}: ${lowerFirst(x.text)}`);
    // Also list a second legal side on the same block if there is one.
    for (const x of home.slice(1).filter((h) => h.rank >= RANK.load)) {
      alternatives.push({ label: x.label, text: x.text, category: x.status.category });
    }
  } else {
    const legalNearby = nearby.filter((x) => x.rank >= RANK.load).sort((a, b) => a.distance - b.distance);
    for (const x of doNot) summaryParts.push(`Do NOT park on ${x.label.replace(/ \(between.*\)$/, '')}: ${lowerFirst(x.text)}`);
    if (legalNearby.length) {
      verdict = 'nearby';
      const alt = legalNearby[0];
      recommendation = { label: alt.label, text: alt.text, category: alt.status.category, distance: walk(alt.distance) };
      summaryParts.unshift(
        `Nothing legal on ${blockName} at ${formatClock(when.minute)}. Closest legal option: ${alt.label}, ${walk(alt.distance)}. ${alt.text}`
      );
      for (const x of legalNearby.slice(1, 3)) {
        alternatives.push({ label: x.label, text: x.text, category: x.status.category, distance: walk(x.distance) });
      }
    } else {
      verdict = 'none';
      const soonest = [...home, ...nearby]
        .map((x) => ({ x, at: nextLegal(x.face, when.day, when.minute) }))
        .filter((y) => y.at)
        .sort((a, b) => a.at.ahead - b.at.ahead || a.x.distance - b.x.distance)[0];
      let line = `WARNING: no legal place to stop within a block of this address at ${formatClock(when.minute)}. Stopping here risks a ticket.`;
      if (soonest) line += ` Earliest legal option: ${soonest.x.label} ${atPhrase(soonest.at, when)}.`;
      summaryParts.unshift(line);
    }
  }

  return {
    ok: true,
    verdict,
    summary: summaryParts.join(' '),
    recommendation,
    doNot,
    alternatives,
    caveats,
    block: blockName,
  };
}

function lowerFirst(s) {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

module.exports = { buildAnswer, describeStatus, faceLabel, blockKey };
