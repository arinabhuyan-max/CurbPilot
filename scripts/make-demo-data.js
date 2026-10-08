#!/usr/bin/env node
// Generates a small, ILLUSTRATIVE sample of sign rows around W 28th St (the
// Flower District) so the app runs before the real city data is fetched.
// The sign wording follows NYC DOT's format, but which sign is on which curb is
// made up. Never use demo answers for real deliveries.
//
//   npm run demo-data   -> data/raw-demo.json -> data/demo.json

const fs = require('fs');
const path = require('path');
const { build } = require('./build-data');

// Approximate Manhattan grid around 6th Ave & W 34th St. Streets run ~29° off
// true east-west; one street block ≈ 80 m, one avenue block ≈ 280 m.
const ORIGIN = [40.74967, -73.98782]; // 6th Ave & W 34th St
const PER_STREET = [0.000629, 0.00046]; // one block north (uptown)
const PER_AVENUE = [0.00122, -0.0029]; // one avenue west
const AVE_INDEX = { '5 AVE': -1, '6 AVE': 0, '7 AVE': 1, '8 AVE': 2 };

function corner(ave, street) {
  const a = AVE_INDEX[ave];
  const s = street - 34;
  return [ORIGIN[0] + s * PER_STREET[0] + a * PER_AVENUE[0], ORIGIN[1] + s * PER_STREET[1] + a * PER_AVENUE[1]];
}

const SIDE_OFFSET = 10 / 80; // ~10 m from the street centerline, in street-block units
function offset(point, side) {
  const [north, west] = [PER_STREET, PER_AVENUE.map((v) => v * (80 / 280))];
  const dir = { N: north, S: north.map((v) => -v), W: west, E: west.map((v) => -v) }[side];
  return [point[0] + dir[0] * SIDE_OFFSET, point[1] + dir[1] * SIDE_OFFSET];
}

const ST = (n) => `W ${n} ST`;
const EVERY_DAY_BUT_SUN = 'EXCEPT SUNDAY';

// [on street, from, to, side, [sign texts]]
const FACES = [
  [ST(28), '6 AVE', '7 AVE', 'N', [
    `3 HOUR COMMERCIAL VEHICLES ONLY PAY AT MUNI-METER 7AM-7PM ${EVERY_DAY_BUT_SUN} <---->`,
    'NO PARKING (SANITATION BROOM SYMBOL) 8:30AM-10AM TUES & FRI <->',
  ]],
  [ST(28), '6 AVE', '7 AVE', 'S', [
    `NO STANDING 4PM-7PM ${EVERY_DAY_BUT_SUN} <---->`,
    `3 HOUR COMMERCIAL VEHICLES ONLY PAY AT MUNI-METER 7AM-4PM ${EVERY_DAY_BUT_SUN}`,
  ]],
  [ST(27), '6 AVE', '7 AVE', 'N', ['NO STANDING EXCEPT TRUCKS LOADING & UNLOADING 7AM-7PM MON THRU FRI <->']],
  [ST(27), '6 AVE', '7 AVE', 'S', ['NO STANDING ANYTIME <->']],
  [ST(29), '6 AVE', '7 AVE', 'N', [`2 HMP PASSENGER VEHICLES ONLY 9AM-7PM ${EVERY_DAY_BUT_SUN}`]],
  [ST(29), '6 AVE', '7 AVE', 'S', [`NO PARKING 7AM-7PM ${EVERY_DAY_BUT_SUN}`]],
  [ST(26), '6 AVE', '7 AVE', 'N', [`NO STANDING 7AM-7PM ${EVERY_DAY_BUT_SUN}`]],
  [ST(26), '6 AVE', '7 AVE', 'S', [`NO STOPPING 7AM-7PM ${EVERY_DAY_BUT_SUN}`]],
  ['6 AVE', ST(26), ST(27), 'W', ['NO STANDING ANYTIME']],
  ['6 AVE', ST(26), ST(27), 'E', ['NO STANDING ANYTIME']],
  ['6 AVE', ST(27), ST(28), 'W', [`NO STANDING 7AM-7PM ${EVERY_DAY_BUT_SUN}`]],
  ['6 AVE', ST(27), ST(28), 'E', ['BUS STOP']],
  ['6 AVE', ST(28), ST(29), 'W', [
    `NO STOPPING 7AM-10AM 4PM-7PM ${EVERY_DAY_BUT_SUN}`,
    `1 HOUR COMMERCIAL VEHICLES ONLY PAY AT MUNI-METER 10AM-4PM ${EVERY_DAY_BUT_SUN}`,
  ]],
  ['6 AVE', ST(28), ST(29), 'E', [`NO STANDING EXCEPT TRUCKS LOADING & UNLOADING 7AM-7PM ${EVERY_DAY_BUT_SUN}`]],
  ['7 AVE', ST(26), ST(27), 'E', ['NO STANDING ANYTIME']],
  ['7 AVE', ST(26), ST(27), 'W', ['NO STANDING ANYTIME']],
  ['7 AVE', ST(27), ST(28), 'E', ['NO STANDING EXCEPT TRUCKS LOADING & UNLOADING 7AM-10AM MON-FRI', 'NO STANDING 10AM-7PM MON-FRI']],
  ['7 AVE', ST(27), ST(28), 'W', ['NO STANDING ANYTIME']],
  ['7 AVE', ST(28), ST(29), 'E', ['SPECIAL EVENT REGULATION SEE SUPPLEMENTARY PLATE', 'NO PARKING 8AM-6PM MON-FRI']],
  ['7 AVE', ST(28), ST(29), 'W', [`NO STANDING 7AM-7PM ${EVERY_DAY_BUT_SUN}`]],
];

function endpoints(on, from, to) {
  if (on.endsWith('AVE')) return [corner(on, Number(from.split(' ')[1])), corner(on, Number(to.split(' ')[1]))];
  const n = Number(on.split(' ')[1]);
  return [corner(from, n), corner(to, n)];
}

const rows = [];
for (const [on, from, to, side, texts] of FACES) {
  const [a, b] = endpoints(on, from, to);
  const fractions = [0.15, 0.5, 0.85];
  for (const f of fractions) {
    const p = offset([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], side);
    for (const text of texts) {
      rows.push({ on_street: on, from_street: from, to_street: to, side, text, lat: p[0], lon: p[1] });
    }
  }
}

const dataDir = path.join(__dirname, '..', 'data');
const rawFile = path.join(dataDir, 'raw-demo.json');
fs.writeFileSync(rawFile, JSON.stringify({ source: 'demo', rows }, null, 1));
build(rawFile, path.join(dataDir, 'demo.json'), { demo: true });
