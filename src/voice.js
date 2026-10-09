// Parker, the voice assistant (Vapi). The page starts a Vapi web call with the
// assistant built here; when the driver says an address, Vapi calls our
// check_curb tool (POST /api/vapi/tool) and Parker speaks the result.
//
// Settings (Vercel → Settings → Environment Variables):
//   VAPI_PUBLIC_KEY   required to turn voice on (Vapi's *public* key, meant for browsers)
//   VAPI_MODEL        Claude model on Vapi (default claude-sonnet-5: fast enough for voice)
//   VAPI_VOICE_PROVIDER + VAPI_VOICE_ID   optional; Vapi's default voice otherwise

const DEFAULT_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'check_curb';

const SYSTEM_PROMPT = `You are Parker, CurbPilot's friendly voice assistant for New York City delivery drivers in commercial vans.
The driver is probably driving. Keep every reply to one or two short spoken sentences in plain language: no lists, symbols or abbreviations read letter by letter.
Your one job: tell the driver where their van can legally stop near a delivery address, to help them avoid parking tickets.
If you don't know the delivery address yet, ask for it (street address and borough).
When you have it, call ${TOOL_NAME}. Pass arrival_time only if the driver said when they will arrive, as 24-hour NYC time like 17:30; otherwise leave it out for "now".
Then say the recommended spot and its time limit. Mention the first backup spot in case it is full; give more backups only if asked.
Only repeat what ${TOOL_NAME} returned. Never invent or guess parking rules. If the result says to check a sign, say so.
Remind the driver to always obey the sign where they stop. Never ask the driver to look at or type on the phone while driving.
If asked about anything else, answer briefly and steer back to parking.`;

function voiceAssistant(toolUrl, env = process.env) {
  const tool = {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description:
        'Look up where a commercial delivery van can legally park or stop near a New York City address right now or at an arrival time. Returns a short spoken answer with the recommended spot, time limits and backup spots.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Delivery street address with borough, e.g. "120 West 28th Street, Manhattan".' },
          arrival_time: { type: 'string', description: 'Optional arrival time today in 24-hour NYC time, e.g. "17:30". Omit for now.' },
        },
        required: ['address'],
      },
    },
    server: { url: toolUrl },
  };

  const assistant = {
    name: 'Parker',
    firstMessage: "Hi, I'm Parker. What's the delivery address?",
    model: {
      provider: 'anthropic',
      model: env.VAPI_MODEL || DEFAULT_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }],
      tools: [tool],
    },
  };
  if (env.VAPI_VOICE_PROVIDER && env.VAPI_VOICE_ID) {
    assistant.voice = { provider: env.VAPI_VOICE_PROVIDER, voiceId: env.VAPI_VOICE_ID };
  }
  return assistant;
}

// Turn a CurbPilot answer into something short and natural to say out loud.
function spokenAnswer(r) {
  if (!r || r.error) return (r && r.error) || "Sorry, I couldn't check that address.";
  const clean = (t) =>
    String(t)
      .replace(/—/g, ',')
      .replace(/\bWARNING:\s*/i, 'Heads up: ')
      .replace(/\s+/g, ' ')
      .trim();
  const parts = [clean(r.summary)];
  const backups = r.backups || [];
  backups.forEach((b, i) => {
    parts.push(`Backup ${i + 1} if that's full: ${b.label}, ${b.distance}. ${clean(b.text)}`);
  });
  parts.push('Always obey the sign where you stop.');
  return parts.join(' ');
}

// Vapi "tool-calls" webhook body -> list of { id, name, args }.
function readToolCalls(body) {
  const message = (body && body.message) || {};
  const list = message.toolCallList || message.toolCalls || [];
  return list.map((tc) => {
    const fn = tc.function || {};
    let args = fn.arguments ?? tc.arguments ?? tc.parameters ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { id: tc.id, name: fn.name || tc.name, args: args || {} };
  });
}

module.exports = { voiceAssistant, spokenAnswer, readToolCalls, TOOL_NAME, DEFAULT_MODEL };
