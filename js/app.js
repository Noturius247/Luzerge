/**
 * Luzerge.com — Frontend JavaScript
 * Handles: contact form, nav mobile menu, analytics, char count,
 *          starfield, scroll animations, parallax, hero reveal,
 *          scroll-driven rocket, scroll progress bar
 */

'use strict'

// ─── Deferred Google Fonts (CSP-safe) ────────────────────────────────────────
var _gf = document.getElementById('googleFonts')
if (_gf) _gf.media = 'all'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1/api'
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

// ─── Full-page starfield canvas animation ─────────────────────────────────────

function initStarfield() {
  const canvas = document.getElementById('heroStarfield')
  if (!canvas) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  let stars = []
  let animId = null
  let scrollSpeed = 0  // extra speed from scrolling up
  let lastScrollY = window.scrollY
  let targetScrollSpeed = 0

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }

  function createStars(count) {
    count = count || 180
    stars = []
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.5 + 0.5,
        baseSpeed: Math.random() * 0.3 + 0.05,
        opacity: Math.random() * 0.6 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleOffset: Math.random() * Math.PI * 2,
      })
    }
  }

  // Track scroll direction and speed
  window.addEventListener('scroll', function() {
    var currentY = window.scrollY
    var delta = currentY - lastScrollY
    lastScrollY = currentY

    if (delta < 0) {
      // Scrolling up — stars move down fast (like flying upward through space)
      targetScrollSpeed = Math.min(Math.abs(delta) * 0.8, 25)
    } else {
      targetScrollSpeed = 0
    }
  }, { passive: true })

  function draw(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Smoothly interpolate scroll speed
    scrollSpeed += (targetScrollSpeed - scrollSpeed) * 0.1
    // Decay target back to 0
    targetScrollSpeed *= 0.92

    stars.forEach(function(star) {
      const flicker = Math.sin(time * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
      ctx.beginPath()
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (star.opacity * flicker) + ')'
      ctx.fill()

      // Idle drift + scroll boost
      star.y += star.baseSpeed + scrollSpeed * (star.size * 0.8)

      // Wrap around
      if (star.y > canvas.height) {
        star.y = 0
        star.x = Math.random() * canvas.width
      }
      if (star.y < 0) {
        star.y = canvas.height
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
  const landingPad = document.getElementById('landingPad')
  const progressBar = document.getElementById('scrollProgress')
  const hero = document.querySelector('.hero')
  const stats = document.querySelector('.hero__stats')
  const sections = document.querySelectorAll('[data-scroll-section]')

  let scheduled = false
  let lastScrollY = window.scrollY
  let scrollDir = 1  // 1 = down, -1 = up
  let rocketAngle = 0  // current rendered angle, smoothed (starts upright)
  let rocketStartX = null
  let rocketStartY = null
  window._rocketT = 0

  // Capture rocket start position from anchor on load — tight beside "Business"
  var anchor = document.getElementById('rocketAnchor')
  if (anchor) {
    var anchorRect = anchor.getBoundingClientRect()
    rocketStartX = (anchorRect.left / window.innerWidth) * 100 - 3
    rocketStartY = (anchorRect.top / window.innerHeight) * 100 - 4
    if (rocket) {
      rocket.style.transform = 'translate(' + rocketStartX + 'vw, ' + rocketStartY + 'vh) scale(1.2) rotate(0deg)'
    }
  }

  function onScroll() {
    // Always capture direction from latest event
    var currentY = window.scrollY
    scrollDir = currentY >= lastScrollY ? 1 : -1
    lastScrollY = currentY

    if (scheduled) return
    scheduled = true

    requestAnimationFrame(function() {
      scheduled = false
      // Read fresh scroll position (not stale from event time)
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

      // ── Rocket: always visible, starts beside "Business" in hero, arcs to landing pad
      if (rocket && !reducedMotion) {
        // Always visible
        rocket.style.opacity = 0.4
        rocket.classList.add('is-visible')

        // t goes 0→1 over the full scroll
        var t = Math.min(scrollPercent / 0.8, 1)
        window._rocketT = t

        // Toggle landed state — lights off when fully landed
        if (t >= 0.99) {
          rocket.classList.add('is-landed')
        } else {
          rocket.classList.remove('is-landed')
        }

        // Smooth ease-in-out
        var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

        var startX = rocketStartX || 55
        var startY = rocketStartY || 12
        var cpX = 20, cpY = 5
        var endX = 3, endY = 68

        // Add a vertical lift-off zone: first 10% of reverse travel goes straight up
        // by using a secondary control point near the landing position
        var liftCpX = endX, liftCpY = endY - 20

        // Cubic Bezier: Start → CP1 (arc top) → CP2 (straight above landing) → End
        var u = 1 - eased
        var x = u*u*u * startX + 3*u*u*eased * cpX + 3*u*eased*eased * liftCpX + eased*eased*eased * endX
        var y = u*u*u * startY + 3*u*u*eased * cpY + 3*u*eased*eased * liftCpY + eased*eased*eased * endY

        // Scale: start larger (1.2) as background element, shrink to full as it lands
        var startScale = 1.2
        var scale = startScale + eased * (1 - startScale)

        // Rotation depends on scroll direction
        var targetAngle

        // Smoothstep function
        function smoothstep(a, b, v) {
          var c = Math.max(0, Math.min(1, (v - a) / (b - a)))
          return c * c * (3 - 2 * c)
        }

        if (scrollDir === 1) {
          // Scrolling DOWN: follow curve tangent, upright at start and landing
          var u2 = 1 - eased
          var tx = 3*u2*u2*(cpX - startX) + 6*u2*eased*(liftCpX - cpX) + 3*eased*eased*(endX - liftCpX)
          var ty = 3*u2*u2*(cpY - startY) + 6*u2*eased*(liftCpY - cpY) + 3*eased*eased*(endY - liftCpY)
          var tangentAngle = Math.atan2(ty, tx) * (180 / Math.PI) + 90

          var rampUp = smoothstep(0, 0.2, t)
          var rampDown = 1 - smoothstep(0.7, 1, t)
          rocketAngle = tangentAngle * rampUp * rampDown
        } else {
          // Scrolling UP: point nose toward start position, upright at both ends
          var dx = startX - x
          var dy = startY - y
          var dist = Math.sqrt(dx * dx + dy * dy)
          var pointAngle = dist > 2 ? Math.atan2(dy, dx) * (180 / Math.PI) + 90 : 0

          var rampUp = 1 - smoothstep(0.65, 0.85, t)
          var rampDown = smoothstep(0.15, 0.35, t)
          rocketAngle = pointAngle * rampUp * rampDown
        }

        rocket.style.transform = 'translate(' + x + 'vw, ' + y + 'vh) scale(' + scale + ') rotate(' + rocketAngle + 'deg)'

        // Landing platform fades in during last 40%
        if (landingPad) {
          var padProgress = Math.max(0, (t - 0.6) / 0.4)
          var padEased = 1 - Math.pow(1 - padProgress, 2)
          landingPad.style.opacity = padEased
          landingPad.style.transform = 'scale(' + (0.6 + padEased * 0.4) + ')'
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

    })
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  // Run once on load to set initial state
  onScroll()
}

// ─── 3D Glass Rotating Carousel ───────────────────────────────────────────────

function initDragCards() {
  var grids = document.querySelectorAll('.services__grid, .pricing__grid')

  grids.forEach(function(grid) {
    var allCards = Array.from(grid.querySelectorAll('.service-card, .pricing-card'))
    var cards = allCards.filter(function(c) { return getComputedStyle(c).display !== 'none' })
    var count = cards.length
    var angleStep = 360 / count
    var radius = window.innerWidth <= 380 ? 180 : window.innerWidth <= 768 ? 250 : 380
    var currentAngle = 0
    var targetAngle = 0
    var isDragging = false
    var originX = 0
    var rafId = null

    function isHidden(c) { return getComputedStyle(c).display === 'none' || c.style.display === 'none' }

    // Recalculate visible cards (called when pricing mode changes)
    grid._relayout = function() {
      cards = allCards.filter(function(c) { return !isHidden(c) })
      count = cards.length
      angleStep = 360 / count
      currentAngle = 0
      targetAngle = 0
      layoutCards()
    }

    // Position cards in a 3D circle
    function layoutCards() {
      allCards.forEach(function(card) {
        if (isHidden(card)) {
          card.style.opacity = '0'
          card.style.zIndex = '-1'
          return
        }
      })
      cards.forEach(function(card, i) {
        var cardAngle = currentAngle + (i * angleStep)
        var rad = cardAngle * (Math.PI / 180)
        var x = Math.sin(rad) * radius
        var z = Math.cos(rad) * radius
        // Cards facing away get faded but still visible
        var faceFactor = (z + radius) / (2 * radius)  // 0 = back, 1 = front
        var opacity = 0.25 + faceFactor * 0.75
        var scale = 0.8 + faceFactor * 0.2

        card.style.transform = 'translateX(' + x + 'px) translateZ(' + z + 'px) scale(' + scale + ')'
        card.style.opacity = opacity
        card.style.zIndex = Math.round(faceFactor * 10)
      })
    }

    // Smooth animation loop
    function animate() {
      // Lerp current toward target
      var diff = targetAngle - currentAngle
      currentAngle += diff * 0.1

      if (Math.abs(diff) > 0.1 || isDragging) {
        layoutCards()
        rafId = requestAnimationFrame(animate)
      } else {
        currentAngle = targetAngle
        layoutCards()
        rafId = null
      }
    }

    function startAnimation() {
      if (!rafId) rafId = requestAnimationFrame(animate)
    }

    // Initial layout
    layoutCards()

    // Drag to rotate
    function onPointerDown(e) {
      isDragging = true
      originX = e.clientX
      grid.style.cursor = 'grabbing'
      // Kill CSS transitions during drag for responsiveness
      cards.forEach(function(c) { c.style.transition = 'none' })
      startAnimation()
    }

    function onPointerMove(e) {
      if (!isDragging) return
      e.preventDefault()
      var dx = e.clientX - originX
      targetAngle = currentAngle + dx * 0.3
    }

    function onPointerUp() {
      if (!isDragging) return
      isDragging = false
      grid.style.cursor = 'grab'
      // Snap to nearest card facing front
      currentAngle = targetAngle
      var snapAngle = Math.round(currentAngle / angleStep) * angleStep
      targetAngle = snapAngle
      // Re-enable transitions
      cards.forEach(function(c) {
        c.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease'
      })
      startAnimation()
    }

    grid.style.cursor = 'grab'
    grid.addEventListener('mousedown', onPointerDown)
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)

    grid.addEventListener('touchstart', function(e) {
      onPointerDown({ clientX: e.touches[0].clientX })
    }, { passive: true })

    window.addEventListener('touchmove', function(e) {
      if (!isDragging) return
      onPointerMove({ clientX: e.touches[0].clientX, preventDefault: function() {} })
    }, { passive: true })

    window.addEventListener('touchend', onPointerUp)

    // Arrow buttons
    var wrap = grid.closest('.carousel-wrap')
    if (wrap) {
      wrap.querySelectorAll('.carousel-arrow').forEach(function(arrow) {
        arrow.addEventListener('click', function() {
          var dir = parseInt(arrow.getAttribute('data-dir'))
          targetAngle += dir * angleStep
          cards.forEach(function(c) {
            c.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease'
          })
          startAnimation()
        })
      })
    }

    // Click a card to bring it to center
    allCards.forEach(function(card) {
      card.addEventListener('click', function() {
        if (isHidden(card)) return
        var idx = cards.indexOf(card)
        if (idx < 0) return
        // Calculate the angle needed to bring this card to the front (z = max)
        var cardCurrentAngle = (currentAngle + idx * angleStep) % 360
        // Normalize to -180..180
        var rotation = -cardCurrentAngle
        if (rotation > 180) rotation -= 360
        if (rotation < -180) rotation += 360
        targetAngle = currentAngle + rotation
        cards.forEach(function(c) {
          c.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease'
        })
        startAnimation()
      })
    })
  })
}

// ─── Rocket smoke trail ───────────────────────────────────────────────────────

function initRocketSmoke() {
  var canvas = document.getElementById('rocketSmoke')
  var rocket = document.getElementById('scrollRocket')
  if (!canvas || !rocket) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (window.innerWidth <= 768) return  // skip on mobile

  var ctx = canvas.getContext('2d')
  var particles = []
  var lastRocketX = 0
  var lastRocketY = 0

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  function spawnSmoke(x, y, scale, burst) {
    var count = burst ? 8 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 2)
    var spread = burst ? 25 : 10
    var baseSize = burst ? 12 : 4
    var maxSize = burst ? 20 : 8
    for (var i = 0; i < count; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * spread * scale,
        y: y + (Math.random() - 0.5) * spread * scale,
        vx: (Math.random() - 0.5) * (burst ? 3 : 1.5),
        vy: burst ? (Math.random() - 0.5) * 2 : Math.random() * 0.5 + 0.3,
        size: (Math.random() * maxSize + baseSize) * scale,
        life: 1,
        decay: burst ? Math.random() * 0.01 + 0.005 : Math.random() * 0.015 + 0.008,
        color: Math.random() > 0.3 ? 'rgba(148,163,184,' : 'rgba(6,182,212,',
      })
    }
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Get rocket actual rendered position and rotation
    var rect = rocket.getBoundingClientRect()
    var rotMatch = rocket.style.transform.match(/rotate\(([-\d.]+)deg\)/)
    var angleDeg = rotMatch ? parseFloat(rotMatch[1]) : 0
    if (rect.width > 0) {
      var rScale = rect.width / 240

      // Rocket center (getBoundingClientRect gives the axis-aligned bounding box)
      var cx = rect.left + rect.width * 0.5
      var cy = rect.top + rect.height * 0.5

      // Flame offset from center: 0px horizontal, +45% of original height downward
      // Then rotate that offset by the rocket's angle
      var flameOffsetX = 0
      var flameOffsetY = rect.height * 0.45
      var rad = angleDeg * Math.PI / 180
      var smokeX = cx + flameOffsetX * Math.cos(rad) - flameOffsetY * Math.sin(rad)
      var smokeY = cy + flameOffsetX * Math.sin(rad) + flameOffsetY * Math.cos(rad)

      // Only spawn if rocket has moved and not landed
      var dx = smokeX - lastRocketX
      var dy = smokeY - lastRocketY
      var rt = window._rocketT || 0
      var isLanded = rt >= 0.99
      if (!isLanded && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        var isBurst = rt < 0.1 || rt > 0.9
        spawnSmoke(smokeX, smokeY, rScale, isBurst)
        lastRocketX = smokeX
        lastRocketY = smokeY
      }
    }

    // Update and draw particles
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i]
      p.x += p.vx
      p.y += p.vy
      p.size += 0.3
      p.life -= p.decay
      p.vx *= 0.98

      if (p.life <= 0) {
        particles.splice(i, 1)
        continue
      }

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fillStyle = p.color + (p.life * 0.3) + ')'
      ctx.fill()
    }

    // Cap particles
    if (particles.length > 400) {
      particles.splice(0, particles.length - 400)
    }

    requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}

// ─── Domain Scanner ──────────────────────────────────────────────────────────

function initScanner() {
  const form = document.getElementById('scannerForm')
  if (!form) return

  const input = document.getElementById('scannerInput')
  const btn = document.getElementById('scannerBtn')
  const resultsWrap = document.getElementById('scannerResults')
  const grid = document.getElementById('scannerGrid')
  const cta = document.getElementById('scannerCta')
  const loading = document.getElementById('scannerLoading')
  const errorEl = document.getElementById('scannerError')

  const LOOKUP_URL = 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1/domain-lookup'

  function cleanDomain(raw) {
    return raw.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/[^a-z0-9.\-]/g, '')
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  }

  // SVG line icons (24x24 viewBox, stroke-based, matching landing page style)
  const ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    shieldOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"/><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    mapPin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    dns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  }

  function resultCard(label, value, iconKey, valueClass) {
    const cls = valueClass ? `scanner__result-value ${valueClass}` : 'scanner__result-value'
    return `<div class="scanner__result-item">
      <span class="scanner__result-icon">${ICONS[iconKey] || ICONS.globe}</span>
      <div class="scanner__result-body">
        <span class="scanner__result-label">${escHtml(label)}</span>
        <span class="${cls}">${escHtml(value)}</span>
      </div>
    </div>`
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const domain = cleanDomain(input.value)
    if (!domain || !domain.includes('.')) {
      errorEl.textContent = 'Please enter a valid domain (e.g., example.com)'
      errorEl.hidden = false
      return
    }

    // Reset UI
    resultsWrap.hidden = true
    cta.hidden = true
    errorEl.hidden = true
    grid.innerHTML = ''
    loading.hidden = false
    btn.disabled = true
    btn.innerHTML = '<span class="loading-dots"><span></span><span></span><span></span></span> Scanning...'

    trackEvent('scanner_submit', { domain })

    try {
      const res = await fetch(`${LOOKUP_URL}?domain=${encodeURIComponent(domain)}`)
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Lookup failed')
      }

      if (!data.registered) {
        errorEl.textContent = `"${escHtml(domain)}" does not appear to be registered.`
        errorEl.hidden = false
        trackEvent('scanner_not_found', { domain })
        return
      }

      // Build results
      let html = ''

      html += resultCard('Status', 'Registered & Active', 'check', 'scanner__result-value--green')

      html += resultCard('Platform', data.platform || 'Unknown', 'globe')

      html += resultCard('Cloudflare Protection',
        data.is_on_cloudflare ? 'Active' : 'Not Detected',
        data.is_on_cloudflare ? 'shield' : 'shieldOff',
        data.is_on_cloudflare ? 'scanner__result-value--green' : 'scanner__result-value--amber')

      if (data.hosting) {
        html += resultCard('Hosting Provider', data.hosting.provider || 'Unknown', 'server')
        if (data.hosting.country) {
          html += resultCard('Server Location', data.hosting.country, 'mapPin')
        }
        if (data.hosting.ip) {
          html += resultCard('IP Address', data.hosting.ip, 'hash')
        }
      }

      if (data.nameservers && data.nameservers.length > 0) {
        const nsList = data.nameservers.slice(0, 4).map(ns =>
          `<span class="scanner__ns-tag">${escHtml(ns)}</span>`
        ).join('')
        html += `<div class="scanner__result-item scanner__result-item--full">
          <span class="scanner__result-icon">${ICONS.dns}</span>
          <div class="scanner__result-body">
            <span class="scanner__result-label">Nameservers</span>
            <div class="scanner__result-ns">${nsList}</div>
          </div>
        </div>`
      }

      grid.innerHTML = html
      resultsWrap.hidden = false
      cta.hidden = false
      resultsWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

      trackEvent('scanner_success', { domain, platform: data.platform, cloudflare: data.is_on_cloudflare })

    } catch (err) {
      console.error('Scanner error:', err)
      errorEl.textContent = 'Something went wrong. Please check the domain and try again.'
      errorEl.hidden = false
      trackEvent('scanner_error', { domain, error: err.message })
    } finally {
      loading.hidden = true
      btn.disabled = false
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan Domain'
    }
  })
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
  initRocketSmoke()
  initDragCards()
  setFooterYear()
  initScanner()
  initPageTracking()
  initPricingToggle()
  initCurrencyConverter()
})

// ─── Pricing mode toggle (Self-managed vs Managed) ──────────────────────────

let _pricingMode = 'self'
let _pricingCurrency = 'PHP'
let _pricingRate = 1
const _currencySymbols = {
  PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩',
  SGD: 'S$', AUD: 'A$', CAD: 'C$', INR: '₹', AED: 'د.إ',
  MYR: 'RM', THB: '฿', IDR: 'Rp', VND: '₫', CNY: '¥', BRL: 'R$',
}
// Currencies where decimals don't make sense
const _noDecimalCurrencies = new Set(['JPY', 'KRW', 'VND', 'IDR'])

function formatPrice(phpAmount, currency, rate) {
  if (phpAmount === 0) return `${_currencySymbols[currency] || currency}0`
  const converted = phpAmount * rate
  const sym = _currencySymbols[currency] || currency + ' '
  if (_noDecimalCurrencies.has(currency)) {
    return `${sym}${Math.round(converted).toLocaleString()}`
  }
  // Show decimals only if they exist
  const rounded = Math.round(converted * 100) / 100
  const formatted = rounded % 1 === 0 ? rounded.toLocaleString() : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sym}${formatted}`
}

function updateAllPrices() {
  document.querySelectorAll('.pricing-card__amount').forEach(el => {
    const baseSelf = parseFloat(el.dataset.baseSelf)
    const baseManaged = parseFloat(el.dataset.baseManaged)
    if (isNaN(baseSelf)) return
    const base = _pricingMode === 'managed' ? baseManaged : baseSelf
    el.textContent = formatPrice(base, _pricingCurrency, _pricingRate)
  })
}

function initPricingToggle() {
  const btns = document.querySelectorAll('.pricing-mode-btn')
  if (!btns.length) return

  const desc = document.getElementById('pricingModeDesc')
  const selfOnlyCards = document.querySelectorAll('[data-self-only]')
  const managedOnlyCards = document.querySelectorAll('[data-managed-only]')

  const descriptions = {
    self: 'You provide your own Cloudflare credentials \u2014 we provide the dashboard.',
    managed: 'Our team sets up and manages Cloudflare for you \u2014 fully hands-off.',
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode
      _pricingMode = mode
      btns.forEach(b => b.classList.remove('pricing-mode-btn--active'))
      btn.classList.add('pricing-mode-btn--active')

      if (desc) desc.textContent = descriptions[mode] || ''

      selfOnlyCards.forEach(c => c.style.display = mode === 'managed' ? 'none' : '')
      managedOnlyCards.forEach(c => {
        c.style.display = mode === 'self' ? 'none' : ''
        c.classList.toggle('pricing-card--managed-only', mode === 'self')
      })

      // Update prices with current currency
      updateAllPrices()

      const pricingGrid = document.querySelector('.pricing__grid')
      if (pricingGrid && pricingGrid._relayout) {
        setTimeout(() => pricingGrid._relayout(), 50)
      }
    })
  })
}

// ─── Currency converter ──────────────────────────────────────────────────────

let _ratesCache = null

async function fetchRates() {
  if (_ratesCache) return _ratesCache
  try {
    // Free exchange rate API — no API key needed
    const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/php.json')
    if (!res.ok) throw new Error('Rate fetch failed')
    const data = await res.json()
    _ratesCache = data.php || {}
    return _ratesCache
  } catch {
    // Fallback static rates (approximate) if API fails
    _ratesCache = {
      usd: 0.0175, eur: 0.0162, gbp: 0.014, jpy: 2.63, krw: 23.8,
      sgd: 0.0236, aud: 0.027, cad: 0.024, inr: 1.47, aed: 0.064,
      myr: 0.082, thb: 0.62, idr: 278, vnd: 440, cny: 0.127, brl: 0.089,
      php: 1,
    }
    return _ratesCache
  }
}

function initCurrencyConverter() {
  const select = document.getElementById('currencySelect')
  if (!select) return

  select.addEventListener('change', async () => {
    const currency = select.value
    _pricingCurrency = currency
    const rateEl = document.getElementById('currencyRate')

    if (currency === 'PHP') {
      _pricingRate = 1
      if (rateEl) rateEl.textContent = ''
      updateAllPrices()
      return
    }

    if (rateEl) rateEl.textContent = 'Loading rate...'

    const rates = await fetchRates()
    const rate = rates[currency.toLowerCase()]
    if (!rate) {
      if (rateEl) rateEl.textContent = 'Rate unavailable'
      return
    }

    _pricingRate = rate
    if (rateEl) rateEl.textContent = `1 PHP = ${rate < 1 ? rate.toFixed(4) : rate.toFixed(2)} ${currency}`
    updateAllPrices()
  })
}
