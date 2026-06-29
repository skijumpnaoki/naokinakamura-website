// Serverless proxy for a single "Flying Report" post (contract v1).
//
//   GET /api/post?id=<id>&lang=ja|en   →   one Post object (with body_html for articles)
//
// Same rationale as /api/news: env base URL (no hard-coding), 5-min cache, CORS-safe,
// and it shields the browser from upstream quirks. `id` is strictly validated before it
// is interpolated into the upstream URL (prevents path traversal / SSRF).
//
// Upstream:  GET {API_BASE}/api/public/posts/{id}?lang=ja|en
//   200 → Post   | 404 → {error:'not_found'}   | 5xx → upstream failure

const API_BASE = process.env.FLYING_REPORT_API_BASE || 'https://flying-report-manager.vercel.app';
const OK_TTL_MS = 5 * 60 * 1000;     // cache a found post for 5 minutes
const MISS_TTL_MS = 60 * 1000;       // cache "not found" briefly to avoid hammering
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const cache = {}; // { [lang:id]: { at, ttl, status, payload } }

function normalizePost(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: p.id != null ? String(p.id) : null,
    type: typeof p.type === 'string' && p.type ? p.type : 'report',
    title: typeof p.title === 'string' ? p.title.trim() : '',
    excerpt: typeof p.excerpt === 'string' ? p.excerpt : '',
    date: typeof p.date === 'string' && p.date ? p.date : null,
    url: typeof p.url === 'string' && p.url ? p.url : null,
    image: typeof p.image === 'string' && p.image ? p.image : null,
    tags: Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string') : [],
    body_html: typeof p.body_html === 'string' ? p.body_html : null,
  };
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const q = req.query || {};
  const id = typeof q.id === 'string' ? q.id : '';
  const lang = q.lang === 'en' ? 'en' : 'ja'; // contract default is ja; unsupported → ja

  if (!ID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const key = `${lang}:${id}`;
  const now = Date.now();
  const cached = cache[key];
  if (cached && now - cached.at < cached.ttl) {
    res.setHeader('X-Post-Cache', 'HIT');
    res.setHeader('Cache-Control', cached.status === 200 ? 's-maxage=300, stale-while-revalidate=600' : 's-maxage=60');
    return res.status(cached.status).json(cached.payload);
  }

  try {
    const upstream = await fetch(`${API_BASE}/api/public/posts/${encodeURIComponent(id)}?lang=${lang}`, {
      headers: { Accept: 'application/json' },
    });

    if (upstream.status === 404) {
      const payload = { error: 'not_found', id };
      cache[key] = { at: now, ttl: MISS_TTL_MS, status: 404, payload };
      res.setHeader('X-Post-Cache', 'MISS');
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(404).json(payload);
    }
    if (!upstream.ok) throw new Error(`upstream responded ${upstream.status}`);

    const raw = await upstream.json();
    const post = normalizePost(raw);
    if (!post || !post.id) throw new Error('malformed upstream post');
    const payload = { ...post, lang, source: 'live' };
    cache[key] = { at: now, ttl: OK_TTL_MS, status: 200, payload };
    res.setHeader('X-Post-Cache', 'MISS');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(payload);
  } catch (err) {
    // Upstream unreachable / 5xx — do not cache; let the client retry / show an error.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream' });
  }
}
