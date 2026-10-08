// Street-name helpers. NYC data writes streets many ways ("WEST 28 STREET",
// "W 28TH ST", "AVENUE OF THE AMERICAS"); we normalize to one key ("W 28 ST",
// "6 AVE") for matching, and pretty-print it for drivers ("W 28th St").

const WORD_NUMBERS = {
  FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7,
  EIGHTH: 8, NINTH: 9, TENTH: 10, ELEVENTH: 11, TWELFTH: 12,
};

const SUFFIXES = [
  [/\bSTREET\b|\bSTR\b/g, 'ST'],
  [/\bAVENUE\b|\bAV\b/g, 'AVE'],
  [/\bPLACE\b/g, 'PL'],
  [/\bBOULEVARD\b/g, 'BLVD'],
  [/\bROAD\b/g, 'RD'],
];

function normalizeStreet(name) {
  if (!name) return '';
  let s = String(name).toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\bAVENUE OF THE AMERICAS\b|\bAVE OF THE AMERICAS\b/g, '6 AVENUE');
  s = s.replace(/\bWEST\b/g, 'W').replace(/\bEAST\b/g, 'E');
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    s = s.replace(new RegExp(`\\b${word}\\b`, 'g'), String(n));
  }
  s = s.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1');
  for (const [re, abbr] of SUFFIXES) s = s.replace(re, abbr);
  return s.replace(/\s+/g, ' ').trim();
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

const PRETTY_SUFFIX = { ST: 'St', AVE: 'Ave', PL: 'Pl', BLVD: 'Blvd', RD: 'Rd' };

function prettyStreet(name) {
  const s = normalizeStreet(name);
  return s
    .split(' ')
    .map((tok) => {
      if (/^\d+$/.test(tok)) return ordinal(Number(tok));
      if (tok === 'W' || tok === 'E') return tok;
      if (PRETTY_SUFFIX[tok]) return PRETTY_SUFFIX[tok];
      return tok.charAt(0) + tok.slice(1).toLowerCase();
    })
    .join(' ');
}

const SIDE_NAMES = { N: 'north', S: 'south', E: 'east', W: 'west' };

function sideName(side) {
  return SIDE_NAMES[String(side || '').toUpperCase().charAt(0)] || 'unknown';
}

module.exports = { normalizeStreet, prettyStreet, sideName, ordinal };
