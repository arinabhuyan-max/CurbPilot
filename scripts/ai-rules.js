// AI step of the pipeline: Claude reads the sign texts our rule parser couldn't,
// and returns the same structured rule the parser produces. Results are cached
// in data/ai-rules-cache.json so each distinct sign text is only sent once, and
// so a person can review (and correct) every AI reading before it ships.
//
// Runtime answers never call the AI: drivers get deterministic rule evaluation.

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', 'data', 'ai-rules-cache.json');
const MODEL = process.env.CURBPILOT_MODEL || 'claude-opus-5-5';

const RULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'windows', 'days', 'limitMinutes', 'paid', 'confident'],
  properties: {
    kind: {
      type: 'string',
      enum: [
        'no_stopping',
        'no_standing',
        'passenger_only',
        'no_parking',
        'truck_loading',
        'commercial_parking',
        'limited_parking',
        'info',
        'unknown',
      ],
    },
    windows: {
      description: 'Time windows in minutes after midnight (end may be 1440). Empty array = all day.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end'],
        properties: { start: { type: 'integer' }, end: { type: 'integer' } },
      },
    },
    days: {
      description: 'Weekdays the rule applies, 0=Sunday..6=Saturday. Empty array = every day.',
      type: 'array',
      items: { type: 'integer' },
    },
    limitMinutes: { type: ['integer', 'null'] },
    paid: { type: 'boolean' },
    confident: { type: 'boolean', description: 'false if the sign text is ambiguous or incomplete' },
  },
};

const SYSTEM = `You convert New York City parking sign text (from the NYC DOT sign database) into a structured rule, from the point of view of a commercial delivery van.

Kinds:
- no_stopping: no stopping at all.
- no_standing: no standing, including bus stops, taxi stands, hotel loading zones and spaces reserved for authorized/permit vehicles.
- passenger_only: parking only for passenger vehicles (commercial vans not allowed).
- no_parking: "No Parking" (incl. street cleaning). Commercial vans may still stop briefly to load/unload.
- truck_loading: "No Standing/No Parking Except Trucks Loading & Unloading".
- commercial_parking: parking for commercial vehicles (metered or not).
- limited_parking: general time-limited or metered parking that commercial vans may use.
- info: not a parking regulation (route markers, one-way, building line, etc).
- unknown: anything you cannot classify with confidence.

Use NYC wall-clock time. If the text is ambiguous, refers to a supplementary plate you cannot see, or you are unsure, set confident=false. A wrong answer causes a driver to get a ticket, so prefer "unknown" over guessing.`;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function toRule(text, out) {
  if (!out.confident) return null;
  return {
    kind: out.kind,
    windows: out.windows.length ? out.windows : null,
    days: out.days.length && out.days.length < 7 ? [...out.days].sort() : null,
    limitMinutes: out.limitMinutes,
    paid: out.paid,
    text,
    source: 'ai',
  };
}

async function readSign(client, text) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: RULE_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Sign text: ${text}` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const block = response.content.find((b) => b.type === 'text');
  return block ? JSON.parse(block.text) : null;
}

// texts: distinct sign texts the parser marked "unknown".
// Returns Map(text -> rule) for the ones Claude read confidently.
async function aiReadSigns(texts) {
  const cache = loadCache();
  const todo = texts.filter((t) => !(t in cache));
  if (todo.length) {
    let Anthropic;
    try {
      Anthropic = require('@anthropic-ai/sdk');
    } catch {
      throw new Error('AI step needs the Anthropic SDK: run `npm install` first.');
    }
    const client = new Anthropic();
    for (const [i, text] of todo.entries()) {
      process.stdout.write(`  AI reading sign ${i + 1}/${todo.length}: ${text.slice(0, 60)}\n`);
      try {
        cache[text] = await readSign(client, text);
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new Error('Anthropic API key missing or invalid.');
        if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.APIConnectionError) {
          console.warn(`  skipped (retry later): ${err.message}`);
          continue;
        }
        throw err;
      }
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    }
  }
  const result = new Map();
  for (const t of texts) {
    const rule = cache[t] ? toRule(t, cache[t]) : null;
    if (rule) result.set(t, rule);
  }
  return result;
}

module.exports = { aiReadSigns, RULE_SCHEMA };
