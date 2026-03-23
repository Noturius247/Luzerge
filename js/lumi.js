/**
 * Lumi — Luzerge AI Chat Widget
 * Floating chat powered by Google Gemini via edge function
 */
;(function () {
  'use strict'

  const SUPABASE_URL = window.__LUZERGE_CONFIG?.SUPABASE_URL || 'https://byzuraeyhrxxpztredri.supabase.co'
  const SUPABASE_ANON_KEY = window.__LUZERGE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5enVyYWV5aHJ4eHB6dHJlZHJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjgxMTYsImV4cCI6MjA4OTAwNDExNn0.b_Plo15IWR8g5XPlN8XUs7Cpo2WZwt0UkrawfssIgZU'
  const ENDPOINT = SUPABASE_URL + '/functions/v1/lumi-chat'
  const WELCOME_GUEST = "Hi! I'm Lumi, your Luzerge assistant. Ask me anything about our plans, features, or how to get started."
  const WELCOME_USER = "Hi! I'm Lumi, your Luzerge assistant. I can see your account data — ask me about your domains, uptime, plan, or anything else!"

  let isOpen = false
  let isLoading = false
  let history = [] // { role: 'user'|'model', text: string }

  // Try to get the logged-in user's access token from Supabase session storage
  function getUserToken() {
    try {
      // Supabase stores session in localStorage with key: sb-<project-ref>-auth-token
      const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
      const raw = localStorage.getItem('sb-' + projectRef + '-auth-token')
      if (raw) {
        const session = JSON.parse(raw)
        if (session && session.access_token) return session.access_token
      }
    } catch (_) { /* not logged in or no access */ }
    return null
  }

  // ─── Create DOM ────────────────────────────────────────────────

  function createWidget() {
    // FAB button
    const fab = document.createElement('button')
    fab.className = 'lumi-fab'
    fab.setAttribute('aria-label', 'Chat with Lumi')
    fab.setAttribute('aria-expanded', 'false')
    fab.innerHTML = `
      <svg class="lumi-face" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="lf-sphere" cx="38%" cy="35%" r="55%">
            <stop offset="0%" stop-color="#0e2a47"/>
            <stop offset="50%" stop-color="#0a1628"/>
            <stop offset="100%" stop-color="#050a14"/>
          </radialGradient>
          <radialGradient id="lf-shine" cx="35%" cy="25%" r="40%">
            <stop offset="0%" stop-color="rgba(6,182,212,0.35)"/>
            <stop offset="100%" stop-color="rgba(6,182,212,0)"/>
          </radialGradient>
          <radialGradient id="lf-eye" cx="40%" cy="35%" r="50%">
            <stop offset="0%" stop-color="#fff"/>
            <stop offset="100%" stop-color="#c8dff5"/>
          </radialGradient>
          <radialGradient id="lf-pupil" cx="45%" cy="40%" r="50%">
            <stop offset="0%" stop-color="#1a1a2e"/>
            <stop offset="100%" stop-color="#000"/>
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#lf-sphere)"/>
        <circle cx="32" cy="32" r="28" fill="url(#lf-shine)"/>
        <circle class="lumi-face__glow" cx="32" cy="32" r="28" fill="none" stroke="rgba(6,182,212,0.5)" stroke-width="1.5"/>
        <path class="lumi-face__bolt" d="M38 2L18 34h16l-3 26 20-34H33l5-24z" fill="rgba(255,255,255,0.5)" stroke="#fff" stroke-width="1.2"/>
        <circle class="lumi-face__eye lumi-face__eye--l" cx="20" cy="28" r="5.5" fill="url(#lf-eye)"/>
        <circle class="lumi-face__eye lumi-face__eye--r" cx="44" cy="28" r="5.5" fill="url(#lf-eye)"/>
        <circle class="lumi-face__pupil lumi-face__pupil--l" cx="20" cy="28" r="2.8" fill="url(#lf-pupil)"/>
        <circle class="lumi-face__pupil lumi-face__pupil--r" cx="44" cy="28" r="2.8" fill="url(#lf-pupil)"/>
        <ellipse cx="18" cy="26" rx="2" ry="1.2" fill="rgba(255,255,255,0.5)"/>
        <ellipse cx="42" cy="26" rx="2" ry="1.2" fill="rgba(255,255,255,0.5)"/>
        <path class="lumi-face__mouth" d="M18 42 Q32 54 46 42" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>
        <ellipse cx="28" cy="18" rx="8" ry="3" fill="rgba(255,255,255,0.08)" transform="rotate(-15 28 18)"/>
        <circle class="lumi-face__spark lumi-face__spark--1" cx="12" cy="16" r="1.2" fill="#06b6d4"/>
        <circle class="lumi-face__spark lumi-face__spark--2" cx="52" cy="14" r="1" fill="#3b82f6"/>
        <circle class="lumi-face__spark lumi-face__spark--3" cx="50" cy="50" r="0.8" fill="#a855f7"/>
      </svg>
      <span class="lumi-fab__badge"></span>
    `

    // Chat window
    const win = document.createElement('div')
    win.className = 'lumi-window'
    win.setAttribute('role', 'dialog')
    win.setAttribute('aria-label', 'Chat with Lumi')
    win.innerHTML = `
      <div class="lumi-header">
        <div class="lumi-avatar">
          <svg class="lumi-face lumi-face--header" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="lh-sphere" cx="38%" cy="35%" r="55%">
                <stop offset="0%" stop-color="#1e90ff"/>
                <stop offset="50%" stop-color="#0a5eaa"/>
                <stop offset="100%" stop-color="#042a4a"/>
              </radialGradient>
              <radialGradient id="lh-shine" cx="35%" cy="25%" r="40%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.45)"/>
                <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
              </radialGradient>
            </defs>
            <circle cx="32" cy="32" r="28" fill="url(#lh-sphere)"/>
            <circle cx="32" cy="32" r="28" fill="url(#lh-shine)"/>
            <circle class="lumi-face__glow" cx="32" cy="32" r="28" fill="none" stroke="rgba(6,182,212,0.35)" stroke-width="1.5"/>
            <path class="lumi-face__bolt" d="M38 2L18 34h16l-3 26 20-34H33l5-24z" fill="rgba(255,255,255,0.5)" stroke="#fff" stroke-width="1.2"/>
            <circle class="lumi-face__eye lumi-face__eye--l" cx="20" cy="28" r="5.5" fill="url(#lf-eye)"/>
            <circle class="lumi-face__eye lumi-face__eye--r" cx="44" cy="28" r="5.5" fill="url(#lf-eye)"/>
            <circle class="lumi-face__pupil lumi-face__pupil--l" cx="20" cy="28" r="2.8" fill="url(#lf-pupil)"/>
            <circle class="lumi-face__pupil lumi-face__pupil--r" cx="44" cy="28" r="2.8" fill="url(#lf-pupil)"/>
            <ellipse cx="18" cy="26" rx="2" ry="1.2" fill="rgba(255,255,255,0.5)"/>
            <ellipse cx="42" cy="26" rx="2" ry="1.2" fill="rgba(255,255,255,0.5)"/>
            <path class="lumi-face__mouth" d="M18 42 Q32 54 46 42" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>
            <ellipse cx="28" cy="18" rx="8" ry="3" fill="rgba(255,255,255,0.08)" transform="rotate(-15 28 18)"/>
            <circle class="lumi-face__spark lumi-face__spark--1" cx="10" cy="14" r="1" fill="#06b6d4"/>
            <circle class="lumi-face__spark lumi-face__spark--2" cx="54" cy="12" r="0.8" fill="#3b82f6"/>
          </svg>
        </div>
        <div class="lumi-header__info">
          <div class="lumi-header__name">Lumi</div>
          <div class="lumi-header__status">Online</div>
        </div>
        <button class="lumi-close" aria-label="Close chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="lumi-messages" id="lumiMessages"></div>
      <div class="lumi-input-area">
        <textarea class="lumi-input" id="lumiInput" placeholder="Ask Lumi anything..." rows="1" maxlength="1000"></textarea>
        <button class="lumi-send" id="lumiSend" aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div class="lumi-powered">Powered by Luzerge AI</div>
    `

    document.body.appendChild(win)
    document.body.appendChild(fab)

    return { fab, win }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  const MINI_FACE = `<svg class="lumi-face lumi-face--mini" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="lm-sphere" cx="38%" cy="35%" r="55%">
        <stop offset="0%" stop-color="#0e2a47"/>
        <stop offset="50%" stop-color="#0a1628"/>
        <stop offset="100%" stop-color="#050a14"/>
      </radialGradient>
      <radialGradient id="lm-shine" cx="35%" cy="25%" r="40%">
        <stop offset="0%" stop-color="rgba(6,182,212,0.3)"/>
        <stop offset="100%" stop-color="rgba(6,182,212,0)"/>
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="28" fill="url(#lm-sphere)"/>
    <circle cx="32" cy="32" r="28" fill="url(#lm-shine)"/>
    <path class="lumi-face__bolt" d="M38 2L18 34h16l-3 26 20-34H33l5-24z" fill="rgba(255,255,255,0.4)" stroke="#fff" stroke-width="0.8"/>
    <circle class="lumi-face__eye lumi-face__eye--l" cx="20" cy="28" r="5.5" fill="#fff"/>
    <circle class="lumi-face__eye lumi-face__eye--r" cx="44" cy="28" r="5.5" fill="#fff"/>
    <circle class="lumi-face__pupil lumi-face__pupil--l" cx="20" cy="28" r="2.8" fill="#0a0e1a"/>
    <circle class="lumi-face__pupil lumi-face__pupil--r" cx="44" cy="28" r="2.8" fill="#0a0e1a"/>
    <ellipse cx="18" cy="26" rx="1.5" ry="1" fill="rgba(255,255,255,0.5)"/>
    <ellipse cx="42" cy="26" rx="1.5" ry="1" fill="rgba(255,255,255,0.5)"/>
    <path class="lumi-face__mouth" d="M18 42 Q32 54 46 42" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>
  </svg>`

  function addMessage(container, text, type) {
    const wrapper = document.createElement('div')
    wrapper.className = 'lumi-msg-row lumi-msg-row--' + type

    if (type === 'bot') {
      const avatar = document.createElement('div')
      avatar.className = 'lumi-msg-avatar'
      avatar.innerHTML = MINI_FACE
      wrapper.appendChild(avatar)
    }

    const div = document.createElement('div')
    div.className = 'lumi-msg lumi-msg--' + type
    // Basic markdown: **bold**, `code`, newlines
    let html = escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:.75rem">$1</code>')
      .replace(/\n/g, '<br>')
    div.innerHTML = html
    wrapper.appendChild(div)
    container.appendChild(wrapper)
    container.scrollTop = container.scrollHeight
  }

  function showTyping(container) {
    const wrapper = document.createElement('div')
    wrapper.className = 'lumi-msg-row lumi-msg-row--bot'
    wrapper.id = 'lumiTyping'

    const avatar = document.createElement('div')
    avatar.className = 'lumi-msg-avatar'
    avatar.innerHTML = MINI_FACE
    wrapper.appendChild(avatar)

    const div = document.createElement('div')
    div.className = 'lumi-msg lumi-msg--typing'
    div.innerHTML = '<div class="lumi-dots"><span></span><span></span><span></span></div>'
    wrapper.appendChild(div)
    container.appendChild(wrapper)
    container.scrollTop = container.scrollHeight
  }

  function hideTyping() {
    const el = document.getElementById('lumiTyping')
    if (el) el.remove()
  }

  function autoResize(textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px'
  }

  // ─── Send message ──────────────────────────────────────────────

  async function sendMessage(input, messages, sendBtn) {
    const text = input.value.trim()
    if (!text || isLoading) return

    isLoading = true
    sendBtn.disabled = true
    input.value = ''
    autoResize(input)

    addMessage(messages, text, 'user')
    history.push({ role: 'user', text: text })
    showTyping(messages)

    try {
      // Use user's JWT if logged in, otherwise fall back to anon key
      const userToken = getUserToken()
      const authToken = userToken || SUPABASE_ANON_KEY

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + authToken,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ message: text, history: history.slice(-10) }),
      })

      hideTyping()

      const data = await res.json()

      if (!res.ok) {
        addMessage(messages, data.error || 'Something went wrong. Please try again.', 'bot')
      } else {
        const reply = data.reply || "Sorry, I couldn't process that."
        addMessage(messages, reply, 'bot')
        history.push({ role: 'model', text: reply })
      }
    } catch {
      hideTyping()
      addMessage(messages, 'Connection error. Please check your internet and try again.', 'bot')
    }

    isLoading = false
    sendBtn.disabled = false
    input.focus()
  }

  // ─── Init ──────────────────────────────────────────────────────

  function init() {
    const { fab, win } = createWidget()
    const messages = win.querySelector('#lumiMessages')
    const input = win.querySelector('#lumiInput')
    const sendBtn = win.querySelector('#lumiSend')
    const closeBtn = win.querySelector('.lumi-close')

    // Welcome message (personalized if logged in)
    const welcome = getUserToken() ? WELCOME_USER : WELCOME_GUEST
    addMessage(messages, welcome, 'bot')

    // Toggle
    fab.addEventListener('click', () => {
      isOpen = !isOpen
      win.classList.toggle('is-open', isOpen)
      fab.setAttribute('aria-expanded', isOpen)
      if (isOpen) input.focus()
    })

    closeBtn.addEventListener('click', () => {
      isOpen = false
      win.classList.remove('is-open')
      fab.setAttribute('aria-expanded', 'false')
    })

    // Send
    sendBtn.addEventListener('click', () => sendMessage(input, messages, sendBtn))

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage(input, messages, sendBtn)
      }
    })

    input.addEventListener('input', () => autoResize(input))

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        isOpen = false
        win.classList.remove('is-open')
        fab.setAttribute('aria-expanded', 'false')
      }
    })

    // ─── Live face: eyes follow cursor (throttled via rAF) ─────
    var _rafPending = false
    var _lastMx = 0, _lastMy = 0
    var clamp = function (v, max) { return Math.max(-max, Math.min(max, v)) }

    function updatePupils() {
      _rafPending = false
      var pupils = document.querySelectorAll('.lumi-face__pupil')
      var ww = window.innerWidth, wh = window.innerHeight
      for (var i = 0; i < pupils.length; i++) {
        var p = pupils[i]
        var svg = p.closest('svg')
        if (!svg) continue
        // Cache original positions
        if (!p._ox) {
          p._ox = parseFloat(p.getAttribute('cx'))
          p._oy = parseFloat(p.getAttribute('cy'))
        }
        var rect = svg.getBoundingClientRect()
        var dx = (_lastMx - rect.left - rect.width / 2) / ww * 3
        var dy = (_lastMy - rect.top - rect.height / 2) / wh * 3
        p.setAttribute('cx', p._ox + clamp(dx, 2.2))
        p.setAttribute('cy', p._oy + clamp(dy, 1.8))
      }
    }

    document.addEventListener('mousemove', function (e) {
      _lastMx = e.clientX
      _lastMy = e.clientY
      if (!_rafPending) {
        _rafPending = true
        requestAnimationFrame(updatePupils)
      }
    }, { passive: true })

    // Blink every 3-5 seconds
    function blink() {
      var eyes = document.querySelectorAll('.lumi-face__eye')
      var pups = document.querySelectorAll('.lumi-face__pupil')
      for (var i = 0; i < eyes.length; i++) {
        eyes[i]._r = eyes[i].getAttribute('r')
        eyes[i].setAttribute('r', '0.5')
      }
      for (var j = 0; j < pups.length; j++) {
        pups[j]._r = pups[j].getAttribute('r')
        pups[j].setAttribute('r', '0')
      }
      setTimeout(function () {
        for (var i = 0; i < eyes.length; i++) eyes[i].setAttribute('r', eyes[i]._r)
        for (var j = 0; j < pups.length; j++) pups[j].setAttribute('r', pups[j]._r)
      }, 150)
      setTimeout(blink, 3000 + Math.random() * 2000)
    }
    setTimeout(blink, 2000)
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
