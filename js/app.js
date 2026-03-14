/**
 * Luzerge.com — Frontend JavaScript
 * Handles: contact form, nav mobile menu, analytics, char count,
 *          starfield, scroll animations, parallax, hero reveal,
 *          scroll-driven rocket, scroll progress bar
 */

'use strict'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = '/api'
const SESSION_ID = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)

// ─── Analytics (privacy-first, no cookies) ───────────────────────────────────

function trackEvent(eventType, extra = {}) {
  const payload = {
    event_type: eventType,
    page_path: location.pathname,
    referrer: document.referrer || null,
    utm_source: new URLSearchParams(location.search).get('utm_source'),
    utm_medium: new URLSearchParams(location.search).get('utm_medium'),
    utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
    session_id: SESSION_ID,
    ...extra,
  }

  fetch(`${API_BASE}/analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {})
}

// ─── Contact form ─────────────────────────────────────────────────────────────

function initContactForm() {
  const form = document.getElementById('contactForm')
  if (!form) return

  const submitBtn = document.getElementById('submitBtn')
  const formSuccess = document.getElementById('formSuccess')
  const formError = document.getElementById('formError')
  const charCount = document.getElementById('charCount')
  const messageInput = document.getElementById('message')

  if (messageInput && charCount) {
    messageInput.addEventListener('input', () => {
      charCount.textContent = `${messageInput.value.length} / 2000`
    })
  }

  let formStarted = false
  form.addEventListener('focusin', () => {
    if (!formStarted) {
      formStarted = true
      trackEvent('form_start')
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearErrors()
    formSuccess.hidden = true
    formError.hidden = true

    const data = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim() || undefined,
      service: form.service.value || undefined,
      message: form.message.value.trim(),
    }

    if (!validate(data)) return

    submitBtn.disabled = true
    submitBtn.textContent = 'Sending…'
    trackEvent('form_submit')

    try {
      const res = await fetch(`${API_BASE}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const json = await res.json()

      if (res.ok && json.success) {
        form.reset()
        if (charCount) charCount.textContent = '0 / 2000'
        formSuccess.hidden = false
        formSuccess.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        trackEvent('form_success')
      } else {
        formError.hidden = false
        trackEvent('form_error', { error: json.error })
      }
    } catch {
      formError.hidden = false
      trackEvent('form_error', { error: 'network_error' })
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Send Message →'
    }
  })
}

function validate(data) {
  let valid = true

  if (!data.name || data.name.length < 2) {
    setError('name', 'nameError', 'Please enter your full name (at least 2 characters)')
    valid = false
  }

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    setError('email', 'emailError', 'Please enter a valid email address')
    valid = false
  }

  if (!data.message || data.message.length < 10) {
    setError('message', 'messageError', 'Please tell us a bit more (at least 10 characters)')
    valid = false
  }

  if (data.message && data.message.length > 2000) {
    setError('message', 'messageError', 'Message must be 2000 characters or less')
    valid = false
  }

  return valid
}

function setError(inputId, errorId, message) {
  const input = document.getElementById(inputId)
  const error = document.getElementById(errorId)
  if (input) input.classList.add('is-invalid')
  if (error) error.textContent = message
}

function clearErrors() {
  document.querySelectorAll('.form-input').forEach(el => el.classList.remove('is-invalid'))
  document.querySelectorAll('.form-error').forEach(el => { el.textContent = '' })
}

// ─── Mobile navigation ────────────────────────────────────────────────────────

function initMobileNav() {
  const toggle = document.querySelector('.nav__toggle')
  const links = document.querySelector('.nav__links')
  if (!toggle || !links) return

  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('is-open')
    toggle.setAttribute('aria-expanded', isOpen.toString())
  })

  links.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      links.classList.remove('is-open')
      toggle.setAttribute('aria-expanded', 'false')
    })
  })

  document.addEventListener('click', (e) => {
    if (!toggle.contains(e.target) && !links.contains(e.target)) {
      links.classList.remove('is-open')
      toggle.setAttribute('aria-expanded', 'false')
    }
  })
}

// ─── Footer year ─────────────────────────────────────────────────────────────

function setFooterYear() {
  const el = document.getElementById('footerYear')
  if (el) el.textContent = new Date().getFullYear()
}

// ─── Scroll-driven reveal animations ──────────────────────────────────────────

function initScrollReveals() {
  if (!('IntersectionObserver' in window)) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Show everything immediately
    document.querySelectorAll('[data-scroll-reveal]').forEach(el => {
      el.style.opacity = '1'
      el.style.transform = 'none'
    })
    return
  }

  // Track reveal index per parent for stagger
  const revealedParents = new WeakMap()

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return

        const el = entry.target
        const parent = el.parentElement

        // Stagger delay based on sibling order
        if (!revealedParents.has(parent)) {
          revealedParents.set(parent, 0)
        }
        const index = revealedParents.get(parent)
        revealedParents.set(parent, index + 1)

        el.style.transitionDelay = (index * 80) + 'ms'
        el.classList.add('is-revealed')

        observer.unobserve(el)
      })
    },
    { threshold: 0.08, rootMargin: '0px 0px -60px 0px' }
  )

  document.querySelectorAll('[data-scroll-reveal]').forEach(el => {
    observer.observe(el)
  })
}

// ─── Hero starfield canvas animation ──────────────────────────────────────────

function initStarfield() {
  const canvas = document.getElementById('heroStarfield')
  if (!canvas) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  let stars = []
  let animId = null

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
  }

  function createStars(count) {
    count = count || 120
    stars = []
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.5 + 0.5,
        speed: Math.random() * 0.5 + 0.1,
        opacity: Math.random() * 0.6 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleOffset: Math.random() * Math.PI * 2,
      })
    }
  }

  function draw(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    stars.forEach(function(star) {
      const flicker = Math.sin(time * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
      ctx.beginPath()
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (star.opacity * flicker) + ')'
      ctx.fill()

      star.y += star.speed
      if (star.y > canvas.height) {
        star.y = 0
        star.x = Math.random() * canvas.width
      }
    })
    animId = requestAnimationFrame(draw)
  }

  resize()
  createStars()
  animId = requestAnimationFrame(draw)

  window.addEventListener('resize', function() {
    resize()
    createStars()
  })

  const observer = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) {
      if (!animId) animId = requestAnimationFrame(draw)
    } else {
      if (animId) {
        cancelAnimationFrame(animId)
        animId = null
      }
    }
  })
  observer.observe(canvas)
}

// ─── Hero accent text reveal ──────────────────────────────────────────────────

function initHeroReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const accent = document.querySelector('.hero__accent')
  if (!accent) return

  accent.style.opacity = '0'
  accent.style.transition = 'opacity 0.8s ease, filter 0.8s ease'
  accent.style.filter = 'blur(8px)'

  setTimeout(function() {
    accent.style.opacity = '1'
    accent.style.filter = 'blur(0)'
  }, 300)
}

// ─── Scroll-driven effects (rocket, progress bar, nav, parallax) ─────────────

function initScrollEffects() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const nav = document.querySelector('.nav')
  const rocket = document.getElementById('scrollRocket')
  const progressBar = document.getElementById('scrollProgress')
  const hero = document.querySelector('.hero')
  const stats = document.querySelector('.hero__stats')
  const sections = document.querySelectorAll('[data-scroll-section]')

  let ticking = false

  function onScroll() {
    if (ticking) return
    ticking = true

    requestAnimationFrame(function() {
      const scrollY = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const scrollPercent = docHeight > 0 ? scrollY / docHeight : 0

      // ── Scroll progress bar
      if (progressBar) {
        progressBar.style.width = (scrollPercent * 100) + '%'
      }

      // ── Nav solidify on scroll
      if (nav) {
        if (scrollY > 50) {
          nav.style.background = 'rgba(10, 14, 26, 0.95)'
          nav.style.borderBottomColor = 'rgba(59, 130, 246, 0.2)'
        } else {
          nav.style.background = 'rgba(10, 14, 26, 0.85)'
          nav.style.borderBottomColor = 'rgba(255, 255, 255, 0.1)'
        }
      }

      // ── Rocket flies from bottom-right to top-right as you scroll
      if (rocket && !reducedMotion) {
        if (scrollPercent > 0.03) {
          rocket.classList.add('is-visible')
          // Map scroll progress to bottom position: starts at 5%, ends at 90%
          var bottomPos = 5 + (scrollPercent * 85)
          rocket.style.bottom = bottomPos + '%'
        } else {
          rocket.classList.remove('is-visible')
          rocket.style.bottom = '5%'
        }
      }

      // ── Hero parallax (stats float, hero content fades)
      if (!reducedMotion && hero && stats) {
        var heroH = hero.offsetHeight
        if (scrollY < heroH) {
          var factor = scrollY / heroH
          stats.style.transform = 'translateY(' + (factor * -30) + 'px)'
          stats.style.opacity = 1 - factor * 0.4
        }
      }

      // ── Subtle parallax on sections (shift content slightly)
      if (!reducedMotion) {
        sections.forEach(function(section) {
          var rect = section.getBoundingClientRect()
          var winH = window.innerHeight
          if (rect.top < winH && rect.bottom > 0) {
            var progress = (winH - rect.top) / (winH + rect.height)
            var shift = (progress - 0.5) * 20
            section.style.transform = 'translateY(' + shift + 'px)'
          }
        })
      }

      ticking = false
    })
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  // Run once on load to set initial state
  onScroll()
}

// ─── Page view tracking ───────────────────────────────────────────────────────

function initPageTracking() {
  setTimeout(() => trackEvent('page_view'), 500)
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav()
  initContactForm()
  initScrollReveals()
  initStarfield()
  initHeroReveal()
  initScrollEffects()
  setFooterYear()
  initPageTracking()
})
