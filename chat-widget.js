(function () {
  'use strict';

  // ── Persist a guest ID so rate-limiting works across page loads ──
  var guestId = (function () {
    try {
      var k = 'fiq_guest';
      var v = localStorage.getItem(k);
      if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v); }
      return v;
    } catch { return 'anon'; }
  })();

  // ── Conversation history & form context ─────────────────────────
  var history = [];
  var activeFormContext = null;  // { formName, fields, savedProfile }

  // ── Inject CSS ───────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = `
    #fiq-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9000;
      width: 54px; height: 54px; border-radius: 50%;
      background: #0F1E3C; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(15,30,60,0.35);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #fiq-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(15,30,60,0.45); }
    #fiq-chat-btn svg { width: 26px; height: 26px; }
    #fiq-unread {
      position: absolute; top: 2px; right: 2px; width: 14px; height: 14px;
      background: #F59E0B; border-radius: 50%; border: 2px solid #fff;
      display: none;
    }

    #fiq-panel {
      position: fixed; bottom: 90px; right: 24px; z-index: 9001;
      width: 370px; max-width: calc(100vw - 32px);
      height: 540px; max-height: calc(100vh - 110px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 16px 56px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'Inter', -apple-system, sans-serif;
      animation: fiqSlideUp 0.22s ease-out;
    }
    #fiq-panel.open { display: flex; }
    @keyframes fiqSlideUp {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    #fiq-header {
      background: #0F1E3C; padding: 14px 16px;
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    #fiq-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: linear-gradient(135deg, #1e3560, #F59E0B);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    #fiq-header-info { flex: 1; }
    #fiq-header-name { color: #f1f5f9; font-size: 0.875rem; font-weight: 600; margin: 0; }
    #fiq-header-status { display: flex; align-items: center; gap: 5px; margin: 2px 0 0; }
    #fiq-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
    #fiq-status-text { color: #64748b; font-size: 0.68rem; }
    #fiq-close {
      background: none; border: none; color: #475569; cursor: pointer;
      font-size: 1.25rem; line-height: 1; padding: 4px;
    }
    #fiq-close:hover { color: #94a3b8; }

    #fiq-messages {
      flex: 1; overflow-y: auto; padding: 14px 14px 8px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    #fiq-messages::-webkit-scrollbar { width: 4px; }
    #fiq-messages::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 2px; }

    .fiq-msg { display: flex; gap: 8px; align-items: flex-end; max-width: 100%; }
    .fiq-msg.user { flex-direction: row-reverse; }
    .fiq-msg-icon {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; background: #f1f5f9;
    }
    .fiq-msg.user .fiq-msg-icon { background: #0F1E3C; color: #FAFAF8; }
    .fiq-bubble {
      max-width: 82%; padding: 9px 12px; border-radius: 14px;
      font-size: 0.82rem; line-height: 1.6; color: #1e293b;
      background: #f1f5f9; border-bottom-left-radius: 4px;
      word-break: break-word; white-space: pre-wrap;
    }
    .fiq-msg.user .fiq-bubble {
      background: #0F1E3C; color: #f1f5f9;
      border-bottom-left-radius: 14px; border-bottom-right-radius: 4px;
    }
    .fiq-bubble a { color: #1d4ed8; }
    .fiq-msg.user .fiq-bubble a { color: #93c5fd; }

    /* Typing indicator */
    .fiq-typing { display: flex; gap: 4px; align-items: center; padding: 10px 14px; }
    .fiq-dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8;
      animation: fiqBounce 1.2s infinite ease-in-out; }
    .fiq-dot:nth-child(2) { animation-delay: 0.2s; }
    .fiq-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes fiqBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30%           { transform: translateY(-5px); }
    }

    /* Suggestions */
    #fiq-suggestions {
      padding: 0 14px 10px; display: flex; flex-wrap: wrap; gap: 6px;
    }
    .fiq-sug {
      background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 20px;
      padding: 5px 12px; font-size: 0.72rem; color: #334155; cursor: pointer;
      font-family: inherit; transition: background 0.15s, border-color 0.15s;
    }
    .fiq-sug:hover { background: #e2e8f0; border-color: #cbd5e1; }

    /* Footer */
    #fiq-footer { padding: 10px 12px; border-top: 1px solid #f1f5f9; flex-shrink: 0; }
    #fiq-dl-bar {
      display: none; align-items: center; gap: 8px; margin-bottom: 8px;
      padding: 8px 10px; background: #f5f3ff; border: 1.5px solid #c4b5fd;
      border-radius: 8px;
    }
    #fiq-dl-bar.visible { display: flex; }
    #fiq-dl-bar-text { flex: 1; font-size: 0.72rem; color: #5b21b6; line-height: 1.35; }
    #fiq-dl-btn {
      padding: 5px 12px; font-family: inherit; font-size: 0.75rem; font-weight: 700;
      background: #7c3aed; color: #fff; border: none; border-radius: 6px; cursor: pointer;
      white-space: nowrap; flex-shrink: 0;
    }
    #fiq-dl-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    #fiq-dl-btn:hover:not(:disabled) { background: #6d28d9; }

    /* Upload bar */
    #fiq-upload-bar {
      display: none; align-items: center; gap: 8px; margin-bottom: 8px;
      padding: 7px 10px; background: #f0f9ff; border: 1.5px solid #bae6fd;
      border-radius: 8px;
    }
    #fiq-upload-bar.visible { display: flex; }
    #fiq-upload-label {
      flex: 1; font-size: 0.72rem; color: #0369a1; line-height: 1.35; cursor: pointer;
    }
    #fiq-upload-btn {
      padding: 5px 11px; font-family: inherit; font-size: 0.75rem; font-weight: 700;
      background: #0284c7; color: #fff; border: none; border-radius: 6px; cursor: pointer;
      white-space: nowrap; flex-shrink: 0;
    }
    #fiq-upload-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    #fiq-upload-btn:hover:not(:disabled) { background: #0369a1; }
    #fiq-file-input { display: none; }

    /* Extraction confirmation card */
    .fiq-extract-card {
      background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px;
      padding: 10px 12px; margin: 4px 0; font-size: 0.78rem;
    }
    .fiq-extract-title { font-weight: 700; color: #0F1E3C; margin: 0 0 6px; font-size: 0.82rem; }
    .fiq-extract-subtitle { color: #64748b; margin: 0 0 8px; font-size: 0.72rem; }
    .fiq-extract-row { display: flex; align-items: flex-start; gap: 6px; padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
    .fiq-extract-row:last-of-type { border-bottom: none; }
    .fiq-extract-row.needs-review { background: #fffbeb; border-radius: 6px; padding: 5px 6px; margin: 1px -6px; border-bottom: none; border-top: 1px solid #fde68a; }
    .fiq-extract-row.needs-review:first-of-type { border-top: none; }
    .fiq-extract-col { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .fiq-extract-top { display: flex; gap: 6px; align-items: center; }
    .fiq-extract-field { flex: 1; color: #475569; font-size: 0.72rem; }
    .fiq-extract-val { flex: 1.4; min-width: 0; }
    /* Reasoning annotation */
    details.fiq-reasoning { border-top: 1px dashed #e2e8f0; margin-top: 3px; padding-top: 2px; }
    details.fiq-reasoning summary { cursor: pointer; font-size: 0.68rem; color: #7c3aed; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 3px; user-select: none; }
    details.fiq-reasoning summary::-webkit-details-marker { display: none; }
    details.fiq-reasoning summary::before { content: '▶'; font-size: 0.52rem; display: inline-block; transition: transform 0.15s; }
    details[open].fiq-reasoning summary::before { transform: rotate(90deg); }
    .fiq-reasoning-body { padding: 5px 0 2px; display: flex; flex-direction: column; gap: 4px; }
    .fiq-reasoning-line { display: flex; gap: 6px; font-size: 0.69rem; line-height: 1.45; }
    .fiq-reasoning-label { font-weight: 700; color: #64748b; min-width: 62px; flex-shrink: 0; padding-top: 1px; }
    .fiq-reasoning-value { color: #334155; }
    .fiq-conf-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.02em; }
    .fiq-conf-badge.high   { background: #dcfce7; color: #15803d; }
    .fiq-conf-badge.medium { background: #fef9c3; color: #854d0e; }
    .fiq-conf-badge.low    { background: #fee2e2; color: #b91c1c; }
    .fiq-extract-input {
      width: 100%; box-sizing: border-box; font-family: inherit; font-size: 0.75rem;
      border: 1.5px solid #e2e8f0; border-radius: 5px; padding: 3px 6px; color: #1e293b;
    }
    .fiq-extract-input.amber { border-color: #f59e0b; background: #fffbeb; }
    .fiq-conf-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
    .fiq-conf-high   { background: #22c55e; }
    .fiq-conf-medium { background: #f59e0b; }
    .fiq-conf-low    { background: #ef4444; }
    .fiq-extract-actions { display: flex; gap: 6px; margin-top: 8px; }
    .fiq-extract-apply {
      flex: 1; padding: 6px; background: #0F1E3C; color: #fff; border: none;
      border-radius: 6px; font-family: inherit; font-size: 0.75rem; font-weight: 700; cursor: pointer;
    }
    .fiq-extract-apply:hover { background: #1e3560; }
    .fiq-extract-skip {
      padding: 6px 10px; background: #f1f5f9; color: #64748b; border: none;
      border-radius: 6px; font-family: inherit; font-size: 0.75rem; cursor: pointer;
    }
    #fiq-form { display: flex; gap: 8px; align-items: flex-end; }
    #fiq-input {
      flex: 1; resize: none; border: 1.5px solid #e2e8f0; border-radius: 10px;
      padding: 9px 12px; font-family: inherit; font-size: 0.82rem;
      color: #1e293b; outline: none; line-height: 1.45; max-height: 100px;
      overflow-y: auto;
    }
    #fiq-input:focus { border-color: #0F1E3C; }
    #fiq-send {
      width: 36px; height: 36px; border-radius: 50%; border: none;
      background: #0F1E3C; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    #fiq-send:hover { background: #1e3560; }
    #fiq-send:disabled { background: #94a3b8; cursor: not-allowed; }
    #fiq-send svg { width: 16px; height: 16px; }
    #fiq-powered { text-align: center; font-size: 0.62rem; color: #cbd5e1; margin: 5px 0 0; }
    #fiq-validation-warn { display: none; margin: 0 10px 6px; padding: 6px 10px; border-radius: 6px; font-size: 0.76rem; line-height: 1.5; border: 1px solid #fde68a; background: #fffbeb; color: #92400e; }
    #fiq-validation-warn.visible { display: block; }
    #fiq-validation-warn.is-error { border-color: #fca5a5; background: #fff5f5; color: #991b1b; }
  `;
  document.head.appendChild(style);

  // ── Build DOM ────────────────────────────────────────────────────
  // Floating button
  var btn = document.createElement('button');
  btn.id = 'fiq-chat-btn';
  btn.setAttribute('aria-label', 'Open FormIQ chat support');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#FAFAF8" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    '</svg>' +
    '<span id="fiq-unread"></span>';
  document.body.appendChild(btn);

  // Panel
  // Small i18n for widget static strings
  var WIDGET_LANG = localStorage.getItem('fiq_lang') || 'en';
  var WIDGET_T = {
    placeholder: { en:'Ask anything about forms…', es:'Pregunta sobre cualquier formulario…', pt:'Pergunte sobre qualquer formulário…', fr:'Posez des questions sur tout formulaire…', zh:'关于表格有什么问题？', vi:'Hỏi bất cứ điều gì về mẫu đơn…', tl:'Magtanong tungkol sa anumang form…', ko:'양식에 대해 무엇이든 물어보세요…', ar:'اسأل عن أي نموذج…' },
    uploadLabel: { en:'📎 Upload a prior return, ID, or confirmation letter to pre-fill fields', es:'📎 Sube un documento previo para prellenar los campos', pt:'📎 Envie um documento anterior para pré-preencher os campos', fr:'📎 Chargez un document pour pré-remplir les champs', zh:'📎 上传文件以预填字段', vi:'📎 Tải tài liệu lên để tự động điền các trường', tl:'📎 Mag-upload ng dokumento upang i-pre-fill ang mga field', ko:'📎 문서를 업로드하여 필드를 미리 채우세요', ar:'📎 ارفع مستنداً لملء الحقول مسبقاً' },
  };
  function wt(key) { return (WIDGET_T[key] || {})[WIDGET_LANG] || (WIDGET_T[key] || {})['en'] || key; }

  var panel = document.createElement('div');
  panel.id = 'fiq-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'FormIQ chat support');
  panel.innerHTML =
    // Header
    '<div id="fiq-header">' +
      '<div id="fiq-avatar">📋</div>' +
      '<div id="fiq-header-info">' +
        '<p id="fiq-header-name">FormIQ Assistant</p>' +
        '<div id="fiq-header-status"><span id="fiq-status-dot"></span><span id="fiq-status-text">Online · Powered by Claude</span></div>' +
      '</div>' +
      '<button id="fiq-close" aria-label="Close chat">✕</button>' +
    '</div>' +
    // Messages
    '<div id="fiq-messages"></div>' +
    // Suggestions (shown when empty)
    '<div id="fiq-suggestions"></div>' +
    // Input
    '<div id="fiq-footer">' +
      '<div id="fiq-dl-bar">' +
        '<span id="fiq-dl-bar-text">Ready to download your filled PDF?</span>' +
        '<button id="fiq-dl-btn" type="button">📥 Download filled PDF</button>' +
      '</div>' +
      '<div id="fiq-upload-bar">' +
        '<label id="fiq-upload-label" for="fiq-file-input">' + wt('uploadLabel') + '</label>' +
        '<button id="fiq-upload-btn" type="button">Upload</button>' +
        '<input id="fiq-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" />' +
      '</div>' +
      '<div id="fiq-validation-warn" role="alert" aria-live="polite"></div>' +
      '<form id="fiq-form">' +
        '<textarea id="fiq-input" rows="1" placeholder="' + wt('placeholder') + '" aria-label="Chat message"></textarea>' +
        '<button type="submit" id="fiq-send" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="#FAFAF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</form>' +
      '<p id="fiq-powered">Powered by Claude AI · FormIQ</p>' +
    '</div>';
  document.body.appendChild(panel);

  // ── Refs ─────────────────────────────────────────────────────────
  var messagesEl    = document.getElementById('fiq-messages');
  var suggestionsEl = document.getElementById('fiq-suggestions');
  var inputEl       = document.getElementById('fiq-input');
  var sendBtn       = document.getElementById('fiq-send');
  var unreadDot     = document.getElementById('fiq-unread');
  var dlBar         = document.getElementById('fiq-dl-bar');
  var dlBtn         = document.getElementById('fiq-dl-btn');
  var uploadBar     = document.getElementById('fiq-upload-bar');
  var uploadBtn     = document.getElementById('fiq-upload-btn');
  var fileInput     = document.getElementById('fiq-file-input');
  var isOpen        = false;
  var isStreaming   = false;
  var downloadCallback = null;
  var privacyAccepted  = false;

  dlBtn.addEventListener('click', function () {
    if (typeof downloadCallback !== 'function') return;
    dlBtn.disabled = true;
    dlBtn.textContent = '⏳ Building PDF…';
    document.getElementById('fiq-dl-bar-text').textContent = 'Extracting your answers and filling the form…';
    downloadCallback(function (ok, errMsg, fallbackUrl) {
      dlBtn.disabled = false;
      if (ok) {
        dlBtn.textContent = '✅ Downloaded!';
        document.getElementById('fiq-dl-bar-text').textContent = 'Your filled PDF has been downloaded.';
        setTimeout(function () {
          dlBtn.textContent = '📥 Download filled PDF';
          document.getElementById('fiq-dl-bar-text').textContent = 'Ready to download your filled PDF?';
        }, 4000);
      } else {
        dlBtn.textContent = '📥 Try again';
        var barText = document.getElementById('fiq-dl-bar-text');
        if (fallbackUrl) {
          barText.innerHTML = '⚠️ ' + escHtml(errMsg || 'Download failed.') +
            ' <a href="' + escHtml(fallbackUrl) + '" target="_blank" rel="noopener" style="color:#1d4ed8;text-decoration:underline;">Download blank form ↗</a>';
        } else {
          barText.textContent = '⚠️ ' + (errMsg || 'Download failed — please try again.');
        }
      }
    });
  });

  // ── Document upload ──────────────────────────────────────────────
  uploadBtn.addEventListener('click', function () {
    if (!privacyAccepted) {
      // Show privacy notice as an assistant message, then open picker after confirmation
      appendPrivacyNotice();
    } else {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    fileInput.value = ''; // reset so same file can be re-selected
    processUpload(file);
  });

  function appendPrivacyNotice() {
    var wrap = document.createElement('div');
    wrap.className = 'fiq-msg assistant';
    wrap.innerHTML =
      '<div class="fiq-msg-icon">📋</div>' +
      '<div class="fiq-bubble">' +
        '<strong>Before you upload</strong><br><br>' +
        '🔒 FormIQ processes your document in real-time using AI and <strong>never stores it</strong>. ' +
        'Your file is sent securely, used only to extract relevant field values, and immediately discarded after processing.<br><br>' +
        '<button class="fiq-privacy-ok" style="padding:6px 14px;background:#0F1E3C;color:#fff;border:none;border-radius:6px;font-family:inherit;font-size:0.78rem;font-weight:700;cursor:pointer;margin-right:6px;">I understand — Upload</button>' +
        '<button class="fiq-privacy-cancel" style="padding:6px 10px;background:#f1f5f9;color:#475569;border:none;border-radius:6px;font-family:inherit;font-size:0.78rem;cursor:pointer;">Cancel</button>' +
      '</div>';
    messagesEl.appendChild(wrap);
    scrollBottom();

    wrap.querySelector('.fiq-privacy-ok').addEventListener('click', function () {
      privacyAccepted = true;
      wrap.querySelector('.fiq-privacy-ok').disabled = true;
      wrap.querySelector('.fiq-privacy-cancel').disabled = true;
      fileInput.click();
    });
    wrap.querySelector('.fiq-privacy-cancel').addEventListener('click', function () {
      messagesEl.removeChild(wrap);
    });
  }

  function processUpload(file) {
    var MAX_BYTES = 4.5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      appendMessage('assistant', '⚠️ That file is too large (max 4.5 MB). Please compress it or upload a smaller version.');
      return;
    }

    var mimeType = file.type || '';
    var supported = ['application/pdf','image/jpeg','image/jpg','image/png','image/webp'];
    if (!supported.includes(mimeType)) {
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'docx' || ext === 'doc') {
        appendMessage('assistant', '⚠️ Word documents (.docx) are not supported yet. Please save your document as a PDF and upload that instead.');
      } else {
        appendMessage('assistant', '⚠️ Unsupported file type. Please upload a PDF, JPG, PNG, or WebP file.');
      }
      return;
    }

    // Show loading bubble
    var bubble = appendStreamingBubble();
    bubble.innerHTML = '<em style="color:#64748b;">Reading ' + escHtml(file.name) + '…</em>';
    scrollBottom();

    var reader = new FileReader();
    reader.onload = function (e) {
      var base64 = e.target.result.split(',')[1]; // strip data:mime;base64,
      var formName = activeFormContext ? activeFormContext.formName : '';

      fetch('/api/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, fileType: mimeType, fileName: file.name, targetForm: formName }),
      })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        if (d.error) {
          bubble.textContent = '⚠️ ' + d.error;
          return;
        }
        renderExtractionCard(bubble, d, formName);
      })
      .catch(function () {
        bubble.textContent = '⚠️ Upload failed — please try again.';
      });
    };
    reader.onerror = function () {
      bubble.textContent = '⚠️ Could not read the file. Please try again.';
    };
    reader.readAsDataURL(file);
  }

  // Field names that must always show reasoning expanded (tax elections, entity classification, responsible party)
  var ALWAYS_EXPAND_RE = /entity.?type|responsible.?party|class(?:ification)?|election|s[- ]?corp|officer|director|trustee|grantor|fiduciary|tax.?year|filing.?status|relationship.?to/i;

  function renderExtractionCard(bubble, data, formName) {
    var fields = (data.fields || []);
    var docType = data.docType || 'Document';
    var source  = data.source  || 'Uploaded document';

    if (!fields.length) {
      bubble.textContent = 'I couldn\'t find any relevant fields in this document for ' + (formName || 'this form') + '.';
      return;
    }

    var CONF_LABEL = { high: 'High', medium: 'Medium', low: 'Needs review' };

    var rows = fields.map(function (f) {
      var conf  = f.confidence || 'high';
      var isNeedsReview = conf === 'low';
      var isAmber       = conf === 'medium' || isNeedsReview;
      var dotClass      = 'fiq-conf-' + conf;
      var note          = f.note ? ' title="' + escHtml(f.note) + '"' : '';

      // Open reasoning by default for low-confidence or critical fields
      var alwaysOpen = isNeedsReview || ALWAYS_EXPAND_RE.test(f.field);

      // Reasoning annotation (collapsed/expanded details panel)
      var reasoningHtml = '';
      if (f.reasoning || f.action) {
        var actionText = f.action || (isNeedsReview
          ? 'Verify against your original document before applying. Edit the value above if needed.'
          : 'Edit the value above if it\'s incorrect.');
        reasoningHtml =
          '<details class="fiq-reasoning"' + (alwaysOpen ? ' open' : '') + '>' +
            '<summary>Why this value?</summary>' +
            '<div class="fiq-reasoning-body">' +
              '<div class="fiq-reasoning-line"><span class="fiq-reasoning-label">Source</span><span class="fiq-reasoning-value">' + escHtml(source) + '</span></div>' +
              (f.reasoning ? '<div class="fiq-reasoning-line"><span class="fiq-reasoning-label">Reasoning</span><span class="fiq-reasoning-value">' + escHtml(f.reasoning) + '</span></div>' : '') +
              '<div class="fiq-reasoning-line"><span class="fiq-reasoning-label">Confidence</span><span class="fiq-reasoning-value"><span class="fiq-conf-badge ' + conf + '">' + (CONF_LABEL[conf] || conf) + '</span></span></div>' +
              '<div class="fiq-reasoning-line"><span class="fiq-reasoning-label">If wrong</span><span class="fiq-reasoning-value">' + escHtml(actionText) + '</span></div>' +
            '</div>' +
          '</details>';
      }

      return '<div class="fiq-extract-row' + (isNeedsReview ? ' needs-review' : '') + '">' +
        '<span class="fiq-conf-dot ' + dotClass + '"' + note + ' style="margin-top:4px;"></span>' +
        '<div class="fiq-extract-col">' +
          '<div class="fiq-extract-top">' +
            '<span class="fiq-extract-field">' + escHtml(f.field) + '</span>' +
            '<span class="fiq-extract-val">' +
              '<input class="fiq-extract-input' + (isAmber ? ' amber' : '') + '" data-field="' + escHtml(f.field) + '" value="' + escHtml(f.value || '') + '" />' +
            '</span>' +
          '</div>' +
          reasoningHtml +
        '</div>' +
      '</div>';
    }).join('');

    // Version mismatch warning
    var versionWarn = '';
    if (data.versionInfo && data.versionInfo.isMismatch) {
      versionWarn =
        '<div style="margin-bottom:8px;padding:6px 9px;border-radius:7px;background:#fffbeb;border:1px solid #fde68a;font-size:0.73rem;color:#92400e;line-height:1.45;">' +
          '⚠️ Version mismatch: your uploaded document is Rev. ' + escHtml(data.versionInfo.uploadedRev) +
          ', but the current version is Rev. ' + escHtml(data.versionInfo.currentRev) +
          '. Some fields may have changed — double-check before applying.' +
        '</div>';
    }

    bubble.innerHTML =
      '<div class="fiq-extract-card">' +
        '<p class="fiq-extract-title">📄 ' + escHtml(docType) + '</p>' +
        '<p class="fiq-extract-subtitle">Review and edit the extracted values, then click Apply.</p>' +
        versionWarn +
        rows +
        '<div class="fiq-extract-actions">' +
          '<button class="fiq-extract-apply">✓ Apply these values</button>' +
          '<button class="fiq-extract-skip">Skip</button>' +
        '</div>' +
      '</div>';

    bubble.querySelector('.fiq-extract-skip').addEventListener('click', function () {
      bubble.innerHTML = '<em style="color:#94a3b8;">Extraction skipped.</em>';
    });

    bubble.querySelector('.fiq-extract-apply').addEventListener('click', function () {
      var inputs = bubble.querySelectorAll('.fiq-extract-input');
      var confirmed = [];
      inputs.forEach(function (inp) {
        var val = inp.value.trim();
        if (val) confirmed.push(inp.dataset.field + ': ' + val);
      });

      if (!confirmed.length) { bubble.querySelector('.fiq-extract-apply').textContent = 'No values to apply.'; return; }

      // Inject into chat history as a user message so Claude and fill-form see the values
      var msg = 'I have the following pre-filled values from my uploaded document (' + escHtml(docType) + '). Please use these and confirm each one:\n' + confirmed.join('\n');
      history.push({ role: 'user', content: msg });

      bubble.innerHTML = '✅ Applied ' + confirmed.length + ' field' + (confirmed.length > 1 ? 's' : '') + ' from ' + escHtml(docType) + '. Claude will now confirm them with you.';
      scrollBottom();

      // Trigger Claude to acknowledge and confirm
      sendMessage('Please confirm you have the extracted values and continue guiding me from where we left off.');
    });
  }

  // ── Suggestions ──────────────────────────────────────────────────
  var SUGGESTIONS = [
    'What is Form W-9?',
    'How do I fill out an I-9?',
    'When is Form 1040 due?',
    'What forms do I need to start a business?',
    'What is the difference between W-2 and 1099?',
    'How do I apply for a US passport?',
  ];

  function renderSuggestions() {
    if (history.length > 0) { suggestionsEl.style.display = 'none'; return; }
    suggestionsEl.style.display = 'flex';
    suggestionsEl.innerHTML = SUGGESTIONS.map(function (s) {
      return '<button class="fiq-sug" data-q="' + escHtml(s) + '">' + escHtml(s) + '</button>';
    }).join('');
    suggestionsEl.querySelectorAll('.fiq-sug').forEach(function (b) {
      b.addEventListener('click', function () { sendMessage(b.dataset.q); });
    });
  }

  // ── Open / close ─────────────────────────────────────────────────
  btn.addEventListener('click', function () { isOpen ? close() : open(); });
  document.getElementById('fiq-close').addEventListener('click', close);

  function open() {
    isOpen = true;
    panel.classList.add('open');
    unreadDot.style.display = 'none';
    renderSuggestions();
    if (!history.length) addWelcome();
    setTimeout(function () { inputEl.focus(); }, 100);
  }
  function close() {
    isOpen = false;
    panel.classList.remove('open');
  }

  // ── Welcome message ──────────────────────────────────────────────
  function addWelcome() {
    appendMessage('assistant',
      "Hi! I'm FormIQ Assistant 👋\n\nI can help you with questions about any official form — tax, immigration, HR, passports, and more. What would you like to know?");
  }

  // ── Append a message bubble ──────────────────────────────────────
  function appendMessage(role, text) {
    suggestionsEl.style.display = 'none';
    var wrap = document.createElement('div');
    wrap.className = 'fiq-msg ' + role;
    var icon = role === 'user' ? '🧑' : '📋';
    wrap.innerHTML =
      '<div class="fiq-msg-icon">' + icon + '</div>' +
      '<div class="fiq-bubble">' + escHtml(text) + '</div>';
    messagesEl.appendChild(wrap);
    scrollBottom();
    return wrap.querySelector('.fiq-bubble');
  }

  // ── Streaming placeholder ────────────────────────────────────────
  function appendStreamingBubble() {
    suggestionsEl.style.display = 'none';
    var wrap = document.createElement('div');
    wrap.className = 'fiq-msg assistant';
    wrap.innerHTML =
      '<div class="fiq-msg-icon">📋</div>' +
      '<div class="fiq-bubble"><div class="fiq-typing"><div class="fiq-dot"></div><div class="fiq-dot"></div><div class="fiq-dot"></div></div></div>';
    messagesEl.appendChild(wrap);
    scrollBottom();
    return wrap.querySelector('.fiq-bubble');
  }

  // ── Send ─────────────────────────────────────────────────────────
  document.getElementById('fiq-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = inputEl.value.trim();
    if (text && !isStreaming) sendMessage(text);
  });

  // ── Field validation ─────────────────────────────────────────────
  var VALID_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI'.split(' ');
  var validationEl = document.getElementById('fiq-validation-warn');

  function validateGuideInput(text) {
    if (!text || !activeFormContext) return [];
    var t = text.trim();
    var issues = [];

    // SSN: 9 digits (with or without separators) not matching XXX-XX-XXXX
    var ssnRaw = t.replace(/[- ]/g, '').match(/(?<!\d)(\d{9})(?!\d)/);
    if (ssnRaw && !/\b\d{3}-\d{2}-\d{4}\b/.test(t) && !/\b\d{2}-\d{7}\b/.test(t)) {
      issues.push({ level: 'error', msg: "That doesn’t look like a valid SSN format — it should be 123-45-6789 (three groups separated by dashes)." });
    } else {
      // Partial SSN attempt: 3-2-1to3 digits (last group wrong)
      var ssnPartial = t.match(/\b\d{3}[- ]\d{2}[- ]\d{1,3}\b/);
      if (ssnPartial && !/\b\d{3}-\d{2}-\d{4}\b/.test(t)) {
        issues.push({ level: 'error', msg: "SSNs have a 4-digit last group — e.g. 123-45-6789. The last part of what you entered looks too short." });
      }
    }

    // EIN: 9 digits in XX-XXXXXXX pattern check
    var einAttempt = t.match(/\b(\d{2})[- ](\d+)\b/);
    if (einAttempt && !/\b\d{3}-\d{2}-\d{4}\b/.test(t)) {
      var einDigits = einAttempt[1] + einAttempt[2];
      if (einDigits.length === 9 && !/\b\d{2}-\d{7}\b/.test(t)) {
        issues.push({ level: 'error', msg: "That doesn’t look like a valid EIN format — it should be 12-3456789 (two digits, dash, seven digits)." });
      }
    }

    // Date: find MM/DD/YYYY or MM-DD-YYYY patterns
    var dateRe = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
    var dm;
    while ((dm = dateRe.exec(t)) !== null) {
      var mo = +dm[1], dy = +dm[2], yr = +dm[3];
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      if (mo < 1 || mo > 12) {
        issues.push({ level: 'error', msg: "That doesn’t look like a valid date — the month should be between 01 and 12." });
      } else {
        var maxDay = new Date(yr, mo, 0).getDate();
        var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        if (dy < 1 || dy > maxDay) {
          issues.push({ level: 'error', msg: MONTHS[mo - 1] + " " + yr + " only has " + maxDay + " days, so day " + dy + " doesn’t exist." });
        }
      }
    }

    // ZIP: exact 4-digit message = clearly one digit short
    if (/^\d{4}$/.test(t)) {
      issues.push({ level: 'warn', msg: "ZIP codes are 5 digits — did you miss the last digit? (e.g. 10001)" });
    }

    // State: entire message is 2 uppercase letters → validate
    if (/^[A-Z]{2}$/.test(t) && VALID_STATES.indexOf(t) === -1) {
      issues.push({ level: 'error', msg: "“" + t + "” isn’t a recognized US state or territory code. Please use a 2-letter abbreviation like TX, CA, NY, or DC." });
    }

    return issues;
  }

  function showValidationWarnings(issues) {
    if (!validationEl) return;
    if (!issues || !issues.length) {
      validationEl.className = '';
      validationEl.textContent = '';
      return;
    }
    var hasError = issues.some(function(i) { return i.level === 'error'; });
    validationEl.className = 'visible' + (hasError ? ' is-error' : '');
    validationEl.textContent = issues.map(function(i) { return i.msg; }).join(' · ');
  }

  // Auto-grow textarea
  var validationTimer = null;
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    // Debounced validation (only in guide mode)
    clearTimeout(validationTimer);
    validationTimer = setTimeout(function () {
      showValidationWarnings(validateGuideInput(inputEl.value));
    }, 350);
  });
  // Send on Enter (Shift+Enter for newline)
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = inputEl.value.trim();
      if (text && !isStreaming) sendMessage(text);
    }
  });

  function sendMessage(text) {
    if (isStreaming) return;
    showValidationWarnings([]); // clear inline warnings on send
    clearTimeout(validationTimer);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    isStreaming = true;

    appendMessage('user', text);
    history.push({ role: 'user', content: text });

    var bubble = appendStreamingBubble();
    var accumulated = '';

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, guestId: guestId, formContext: activeFormContext }),
    })
    .then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (d.reply) {
            bubble.textContent = d.reply;
            history.push({ role: 'assistant', content: d.reply });
          } else {
            throw new Error(d.error || 'Server error ' + res.status);
          }
        });
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();

      function read() {
        return reader.read().then(function (result) {
          if (result.done) {
            history.push({ role: 'assistant', content: accumulated });
            return;
          }
          accumulated += decoder.decode(result.value, { stream: true });
          bubble.textContent = accumulated;
          scrollBottom();
          return read();
        });
      }
      return read();
    })
    .catch(function (err) {
      bubble.textContent = 'Sorry, something went wrong. Please try again.';
      bubble.style.color = '#b91c1c';
    })
    .finally(function () {
      isStreaming = false;
      sendBtn.disabled = false;
      inputEl.focus();
      scrollBottom();
      // Show unread dot if panel is closed
      if (!isOpen) unreadDot.style.display = 'block';
    });
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Public API ───────────────────────────────────────────────────
  window.FiqChat = {
    open: open,

    // Start a guided form-filling session from the app page
    // onDownload(callback) is called when the user clicks the in-chat download button
    startGuide: function (formName, fields, onDownload, savedProfile, lang) {
      // Update widget language if changed
      if (lang && lang !== WIDGET_LANG) {
        WIDGET_LANG = lang;
        if (inputEl) inputEl.placeholder = wt('placeholder');
        var ul = document.getElementById('fiq-upload-label');
        if (ul) ul.textContent = wt('uploadLabel');
      }
      // Reset state — include masked profile so API can pre-fill known fields
      activeFormContext = { formName: formName, fields: fields, savedProfile: savedProfile || {}, lang: lang || 'en' };
      downloadCallback = typeof onDownload === 'function' ? onDownload : null;
      history = [];
      messagesEl.innerHTML = '';
      suggestionsEl.style.display = 'none';

      // Show download bar if a PDF is available
      if (downloadCallback) {
        dlBar.classList.add('visible');
        document.getElementById('fiq-dl-bar-text').textContent =
          'Fill in your details below, then download your PDF.';
        dlBtn.disabled = false;
        dlBtn.textContent = '📥 Download filled PDF';
      } else {
        dlBar.classList.remove('visible');
      }

      // Show upload bar so user can pre-fill from existing documents
      if (uploadBar) uploadBar.classList.add('visible');

      // Update header to show guide mode
      var nameEl = document.getElementById('fiq-header-name');
      var statusEl = document.getElementById('fiq-status-text');
      if (nameEl) nameEl.textContent = 'FormIQ Guide — ' + formName;
      if (statusEl) statusEl.textContent = 'Step-by-step mode · Powered by Claude';

      open();
      // Trigger Claude to start the guided session
      sendMessage('Please guide me through filling out ' + formName + ', one section at a time.');
    },

    // Reset to normal chat mode
    resetGuide: function () {
      activeFormContext = null;
      downloadCallback = null;
      dlBar.classList.remove('visible');
      if (uploadBar) uploadBar.classList.remove('visible');
      var nameEl = document.getElementById('fiq-header-name');
      var statusEl = document.getElementById('fiq-status-text');
      if (nameEl) nameEl.textContent = 'FormIQ Assistant';
      if (statusEl) statusEl.textContent = 'Online · Powered by Claude';
    },

    isGuideMode: function () { return activeFormContext !== null; },
    getHistory:  function () { return history.slice(); },
    getFormContext: function () { return activeFormContext; },
  };
})();
