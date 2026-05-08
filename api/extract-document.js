const { createKV, getSessionToken } = require('./_utils');
const { lookupVersion, parseRevFromDocType, revsMismatch } = require('./_form-versions');
const kv = createKV();

const SUPPORTED_TYPES = {
  'application/pdf':  { mediaType: 'application/pdf',  kind: 'document' },
  'image/jpeg':       { mediaType: 'image/jpeg',        kind: 'image' },
  'image/jpg':        { mediaType: 'image/jpeg',        kind: 'image' },
  'image/png':        { mediaType: 'image/png',         kind: 'image' },
  'image/webp':       { mediaType: 'image/webp',        kind: 'image' },
};

const SYSTEM_PROMPT = `You are a document data-extraction specialist for FormIQ. The user has uploaded a document and wants to use it to pre-fill a government form.

Your tasks:
1. Identify the document type precisely (e.g. "IRS CP 575 EIN Confirmation Letter", "California Driver's License", "IRS Form W-2 – Tax Year 2023", "Articles of Organization – Delaware LLC").
2. Extract every data field that is relevant to the target form the user is filling.
3. Flag fields that are unclear, partially legible, or ambiguous.

Return ONLY valid JSON — no markdown, no backticks, no preamble:
{
  "docType": "<precise document type identification>",
  "fields": [
    {
      "field": "<field label as it would appear on the target form>",
      "value": "<extracted value — exact text from the document>",
      "confidence": "<high | medium | low>",
      "note": "<null, or brief explanation when confidence is medium/low>",
      "reasoning": "<one sentence: cite the exact location in the document where this value was found, e.g. 'Taken from the box labeled Employer Identification Number in the top-right corner of the CP 575 letter' or 'Read from Line 1 — Legal name on the W-9'>",
      "action": "<what the user should do if this value is wrong — calibrate to confidence: high → 'Edit the value above if needed.'; medium → 'Review carefully against your original document before applying.'; low → 'Verify against the original document — the value may be only partially visible.'>"
    }
  ]
}

Confidence rules:
- "high"   — clearly printed and fully readable
- "medium" — readable but slightly ambiguous (e.g. 0 vs O, partially cut off)
- "low"    — partially visible, obscured, or genuinely unclear

Additional rules:
- Extract full SSNs, EINs, account numbers, and all sensitive fields exactly as printed — this is user-initiated legitimate form pre-fill
- Use MM/DD/YYYY for all dates
- For SSNs keep XXX-XX-XXXX format; for EINs keep XX-XXXXXXX format
- Only extract fields relevant to the target form — skip unrelated data
- Never fabricate or guess values; if a field is unreadable, set confidence "low" and describe what you can partially see in the note
- For "reasoning": always cite the specific document location (box number, section heading, line label) — never write generic phrases like "found in the document"
- For "action": write one concrete sentence the user can act on immediately
- If you cannot identify the document type, set docType to "Unknown document"`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const { fileData, fileType, fileName, targetForm } = req.body || {};

  if (!fileData || typeof fileData !== 'string') {
    return res.status(400).json({ error: 'fileData (base64) is required' });
  }
  if (!fileType || !SUPPORTED_TYPES[fileType.toLowerCase()]) {
    return res.status(400).json({
      error: `Unsupported file type "${fileType}". Please upload a PDF, JPG, PNG, or WebP file.${
        fileType && fileType.includes('docx') ? ' For Word documents, save as PDF first.' : ''
      }`,
    });
  }

  // Rough size check: base64 string length × 0.75 ≈ raw bytes
  const rawBytes = fileData.length * 0.75;
  if (rawBytes > 4.5 * 1024 * 1024) {
    return res.status(413).json({ error: 'File too large. Maximum size is 4.5 MB.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  const { mediaType, kind } = SUPPORTED_TYPES[fileType.toLowerCase()];

  // Build the content block — document for PDFs, image for rasters
  const fileBlock = kind === 'document'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileData } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: fileData } };

  const userText = targetForm
    ? `Please extract all fields from this document that are relevant to filling out ${targetForm}.`
    : 'Please identify this document and extract all key data fields.';

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [fileBlock, { type: 'text', text: userText }],
        }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: err?.error?.message || 'AI extraction failed' });
    }

    const data = await upstream.json();
    const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '{}';
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const result = JSON.parse(clean);

    // Add source label and privacy note (document not retained)
    result.source = 'Uploaded document';
    result.privacyNote = 'This document was processed in real-time and has not been stored.';

    // Version mismatch detection: compare uploaded document revision to stored current
    const uploadedRev = parseRevFromDocType(result.docType);
    if (uploadedRev) {
      const stored = lookupVersion(targetForm || result.docType || '');
      if (stored) {
        result.versionInfo = {
          uploadedRev,
          currentRev: stored.rev,
          isMismatch: revsMismatch(uploadedRev, stored.rev),
        };
      } else {
        result.versionInfo = { uploadedRev, currentRev: null, isMismatch: false };
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
