/**
 * Lumi — Luzerge AI Chat Widget
 * Floating chat powered by Google Gemini via edge function
 */
;(function () {
  'use strict'

  const SUPABASE_URL = window.__LUZERGE_CONFIG?.SUPABASE_URL || 'https://byzuraeyhrxxpztredri.supabase.co'
  const SUPABASE_ANON_KEY = window.__LUZERGE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5enVyYWV5aHJ4eHB6dHJlZHJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjgxMTYsImV4cCI6MjA4OTAwNDExNn0.b_Plo15IWR8g5XPlN8XUs7Cpo2WZwt0UkrawfssIgZU'
  const ENDPOINT = SUPABASE_URL + '/functions/v1/lumi-chat'
  const WELCOME = "Hi! I'm Lumi, your Luzerge assistant. Ask me anything about our plans, features, or how to get started."

  let isOpen = false
  let isLoading = false
  let history = [] // { role: 'user'|'model', text: string }

  // ─── Create DOM ────────────────────────────────────────────────

  function createWidget() {
    // FAB button
    const fab = document.createElement('button')
    fab.className = 'lumi-fab'
    fab.setAttribute('aria-label', 'Chat with Lumi')
    fab.setAttribute('aria-expanded', 'false')
    fab.innerHTML = `
      <svg class="lumi-face" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle class="lumi-face__glow" cx="32" cy="32" r="28" fill="none" stroke="rgba(6,182,212,0.3)" stroke-width="2"/>
        <circle class="lumi-face__eye lumi-face__eye--l" cx="22" cy="28" r="3.5" fill="#fff"/>
        <circle class="lumi-face__eye lumi-face__eye--r" cx="42" cy="28" r="3.5" fill="#fff"/>
        <circle class="lumi-face__pupil lumi-face__pupil--l" cx="22" cy="28" r="1.8" fill="#0a0e1a"/>
        <circle class="lumi-face__pupil lumi-face__pupil--r" cx="42" cy="28" r="1.8" fill="#0a0e1a"/>
        <path class="lumi-face__mouth" d="M22 40 Q32 48 42 40" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/>
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
          <svg class="lumi-face lumi-face--sm" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle class="lumi-face__eye lumi-face__eye--l" cx="22" cy="28" r="3.5" fill="#fff"/>
            <circle class="lumi-face__eye lumi-face__eye--r" cx="42" cy="28" r="3.5" fill="#fff"/>
            <circle class="lumi-face__pupil lumi-face__pupil--l" cx="22" cy="28" r="1.8" fill="#0a0e1a"/>
            <circle class="lumi-face__pupil lumi-face__pupil--r" cx="42" cy="28" r="1.8" fill="#0a0e1a"/>
            <path class="lumi-face__mouth" d="M22 40 Q32 48 42 40" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/>
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

  function addMessage(container, text, type) {
    const div = document.createElement('div')
    div.className = 'lumi-msg lumi-msg--' + type
    // Basic markdown: **bold**, `code`, newlines
    let html = escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:.75rem">$1</code>')
      .replace(/\n/g, '<br>')
    div.innerHTML = html
    container.appendChild(div)
    container.scrollTop = container.scrollHeight
  }

  function showTyping(container) {
    const div = document.createElement('div')
    div.className = 'lumi-msg lumi-msg--typing'
    div.id = 'lumiTyping'
    div.innerHTML = '<div class="lumi-dots"><span></span><span></span><span></span></div>'
    container.appendChild(div)
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
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
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

    // Welcome message
    addMessage(messages, WELCOME, 'bot')

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

    // ─── Live face: eyes follow cursor ─────────────────────────
    const pupils = document.querySelectorAll('.lumi-face__pupil')
    document.addEventListener('mousemove', (e) => {
      pupils.forEach(p => {
        const svg = p.closest('svg')
        if (!svg) return
        const rect = svg.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const dx = (e.clientX - cx) / window.innerWidth * 3
        const dy = (e.clientY - cy) / window.innerHeight * 3
        const clamp = (v, max) => Math.max(-max, Math.min(max, v))
        p.setAttribute('cx', parseFloat(p.dataset.origCx || p.getAttribute('cx')) + clamp(dx, 2.2))
        p.setAttribute('cy', parseFloat(p.dataset.origCy || p.getAttribute('cy')) + clamp(dy, 1.8))
        if (!p.dataset.origCx) {
          p.dataset.origCx = p.getAttribute('cx')
          p.dataset.origCy = p.getAttribute('cy')
        }
      })
    })

    // Blink every 3-5 seconds
    function blink() {
      const eyes = document.querySelectorAll('.lumi-face__eye')
      const pups = document.querySelectorAll('.lumi-face__pupil')
      eyes.forEach(e => { e._r = e.getAttribute('r'); e.setAttribute('r', '0.5') })
      pups.forEach(p => { p._r = p.getAttribute('r'); p.setAttribute('r', '0') })
      setTimeout(() => {
        eyes.forEach(e => e.setAttribute('r', e._r))
        pups.forEach(p => p.setAttribute('r', p._r))
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
