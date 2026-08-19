/* ==========================================================================
   AraBuzz — api/speak.js
   A real voice, because Apple will not lend us one.

   AraBuzz reads a great deal aloud: the word, the school's definition, the
   correction when a spelling goes wrong. On most devices the browser's own
   voice is adequate and costs nothing, so that is what it uses. On an iPad it
   is not adequate — and worse, it cannot be fixed. Apple lets a NATIVE app
   use the Enhanced and Premium voices a parent downloads, but does not hand
   them to a web app at all; the browser sees a small default set and nothing
   a website does can change that. Prem downloaded 400 MB of Premium voices
   and AraBuzz could not see one of them.

   So the audio is made here instead, and the device just plays it.

   THE THING THAT KEEPS THIS CHEAP: every line is spoken once, ever. The text
   is hashed, the audio is kept in Supabase Storage under that hash, and every
   later request for the same words — the same word, the same definition, the
   same "have another go" — is served from storage without the voice service
   being called at all. A week's sheet costs a few seconds of speech in total,
   and then costs nothing for the rest of the week.

   If AZURE_SPEECH_KEY is not set, this endpoint politely says so and the app
   falls straight back to the device's own voice. Nothing breaks.
   ========================================================================== */

import { whoIs, serviceCount, rpcAsUser, send } from './_lib.js';
import crypto from 'node:crypto';

const SUPA    = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ---------------------------------------------------------------- the voice
   Azure rather than Google, for one unglamorous reason: Azure authenticates
   with a single key string, the same shape as every other key AraBuzz
   already holds, while Google wants a downloaded service-account file turned
   into a signed token. Prem sets this up, not a developer, and one string
   pasted into Vercel is a setup that works the first time.

   Its neural voices are also genuinely good, and the free allowance —
   500,000 characters a month, permanently — is far more than nine children
   can speak once every repeated line is cached. */
const AZ_KEY    = process.env.AZURE_SPEECH_KEY;
const AZ_REGION = process.env.AZURE_SPEECH_REGION || 'southeastasia';
const VOICE     = process.env.TTS_VOICE || 'en-GB-SoniaNeural';

const BUCKET    = 'tts';
const MAX_CHARS = 600;                  // one line of Ara, generously
const DAY_LINES = 400;                  // per family, per day

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 40);
const xml  = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                             .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fromStore(name) {
  const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${name}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` }
  });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

async function toStore(name, buf) {
  const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE, authorization: `Bearer ${SERVICE}`,
      'content-type': 'audio/mpeg', 'x-upsert': 'true'
    },
    body: buf
  });
  if (!r.ok) console.warn('[speak] could not cache', r.status, (await r.text()).slice(0, 160));
}

/** Rate as Azure wants it: a percentage either side of normal. */
function ratePct(rate) {
  const pct = Math.round((rate - 1) * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

async function synthesise(text, rate) {
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${VOICE.slice(0, 5)}">` +
      `<voice name="${VOICE}">` +
        `<prosody rate="${ratePct(rate)}">${xml(text)}</prosody>` +
      `</voice>` +
    `</speak>`;

  const r = await fetch(`https://${AZ_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZ_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'AraBuzz'
    },
    body: ssml
  });
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`voice service said ${r.status}: ${body.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('voice service returned no audio');
  return buf;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!AZ_KEY) return send(res, 503, { error: 'no-voice-service' });

  const who = await whoIs(req);
  if (!who || !who.parent) return send(res, 401, { error: 'Please sign in again.' });

  const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim();
  if (!text) return send(res, 400, { error: 'Nothing to say.' });
  if (text.length > MAX_CHARS) return send(res, 400, { error: 'Too long to read.' });

  /* Speed is part of the recording, so it is part of the identity: the same
     sentence read slowly is a different file from the same sentence read at
     normal pace, and both are worth keeping. */
  const rate = Math.min(1.4, Math.max(0.5, Number(req.body && req.body.rate) || 0.95));
  const name = `${VOICE}/${rate.toFixed(2)}/${hash(VOICE + '|' + rate.toFixed(2) + '|' + text)}.mp3`;

  try {
    /* ---- 1 · has anyone, in any family, ever said this before? ---------
       Words and definitions are shared across every child on the same sheet,
       so the second family to reach a word pays nothing for it. The cache
       key is the text itself, which is what makes that safe: identical words
       in, identical audio out. */
    const cached = await fromStore(name);
    if (cached) {
      res.setHeader('content-type', 'audio/mpeg');
      res.setHeader('cache-control', 'private, max-age=31536000, immutable');
      res.setHeader('x-arabuzz-cache', 'hit');
      return res.status(200).send(cached);
    }

    /* ---- 2 · a genuinely new line. Check the day's allowance first. ---- */
    const since = new Date(Date.now() - 864e5).toISOString();
    const spoken = await serviceCount(
      `api_usage?family_id=eq.${who.parent.family_id}&kind=eq.speak&ts=gte.${encodeURIComponent(since)}&select=id`);
    if (spoken >= DAY_LINES) return send(res, 429, { error: 'daily-limit' });

    const audio = await synthesise(text, rate);
    await toStore(name, audio);

    /* Recorded so the Usage tab tells the truth about every kind of spend,
       not just the AI. Characters go in the token column — it is the unit
       this service actually charges by. */
    try {
      await rpcAsUser(who.token, 'record_usage', {
        p_kind: 'speak', p_model: VOICE,
        p_in_tok: text.length, p_out_tok: 0,
        p_cost: (text.length / 1e6) * 16,       // neural voices, per million characters
        p_scope: 'individual',
        p_child_id: (req.body && req.body.childId) || null,
        p_deck_id: null, p_detail: null
      });
    } catch (e) { console.warn('[speak] usage not recorded', e.message); }

    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'private, max-age=31536000, immutable');
    res.setHeader('x-arabuzz-cache', 'miss');
    return res.status(200).send(audio);
  } catch (e) {
    /* Never fatal. The device has a voice of its own, and a child mid-game
       must never be left in silence because a third party had a bad minute. */
    console.warn('[speak]', e.message);
    return send(res, 502, { error: 'voice-unavailable' });
  }
}
