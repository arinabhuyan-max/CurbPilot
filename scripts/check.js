#!/usr/bin/env node
// Command-line check, handy for the field test:
//   npm run check -- "120 W 28th St" 17:30
//   npm run check -- "120 W 28th St" 2026-10-14T08:45

const { checkCurb, loadData } = require('../src/checker');

const [address, when = 'now'] = process.argv.slice(2);
if (!address) {
  console.error('Usage: npm run check -- "<address>" [HH:MM | YYYY-MM-DDTHH:MM]');
  process.exit(1);
}

checkCurb({ address, when }, loadData(process.env.CURBPILOT_DATA), { offline: process.env.CURBPILOT_OFFLINE === '1' }).then((r) => {
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  console.log(`${r.address} · ${r.when}\n`);
  console.log(r.summary);
  (r.backups || []).forEach((a, i) => console.log(`\nBackup ${i + 1}: ${a.label} (${a.distance}). ${a.text}`));
  console.log(`\n${r.caveats.map((c) => `* ${c}`).join('\n')}`);
});
