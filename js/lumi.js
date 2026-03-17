/**
 * Lumi — Luzerge AI Chat Widget
 * Floating chat powered by Google Gemini via edge function
 */
;(function () {
  'use strict'

  const SUPABASE_URL = window.__LUZERGE_CONFIG?.SUPABASE_URL || 'https://byzuraeyhrxxpztredri.supabase.co'
  const SUPABASE_ANON_KEY = window.__LUZERGE_CONFIG?.SUPABASE_ANON_KEY || ''
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
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
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
