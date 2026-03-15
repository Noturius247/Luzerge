/**
 * Luzerge — User Dashboard JavaScript
 * Handles: domain submission, status monitoring, cache purge (for active domains)
 */

'use strict'

const EDGE_BASE = 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1'

let currentUser = null
let currentProfile = null
let selectedDomainId = null
let domainToDelete = null

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth()
  if (!session) return

  currentUser = session.user
  currentProfile = await getProfile()

  // If admin, redirect to admin page
  if (currentProfile?.role === 'admin') {
    window.location.replace('/admin.html')
    return
  }

  // Show user info
  const navUser = document.getElementById('navUser')
  if (navUser) navUser.textContent = currentProfile?.email || currentUser.email

  // Avatar
  const navAvatar = document.getElementById('navAvatar')
  if (navAvatar && currentProfile?.avatar_url) {
    navAvatar.innerHTML = `<img src="${escHtml(currentProfile.avatar_url)}" alt="" />`
  } else if (navAvatar) {
    navAvatar.textContent = (currentProfile?.full_name || currentUser.email || '?')[0].toUpperCase()
  }

  // Hero name
  const heroName = document.getElementById('heroName')
  if (heroName) {
    const firstName = (currentProfile?.full_name || '').split(' ')[0] || 'there'
    heroName.textContent = firstName
  }

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', signOut)

  // Load domains
  await loadDomains()

  // Add domain form
  document.getElementById('addDomainForm')?.addEventListener('submit', handleAddDomain)

  // Close detail
  document.getElementById('closeDetailBtn')?.addEventListener('click', closeDetail)

  // Purge tabs
  document.querySelectorAll('.purge-tab').forEach(tab => {
    tab.addEventListener('click', () => switchPurgeTab(tab.dataset.tab))
  })

  // Purge actions
  document.getElementById('purgeEverythingBtn')?.addEventListener('click', () => handlePurge('everything'))
  document.getElementById('purgeUrlsBtn')?.addEventListener('click', () => handlePurge('urls'))

  // Delete modal
  document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal)
  document.getElementById('deleteConfirmBtn')?.addEventListener('click', confirmDelete)

  // Init starfield
  initDashStarfield()

  // Scroll reveals
  initScrollReveals()
})

// ─── Load domains ─────────────────────────────────────────────────────────────

async function loadDomains() {
  const list = document.getElementById('domainsList')
  const loading = document.getElementById('domainsLoading')
  const empty = document.getElementById('domainsEmpty')
  const count = document.getElementById('domainCount')

  loading.hidden = false
  list.innerHTML = ''
  empty.hidden = true

  const { data: domains, error } = await _supabase
    .from('user_domains')
    .select('id, domain, status, admin_notes, last_purged_at, created_at')
    .order('created_at', { ascending: false })

  loading.hidden = true

  if (error) {
    list.innerHTML = `<div class="dash-alert dash-alert--error">Failed to load domains: ${escHtml(error.message)}</div>`
    return
  }

  // Update hero stats
  const total = domains.length
  const active = domains.filter(d => d.status === 'active').length
  const pending = domains.filter(d => d.status === 'pending').length
  document.getElementById('statTotal').textContent = total
  document.getElementById('statActive').textContent = active
  document.getElementById('statPending').textContent = pending

  count.textContent = `${total} domain${total !== 1 ? 's' : ''}`

  if (!total) {
    empty.hidden = false
    return
  }

  list.innerHTML = domains.map((d, i) => `
    <div class="domain-card domain-card--${d.status}" data-id="${d.id}" role="button" tabindex="0"
         aria-label="View ${escHtml(d.domain)}" style="animation-delay: ${i * 60}ms">
      <div class="domain-card__left">
        <div class="domain-card__name-row">
          <span class="domain-card__favicon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </span>
          <span class="domain-card__name">${escHtml(d.domain)}</span>
        </div>
        <span class="domain-card__meta">
          Submitted ${formatDate(d.created_at)}
          ${d.last_purged_at ? ` · Last purged ${formatDate(d.last_purged_at)}` : ''}
        </span>
        ${d.status === 'rejected' && d.admin_notes ? `<span class="domain-card__note">Note: ${escHtml(d.admin_notes)}</span>` : ''}
      </div>
      <div class="domain-card__actions">
        <span class="status-badge status-badge--${d.status}">
          ${statusIcon(d.status)}
          ${d.status}
        </span>
        ${d.status === 'active' ? `<button class="btn btn--outline btn--sm" data-action="view" data-id="${d.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Stats
        </button>` : ''}
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('')

  // Events
  list.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openDetail(btn.dataset.id)
    })
  })
  list.querySelectorAll('.domain-card').forEach(card => {
    card.addEventListener('click', () => {
      const status = card.classList.contains('domain-card--active') ? 'active' : null
      if (status === 'active') openDetail(card.dataset.id)
    })
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && card.classList.contains('domain-card--active')) {
        openDetail(card.dataset.id)
      }
    })
  })
  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openDeleteModal(btn.dataset.id, btn.dataset.domain)
    })
  })
}

function statusIcon(status) {
  switch (status) {
    case 'pending':
      return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    case 'active':
      return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    case 'rejected':
      return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    default:
      return ''
  }
}

// ─── Add domain ───────────────────────────────────────────────────────────────

async function handleAddDomain(e) {
  e.preventDefault()

  const btn = document.getElementById('addDomainBtn')
  const errEl = document.getElementById('addDomainError')
  const successEl = document.getElementById('addDomainSuccess')
  errEl.hidden = true
  successEl.hidden = true

  const domain = document.getElementById('inputDomain').value.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()

  if (!domain) {
    showAddError('Please enter a domain name.')
    return
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
    showAddError('Please enter a valid domain (e.g., yourdomain.com)')
    return
  }

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Submitting...'

  const { error } = await _supabase.from('user_domains').insert({
    user_id: currentUser.id,
    domain,
    status: 'pending',
  })

  btn.disabled = false
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Submit Domain'

  if (error) {
    showAddError(error.message.includes('unique') ? `${domain} is already submitted.` : error.message)
    return
  }

  // Success
  successEl.innerHTML = `<strong>${escHtml(domain)}</strong> submitted! Our team will set it up and you'll see it go <span class="status-badge status-badge--active" style="display:inline-flex;vertical-align:middle;margin:0 4px">active</span> once ready.`
  successEl.hidden = false
  document.getElementById('addDomainForm').reset()
  await loadDomains()
}

function showAddError(msg) {
  const el = document.getElementById('addDomainError')
  el.textContent = msg
  el.hidden = false
}

// ─── Domain detail ────────────────────────────────────────────────────────────

async function openDetail(domainId) {
  selectedDomainId = domainId
  document.getElementById('detailPanel').hidden = false
  document.getElementById('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })

  document.getElementById('purgeSuccess').hidden = true
  document.getElementById('purgeError').hidden = true

  const { data: domain } = await _supabase
    .from('user_domains')
    .select('domain')
    .eq('id', domainId)
    .single()

  if (domain) {
    document.getElementById('detailTitle').textContent = domain.domain
  }

  await loadStats(domainId)
}

function closeDetail() {
  document.getElementById('detailPanel').hidden = true
  selectedDomainId = null
}

async function loadStats(domainId) {
  ;['statRequests','statCacheRate','statThreats','statPurges'].forEach(id => {
    document.getElementById(id).textContent = '...'
  })
  document.getElementById('historyLoading').hidden = false
  document.getElementById('historyTable').hidden = true
  document.getElementById('historyEmpty').hidden = true

  const session = await getSession()
  if (!session) return

  const res = await fetch(`${EDGE_BASE}/domain-stats?domain_id=${domainId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })

  if (!res.ok) {
    ;['statRequests','statCacheRate','statThreats','statPurges'].forEach(id => {
      document.getElementById(id).textContent = '—'
    })
    document.getElementById('historyLoading').hidden = true
    document.getElementById('historyEmpty').hidden = false
    return
  }

  const data = await res.json()

  if (data.cf_analytics) {
    const a = data.cf_analytics
    document.getElementById('statRequests').textContent = fmtNum(a.requests_total)
    document.getElementById('statCacheRate').textContent = `${a.cache_hit_rate}%`
    document.getElementById('statThreats').textContent = fmtNum(a.threats_total)
  } else {
    document.getElementById('statRequests').textContent = 'N/A'
    document.getElementById('statCacheRate').textContent = 'N/A'
    document.getElementById('statThreats').textContent = 'N/A'
  }

  document.getElementById('statPurges').textContent = fmtNum(data.purge_count_30d)

  document.getElementById('historyLoading').hidden = true
  const history = data.recent_history ?? []

  if (!history.length) {
    document.getElementById('historyEmpty').hidden = false
    return
  }

  const tbody = document.getElementById('historyBody')
  tbody.innerHTML = history.map(h => `
    <tr>
      <td>${formatDate(h.created_at)}</td>
      <td>${h.purge_type === 'everything' ? 'Everything' : `${(h.urls_purged ?? []).length} URL(s)`}</td>
      <td>
        <span class="status-badge status-badge--${h.success ? 'active' : 'error'}">
          ${h.success ? 'OK' : 'Failed'}
        </span>
      </td>
    </tr>
  `).join('')
  document.getElementById('historyTable').hidden = false
}

// ─── Purge ────────────────────────────────────────────────────────────────────

function switchPurgeTab(tab) {
  document.querySelectorAll('.purge-tab').forEach(t => t.classList.remove('purge-tab--active'))
  document.querySelector(`[data-tab="${tab}"]`).classList.add('purge-tab--active')
  document.getElementById('purgeEverything').hidden = tab !== 'everything'
  document.getElementById('purgeUrls').hidden = tab !== 'urls'
}

async function handlePurge(type) {
  if (!selectedDomainId) return

  const successEl = document.getElementById('purgeSuccess')
  const errorEl = document.getElementById('purgeError')
  successEl.hidden = true
  errorEl.hidden = true

  const btnId = type === 'everything' ? 'purgeEverythingBtn' : 'purgeUrlsBtn'
  const btn = document.getElementById(btnId)
  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Purging...'

  const body = { domain_id: selectedDomainId, purge_type: type }

  if (type === 'urls') {
    const raw = document.getElementById('urlsToPurge').value
    const urls = raw.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) {
      errorEl.textContent = 'Enter at least one URL.'
      errorEl.hidden = false
      btn.disabled = false
      btn.textContent = 'Purge Selected URLs'
      return
    }
    body.urls = urls
  }

  const session = await getSession()
  const res = await fetch(`${EDGE_BASE}/purge-cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  btn.disabled = false

  if (type === 'everything') {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Purge Everything'
  } else {
    btn.textContent = 'Purge Selected URLs'
  }

  if (res.ok && data.success) {
    successEl.textContent = type === 'everything'
      ? 'Cache purged successfully! All pages will be refreshed from origin.'
      : `${body.urls?.length ?? 0} URL(s) purged successfully.`
    successEl.hidden = false
    await loadStats(selectedDomainId)
  } else {
    const msg = data.cf_response?.errors?.[0]?.message ?? data.error ?? 'Purge failed'
    errorEl.textContent = `Error: ${msg}`
    errorEl.hidden = false
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function openDeleteModal(domainId, domainName) {
  domainToDelete = domainId
  document.getElementById('deleteModalDesc').textContent =
    `Remove "${domainName}" from your account? This cannot be undone.`
  document.getElementById('deleteModal').hidden = false
}

function closeDeleteModal() {
  document.getElementById('deleteModal').hidden = true
  domainToDelete = null
}

async function confirmDelete() {
  if (!domainToDelete) return

  const btn = document.getElementById('deleteConfirmBtn')
  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Removing...'

  const { error } = await _supabase
    .from('user_domains')
    .delete()
    .eq('id', domainToDelete)

  btn.disabled = false
  btn.textContent = 'Remove'
  closeDeleteModal()

  if (!error) {
    if (selectedDomainId === domainToDelete) closeDetail()
    await loadDomains()
  }
}

// ─── Starfield ────────────────────────────────────────────────────────────────

function initDashStarfield() {
  const canvas = document.getElementById('dashStarfield')
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  const stars = []
  const STAR_COUNT = 120

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = document.body.scrollHeight
  }
  resize()
  window.addEventListener('resize', resize)

  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.02 + 0.005,
    })
  }

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const s of stars) {
      const opacity = 0.3 + 0.4 * Math.sin(s.phase + t * s.speed)
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${opacity})`
      ctx.fill()
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
}

// ─── Scroll reveals ───────────────────────────────────────────────────────────

function initScrollReveals() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const els = document.querySelectorAll('[data-scroll-reveal]')
  if (!els.length) return

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.1 })

  els.forEach(el => observer.observe(el))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtNum(n) {
  if (n == null) return '—'
  return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n/1_000).toFixed(1)}K`
    : String(n)
}
