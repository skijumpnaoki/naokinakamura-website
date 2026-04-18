export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
  }

  // Rate limiting via Upstash Redis REST API (5 requests / IP / minute)
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const key = `rl:chat:${ip}`;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    const incrRes = await fetch(`${upstashUrl}/incr/${key}`, {
      headers: { Authorization: `Bearer ${upstashToken}` },
    });
    const { result: count } = await incrRes.json();

    if (count === 1) {
      await fetch(`${upstashUrl}/expire/${key}/60`, {
        headers: { Authorization: `Bearer ${upstashToken}` },
      });
    }

    if (count > 5) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
  } catch {
    // Redis error — allow request through rather than blocking users
  }

  // Call Claude API
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: `You are an AI assistant on Naoki Nakamura's personal website. Naoki is a Japanese ski jumper competing at the international level. Your role is to help visitors with sponsorship enquiries, media requests, and collaboration opportunities. Be friendly, concise, and professional. Always reply in the same language as the user (Japanese or English).`,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!claudeRes.ok) {
      return res.status(500).json({ error: 'AI service temporarily unavailable.' });
    }

    const data = await claudeRes.json();
    return res.status(200).json({ reply: data.content[0].text });
  } catch {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
