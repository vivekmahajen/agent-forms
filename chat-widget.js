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

  // ── Conversation history ─────────────────────────────────────────
  var history = [];

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
      '<form id="fiq-form">' +
        '<textarea id="fiq-input" rows="1" placeholder="Ask anything about forms…" aria-label="Chat message"></textarea>' +
        '<button type="submit" id="fiq-send" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="#FAFAF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</form>' +
      '<p id="fiq-powered">Powered by Claude AI · FormIQ</p>' +
    '</div>';
  document.body.appendChild(panel);

  // ── Refs ─────────────────────────────────────────────────────────
  var messagesEl   = document.getElementById('fiq-messages');
  var suggestionsEl = document.getElementById('fiq-suggestions');
  var inputEl      = document.getElementById('fiq-input');
  var sendBtn      = document.getElementById('fiq-send');
  var unreadDot    = document.getElementById('fiq-unread');
  var isOpen       = false;
  var isStreaming  = false;

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

  // Auto-grow textarea
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
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
      body: JSON.stringify({ messages: history, guestId: guestId }),
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
})();
