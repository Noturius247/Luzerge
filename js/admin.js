/**
 * Luzerge — Admin Dashboard JavaScript
 * Sidebar nav, table views with expandable rows, domain config, user management
 */

'use strict'

const EDGE_BASE = 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1'

let currentUser = null
let currentProfile = null
let allDomains = []
let allProfiles = []
let setupDomainId = null
let domainToDelete = null
let adminScannedDomain = null

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth()
  if (!session) return

  currentUser = session.user
  currentProfile = await getProfile()

  if (currentProfile?.role !== 'admin') {
    window.location.replace('/dashboard.html')
    return
  }

  // User info
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

  // Sidebar
  initSidebar()

  // Setup modal
  document.getElementById('setupCloseBtn')?.addEventListener('click', closeSetupModal)
  document.getElementById('setupCancelBtn')?.addEventListener('click', closeSetupModal)
  document.getElementById('setupForm')?.addEventListener('submit', handleApprove)
  document.getElementById('setupRejectBtn')?.addEventListener('click', handleReject)

  // Delete modal
  document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal)
  document.getElementById('deleteConfirmBtn')?.addEventListener('click', confirmDelete)

  // View all apps button
  document.getElementById('viewAllAppsBtn')?.addEventListener('click', () => switchPanel('applications'))

  // Admin add domain
  document.getElementById('adminAddForm')?.addEventListener('submit', handleAdminScan)
  document.getElementById('adminSubmitDomainBtn')?.addEventListener('click', handleAdminSubmit)
  document.getElementById('adminCloseReportBtn')?.addEventListener('click', () => {
    document.getElementById('adminReportPanel').hidden = true
  })

  // Load data
  await loadAllDomains()

  // Starfield & reveals
  initDashStarfield()
  initScrollReveals()
})

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function initSidebar() {
  const sidebar = document.getElementById('dashSidebar')
  const overlay = document.getElementById('sidebarOverlay')
  const toggle = document.getElementById('sidebarToggle')

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      switchPanel(item.dataset.panel)
      sidebar?.classList.remove('is-open')
      overlay?.classList.remove('is-open')
    })
  })

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('is-open')
    overlay?.classList.toggle('is-open')
  })

  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('is-open')
    overlay?.classList.remove('is-open')
  })
}

function switchPanel(panelId) {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('sidebar-item--active', item.dataset.panel === panelId)
  })

  document.querySelectorAll('[data-feature-panel]').forEach(panel => {
    panel.hidden = true
  })

  const target = document.getElementById('panel' + panelId.charAt(0).toUpperCase() + panelId.slice(1))
  if (target) {
    target.hidden = false
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Render panel content
  if (panelId === 'applications') renderApplicationsTable()
  if (panelId === 'active') renderActiveTable()
  if (panelId === 'rejected') renderRejectedTable()
  if (panelId === 'users') renderUsersTable()
}

// ─── Load all domains ─────────────────────────────────────────────────────────

async function loadAllDomains() {
  const { data: domains, error } = await _supabase
    .from('user_domains')
    .select('id, user_id, domain, cloudflare_zone_id, cloudflare_api_token, status, admin_notes, last_purged_at, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) return

  // Fetch user profiles
  const userIds = [...new Set(domains.map(d => d.user_id))]
  let profilesMap = {}

  if (userIds.length) {
    const { data: profiles } = await _supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, role')
      .in('id', userIds)

    if (profiles) {
      allProfiles = profiles
      profiles.forEach(p => { profilesMap[p.id] = p })
    }
  }

  // Enrich
  allDomains = domains.map(d => ({
    ...d,
    user_email: profilesMap[d.user_id]?.email || 'Unknown',
    user_name: profilesMap[d.user_id]?.full_name || '',
  }))

  // Stats
  const pending = allDomains.filter(d => d.status === 'pending').length
  const active = allDomains.filter(d => d.status === 'active').length
  const rejected = allDomains.filter(d => d.status === 'rejected').length

  document.getElementById('statPendingAdmin').textContent = pending
  document.getElementById('statActiveAdmin').textContent = active
  document.getElementById('statRejectedAdmin').textContent = rejected
  document.getElementById('statUsersAdmin').textContent = userIds.length

  // Sidebar badge
  const badge = document.getElementById('sidebarPendingCount')
  if (badge) badge.textContent = pending > 0 ? pending : ''

  // Overview: recent pending
  renderOverviewPending()
}

// ─── Overview: recent pending ─────────────────────────────────────────────────

function renderOverviewPending() {
  const list = document.getElementById('overviewPendingList')
  const empty = document.getElementById('overviewPendingEmpty')
  const pending = allDomains.filter(d => d.status === 'pending').slice(0, 5)

  if (!pending.length) {
    list.innerHTML = ''
    empty.hidden = false
    return
  }
  empty.hidden = true

  list.innerHTML = `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr><th>Domain</th><th>Submitted By</th><th>Date</th><th>Actions</th></tr></thead>
    <tbody>${pending.map(d => `
      <tr class="admin-row" data-id="${d.id}">
        <td><strong>${escHtml(d.domain)}</strong></td>
        <td>${escHtml(d.user_name || d.user_email)}</td>
        <td>${formatDate(d.created_at)}</td>
        <td>
          <button class="btn btn--primary btn--sm" data-action="setup" data-id="${d.id}" type="button">Configure</button>
          <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(d.domain)}" data-id="${d.id}" type="button">Lookup</button>
        </td>
      </tr>
      <tr class="admin-expand-row" id="expand-${d.id}" hidden><td colspan="4"><div class="admin-expand" id="expandContent-${d.id}"></div></td></tr>
    `).join('')}</tbody>
  </table></div>`

  bindTableEvents(list)
}

// ─── Applications table (all statuses) ────────────────────────────────────────

function renderApplicationsTable() {
  const body = document.getElementById('appTableBody')
  const wrap = document.getElementById('appTableWrap')
  const empty = document.getElementById('appEmpty')
  const loading = document.getElementById('appLoading')
  const count = document.getElementById('appCount')

  loading.hidden = true

  if (!allDomains.length) {
    empty.hidden = false
    wrap.hidden = true
    return
  }
  empty.hidden = true
  wrap.hidden = false
  count.textContent = `${allDomains.length} total`

  body.innerHTML = allDomains.map(d => `
    <tr class="admin-row admin-row--${d.status}" data-id="${d.id}">
      <td><strong>${escHtml(d.domain)}</strong></td>
      <td>${escHtml(d.user_name || d.user_email)}</td>
      <td>${formatDate(d.created_at)}</td>
      <td><span class="status-badge status-badge--${d.status}">${d.status}</span></td>
      <td class="admin-row__actions">
        ${d.status === 'pending' ? `<button class="btn btn--primary btn--sm" data-action="setup" data-id="${d.id}" type="button">Configure</button>` : ''}
        ${d.status === 'active' ? `<button class="btn btn--outline btn--sm" data-action="edit" data-id="${d.id}" type="button">Edit</button>` : ''}
        <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(d.domain)}" data-id="${d.id}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
    <tr class="admin-expand-row" id="expand-${d.id}" hidden>
      <td colspan="5"><div class="admin-expand" id="expandContent-${d.id}"></div></td>
    </tr>
  `).join('')

  bindTableEvents(document.getElementById('appTable'))
}

// ─── Active table ─────────────────────────────────────────────────────────────

function renderActiveTable() {
  const body = document.getElementById('activeTableBody')
  const wrap = document.getElementById('activeTableWrap')
  const empty = document.getElementById('activeEmpty')
  const count = document.getElementById('activeCount')

  const active = allDomains.filter(d => d.status === 'active')

  if (!active.length) {
    empty.hidden = false
    wrap.hidden = true
    return
  }
  empty.hidden = true
  wrap.hidden = false
  count.textContent = `${active.length} domain${active.length !== 1 ? 's' : ''}`

  body.innerHTML = active.map(d => `
    <tr class="admin-row admin-row--active" data-id="${d.id}">
      <td><strong>${escHtml(d.domain)}</strong></td>
      <td>${escHtml(d.user_name || d.user_email)}</td>
      <td>${formatDate(d.updated_at || d.created_at)}</td>
      <td>${d.last_purged_at ? formatDate(d.last_purged_at) : '<span style="color:rgba(255,255,255,0.3)">Never</span>'}</td>
      <td class="admin-row__actions">
        <button class="btn btn--outline btn--sm" data-action="edit" data-id="${d.id}" type="button">Edit</button>
        <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(d.domain)}" data-id="${d.id}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Lookup
        </button>
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
    <tr class="admin-expand-row" id="expand-${d.id}" hidden>
      <td colspan="5"><div class="admin-expand" id="expandContent-${d.id}"></div></td>
    </tr>
  `).join('')

  bindTableEvents(document.getElementById('activeTable'))
}

// ─── Rejected table ───────────────────────────────────────────────────────────

function renderRejectedTable() {
  const body = document.getElementById('rejectedTableBody')
  const wrap = document.getElementById('rejectedTableWrap')
  const empty = document.getElementById('rejectedEmpty')
  const count = document.getElementById('rejectedCount')

  const rejected = allDomains.filter(d => d.status === 'rejected')

  if (!rejected.length) {
    empty.hidden = false
    wrap.hidden = true
    return
  }
  empty.hidden = true
  wrap.hidden = false
  count.textContent = `${rejected.length} domain${rejected.length !== 1 ? 's' : ''}`

  body.innerHTML = rejected.map(d => `
    <tr class="admin-row admin-row--rejected" data-id="${d.id}">
      <td><strong>${escHtml(d.domain)}</strong></td>
      <td>${escHtml(d.user_name || d.user_email)}</td>
      <td>${formatDate(d.created_at)}</td>
      <td>${escHtml(d.admin_notes || '—')}</td>
      <td class="admin-row__actions">
        <button class="btn btn--outline btn--sm" data-action="setup" data-id="${d.id}" type="button">Re-review</button>
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
    <tr class="admin-expand-row" id="expand-${d.id}" hidden>
      <td colspan="5"><div class="admin-expand" id="expandContent-${d.id}"></div></td>
    </tr>
  `).join('')

  bindTableEvents(document.getElementById('rejectedTable'))
}

// ─── Users table ──────────────────────────────────────────────────────────────

function renderUsersTable() {
  const body = document.getElementById('usersTableBody')
  const wrap = document.getElementById('usersTableWrap')
  const empty = document.getElementById('usersEmpty')
  const count = document.getElementById('userCount')

  if (!allProfiles.length) {
    empty.hidden = false
    wrap.hidden = true
    return
  }
  empty.hidden = true
  wrap.hidden = false
  count.textContent = `${allProfiles.length} user${allProfiles.length !== 1 ? 's' : ''}`

  body.innerHTML = allProfiles.map(p => {
    const domainCount = allDomains.filter(d => d.user_id === p.id).length
    return `
      <tr class="admin-row">
        <td>
          <div class="admin-user-cell">
            <div class="admin-user-avatar">${(p.full_name || p.email || '?')[0].toUpperCase()}</div>
            <strong>${escHtml(p.full_name || '—')}</strong>
          </div>
        </td>
        <td>${escHtml(p.email)}</td>
        <td><span class="status-badge ${p.role === 'admin' ? 'status-badge--active' : ''}">${p.role}</span></td>
        <td>${domainCount}</td>
      </tr>
    `
  }).join('')
}

// ─── Bind table events (expandable rows + actions) ────────────────────────────

function bindTableEvents(container) {
  if (!container) return

  // Row click to expand
  container.querySelectorAll('.admin-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't expand if clicking a button
      if (e.target.closest('button')) return
      toggleExpand(row.dataset.id)
    })
  })

  // Action buttons
  container.querySelectorAll('[data-action="setup"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openSetupModal(btn.dataset.id)
    })
  })
  container.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openSetupModal(btn.dataset.id)
    })
  })
  container.querySelectorAll('[data-action="lookup"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      runAdminLookup(btn.dataset.domain, btn.dataset.id)
    })
  })
  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openDeleteModal(btn.dataset.id, btn.dataset.domain)
    })
  })
}

// ─── Expandable row ───────────────────────────────────────────────────────────

function toggleExpand(domainId) {
  const expandRow = document.getElementById(`expand-${domainId}`)
  if (!expandRow) return

  // If already open, close it
  if (!expandRow.hidden) {
    expandRow.hidden = true
    return
  }

  // Close all other expanded rows
  document.querySelectorAll('.admin-expand-row').forEach(r => { r.hidden = true })

  // Show this one
  expandRow.hidden = false
  const content = document.getElementById(`expandContent-${domainId}`)
  const domain = allDomains.find(d => d.id === domainId)
  if (!domain || !content) return

  content.innerHTML = `
    <div class="expand-grid">
      <div class="expand-section">
        <h4 class="expand-section__title">Domain Info</h4>
        <div class="expand-meta">
          <div class="expand-meta__item"><span class="expand-meta__label">Domain</span><span class="expand-meta__value">${escHtml(domain.domain)}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Status</span><span class="expand-meta__value"><span class="status-badge status-badge--${domain.status}">${domain.status}</span></span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Submitted</span><span class="expand-meta__value">${formatDate(domain.created_at)}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Last Updated</span><span class="expand-meta__value">${formatDate(domain.updated_at)}</span></div>
        </div>
      </div>
      <div class="expand-section">
        <h4 class="expand-section__title">Customer</h4>
        <div class="expand-meta">
          <div class="expand-meta__item"><span class="expand-meta__label">Name</span><span class="expand-meta__value">${escHtml(domain.user_name || '—')}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Email</span><span class="expand-meta__value">${escHtml(domain.user_email)}</span></div>
        </div>
      </div>
      <div class="expand-section">
        <h4 class="expand-section__title">Cloudflare</h4>
        <div class="expand-meta">
          <div class="expand-meta__item"><span class="expand-meta__label">Zone ID</span><span class="expand-meta__value">${domain.cloudflare_zone_id ? escHtml(domain.cloudflare_zone_id.slice(0, 12)) + '...' : '<span style="color:rgba(255,255,255,0.3)">Not set</span>'}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">API Token</span><span class="expand-meta__value">${domain.cloudflare_api_token ? '<span class="status-badge status-badge--active">Configured</span>' : '<span style="color:rgba(255,255,255,0.3)">Not set</span>'}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Last Purged</span><span class="expand-meta__value">${domain.last_purged_at ? formatDate(domain.last_purged_at) : '—'}</span></div>
        </div>
      </div>
      ${domain.admin_notes ? `
        <div class="expand-section expand-section--full">
          <h4 class="expand-section__title">Admin Notes</h4>
          <p class="expand-notes">${escHtml(domain.admin_notes)}</p>
        </div>
      ` : ''}
    </div>
    <div class="expand-actions">
      ${domain.status === 'pending' ? `<button class="btn btn--primary btn--sm" data-action="setup" data-id="${domain.id}" type="button">Configure & Approve</button>` : ''}
      ${domain.status === 'active' ? `<button class="btn btn--outline btn--sm" data-action="edit" data-id="${domain.id}" type="button">Edit Config</button>` : ''}
      ${domain.status === 'rejected' ? `<button class="btn btn--outline btn--sm" data-action="setup" data-id="${domain.id}" type="button">Re-review</button>` : ''}
      <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(domain.domain)}" data-id="${domain.id}" type="button">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        DNS Lookup
      </button>
      <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${domain.id}" data-domain="${escHtml(domain.domain)}" type="button">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Delete
      </button>
    </div>
    <div class="expand-lookup" id="expandLookup-${domain.id}"></div>
  `

  // Bind expand-level action buttons
  bindTableEvents(content)
}

// ─── Domain Lookup (Admin) ────────────────────────────────────────────────

async function runAdminLookup(domain, domainId) {
  // First make sure the row is expanded
  const expandRow = document.getElementById(`expand-${domainId}`)
  if (expandRow?.hidden) toggleExpand(domainId)

  const container = document.getElementById(`expandLookup-${domainId}`)
  if (!container) return

  // Toggle off
  if (container.innerHTML && container.dataset.loaded === 'true') {
    container.innerHTML = ''
    container.dataset.loaded = ''
    return
  }

  container.innerHTML = `<div class="admin-report__loading">
    <div class="loading-dots"><span></span><span></span><span></span></div>
    Looking up <strong>${escHtml(domain)}</strong>...
  </div>`

  try {
    const res = await fetch(`${EDGE_BASE}/domain-lookup?domain=${encodeURIComponent(domain)}`, {
      headers: {
        Authorization: `Bearer ${__LUZERGE_CONFIG.SUPABASE_ANON_KEY}`,
        apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
      },
    })
    const data = await res.json()

    if (!data.registered) {
      container.innerHTML = `<div class="admin-report__content">
        <div class="report-grid report-grid--admin">
          <div class="report-card"><span class="report-card__label">Status</span><span class="report-card__value"><span class="status-badge status-badge--error">Not Found</span></span></div>
        </div>
        <div class="dash-alert dash-alert--error" style="margin-top:12px">Domain not registered or has no DNS records.</div>
      </div>`
      container.dataset.loaded = 'true'
      return
    }

    const cfBadge = data.is_on_cloudflare
      ? '<span class="report-highlight report-highlight--green">Yes</span>'
      : '<span class="report-highlight report-highlight--amber">No</span>'

    const platformBadge = data.is_on_cloudflare
      ? `<span class="report-highlight report-highlight--green">${escHtml(data.platform)}</span>`
      : escHtml(data.platform || 'Unknown')

    const nsHtml = (data.nameservers || []).map(ns => `<code class="report-ns">${escHtml(ns)}</code>`).join(' ')

    const recordsHtml = []
    if (data.a_records?.length) data.a_records.forEach(r => recordsHtml.push(`<span class="report-record"><span class="report-record__type report-record__type--a">A</span>${escHtml(r)}</span>`))
    if (data.aaaa_records?.length) data.aaaa_records.forEach(r => recordsHtml.push(`<span class="report-record"><span class="report-record__type report-record__type--aaaa">AAAA</span>${escHtml(r)}</span>`))
    if (data.mx_records?.length) data.mx_records.forEach(r => recordsHtml.push(`<span class="report-record"><span class="report-record__type report-record__type--mx">MX</span>${escHtml(r)}</span>`))

    const actionMsg = data.is_on_cloudflare
      ? '<div class="dash-alert dash-alert--success" style="margin-top:12px"><strong>On Cloudflare</strong> — Ask customer for Zone ID & API Token, or add to your Cloudflare account.</div>'
      : '<div class="dash-alert dash-alert--info" style="margin-top:12px"><strong>Not on Cloudflare</strong> — Add domain to your Cloudflare account and send nameserver instructions.</div>'

    container.innerHTML = `<div class="admin-report__content">
      <h4 class="expand-section__title" style="margin-bottom:12px">DNS Lookup Results</h4>
      <div class="report-grid report-grid--admin">
        <div class="report-card"><span class="report-card__label">Status</span><span class="report-card__value"><span class="status-badge status-badge--active">Registered</span></span></div>
        <div class="report-card"><span class="report-card__label">Platform</span><span class="report-card__value">${platformBadge}</span></div>
        <div class="report-card"><span class="report-card__label">Hosting</span><span class="report-card__value">${escHtml(data.hosting?.provider || 'Unknown')}</span></div>
        <div class="report-card"><span class="report-card__label">IP</span><span class="report-card__value">${escHtml(data.hosting?.ip || 'N/A')}</span></div>
        <div class="report-card"><span class="report-card__label">Country</span><span class="report-card__value">${escHtml(data.hosting?.country || 'N/A')}</span></div>
        <div class="report-card"><span class="report-card__label">Cloudflare</span><span class="report-card__value">${cfBadge}</span></div>
      </div>
      <div class="admin-report__section"><strong>Nameservers:</strong> ${nsHtml || 'None found'}</div>
      ${recordsHtml.length ? `<div class="admin-report__section"><strong>Records:</strong> ${recordsHtml.join(' ')}</div>` : ''}
      ${actionMsg}
    </div>`
    container.dataset.loaded = 'true'

  } catch (err) {
    container.innerHTML = `<div class="dash-alert dash-alert--error" style="margin:12px 0">Lookup failed: ${escHtml(String(err))}</div>`
  }
}

// ─── Admin Scan & Submit ──────────────────────────────────────────────────────

async function handleAdminScan(e) {
  e.preventDefault()
  const btn = document.getElementById('adminScanBtn')
  const errEl = document.getElementById('adminAddError')
  errEl.hidden = true

  const domain = document.getElementById('adminInputDomain').value.trim()
    .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase()

  if (!domain) { errEl.textContent = 'Please enter a domain.'; errEl.hidden = false; return }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
    errEl.textContent = 'Please enter a valid domain (e.g., example.com)'; errEl.hidden = false; return
  }

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Scanning...'
  adminScannedDomain = domain

  await runAdminScanReport(domain)

  btn.disabled = false
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan Domain'
}

async function runAdminScanReport(domain) {
  const panel = document.getElementById('adminReportPanel')
  panel.hidden = false
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Reset
  const submitSection = document.getElementById('adminSubmitSection')
  submitSection.hidden = true
  document.getElementById('adminSubmitError').hidden = true
  document.getElementById('adminSubmitSuccess').hidden = true
  document.getElementById('adminSubmitDomainBtn').hidden = false

  document.getElementById('adminReportDomainName').textContent = domain
  document.getElementById('adminRptStatus').innerHTML = '<span class="report-loading">Scanning...</span>'
  ;['adminRptPlatform','adminRptHosting','adminRptIP','adminRptCountry','adminRptCloudflare'].forEach(id => {
    document.getElementById(id).textContent = '...'
  })
  document.getElementById('adminRptNameservers').innerHTML = '<li>Scanning...</li>'
  document.getElementById('adminRptRecordsGroup').hidden = true
  document.getElementById('adminRptAction').innerHTML = ''

  try {
    const res = await fetch(`${EDGE_BASE}/domain-lookup?domain=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${__LUZERGE_CONFIG.SUPABASE_ANON_KEY}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
    })
    const data = await res.json()

    if (!data.registered) {
      document.getElementById('adminRptStatus').innerHTML = '<span class="status-badge status-badge--error">Not Found</span>'
      ;['adminRptPlatform','adminRptHosting','adminRptIP','adminRptCountry','adminRptCloudflare'].forEach(id => {
        document.getElementById(id).textContent = '—'
      })
      document.getElementById('adminRptNameservers').innerHTML = '<li>Domain does not exist</li>'
      document.getElementById('adminRptAction').innerHTML = '<div class="dash-alert dash-alert--error">This domain is not registered or has no DNS records.</div>'
      return
    }

    document.getElementById('adminRptStatus').innerHTML = '<span class="status-badge status-badge--active">Registered</span>'

    const platformEl = document.getElementById('adminRptPlatform')
    if (data.is_on_cloudflare) {
      platformEl.innerHTML = `<span class="report-highlight report-highlight--green">${escHtml(data.platform)}</span>`
    } else {
      platformEl.textContent = data.platform || 'Unknown'
    }

    document.getElementById('adminRptHosting').textContent = data.hosting?.provider || 'Unknown'
    document.getElementById('adminRptIP').textContent = data.hosting?.ip || 'N/A'
    document.getElementById('adminRptCountry').textContent = data.hosting?.country || 'N/A'

    const cfEl = document.getElementById('adminRptCloudflare')
    cfEl.innerHTML = data.is_on_cloudflare
      ? '<span class="report-highlight report-highlight--green">Yes — On Cloudflare</span>'
      : '<span class="report-highlight report-highlight--amber">No — Not on Cloudflare</span>'

    const nsList = document.getElementById('adminRptNameservers')
    nsList.innerHTML = data.nameservers?.length
      ? data.nameservers.map(ns => `<li><code>${escHtml(ns)}</code></li>`).join('')
      : '<li>No nameservers found</li>'

    const hasRecords = (data.a_records?.length || data.aaaa_records?.length || data.mx_records?.length)
    if (hasRecords) {
      document.getElementById('adminRptRecordsGroup').hidden = false
      const recs = []
      if (data.a_records?.length) data.a_records.forEach(r => recs.push(`<div class="report-record"><span class="report-record__type report-record__type--a">A</span><span class="report-record__value">${escHtml(r)}</span></div>`))
      if (data.aaaa_records?.length) data.aaaa_records.forEach(r => recs.push(`<div class="report-record"><span class="report-record__type report-record__type--aaaa">AAAA</span><span class="report-record__value">${escHtml(r)}</span></div>`))
      if (data.mx_records?.length) data.mx_records.forEach(r => recs.push(`<div class="report-record"><span class="report-record__type report-record__type--mx">MX</span><span class="report-record__value">${escHtml(r)}</span></div>`))
      document.getElementById('adminRptRecords').innerHTML = recs.join('')
    }

    const actionEl = document.getElementById('adminRptAction')
    actionEl.innerHTML = data.is_on_cloudflare
      ? '<div class="dash-alert dash-alert--success"><strong>Already on Cloudflare!</strong> You can configure it right away with the Zone ID and API Token.</div>'
      : '<div class="dash-alert dash-alert--info"><strong>Not on Cloudflare yet.</strong> Add this domain to your Cloudflare account first, then configure it.</div>'

    // Show submit button
    submitSection.hidden = false
    document.getElementById('adminSubmitDomainName').textContent = domain

  } catch (err) {
    document.getElementById('adminRptStatus').innerHTML = '<span class="status-badge status-badge--error">Error</span>'
    document.getElementById('adminRptAction').innerHTML = `<div class="dash-alert dash-alert--error">Lookup failed: ${escHtml(String(err))}</div>`
  }
}

async function handleAdminSubmit() {
  if (!adminScannedDomain) return

  const btn = document.getElementById('adminSubmitDomainBtn')
  const errEl = document.getElementById('adminSubmitError')
  const successEl = document.getElementById('adminSubmitSuccess')
  errEl.hidden = true
  successEl.hidden = true

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Submitting...'

  const { error } = await _supabase.from('user_domains').insert({
    user_id: currentUser.id,
    domain: adminScannedDomain,
    status: 'pending',
  })

  btn.disabled = false
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Submit Domain'

  if (error) {
    errEl.textContent = error.message.includes('unique') ? `${adminScannedDomain} is already submitted.` : error.message
    errEl.hidden = false
    return
  }

  successEl.innerHTML = `<strong>${escHtml(adminScannedDomain)}</strong> submitted! You can now configure it from the Applications page.`
  successEl.hidden = false
  btn.hidden = true

  document.getElementById('adminAddForm').reset()
  adminScannedDomain = null

  await loadAllDomains()
}

// ─── Setup modal ──────────────────────────────────────────────────────────────

function openSetupModal(domainId) {
  setupDomainId = domainId
  const domain = allDomains.find(d => d.id === domainId)
  if (!domain) return

  document.getElementById('setupDomainName').textContent = domain.domain
  document.getElementById('setupDomainUser').textContent = domain.user_name || domain.user_email
  document.getElementById('setupDomainDate').textContent = `Submitted ${formatDate(domain.created_at)}`

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
    .update({ cloudflare_zone_id: zoneId, cloudflare_api_token: apiToken, admin_notes: notes || null, status: 'active' })
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
    .update({ status: 'rejected', admin_notes: notes || 'Domain rejected by admin.' })
    .eq('id', setupDomainId)

  btn.disabled = false
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Reject'

  if (error) {
    document.getElementById('setupError').textContent = error.message
    document.getElementById('setupError').hidden = false
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

  if (!error) await loadAllDomains()
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
