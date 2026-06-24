// Serverless proxy for the "Flying Report" public posts API (contract v1).
//
// Why a proxy instead of fetching the API straight from the browser:
//   - keeps the upstream base URL in an env var (no hard-coded URL in client code;
//     a future custom domain is just an env change)
//   - adds a small server-side cache (5 min, matching the upstream CDN policy)
//   - graceful degradation WITHOUT fabricating content: on an upstream failure it
//     serves the last good response it has (stale-on-error); if it has none, it
//     returns an empty feed. A healthy-but-empty API (200, total:0, posts:[]) is
//     passed through untouched. The site therefore only ever shows real Flying
//     Report content or its "no news yet" state — never placeholder/mock posts.
//
// Client calls:  GET /api/news?lang=ja|en&limit=8
// Upstream:      GET {API_BASE}/api/public/posts?lang=ja|en&limit=&offset=
// Response shape: { lang, updated, total, limit, offset, source:'live'|'stale'|'error', posts:[...] }

const API_BASE = process.env.FLYING_REPORT_API_BASE || 'https://flying-report-manager.vercel.app';
const LIVE_TTL_MS = 5 * 60 * 1000; // cache real data for 5 minutes (matches upstream s-maxage)
const SOFT_TTL_MS = 60 * 1000;     // re-check sooner after a stale/empty fallback
const HARD_CAP = 50;               // upstream max limit per contract

// Fresh-window cache + most-recent-successful payload (for stale-on-error), keyed by lang:limit:offset.
const cache = {};    // { [key]: { at: number, ttl: number, payload: object } }
const lastGood = {}; // { [key]: payload }  — only updated on a successful upstream fetch

function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// Coerce one raw post into a safe, null-tolerant shape. Returns null if unusable.
// `type` and `tags` are kept verbatim (stable, untranslated identifiers) so unknown
// future values survive — the client decides how to display them.
function normalizePost(p) {
  if (!p || typeof p !== 'object') return null;
  const title = typeof p.title === 'string' ? p.title.trim() : '';
  if (!title) return null; // a post with no title is not worth showing
  return {
    id: p.id != null ? String(p.id) : null,
    type: typeof p.type === 'string' && p.type ? p.type : 'report',
    title,
    excerpt: typeof p.excerpt === 'string' ? p.excerpt : '',
    date: typeof p.date === 'string' && p.date ? p.date : null,
    url: typeof p.url === 'string' && p.url ? p.url : null,
    image: typeof p.image === 'string' && p.image ? p.image : null,
    tags: Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string') : [],
  };
}

function normalize(raw, lang, reqLimit, reqOffset) {
  const rawPosts = raw && Array.isArray(raw.posts) ? raw.posts : [];
  const posts = rawPosts
    .map(normalizePost)
    .filter(Boolean)
    .sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
    .slice(0, HARD_CAP);
  return {
    lang,
    updated: raw && typeof raw.updated === 'string' ? raw.updated : null,
    total: raw && Number.isFinite(raw.total) ? raw.total : posts.length,
    limit: raw && Number.isFinite(raw.limit) ? raw.limit : reqLimit,
    offset: raw && Number.isFinite(raw.offset) ? raw.offset : reqOffset,
    posts,
  };
}

function emptyFeed(lang, limit, offset) {
  return { lang, updated: null, total: 0, limit, offset, posts: [] };
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const q = req.query || {};
  const lang = q.lang === 'en' ? 'en' : 'ja'; // contract default is ja; unsupported → ja
  const limit = clamp(intOr(q.limit, 20), 1, HARD_CAP);
  const offset = Math.max(0, intOr(q.offset, 0));
  const key = `${lang}:${limit}:${offset}`;
  const now = Date.now();

  const setHeaders = () => res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  // Serve from cache while fresh.
  const cached = cache[key];
  if (cached && now - cached.at < cached.ttl) {
    res.setHeader('X-News-Cache', 'HIT');
    setHeaders();
    return res.status(200).json(cached.payload);
  }

  let payload;
  let ttl;
  try {
    const upstream = await fetch(`${API_BASE}/api/public/posts?lang=${lang}&limit=${limit}&offset=${offset}`, {
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`upstream responded ${upstream.status}`);
    const raw = await upstream.json();
    // Healthy response (including total:0 / posts:[]) flows through untouched.
    payload = { ...normalize(raw, lang, limit, offset), source: 'live' };
    lastGood[key] = payload;
    ttl = LIVE_TTL_MS;
  } catch (err) {
    // Upstream unreachable / 5xx. Prefer last good REAL data (stale); otherwise empty.
    if (lastGood[key]) {
      payload = { ...lastGood[key], source: 'stale' };
    } else {
      payload = { ...emptyFeed(lang, limit, offset), source: 'error' };
    }
    ttl = SOFT_TTL_MS;
  }

  cache[key] = { at: now, ttl, payload };
  res.setHeader('X-News-Cache', 'MISS');
  setHeaders();
  return res.status(200).json(payload);
}
