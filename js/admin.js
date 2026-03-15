/**
 * Luzerge — Admin Dashboard JavaScript
 * Handles: viewing all domain submissions, configuring Cloudflare, approving/rejecting
 */

'use strict'

let currentUser = null
let currentProfile = null
let allDomains = []
let currentFilter = 'all'
let setupDomainId = null
let domainToDelete = null

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth()
  if (!session) return

  currentUser = session.user
  currentProfile = await getProfile()

  // Only admins allowed
  if (currentProfile?.role !== 'admin') {
    window.location.replace('/dashboard.html')
    return
  }

  // Show user info
  const navUser = document.getElementById('navUser')
  if (navUser) navUser.textContent = currentProfile.email

  const navAvatar = document.getElementById('navAvatar')
  if (navAvatar && currentProfile.avatar_url) {
    navAvatar.innerHTML = `<img src="${escHtml(currentProfile.avatar_url)}" alt="" />`
  } else if (navAvatar) {
    navAvatar.textContent = (currentProfile.full_name || currentProfile.email || 'A')[0].toUpperCase()
  }

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', signOut)

  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('filter-tab--active'))
      tab.classList.add('filter-tab--active')
      renderDomains()
    })
  })

  // Setup modal
  document.getElementById('setupCloseBtn')?.addEventListener('click', closeSetupModal)
  document.getElementById('setupCancelBtn')?.addEventListener('click', closeSetupModal)
  document.getElementById('setupForm')?.addEventListener('submit', handleApprove)
  document.getElementById('setupRejectBtn')?.addEventListener('click', handleReject)

  // Delete modal
  document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal)
  document.getElementById('deleteConfirmBtn')?.addEventListener('click', confirmDelete)

  // Load data
  await loadAllDomains()

  // Init starfield
  initDashStarfield()
  initScrollReveals()
})

// ─── Load all domains (admin sees everything) ────────────────────────────────

async function loadAllDomains() {
  const loading = document.getElementById('adminLoading')
  const empty = document.getElementById('adminEmpty')
  loading.hidden = false
  empty.hidden = true

  // Fetch all domains with user email from profiles
  const { data: domains, error } = await _supabase
    .from('user_domains')
    .select('id, user_id, domain, cloudflare_zone_id, cloudflare_api_token, status, admin_notes, last_purged_at, created_at, updated_at')
    .order('created_at', { ascending: false })

  loading.hidden = true

  if (error) {
    document.getElementById('adminDomainsList').innerHTML =
      `<div class="dash-alert dash-alert--error">Failed to load: ${escHtml(error.message)}</div>`
    return
  }

  // Fetch user profiles for emails
  const userIds = [...new Set(domains.map(d => d.user_id))]
  let profilesMap = {}

  if (userIds.length) {
    const { data: profiles } = await _supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds)

    if (profiles) {
      profiles.forEach(p => { profilesMap[p.id] = p })
    }
  }

  // Enrich domains with user info
  allDomains = domains.map(d => ({
    ...d,
    user_email: profilesMap[d.user_id]?.email || 'Unknown',
    user_name: profilesMap[d.user_id]?.full_name || '',
  }))

  // Update stats
  const pending = allDomains.filter(d => d.status === 'pending').length
  const active = allDomains.filter(d => d.status === 'active').length
  const rejected = allDomains.filter(d => d.status === 'rejected').length
  document.getElementById('statPendingAdmin').textContent = pending
  document.getElementById('statActiveAdmin').textContent = active
  document.getElementById('statRejectedAdmin').textContent = rejected
  document.getElementById('statUsersAdmin').textContent = userIds.length

  const pendingCount = document.getElementById('filterPendingCount')
  if (pendingCount) pendingCount.textContent = pending > 0 ? pending : ''

  renderDomains()
}

function renderDomains() {
  const list = document.getElementById('adminDomainsList')
  const empty = document.getElementById('adminEmpty')

  const filtered = currentFilter === 'all'
    ? allDomains
    : allDomains.filter(d => d.status === currentFilter)

  if (!filtered.length) {
    list.innerHTML = ''
    empty.hidden = false
    return
  }
  empty.hidden = true

  list.innerHTML = filtered.map((d, i) => `
    <div class="admin-domain-card admin-domain-card--${d.status}" style="animation-delay: ${i * 40}ms">
      <div class="admin-domain-card__top">
        <div class="admin-domain-card__info">
          <span class="admin-domain-card__name">${escHtml(d.domain)}</span>
          <span class="admin-domain-card__user">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${escHtml(d.user_name || d.user_email)}
          </span>
          <span class="admin-domain-card__date">Submitted ${formatDate(d.created_at)}</span>
        </div>
        <div class="admin-domain-card__actions">
          <span class="status-badge status-badge--${d.status}">${d.status}</span>
          ${d.status === 'pending' ? `
            <button class="btn btn--primary btn--sm" data-action="setup" data-id="${d.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Configure
            </button>
          ` : ''}
          ${d.status === 'active' ? `
            <button class="btn btn--outline btn--sm" data-action="edit" data-id="${d.id}">Edit</button>
          ` : ''}
          <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      ${d.cloudflare_zone_id ? `
        <div class="admin-domain-card__meta">
          <span class="meta-tag">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Zone: ${escHtml(d.cloudflare_zone_id.slice(0, 8))}...
          </span>
          <span class="meta-tag">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Token configured
          </span>
          ${d.last_purged_at ? `<span class="meta-tag">Last purged ${formatDate(d.last_purged_at)}</span>` : ''}
        </div>
      ` : ''}
      ${d.admin_notes ? `
        <div class="admin-domain-card__notes">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          ${escHtml(d.admin_notes)}
        </div>
      ` : ''}
    </div>
  `).join('')

  // Events
  list.querySelectorAll('[data-action="setup"]').forEach(btn => {
    btn.addEventListener('click', () => openSetupModal(btn.dataset.id))
  })
  list.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openSetupModal(btn.dataset.id))
  })
  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id, btn.dataset.domain))
  })
}

// ─── Setup modal ──────────────────────────────────────────────────────────────

function openSetupModal(domainId) {
  setupDomainId = domainId
  const domain = allDomains.find(d => d.id === domainId)
  if (!domain) return

  document.getElementById('setupDomainName').textContent = domain.domain
  document.getElementById('setupDomainUser').textContent = domain.user_name || domain.user_email
  document.getElementById('setupDomainDate').textContent = `Submitted ${formatDate(domain.created_at)}`

  // Pre-fill if editing
  document.getElementById('setupZoneId').value = domain.cloudflare_zone_id || ''
  document.getElementById('setupApiToken').value = domain.cloudflare_api_token || ''
  document.getElementById('setupNotes').value = domain.admin_notes || ''
  document.getElementById('setupError').hidden = true

  document.getElementById('setupModal').hidden = false
}

function closeSetupModal() {
  document.getElementById('setupModal').hidden = true
  setupDomainId = null
}

async function handleApprove(e) {
  e.preventDefault()
  if (!setupDomainId) return

  const zoneId = document.getElementById('setupZoneId').value.trim()
  const apiToken = document.getElementById('setupApiToken').value.trim()
  const notes = document.getElementById('setupNotes').value.trim()
  const errEl = document.getElementById('setupError')

  if (!zoneId || !apiToken) {
    errEl.textContent = 'Zone ID and API Token are required to activate a domain.'
    errEl.hidden = false
    return
  }

  const btn = document.getElementById('setupApproveBtn')
  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Activating...'

  const { error } = await _supabase
    .from('user_domains')
    .update({
      cloudflare_zone_id: zoneId,
      cloudflare_api_token: apiToken,
      admin_notes: notes || null,
      status: 'active',
    })
    .eq('id', setupDomainId)

  btn.disabled = false
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Approve & Activate'

  if (error) {
    errEl.textContent = error.message
    errEl.hidden = false
    return
  }

  closeSetupModal()
  await loadAllDomains()
}

async function handleReject() {
  if (!setupDomainId) return

  const notes = document.getElementById('setupNotes').value.trim()
  const btn = document.getElementById('setupRejectBtn')
  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Rejecting...'

  const { error } = await _supabase
    .from('user_domains')
    .update({
      status: 'rejected',
      admin_notes: notes || 'Domain rejected by admin.',
    })
    .eq('id', setupDomainId)

  btn.disabled = false
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Reject'

  if (error) {
    const errEl = document.getElementById('setupError')
    errEl.textContent = error.message
    errEl.hidden = false
    return
  }

  closeSetupModal()
  await loadAllDomains()
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function openDeleteModal(domainId, domainName) {
  domainToDelete = domainId
  document.getElementById('deleteModalDesc').textContent =
    `Permanently delete "${domainName}" and all its purge history? This cannot be undone.`
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
  btn.innerHTML = '<span class="btn-spinner"></span> Deleting...'

  const { error } = await _supabase
    .from('user_domains')
    .delete()
    .eq('id', domainToDelete)

  btn.disabled = false
  btn.textContent = 'Delete'
  closeDeleteModal()

  if (!error) {
    await loadAllDomains()
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
