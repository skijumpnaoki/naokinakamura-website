// Naometer Mobility Partner — application intake.
// Forwards applications to an n8n webhook (MOBILITY_WEBHOOK_URL).
// No payment is taken here: partners are invoiced by Naoki Nakamura SP
// (Slovenia) and pay by SEPA bank transfer.

const MAX_LOGO_DATAURL_LENGTH = 3 * 1024 * 1024; // ~2.2 MB decoded — SVG/PNG logos are far smaller
const ALLOWED_LOGO_PREFIXES = [
  'data:image/png;base64,',
  'data:image/svg+xml;base64,',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company, vatId, billingAddress, contactPerson, email, logo } = req.body || {};

  const isFilled = (v) => typeof v === 'string' && v.trim() !== '';
  if (!isFilled(company) || !isFilled(billingAddress) || !isFilled(contactPerson) || !isFilled(email)) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if ([company, billingAddress, contactPerson, email, vatId || ''].some((v) => String(v).length > 1000)) {
    return res.status(400).json({ error: 'One of the fields is too long.' });
  }

  if (logo) {
    const validShape =
      typeof logo === 'object' &&
      isFilled(logo.filename) &&
      typeof logo.data === 'string' &&
      ALLOWED_LOGO_PREFIXES.some((p) => logo.data.startsWith(p));
    if (!validShape) {
      return res.status(400).json({ error: 'Logo must be an SVG or PNG file.' });
    }
    if (logo.data.length > MAX_LOGO_DATAURL_LENGTH) {
      return res.status(400).json({ error: 'Logo file is too large (max 2 MB).' });
    }
  }

  const payload = {
    product: 'naometer-mobility-partner',
    plan: { name: 'Season', priceEUR: 1500, billing: 'invoice-sepa' },
    submittedAt: new Date().toISOString(),
    company: company.trim(),
    vatId: isFilled(vatId) ? vatId.trim() : null,
    billingAddress: billingAddress.trim(),
    contactPerson: contactPerson.trim(),
    email: email.trim(),
    logo: logo ? { filename: logo.filename, data: logo.data } : null,
  };

  const webhookUrl = process.env.MOBILITY_WEBHOOK_URL;
  if (!webhookUrl) {
    // Placeholder mode: accept the application so the flow can be exercised
    // before the n8n webhook is wired up.
    console.warn('MOBILITY_WEBHOOK_URL is not set — application received but not forwarded:', {
      company: payload.company,
      email: payload.email,
    });
    return res.status(200).json({ ok: true, delivered: false });
  }

  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      return res.status(502).json({ error: 'We could not receive your application right now. Please try again in a few minutes.' });
    }
    return res.status(200).json({ ok: true, delivered: true });
  } catch {
    return res.status(502).json({ error: 'We could not receive your application right now. Please try again in a few minutes.' });
  }
}
