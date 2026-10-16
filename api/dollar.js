import { sendJson, originAllowed, clientIp, rateLimited, readJsonBody } from './_lib/guard.js';
import { getDollarSnapshot } from './_lib/dollar-data.js';

// POST /api/dollar → the live "where the dollar stands" snapshot for the tracker page.
// Read-only: it fetches public data and never takes any action.
// The snapshot is cached for 15 minutes per server instance, so visitors don't hammer the data sources.
export const DOLLAR_LIMIT = { windowMs: 600 * 1000, max: 30 };
const OVERALL_TIMEOUT_MS = 20000; // shorter than maxDuration (30s) in vercel.json

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    return;
  }
  const ctype = String(req.headers['content-type'] || '').toLowerCase();
  if (!ctype.startsWith('application/json')) {
    sendJson(res, 415, { error: 'Please send JSON.' });
    return;
  }
  if (!originAllowed(req)) {
    sendJson(res, 403, { error: 'This data only loads on this website.' });
    return;
  }
  if (rateLimited(clientIp(req), 'dollar', DOLLAR_LIMIT)) {
    sendJson(res, 429, { error: 'Too many refreshes. Please wait a few minutes and try again.' }, { 'Retry-After': '600' });
    return;
  }
  try {
    await readJsonBody(req);
  } catch (err) {
    const status = err && err.status === 413 ? 413 : 400;
    sendJson(res, status, { error: 'The request could not be read.' });
    return;
  }

  let timer;
  try {
    const snap = await Promise.race([
      getDollarSnapshot(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), OVERALL_TIMEOUT_MS); }),
    ]);
    if (!snap || !snap.metrics || !snap.metrics.length) {
      console.error('dollar: status 502 (no sources available)');
      sendJson(res, 502, { error: 'The live data sources are not responding right now. Please try again in a few minutes.' });
      return;
    }
    sendJson(res, 200, snap);
  } catch {
    console.error('dollar: status 502 (timeout or error)');
    sendJson(res, 502, { error: 'The live data sources are not responding right now. Please try again in a few minutes.' });
  } finally {
    clearTimeout(timer);
  }
}
