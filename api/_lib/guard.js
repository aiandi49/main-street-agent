// Shared request guards for /api functions.
// Files in api/_lib are not deployed as routes (Vercel skips paths that start with "_").

export const MAX_BODY_BYTES = 32 * 1024;
export const RATE_LIMIT = { windowMs: 600 * 1000, max: 20 }; // matches the Vercel Firewall rule in the README

export function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

// Blocks other websites from calling this endpoint from a visitor's browser.
// It does NOT stop scripts or servers (they can fake headers), which is why
// rate limits and a spend cap are still required.
export function originAllowed(req) {
  const origin = firstHeader(req.headers.origin);
  if (!origin) return false;
  let originHost;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host))) return false;
    originHost = u.host.toLowerCase();
  } catch {
    return false;
  }
  const allowed = new Set();
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  if (host) allowed.add(host.split(',')[0].trim().toLowerCase());
  const extra = process.env.ALLOWED_ORIGINS || '';
  for (const item of extra.split(',')) {
    const v = item.trim();
    if (!v) continue;
    try { allowed.add(new URL(v).host.toLowerCase()); } catch { /* ignore malformed entries */ }
  }
  return allowed.has(originHost);
}

export function clientIp(req) {
  const fwd = firstHeader(req.headers['x-forwarded-for']);
  if (fwd) return fwd.split(',')[0].trim();
  return firstHeader(req.headers['x-real-ip']) || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Best-effort in-memory limiter. Each serverless instance keeps its own counts,
// so the Vercel Firewall rule is the real enforcement layer.
// Each endpoint passes its own bucket name so one route's traffic never uses up another's.
const buckets = new Map();
export function rateLimited(key, bucket = 'chat', limit = RATE_LIMIT) {
  if (!buckets.has(bucket)) buckets.set(bucket, new Map());
  const hits = buckets.get(bucket);
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > limit.windowMs) {
    hits.set(key, { start: now, count: 1 });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start > limit.windowMs) hits.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > limit.max;
}

export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(firstHeader(req.headers['content-length']) || 0);
    if (declared > limit) {
      reject(Object.assign(new Error('too large'), { status: 413 }));
      return;
    }
    let size = 0;
    const chunks = [];
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      reject(Object.assign(new Error('read error'), { status: 400 }));
    });
  });
}
