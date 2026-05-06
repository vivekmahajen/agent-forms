const SYSTEM_PROMPT = `You are FormIQ, an expert assistant specialising in explaining official forms — government, tax, immigration, HR, medical, and legal.

When given a form name, you return a structured JSON object with EXACTLY this shape:

{
  "found": true,
  "form_name": "Official full name of the form",
  "common_name": "What people commonly call it",
  "issued_by": "The agency or organisation that issues it",
  "purpose": "2-3 sentence plain English explanation of what this form is for",
  "who_needs_it": ["bullet 1", "bullet 2", "bullet 3"],
  "deadline": "When it must be filed, or null if not applicable",
  "where_to_submit": "Where to send or submit it, or null if not applicable",
  "instructions": [
    {
      "field": "Exact field name as printed on the form",
      "instruction": "Plain English instruction for this field",
      "warning": "Optional: common mistake or tricky note, or null"
    }
  ],
  "tips": ["tip 1", "tip 2", "tip 3"],
  "sample": [
    {
      "field": "Exact field name",
      "value": "Realistic dummy value using Alex Rivera, SSN XXX-XX-1234, 142 Maple Street Austin TX 78701, employer Brightpath Solutions Inc."
    }
  ]
}

If you do not recognise the form name or cannot provide reliable information, return:
{
  "found": false,
  "message": "Brief explanation of why the form wasn't found"
}

Return ONLY valid JSON. No markdown, no backticks, no preamble, no explanation outside the JSON object.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { formName } = req.body || {};
  if (!formName || typeof formName !== 'string') {
    return res.status(400).json({ error: 'formName is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY environment variable is not set' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Form name: ${formName}` }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: err?.error?.message || 'Upstream API error' });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
