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

// ─── Theme Toggle ────────────────────────────────────────────────────────────

;(function initTheme() {
  const saved = localStorage.getItem('luzerge-theme')
  if (saved) document.documentElement.setAttribute('data-theme', saved)
})()

function setupThemeToggle() {
  const btn = document.getElementById('themeToggle')
  if (!btn) return
  const iconDark = document.getElementById('themeIconDark')
  const iconLight = document.getElementById('themeIconLight')

  function updateIcons() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
    if (iconDark) iconDark.hidden = !isDark
    if (iconLight) iconLight.hidden = isDark
  }

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme')
    const next = current === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('luzerge-theme', next)
    updateIcons()
  })

  updateIcons()
}

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

  // Theme & Sidebar
  setupThemeToggle()
  initSidebar()

  // Setup modal
  document.getElementById('setupCloseBtn')?.addEventListener('click', closeSetupModal)
  document.getElementById('setupCancelBtn')?.addEventListener('click', closeSetupModal)
  document.getElementById('setupForm')?.addEventListener('submit', handleApprove)
  document.getElementById('setupRejectBtn')?.addEventListener('click', handleReject)
  document.getElementById('setupProvider')?.addEventListener('change', (e) => {
    updateSetupProviderFields(e.target.value)
  })

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

  // Settings handlers
  initSettingsHandlers()

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

  // Collapsible sidebar sections
  document.querySelectorAll('.sidebar-section-toggle').forEach(label => {
    label.addEventListener('click', () => {
      const section = label.closest('.sidebar-section')
      section?.classList.toggle('sidebar-section--collapsed')
      const isCollapsed = section?.classList.contains('sidebar-section--collapsed')
      label.setAttribute('aria-expanded', String(!isCollapsed))
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

  // Settings panels
  if (panelId === 'settingsProfile') admPopulateProfile()
  if (panelId === 'settingsPlans') admPopulatePlansStats()
  if (panelId === 'settingsNotifications') admPopulateNotifSettings()
  if (panelId === 'settingsUsers') admPopulateUsersTable()
  if (panelId === 'settingsSecurity') admPopulateSecurity()

  // Monitoring panels
  if (panelId === 'monAnalytics') admPopulateAnalytics()
  if (panelId === 'monSsl') admPopulateSsl()
  if (panelId === 'monDns') admPopulateDns()
  if (panelId === 'monWaf') admPopulateWaf()
  if (panelId === 'monImages') admPopulateImages()
  if (panelId === 'monMinify') admPopulateMinify()
  if (panelId === 'monUptime') admPopulateUptime()
  if (panelId === 'monDdos') admPopulateDdos()

  // New feature panels
  if (panelId === 'admBotFight') admLoadBotFight()
  if (panelId === 'admAlwaysOnline') admLoadAlwaysOnline()
  if (panelId === 'admEmailRouting') admLoadEmailRouting()
  if (panelId === 'admHeaderInspector') admInitHeaderInspector()
  if (panelId === 'admPageSpeed') admInitPageSpeed()
  if (panelId === 'admWhois') admInitWhois()
  if (panelId === 'admScheduledReports') admLoadScheduledReports()
  if (panelId === 'admAuditLog') admLoadAuditLog()
  if (panelId === 'admEmailMarketing') admInitEmailMarketing()
}

// ─── Provider helpers ─────────────────────────────────────────────────────────

const PROVIDER_LABELS = { cloudflare: 'Cloudflare', cloudfront: 'AWS CloudFront', fastly: 'Fastly', none: 'None (monitoring)' }

function providerBadge(provider) {
  const p = provider || 'cloudflare'
  const colors = { cloudflare: '#f38020', cloudfront: '#ff9900', fastly: '#ff282d', none: '#6b7280' }
  const color = colors[p] || '#7c3aed'
  return `<span class="status-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;font-size:0.7rem">${PROVIDER_LABELS[p] || p}</span>`
}

function renderCredentialsMeta(d) {
  const p = d.cdn_provider || 'cloudflare'
  let html = `<div class="expand-meta__item"><span class="expand-meta__label">Provider</span><span class="expand-meta__value">${providerBadge(p)}</span></div>`

  if (p === 'cloudflare') {
    html += `<div class="expand-meta__item"><span class="expand-meta__label">Zone ID</span><span class="expand-meta__value">${d.cloudflare_zone_id ? escHtml(d.cloudflare_zone_id.slice(0, 12)) + '...' : '<span style="color:rgba(255,255,255,0.3)">Not set</span>'}</span></div>`
    html += `<div class="expand-meta__item"><span class="expand-meta__label">API Token</span><span class="expand-meta__value">${d.cloudflare_api_token ? '<span class="status-badge status-badge--active">Configured</span>' : '<span style="color:rgba(255,255,255,0.3)">Not set</span>'}</span></div>`
  } else if (p === 'cloudfront' || p === 'fastly') {
    const idLabel = p === 'cloudfront' ? 'Distribution ID' : 'Service ID'
    html += `<div class="expand-meta__item"><span class="expand-meta__label">${idLabel}</span><span class="expand-meta__value">${d.cdn_distribution_id ? escHtml(d.cdn_distribution_id.slice(0, 12)) + '...' : '<span style="color:rgba(255,255,255,0.3)">Not set</span>'}</span></div>`
    html += `<div class="expand-meta__item"><span class="expand-meta__label">API Key</span><span class="expand-meta__value">${d.cdn_api_key ? '<span class="status-badge status-badge--active">Configured</span>' : '<span style="color:rgba(255,255,255,0.3)">Not set</span>'}</span></div>`
  }
  // 'none' — no credentials needed
  return html
}

// ─── Load all domains ─────────────────────────────────────────────────────────

async function loadAllDomains() {
  const { data: domains, error } = await _supabase
    .from('user_domains')
    .select('id, user_id, domain, cloudflare_zone_id, cloudflare_api_token, cdn_provider, cdn_api_key, cdn_distribution_id, status, admin_notes, last_purged_at, auto_purge_enabled, auto_purge_interval, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) { console.error('Load domains error:', error); showToast('Failed to load domains. Please try again.', true); return }

  // Fetch ALL user profiles (not just those with domains)
  let profilesMap = {}

  const { data: profiles } = await _supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, role, status, plan, payment_status, created_at')
    .order('created_at', { ascending: false })

  if (profiles) {
    allProfiles = profiles
    profiles.forEach(p => { profilesMap[p.id] = p })
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
  document.getElementById('statUsersAdmin').textContent = allProfiles.length

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

  const allPending = allDomains.filter(d => d.status === 'pending')

  if (!allPending.length) {
    empty.hidden = false
    wrap.hidden = true
    count.textContent = ''
    return
  }
  empty.hidden = true
  wrap.hidden = false
  count.textContent = `${allPending.length} pending`

  const { items: pending, page, totalPages, total } = paginate(allPending, 'applications')

  body.innerHTML = pending.map(d => `
    <tr class="admin-row admin-row--pending" data-id="${d.id}">
      <td><strong>${escHtml(d.domain)}</strong></td>
      <td>${escHtml(d.user_name || d.user_email)}</td>
      <td>${formatDate(d.created_at)}</td>
      <td><span class="status-badge status-badge--pending">pending</span></td>
      <td class="admin-row__actions">
        <button class="btn btn--primary btn--sm" data-action="setup" data-id="${d.id}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Approve
        </button>
        <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(d.domain)}" data-id="${d.id}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Lookup
        </button>
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="reject" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          Reject
        </button>
      </td>
    </tr>
    <tr class="admin-expand-row" id="expand-${d.id}" hidden>
      <td colspan="5"><div class="admin-expand" id="expandContent-${d.id}"></div></td>
    </tr>
  `).join('')

  bindTableEvents(document.getElementById('appTable'))
  renderPagination(wrap, 'applications', total, page, totalPages, renderApplicationsTable)
}

// ─── Active table ─────────────────────────────────────────────────────────────

function renderActiveTable() {
  const container = document.getElementById('activeDetailList')
  const empty = document.getElementById('activeEmpty')
  const count = document.getElementById('activeCount')

  const allActive = allDomains.filter(d => d.status === 'active')

  if (!allActive.length) {
    empty.hidden = false
    if (container) container.hidden = true
    count.textContent = ''
    return
  }
  empty.hidden = true

  if (!container) return
  container.hidden = false
  count.textContent = `${allActive.length} domain${allActive.length !== 1 ? 's' : ''}`

  const { items: active, page, totalPages, total } = paginate(allActive, 'active')

  container.innerHTML = active.map(d => `
    <div class="active-domain-card" data-id="${d.id}">
      <div class="active-domain-card__header" data-toggle-id="${d.id}">
        <div class="active-domain-card__title">
          <svg class="active-domain-card__chevron" id="chevron-${d.id}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <strong>${escHtml(d.domain)}</strong>
          <span class="status-badge status-badge--active">active</span>
        </div>
        <div class="active-domain-card__actions">
          <button class="btn btn--outline btn--sm" data-action="adminpurge" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Purge
          </button>
          <button class="btn btn--outline btn--sm" data-action="edit" data-id="${d.id}" type="button">Edit</button>
          <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(d.domain)}" data-id="${d.id}" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Lookup
          </button>
          <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button" aria-label="Delete domain">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="active-domain-card__body" id="cardBody-${d.id}" hidden>
        <div class="expand-grid">
          <div class="expand-section">
            <h4 class="expand-section__title">Domain Info</h4>
            <div class="expand-meta">
              <div class="expand-meta__item"><span class="expand-meta__label">Domain</span><span class="expand-meta__value">${escHtml(d.domain)}</span></div>
              <div class="expand-meta__item"><span class="expand-meta__label">Submitted</span><span class="expand-meta__value">${formatDate(d.created_at)}</span></div>
              <div class="expand-meta__item"><span class="expand-meta__label">Activated</span><span class="expand-meta__value">${formatDate(d.updated_at)}</span></div>
              <div class="expand-meta__item"><span class="expand-meta__label">Last Purged</span><span class="expand-meta__value">${d.last_purged_at ? formatDate(d.last_purged_at) : '—'}</span></div>
            </div>
          </div>
          <div class="expand-section">
            <h4 class="expand-section__title">Customer</h4>
            <div class="expand-meta">
              <div class="expand-meta__item"><span class="expand-meta__label">Name</span><span class="expand-meta__value">${escHtml(d.user_name || '—')}</span></div>
              <div class="expand-meta__item"><span class="expand-meta__label">Email</span><span class="expand-meta__value">${escHtml(d.user_email)}</span></div>
            </div>
          </div>
          <div class="expand-section">
            <h4 class="expand-section__title">CDN Provider</h4>
            <div class="expand-meta">
              ${renderCredentialsMeta(d)}
            </div>
          </div>
          <div class="expand-section">
            <h4 class="expand-section__title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Auto-Purge
            </h4>
            <div class="auto-purge-controls">
              <div class="auto-purge-toggle">
                <label class="toggle-switch ${d.auto_purge_enabled ? 'toggle-switch--on' : ''}">
                  <input type="checkbox" class="admin-auto-toggle" data-id="${d.id}" ${d.auto_purge_enabled ? 'checked' : ''} />
                  <span class="toggle-slider"></span>
                </label>
                <span class="auto-purge-toggle__label" id="apLabel-${d.id}">${d.auto_purge_enabled ? '<strong>On</strong>' : '<strong>Off</strong>'}</span>
              </div>
              <div class="auto-purge-interval ${d.auto_purge_enabled ? '' : 'auto-purge-interval--disabled'}">
                <label class="form-label">Frequency</label>
                <select class="form-input form-select admin-auto-interval" data-id="${d.id}" ${d.auto_purge_enabled ? '' : 'disabled'}>
                  <option value="hourly" ${d.auto_purge_interval === 'hourly' ? 'selected' : ''}>Every hour</option>
                  <option value="every6h" ${d.auto_purge_interval === 'every6h' ? 'selected' : ''}>Every 6 hours</option>
                  <option value="every12h" ${d.auto_purge_interval === 'every12h' ? 'selected' : ''}>Every 12 hours</option>
                  <option value="daily" ${(d.auto_purge_interval || 'daily') === 'daily' ? 'selected' : ''}>Once a day</option>
                  <option value="weekly" ${d.auto_purge_interval === 'weekly' ? 'selected' : ''}>Once a week</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        ${d.admin_notes ? `<div class="expand-section expand-section--full" style="margin-top:8px"><h4 class="expand-section__title">Admin Notes</h4><p class="expand-notes">${escHtml(d.admin_notes)}</p></div>` : ''}
        <div class="expand-lookup" id="expandLookup-${d.id}"></div>
      </div>
    </div>
  `).join('')

  // Bind expand/collapse on card headers
  container.querySelectorAll('.active-domain-card__header[data-toggle-id]').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      const id = header.dataset.toggleId
      const body = document.getElementById(`cardBody-${id}`)
      const chevron = document.getElementById(`chevron-${id}`)
      if (!body) return

      // Close all other cards
      container.querySelectorAll('.active-domain-card__body').forEach(b => {
        if (b.id !== `cardBody-${id}`) {
          b.hidden = true
          const otherId = b.id.replace('cardBody-', '')
          const otherChevron = document.getElementById(`chevron-${otherId}`)
          if (otherChevron) otherChevron.classList.remove('active-domain-card__chevron--open')
        }
      })

      body.hidden = !body.hidden
      if (chevron) chevron.classList.toggle('active-domain-card__chevron--open', !body.hidden)
      if (!body.hidden) body.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  })

  // Bind events on all cards
  bindTableEvents(container)

  // Bind auto-purge toggles/intervals
  container.querySelectorAll('.admin-auto-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const id = toggle.dataset.id
      const on = toggle.checked
      const { error } = await _supabase.from('user_domains').update({ auto_purge_enabled: on }).eq('id', id)
      if (error) { toggle.checked = !on; showToast('Failed to update auto-purge', true); return }
      toggle.closest('.toggle-switch').classList.toggle('toggle-switch--on', on)
      const label = document.getElementById(`apLabel-${id}`)
      if (label) label.innerHTML = on ? '<strong>On</strong>' : '<strong>Off</strong>'
      const intervalSelect = container.querySelector(`.admin-auto-interval[data-id="${id}"]`)
      if (intervalSelect) {
        intervalSelect.disabled = !on
        intervalSelect.closest('.auto-purge-interval')?.classList.toggle('auto-purge-interval--disabled', !on)
      }
      const d = allDomains.find(d => d.id === id)
      if (d) d.auto_purge_enabled = on
    })
  })
  container.querySelectorAll('.admin-auto-interval').forEach(select => {
    select.addEventListener('change', async () => {
      const id = select.dataset.id
      const { error } = await _supabase.from('user_domains').update({ auto_purge_interval: select.value }).eq('id', id)
      if (error) { showToast('Failed to update interval', true); return }
      const d = allDomains.find(d => d.id === id)
      if (d) d.auto_purge_interval = select.value
    })
  })

  renderPagination(container, 'active', total, page, totalPages, renderActiveTable)
}

// ─── Rejected table ───────────────────────────────────────────────────────────

function renderRejectedTable() {
  const body = document.getElementById('rejectedTableBody')
  const wrap = document.getElementById('rejectedTableWrap')
  const empty = document.getElementById('rejectedEmpty')
  const count = document.getElementById('rejectedCount')

  const allRejected = allDomains.filter(d => d.status === 'rejected')

  if (!allRejected.length) {
    empty.hidden = false
    wrap.hidden = true
    count.textContent = ''
    return
  }
  empty.hidden = true
  wrap.hidden = false
  count.textContent = `${allRejected.length} domain${allRejected.length !== 1 ? 's' : ''}`

  const { items: rejected, page, totalPages, total } = paginate(allRejected, 'rejected')

  body.innerHTML = rejected.map(d => `
    <tr class="admin-row admin-row--rejected" data-id="${d.id}">
      <td><strong>${escHtml(d.domain)}</strong></td>
      <td>${escHtml(d.user_name || d.user_email)}</td>
      <td>${formatDate(d.created_at)}</td>
      <td>${escHtml(d.admin_notes || '—')}</td>
      <td class="admin-row__actions">
        <button class="btn btn--outline btn--sm" data-action="setup" data-id="${d.id}" type="button">Re-review</button>
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button" aria-label="Delete domain">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
    <tr class="admin-expand-row" id="expand-${d.id}" hidden>
      <td colspan="5"><div class="admin-expand" id="expandContent-${d.id}"></div></td>
    </tr>
  `).join('')

  bindTableEvents(document.getElementById('rejectedTable'))
  renderPagination(wrap, 'rejected', total, page, totalPages, renderRejectedTable)
}

// ─── Users table ──────────────────────────────────────────────────────────────

function renderUsersTable() {
  const admins = allProfiles.filter(p => p.role === 'admin')
  const users = allProfiles.filter(p => p.role !== 'admin')

  // ─── Admins section ─────────────────────────────────────────────
  const adminBody = document.getElementById('adminsTableBody')
  const adminWrap = document.getElementById('adminsTableWrap')
  const adminEmpty = document.getElementById('adminsEmpty')
  const adminCount = document.getElementById('adminCount')

  if (!admins.length) {
    adminEmpty.hidden = false
    adminWrap.hidden = true
  } else {
    adminEmpty.hidden = true
    adminWrap.hidden = false
    adminCount.textContent = `${admins.length}`

    const { items: pagedAdmins, page: aPage, totalPages: aTotalPages, total: aTotal } = paginate(admins, 'adminsTable')

    adminBody.innerHTML = pagedAdmins.map(p => {
      const domainCount = allDomains.filter(d => d.user_id === p.id).length
      const status = p.status || 'active'
      const plan = p.plan || 'none'
      const payment = p.payment_status || 'unpaid'
      return `
        <tr class="admin-row" data-user-id="${p.id}">
          <td>
            <div class="admin-user-cell">
              <div class="admin-user-avatar admin-user-avatar--admin">${(p.full_name || p.email || '?')[0].toUpperCase()}</div>
              <strong>${escHtml(p.full_name || '—')}</strong>
            </div>
          </td>
          <td>${escHtml(p.email || '—')}</td>
          <td><span class="status-badge status-badge--${status}">${status}</span></td>
          <td><span class="plan-badge plan-badge--${plan}">${plan}</span></td>
          <td><span class="payment-badge payment-badge--${payment}">${payment}</span></td>
          <td>${domainCount}</td>
          <td>${formatDate(p.created_at)}</td>
        </tr>
        <tr class="admin-expand-row" id="expand-user-${p.id}" hidden>
          <td colspan="7"><div class="admin-expand" id="expandUser-${p.id}"></div></td>
        </tr>
      `
    }).join('')

    bindUserRowEvents(adminBody)
    renderPagination(adminWrap, 'adminsTable', aTotal, aPage, aTotalPages, renderUsersTable)
  }

  // ─── Users section ──────────────────────────────────────────────
  const userBody = document.getElementById('usersTableBody')
  const userWrap = document.getElementById('usersTableWrap')
  const userEmpty = document.getElementById('usersEmpty')
  const userCount = document.getElementById('userCount')

  if (!users.length) {
    userEmpty.hidden = false
    userWrap.hidden = true
  } else {
    userEmpty.hidden = true
    userWrap.hidden = false
    userCount.textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`

    const { items: pagedUsers, page: uPage, totalPages: uTotalPages, total: uTotal } = paginate(users, 'usersTable')

    userBody.innerHTML = pagedUsers.map(p => {
      const domainCount = allDomains.filter(d => d.user_id === p.id).length
      const status = p.status || 'active'
      const plan = p.plan || 'none'
      const payment = p.payment_status || 'unpaid'
      return `
        <tr class="admin-row" data-user-id="${p.id}">
          <td>
            <div class="admin-user-cell">
              <div class="admin-user-avatar">${(p.full_name || p.email || '?')[0].toUpperCase()}</div>
              <strong>${escHtml(p.full_name || '—')}</strong>
            </div>
          </td>
          <td>${escHtml(p.email || '—')}</td>
          <td><span class="status-badge status-badge--${status}" id="userStatus-${p.id}">${status}</span></td>
          <td><span class="plan-badge plan-badge--${plan}" id="userPlan-${p.id}">${plan}</span></td>
          <td><span class="payment-badge payment-badge--${payment}" id="userPayment-${p.id}">${payment}</span></td>
          <td>${domainCount}</td>
          <td>${formatDate(p.created_at)}</td>
          <td class="admin-row__actions">
            <select class="form-input form-select form-select--sm user-status-select" data-user-id="${p.id}">
              <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
              <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
              <option value="suspended" ${status === 'suspended' ? 'selected' : ''}>Suspended</option>
              <option value="blocked" ${status === 'blocked' ? 'selected' : ''}>Blocked</option>
            </select>
            <select class="form-input form-select form-select--sm user-plan-select" data-user-id="${p.id}">
              <option value="none" ${plan === 'none' ? 'selected' : ''}>No Plan</option>
              <option value="solo" ${plan === 'solo' ? 'selected' : ''}>Solo</option>
              <option value="starter" ${plan === 'starter' ? 'selected' : ''}>Starter</option>
              <option value="pro" ${plan === 'pro' ? 'selected' : ''}>Pro</option>
              <option value="business" ${plan === 'business' ? 'selected' : ''}>Business</option>
              <option value="enterprise" ${plan === 'enterprise' ? 'selected' : ''}>Enterprise</option>
            </select>
            <select class="form-input form-select form-select--sm user-payment-select" data-user-id="${p.id}">
              <option value="unpaid" ${payment === 'unpaid' ? 'selected' : ''}>Unpaid</option>
              <option value="paid" ${payment === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="overdue" ${payment === 'overdue' ? 'selected' : ''}>Overdue</option>
              <option value="trial" ${payment === 'trial' ? 'selected' : ''}>Trial</option>
              <option value="cancelled" ${payment === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </td>
        </tr>
        <tr class="admin-expand-row" id="expand-user-${p.id}" hidden>
          <td colspan="8"><div class="admin-expand" id="expandUser-${p.id}"></div></td>
        </tr>
      `
    }).join('')

    bindUserRowEvents(userBody)

    // Bind status change events
    userWrap.querySelectorAll('.user-status-select').forEach(select => {
      select.addEventListener('change', async () => {
        const userId = select.dataset.userId
        const newStatus = select.value
        const { error } = await _supabase
          .from('profiles')
          .update({ status: newStatus })
          .eq('id', userId)

        if (error) {
          console.error('Update error:', error); showToast('Failed to update. Please try again.', true)
          return
        }

        const badge = document.getElementById(`userStatus-${userId}`)
        if (badge) {
          badge.textContent = newStatus
          badge.className = `status-badge status-badge--${newStatus}`
        }

        const profile = allProfiles.find(p => p.id === userId)
        if (profile) profile.status = newStatus
        showToast(`User status changed to ${newStatus}`)
      })
    })

    // Bind plan change events
    userWrap.querySelectorAll('.user-plan-select').forEach(select => {
      select.addEventListener('change', async () => {
        const userId = select.dataset.userId
        const newPlan = select.value
        const { error } = await _supabase
          .from('profiles')
          .update({ plan: newPlan })
          .eq('id', userId)

        if (error) {
          console.error('Update error:', error); showToast('Failed to update. Please try again.', true)
          return
        }

        const badge = document.getElementById(`userPlan-${userId}`)
        if (badge) {
          badge.textContent = newPlan
          badge.className = `plan-badge plan-badge--${newPlan}`
        }

        const profile = allProfiles.find(p => p.id === userId)
        if (profile) profile.plan = newPlan
        showToast(`User plan changed to ${newPlan}`)
      })
    })

    // Bind payment status change events
    userWrap.querySelectorAll('.user-payment-select').forEach(select => {
      select.addEventListener('change', async () => {
        const userId = select.dataset.userId
        const newPayment = select.value
        const { error } = await _supabase
          .from('profiles')
          .update({ payment_status: newPayment })
          .eq('id', userId)

        if (error) {
          console.error('Update error:', error); showToast('Failed to update. Please try again.', true)
          return
        }

        const badge = document.getElementById(`userPayment-${userId}`)
        if (badge) {
          badge.textContent = newPayment
          badge.className = `payment-badge payment-badge--${newPayment}`
        }

        const profile = allProfiles.find(p => p.id === userId)
        if (profile) profile.payment_status = newPayment
        showToast(`Payment status changed to ${newPayment}`)
      })
    })

    renderPagination(userWrap, 'usersTable', uTotal, uPage, uTotalPages, renderUsersTable)
  }
}

// ─── User row expand/collapse ─────────────────────────────────────────────────

function bindUserRowEvents(container) {
  container.querySelectorAll('.admin-row[data-user-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('select') || e.target.closest('button')) return
      toggleUserExpand(row.dataset.userId)
    })
  })
}

function toggleUserExpand(userId) {
  const expandRow = document.getElementById(`expand-user-${userId}`)
  if (!expandRow) return

  // Close if already open
  if (!expandRow.hidden) {
    expandRow.hidden = true
    return
  }

  // Close all other user expand rows
  document.querySelectorAll('.admin-expand-row[id^="expand-user-"]').forEach(r => { r.hidden = true })

  expandRow.hidden = false
  expandRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  const content = document.getElementById(`expandUser-${userId}`)
  if (!content) return

  const profile = allProfiles.find(p => p.id === userId)
  if (!profile) return

  const userDomainsList = allDomains.filter(d => d.user_id === userId)
  const status = profile.status || 'active'
  const plan = profile.plan || 'none'
  const payment = profile.payment_status || 'unpaid'

  const domainsHtml = userDomainsList.length
    ? userDomainsList.map(d => `
        <div class="expand-meta__item">
          <span class="expand-meta__value"><strong>${escHtml(d.domain)}</strong></span>
          <span class="status-badge status-badge--${d.status}">${d.status}</span>
        </div>
      `).join('')
    : '<p style="color:rgba(255,255,255,0.4);font-size:0.82rem;margin:0">No domains submitted</p>'

  content.innerHTML = `
    <div class="expand-grid">
      <div class="expand-section">
        <h4 class="expand-section__title">Account Info</h4>
        <div class="expand-meta">
          <div class="expand-meta__item"><span class="expand-meta__label">User ID</span><span class="expand-meta__value" style="font-size:0.75rem;font-family:monospace;color:rgba(255,255,255,0.5)">${userId.slice(0, 16)}...</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Name</span><span class="expand-meta__value">${escHtml(profile.full_name || '—')}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Email</span><span class="expand-meta__value">${escHtml(profile.email || '—')}</span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Role</span><span class="expand-meta__value"><span class="status-badge ${profile.role === 'admin' ? 'status-badge--active' : ''}">${profile.role}</span></span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Status</span><span class="expand-meta__value"><span class="status-badge status-badge--${status}">${status}</span></span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Plan</span><span class="expand-meta__value"><span class="plan-badge plan-badge--${plan}">${plan}</span></span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Payment</span><span class="expand-meta__value"><span class="payment-badge payment-badge--${payment}">${payment}</span></span></div>
          <div class="expand-meta__item"><span class="expand-meta__label">Joined</span><span class="expand-meta__value">${formatDate(profile.created_at)}</span></div>
        </div>
      </div>
      <div class="expand-section">
        <h4 class="expand-section__title">Avatar</h4>
        <div style="margin-top:4px">
          ${profile.avatar_url
            ? `<img src="${escHtml(profile.avatar_url)}" alt="" style="width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,0.1)" />`
            : `<div class="admin-user-avatar" style="width:64px;height:64px;font-size:1.5rem;line-height:64px">${(profile.full_name || profile.email || '?')[0].toUpperCase()}</div>`
          }
        </div>
      </div>
      <div class="expand-section">
        <h4 class="expand-section__title">Domains (${userDomainsList.length})</h4>
        <div class="expand-meta">
          ${domainsHtml}
        </div>
      </div>
    </div>
  `
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
  container.querySelectorAll('[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleQuickReject(btn.dataset.id, btn.dataset.domain)
    })
  })
  container.querySelectorAll('[data-action="adminpurge"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleAdminPurge(btn)
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
  expandRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
        <h4 class="expand-section__title">CDN Provider</h4>
        <div class="expand-meta">
          ${renderCredentialsMeta(domain)}
          <div class="expand-meta__item"><span class="expand-meta__label">Last Purged</span><span class="expand-meta__value">${domain.last_purged_at ? formatDate(domain.last_purged_at) : '—'}</span></div>
        </div>
      </div>
      ${domain.admin_notes ? `
        <div class="expand-section expand-section--full">
          <h4 class="expand-section__title">Admin Notes</h4>
          <p class="expand-notes">${escHtml(domain.admin_notes)}</p>
        </div>
      ` : ''}
      ${domain.status === 'active' ? `
        <div class="expand-section expand-section--full">
          <h4 class="expand-section__title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Auto-Purge Schedule
          </h4>
          <p class="expand-notes" style="margin-bottom:12px">Runs on the server 24/7 — no need to keep any device on.</p>
          <div class="auto-purge-controls">
            <div class="auto-purge-toggle">
              <label class="toggle-switch ${domain.auto_purge_enabled ? 'toggle-switch--on' : ''}">
                <input type="checkbox" class="admin-auto-toggle" data-id="${domain.id}" ${domain.auto_purge_enabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <span class="auto-purge-toggle__label" id="apLabel-${domain.id}">${domain.auto_purge_enabled ? 'Auto-purge is <strong>on</strong>' : 'Auto-purge is <strong>off</strong>'}</span>
            </div>
            <div class="auto-purge-interval ${domain.auto_purge_enabled ? '' : 'auto-purge-interval--disabled'}">
              <label class="form-label">Frequency</label>
              <select class="form-input form-select admin-auto-interval" data-id="${domain.id}" ${domain.auto_purge_enabled ? '' : 'disabled'}>
                <option value="hourly" ${domain.auto_purge_interval === 'hourly' ? 'selected' : ''}>Every hour</option>
                <option value="every6h" ${domain.auto_purge_interval === 'every6h' ? 'selected' : ''}>Every 6 hours</option>
                <option value="every12h" ${domain.auto_purge_interval === 'every12h' ? 'selected' : ''}>Every 12 hours</option>
                <option value="daily" ${(domain.auto_purge_interval || 'daily') === 'daily' ? 'selected' : ''}>Once a day</option>
                <option value="weekly" ${domain.auto_purge_interval === 'weekly' ? 'selected' : ''}>Once a week</option>
              </select>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
    <div class="expand-actions">
      ${domain.status === 'pending' ? `<button class="btn btn--primary btn--sm" data-action="setup" data-id="${domain.id}" type="button">Configure & Approve</button>` : ''}
      ${domain.status === 'active' ? `<button class="btn btn--outline btn--sm" data-action="adminpurge" data-id="${domain.id}" data-domain="${escHtml(domain.domain)}" type="button"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Purge Cache</button>` : ''}
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

  // Bind auto-purge toggle/interval events
  content.querySelectorAll('.admin-auto-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const id = toggle.dataset.id
      const on = toggle.checked
      const { error } = await _supabase.from('user_domains').update({ auto_purge_enabled: on }).eq('id', id)
      if (error) {
        toggle.checked = !on
        showToast('Failed to update auto-purge', true)
        return
      }
      toggle.closest('.toggle-switch').classList.toggle('toggle-switch--on', on)
      const label = document.getElementById(`apLabel-${id}`)
      if (label) label.innerHTML = on ? 'Auto-purge is <strong>on</strong>' : 'Auto-purge is <strong>off</strong>'
      const intervalWrap = content.querySelector(`.admin-auto-interval[data-id="${id}"]`)
      if (intervalWrap) {
        intervalWrap.disabled = !on
        intervalWrap.closest('.auto-purge-interval')?.classList.toggle('auto-purge-interval--disabled', !on)
      }
      // Update local data
      const d = allDomains.find(d => d.id === id)
      if (d) d.auto_purge_enabled = on
    })
  })
  content.querySelectorAll('.admin-auto-interval').forEach(select => {
    select.addEventListener('change', async () => {
      const id = select.dataset.id
      const { error } = await _supabase.from('user_domains').update({ auto_purge_interval: select.value }).eq('id', id)
      if (error) { showToast('Failed to update interval', true); return }
      const d = allDomains.find(d => d.id === id)
      if (d) d.auto_purge_interval = select.value
    })
  })
}

// ─── Domain Lookup (Admin) ────────────────────────────────────────────────

async function runAdminLookup(domain, domainId) {
  // Determine which container to use
  let container

  // Try card-based lookup (active domain cards)
  const cardLookup = document.getElementById(`expandLookup-${domainId}`)
  if (cardLookup) {
    const cardBody = document.getElementById(`cardBody-${domainId}`)
    const chevron = document.getElementById(`chevron-${domainId}`)
    if (cardBody && cardBody.hidden) {
      cardBody.hidden = false
      if (chevron) chevron.classList.add('active-domain-card__chevron--open')
    }
    container = cardLookup
  } else {
    // Table row mode — use the dedicated lookup result area
    container = document.getElementById('appLookupResult')
    if (!container) return
  }

  // Toggle off if already loaded
  if (container.dataset.lookupLoaded === 'true') {
    container.innerHTML = ''
    container.hidden = true
    container.dataset.lookupLoaded = ''
    return
  }

  container.hidden = false
  container.innerHTML = `<div class="admin-report__loading">
    <div class="loading-dots"><span></span><span></span><span></span></div>
    Looking up <strong>${escHtml(domain)}</strong>...
  </div>`
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

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
      container.dataset.lookupLoaded = 'true'
      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
    container.dataset.lookupLoaded = 'true'
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

  } catch (err) {
    container.innerHTML = `<div class="dash-alert dash-alert--error" style="margin:12px 0">Lookup failed: ${escHtml(String(err))}</div>`
    container.dataset.lookupLoaded = 'true'
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
    console.error('Submit domain error:', error)
    errEl.textContent = error.message?.includes('unique') ? `${adminScannedDomain} is already submitted.` : 'Failed to submit domain. Please try again.'
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

// ─── Admin Purge ─────────────────────────────────────────────────────────────

async function handleAdminPurge(btn) {
  const domainId = btn.dataset.id
  const domainName = btn.dataset.domain
  const origHtml = btn.innerHTML

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Purging...'

  const session = await getSession()
  if (!session) { btn.disabled = false; btn.innerHTML = origHtml; return }

  const res = await fetch(`${EDGE_BASE}/purge-cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain_id: domainId, purge_type: 'everything' }),
  })

  const data = await res.json()
  btn.disabled = false

  if (res.ok && data.success) {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Done!'
    setTimeout(() => { btn.innerHTML = origHtml }, 2000)
    await loadAllDomains()
  } else {
    btn.innerHTML = origHtml
    const errMsg = data.cf_response?.errors?.[0]?.message || data.error || 'Purge failed'
    showToast(`Purge failed: ${errMsg}`, true)
  }
}

// ─── Setup modal ──────────────────────────────────────────────────────────────

function openSetupModal(domainId) {
  setupDomainId = domainId
  const domain = allDomains.find(d => d.id === domainId)
  if (!domain) return

  document.getElementById('setupDomainName').textContent = domain.domain
  document.getElementById('setupDomainUser').textContent = domain.user_name || domain.user_email
  document.getElementById('setupDomainDate').textContent = `Submitted ${formatDate(domain.created_at)}`

  const provider = domain.cdn_provider || 'cloudflare'
  document.getElementById('setupProvider').value = provider
  updateSetupProviderFields(provider)

  document.getElementById('setupZoneId').value = domain.cloudflare_zone_id || ''
  document.getElementById('setupApiToken').value = domain.cloudflare_api_token || ''
  document.getElementById('setupDistId').value = domain.cdn_distribution_id || ''
  document.getElementById('setupCdnApiKey').value = domain.cdn_api_key || ''
  document.getElementById('setupNotes').value = domain.admin_notes || ''
  document.getElementById('setupError').hidden = true

  document.getElementById('setupModal').hidden = false
}

function updateSetupProviderFields(prov) {
  document.getElementById('setupCfFields').hidden = prov !== 'cloudflare'
  document.getElementById('setupGenericFields').hidden = prov === 'cloudflare' || prov === 'none'
  document.getElementById('setupNoneMsg').hidden = prov !== 'none'

  if (prov === 'cloudfront') {
    document.getElementById('setupLabelDistId').textContent = 'Distribution ID'
    document.getElementById('setupLabelCdnApiKey').textContent = 'AWS Access Key'
    document.getElementById('setupHintDistId').textContent = 'Found in CloudFront console → Distributions'
    document.getElementById('setupHintCdnApiKey').textContent = 'IAM user access key with CloudFront permissions'
  } else if (prov === 'fastly') {
    document.getElementById('setupLabelDistId').textContent = 'Service ID'
    document.getElementById('setupLabelCdnApiKey').textContent = 'API Token'
    document.getElementById('setupHintDistId').textContent = 'Found in Fastly dashboard → your service'
    document.getElementById('setupHintCdnApiKey').textContent = 'Account → API tokens → Create token'
  }
}

function closeSetupModal() {
  document.getElementById('setupModal').hidden = true
  setupDomainId = null
}

async function handleApprove(e) {
  e.preventDefault()
  if (!setupDomainId) return

  const provider = document.getElementById('setupProvider').value
  const notes = document.getElementById('setupNotes').value.trim()
  const errEl = document.getElementById('setupError')

  const updateData = {
    cdn_provider: provider,
    admin_notes: notes || null,
    status: 'active',
  }

  if (provider === 'cloudflare') {
    const zoneId = document.getElementById('setupZoneId').value.trim()
    const apiToken = document.getElementById('setupApiToken').value.trim()
    if (!zoneId || !apiToken) {
      errEl.textContent = 'Zone ID and API Token are required for Cloudflare.'
      errEl.hidden = false
      return
    }
    updateData.cloudflare_zone_id = zoneId
    updateData.cloudflare_api_token = apiToken
  } else if (provider === 'cloudfront' || provider === 'fastly') {
    const distId = document.getElementById('setupDistId').value.trim()
    const apiKey = document.getElementById('setupCdnApiKey').value.trim()
    if (!distId || !apiKey) {
      errEl.textContent = `${provider === 'cloudfront' ? 'Distribution ID and AWS Access Key' : 'Service ID and API Token'} are required.`
      errEl.hidden = false
      return
    }
    updateData.cdn_distribution_id = distId
    updateData.cdn_api_key = apiKey
  }
  // 'none' — no credentials needed

  const btn = document.getElementById('setupApproveBtn')
  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Activating...'

  const { error } = await _supabase
    .from('user_domains')
    .update(updateData)
    .eq('id', setupDomainId)

  btn.disabled = false
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Approve & Activate'

  if (error) {
    console.error('Activate error:', error)
    errEl.textContent = 'Failed to activate domain. Please try again.'
    errEl.hidden = false
    return
  }

  closeSetupModal()
  await loadAllDomains()
}

async function handleReject() {
  if (!setupDomainId) return
  if (!confirm('Reject this domain application?')) return

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
    console.error('Reject error:', error)
    document.getElementById('setupError').textContent = 'Failed to reject domain. Please try again.'
    document.getElementById('setupError').hidden = false
    return
  }

  closeSetupModal()
  await loadAllDomains()
}

// ─── Quick Reject (from applications table) ──────────────────────────────────

async function handleQuickReject(domainId, domainName) {
  if (!confirm(`Reject domain "${domainName}"?`)) return

  const { error } = await _supabase
    .from('user_domains')
    .update({ status: 'rejected', admin_notes: 'Domain rejected by admin.' })
    .eq('id', domainId)

  if (error) {
    console.error('Reject error:', error)
    showToast('Failed to reject domain. Please try again.', true)
    return
  }

  showToast(`${domainName} rejected`)
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

  if (error) {
    console.error('Delete domain error:', error)
    showToast('Failed to delete domain. Please try again.', true)
    return
  }
  showToast('Domain deleted')
  await loadAllDomains()
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

// ─── Pagination ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 10
const pageState = {}

function paginate(items, tableKey) {
  if (!pageState[tableKey]) pageState[tableKey] = 1
  const page = pageState[tableKey]
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  if (page > totalPages) pageState[tableKey] = totalPages
  const start = (pageState[tableKey] - 1) * PAGE_SIZE
  return {
    items: items.slice(start, start + PAGE_SIZE),
    page: pageState[tableKey],
    totalPages,
    total: items.length,
  }
}

function renderPagination(containerEl, tableKey, total, page, totalPages, renderFn) {
  const existing = containerEl.querySelector('.pagination')
  if (existing) existing.remove()

  if (totalPages <= 1) return

  const pag = document.createElement('div')
  pag.className = 'pagination'

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  let pageButtons = ''
  const maxVisible = 5
  let startPage = Math.max(1, page - Math.floor(maxVisible / 2))
  let endPage = Math.min(totalPages, startPage + maxVisible - 1)
  if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1)

  for (let i = startPage; i <= endPage; i++) {
    pageButtons += `<button class="pagination__btn ${i === page ? 'pagination__btn--active' : ''}" data-page="${i}" type="button">${i}</button>`
  }

  pag.innerHTML = `
    <span class="pagination__info">Showing ${start}–${end} of ${total}</span>
    <div class="pagination__buttons">
      <button class="pagination__btn pagination__btn--nav" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} type="button">&laquo; Prev</button>
      ${pageButtons}
      <button class="pagination__btn pagination__btn--nav" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} type="button">Next &raquo;</button>
    </div>
  `

  pag.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page)
      if (p >= 1 && p <= totalPages) {
        pageState[tableKey] = p
        renderFn()
      }
    })
  })

  containerEl.appendChild(pag)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.classList.toggle('toast--error', isError)
  toast.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.hidden = true }, isError ? 5000 : 2500)
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN MONITORING PANELS
// ═══════════════════════════════════════════════════════════════════════════════

const _admCfCache = {}
const ADM_CACHE_TTL = 60_000

// ─── Generic Table Pagination ─────────────────────────────────────────────────
const ADM_PER_PAGE = 15
const _admPageState = {} // { key: { rows: [], page: 1 } }

function _admInitPage(key, rows) {
  _admPageState[key] = { rows, page: (_admPageState[key]?.page > 1 ? Math.min(_admPageState[key].page, Math.ceil(rows.length / ADM_PER_PAGE) || 1) : 1) }
}

function _admRenderPage(key, tbodyId, pagId) {
  const state = _admPageState[key]
  if (!state) return
  const tbody = document.getElementById(tbodyId)
  const pag = document.getElementById(pagId)
  if (!tbody || !pag) return

  const totalPages = Math.ceil(state.rows.length / ADM_PER_PAGE) || 1
  if (state.page > totalPages) state.page = totalPages
  const start = (state.page - 1) * ADM_PER_PAGE
  tbody.innerHTML = state.rows.slice(start, start + ADM_PER_PAGE).join('')

  if (totalPages <= 1) { pag.innerHTML = ''; return }

  let btns = ''
  btns += `<button class="pagination__btn pagination__btn--nav" ${state.page === 1 ? 'disabled' : ''} data-pag="${key}" data-pp="${state.page - 1}">&laquo; Prev</button>`
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - state.page) > 1) {
      if (i === 3 || i === totalPages - 2) btns += '<span class="pagination__dots">&hellip;</span>'
      continue
    }
    btns += `<button class="pagination__btn${i === state.page ? ' pagination__btn--active' : ''}" data-pag="${key}" data-pp="${i}">${i}</button>`
  }
  btns += `<button class="pagination__btn pagination__btn--nav" ${state.page === totalPages ? 'disabled' : ''} data-pag="${key}" data-pp="${state.page + 1}">Next &raquo;</button>`

  pag.innerHTML = `<div class="pagination__info">${state.rows.length} records &middot; Page ${state.page} of ${totalPages}</div><div class="pagination__buttons">${btns}</div>`

  pag.querySelectorAll(`[data-pag="${key}"]`).forEach(btn => {
    btn.onclick = () => {
      state.page = Number(btn.dataset.pp)
      _admRenderPage(key, tbodyId, pagId)
    }
  })
}

async function admCfProxy(domainId, action, extra = {}) {
  const cacheKey = `${domainId}:${action}:${JSON.stringify(extra)}`
  const cached = _admCfCache[cacheKey]
  if (cached && Date.now() - cached.ts < ADM_CACHE_TTL) return cached.data

  const session = await getSession()
  if (!session) return null
  const params = new URLSearchParams({ domain_id: domainId, action, ...extra })
  const res = await fetch(`${EDGE_BASE}/cf-proxy?${params}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error('Session expired — please reload the page')
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  _admCfCache[cacheKey] = { data, ts: Date.now() }
  return data
}

function admGetProvider(domainId) {
  const d = allDomains.find(x => x.id === domainId)
  return d?.cdn_provider || 'cloudflare'
}

function admPopulateDomainSelect(selectId) {
  const select = document.getElementById(selectId)
  if (!select) return null
  const active = allDomains.filter(d => d.status === 'active')
  if (!active.length) {
    select.innerHTML = '<option value="">No active domains</option>'
    return null
  }
  const prev = select.value
  select.innerHTML = '<option value="__all__">All Domains</option>' + active.map(d => {
    const prov = d.cdn_provider || 'cloudflare'
    const owner = d.user_email ? ` (${d.user_email.split('@')[0]})` : ''
    const label = prov === 'cloudflare' ? '' : ` [${prov}]`
    return `<option value="${d.id}">${escHtml(d.domain)}${label}${owner}</option>`
  }).join('')
  if (prev && select.querySelector(`option[value="${prev}"]`)) select.value = prev
  return '__all__'
}

function admGetSelectedDomains(selectId) {
  const select = document.getElementById(selectId)
  const val = select?.value || '__all__'
  const active = allDomains.filter(d => d.status === 'active')
  if (val === '__all__') return active
  return active.filter(d => d.id === val)
}

function admSettingBadge(value) {
  const isOn = value === 'on' || value === true
  return `<span class="status-badge ${isOn ? 'status-badge--active' : 'status-badge--pending'}">${isOn ? 'On' : 'Off'}</span>`
}

function fmtNum(n) {
  if (n == null) return '0'
  return Number(n).toLocaleString()
}

function formatBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// ─── Analytics ───────────────────────────────────────────────────────────────

let _admAnlRange = '7d'
let _admAnlChart = null

function _anlStatusColor(code) {
  if (code < 300) return 'status-badge--active'
  if (code < 400) return 'status-badge--info'
  if (code < 500) return 'status-badge--pending'
  return 'status-badge--error'
}

async function admPopulateAnalytics() {
  const loading = document.getElementById('admAnlLoading')
  const content = document.getElementById('admAnlContent')
  const noDomains = document.getElementById('admAnlNoDomains')
  const error = document.getElementById('admAnlError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admAnlDomainSelect')
  const activeDomains = admGetSelectedDomains('admAnlDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admAnlDomainSelect').onchange = () => { delete _admPageState['anl']; admPopulateAnalytics() }

  document.querySelectorAll('#panelMonAnalytics .purge-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#panelMonAnalytics .purge-tab').forEach(b => b.classList.remove('purge-tab--active'))
      btn.classList.add('purge-tab--active')
      _admAnlRange = btn.dataset.range || '24h'
      admPopulateAnalytics()
    }
  })

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      try {
        const data = await admCfProxy(d.id, 'analytics', { since: _admAnlRange })
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', analytics: data.analytics, message: data.message }
      } catch (err) {
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', analytics: null, message: err.message }
      }
    }))

    loading.hidden = true

    // ── Aggregate totals across all domains ──
    const agg = { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, threats: 0, uniques: 0 }
    const dailyMap = {}
    const countryAgg = {}
    const statusAgg = {}
    const contentAgg = {}
    const sslAgg = {}

    for (const r of results) {
      if (!r.analytics) continue
      const a = r.analytics
      agg.requests += a.requests_total || 0
      agg.cachedRequests += a.requests_cached || 0
      agg.bytes += a.bandwidth_total || 0
      agg.cachedBytes += a.bandwidth_cached || 0
      agg.threats += a.threats_total || 0
      agg.uniques += a.unique_visitors || 0

      for (const d of a.daily || []) {
        if (!dailyMap[d.date]) dailyMap[d.date] = { requests: 0, bytes: 0, threats: 0 }
        dailyMap[d.date].requests += d.requests || 0
        dailyMap[d.date].bytes += d.bytes || 0
        dailyMap[d.date].threats += d.threats || 0
      }
      for (const c of a.countryMap || []) {
        if (!countryAgg[c.country]) countryAgg[c.country] = { requests: 0, bytes: 0, threats: 0 }
        countryAgg[c.country].requests += c.requests || 0
        countryAgg[c.country].bytes += c.bytes || 0
        countryAgg[c.country].threats += c.threats || 0
      }
      for (const s of a.responseStatusMap || []) {
        statusAgg[s.status] = (statusAgg[s.status] || 0) + (s.requests || 0)
      }
      for (const ct of a.contentTypeMap || []) {
        if (!contentAgg[ct.type]) contentAgg[ct.type] = { requests: 0, bytes: 0 }
        contentAgg[ct.type].requests += ct.requests || 0
        contentAgg[ct.type].bytes += ct.bytes || 0
      }
      for (const sl of a.clientSSLMap || []) {
        sslAgg[sl.protocol] = (sslAgg[sl.protocol] || 0) + (sl.requests || 0)
      }
    }

    const cacheRate = agg.bytes > 0 ? Math.round((agg.cachedBytes / agg.bytes) * 100) : 0

    // ── Summary stat cards ──
    document.getElementById('admAnlStats').innerHTML = `
      <div class="stat-box">
        <span class="stat-box__icon stat-box__icon--blue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
        <span class="stat-box__value">${fmtNum(agg.requests)}</span>
        <span class="stat-box__label">Total Requests</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__icon stat-box__icon--cyan"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>
        <span class="stat-box__value">${formatBytes(agg.bytes)}</span>
        <span class="stat-box__label">Bandwidth</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__icon stat-box__icon--purple"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></span>
        <span class="stat-box__value">${fmtNum(agg.uniques)}</span>
        <span class="stat-box__label">Unique Visitors</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__icon stat-box__icon--amber"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
        <span class="stat-box__value">${cacheRate}%</span>
        <span class="stat-box__label">Cache Hit Rate</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__icon stat-box__icon--red"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
        <span class="stat-box__value">${fmtNum(agg.threats)}</span>
        <span class="stat-box__label">Threats Blocked</span>
      </div>
    `

    // ── Trend chart ──
    const dates = Object.keys(dailyMap).sort()
    const chartWrap = document.querySelector('.anl-chart-wrap')
    if (dates.length > 1 && typeof Chart !== 'undefined') {
      chartWrap.hidden = false
      const reqData = dates.map(d => dailyMap[d].requests)
      const bwData = dates.map(d => dailyMap[d].bytes)
      const is24h = _admAnlRange === '24h'
      const isYearly = _admAnlRange === '1y'
      const isLongRange = _admAnlRange === '30d' || _admAnlRange === '1y'
      const labels = dates.map(d => {
        if (is24h && d.includes('T')) return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        const dt = new Date(d + (d.includes('T') ? '' : 'T00:00:00'))
        if (isYearly) return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      })

      if (_admAnlChart) _admAnlChart.destroy()
      const ctx = document.getElementById('admAnlChart').getContext('2d')
      _admAnlChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Requests', data: reqData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.3, pointRadius: isLongRange ? 1 : 3, yAxisID: 'y' },
            { label: 'Bandwidth', data: bwData, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true, tension: 0.3, pointRadius: isLongRange ? 1 : 3, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: '#94a3b8', font: { size: 12 } } } },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 11 }, maxTicksLimit: isLongRange ? 12 : undefined }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { position: 'left', ticks: { color: '#3b82f6', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Requests', color: '#3b82f6' } },
            y1: { position: 'right', ticks: { color: '#06b6d4', font: { size: 11 }, callback: v => formatBytes(v) }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Bandwidth', color: '#06b6d4' } }
          }
        }
      })
    } else {
      chartWrap.hidden = true
    }

    // ── Per-domain table ──
    const anlRows = results.map(r => {
      if (!r.analytics) {
        return `<tr><td>${escHtml(r.domain)}</td><td>${providerBadge(r.provider)}</td><td colspan="6" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      }
      const a = r.analytics
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td>${fmtNum(a.requests_total)}</td><td>${fmtNum(a.requests_cached)}</td><td>${formatBytes(a.bandwidth_total)}</td><td>${a.unique_visitors != null ? fmtNum(a.unique_visitors) : 'N/A'}</td><td>${fmtNum(a.threats_total)}</td><td>${a.cache_hit_rate != null ? a.cache_hit_rate + '%' : 'N/A'}</td></tr>`
    })
    _admInitPage('anl', anlRows)
    _admRenderPage('anl', 'admAnlBody', 'admAnlPagination')

    // ── Top Countries ──
    const countries = Object.entries(countryAgg).map(([c, v]) => ({ country: c, ...v })).sort((a, b) => b.requests - a.requests).slice(0, 15)
    document.getElementById('admAnlCountries').innerHTML = countries.length
      ? countries.map(c => `<tr><td><strong>${escHtml(c.country)}</strong></td><td>${fmtNum(c.requests)}</td><td>${formatBytes(c.bytes)}</td><td>${fmtNum(c.threats)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="feature-empty">No data</td></tr>'

    // ── HTTP Status Codes ──
    const statuses = Object.entries(statusAgg).map(([s, r]) => ({ status: Number(s), requests: r })).sort((a, b) => b.requests - a.requests)
    document.getElementById('admAnlStatus').innerHTML = statuses.length
      ? statuses.map(s => {
          const pct = agg.requests > 0 ? ((s.requests / agg.requests) * 100).toFixed(1) : '0'
          return `<tr><td><span class="status-badge ${_anlStatusColor(s.status)}">${s.status}</span></td><td>${fmtNum(s.requests)}</td><td>${pct}%</td></tr>`
        }).join('')
      : '<tr><td colspan="3" class="feature-empty">No data</td></tr>'

    // ── Content Types ──
    const contentTypes = Object.entries(contentAgg).map(([t, v]) => ({ type: t, ...v })).sort((a, b) => b.requests - a.requests).slice(0, 15)
    document.getElementById('admAnlContentType').innerHTML = contentTypes.length
      ? contentTypes.map(c => `<tr><td>${escHtml(c.type)}</td><td>${fmtNum(c.requests)}</td><td>${formatBytes(c.bytes)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="feature-empty">No data</td></tr>'

    // ── SSL/TLS Versions ──
    const sslVersions = Object.entries(sslAgg).map(([p, r]) => ({ protocol: p, requests: r })).sort((a, b) => b.requests - a.requests)
    document.getElementById('admAnlSsl').innerHTML = sslVersions.length
      ? sslVersions.map(s => {
          const pct = agg.requests > 0 ? ((s.requests / agg.requests) * 100).toFixed(1) : '0'
          return `<tr><td><strong>${escHtml(s.protocol)}</strong></td><td>${fmtNum(s.requests)}</td><td>${pct}%</td></tr>`
        }).join('')
      : '<tr><td colspan="3" class="feature-empty">No data</td></tr>'

    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── SSL ─────────────────────────────────────────────────────────────────────

async function admPopulateSsl() {
  const loading = document.getElementById('admSslLoading')
  const content = document.getElementById('admSslContent')
  const noDomains = document.getElementById('admSslNoDomains')
  const error = document.getElementById('admSslError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admSslDomainSelect')
  const activeDomains = admGetSelectedDomains('admSslDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admSslDomainSelect').onchange = () => { delete _admPageState['ssl']; admPopulateSsl() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      try {
        const certData = await admCfProxy(d.id, 'ssl_certs')
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', data: certData }
      } catch (err) {
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', data: null, error: err.message }
      }
    }))

    loading.hidden = true
    const tbody = document.getElementById('admSslBody')
    const rows = []

    for (const r of results) {
      if (r.error || !r.data) {
        rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="5" class="feature-empty">${escHtml(r.error || 'No data')}</td></tr>`)
        continue
      }
      if (r.provider === 'cloudflare') {
        const certs = r.data.certs || []
        if (certs.length) {
          for (const c of certs) {
            const hosts = (c.hosts || []).join(', ')
            const cls = c.status === 'active' ? 'active' : 'pending'
            rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(hosts)}</td><td><span class="status-badge status-badge--${cls}">${escHtml(c.status)}</span></td><td>${escHtml(c.issuer || 'Cloudflare')}</td><td>${escHtml(c.type || 'universal')}</td><td>${c.expires_on ? formatDate(c.expires_on) : 'Auto-renewed'}</td></tr>`)
          }
        } else {
          rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="5" class="feature-empty">No certificate packs found</td></tr>`)
        }
      } else {
        if (r.data.ssl_valid) {
          const hdr = r.data.headers || {}
          rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${escHtml(r.domain)}</td><td><span class="status-badge status-badge--active">Valid</span></td><td>${escHtml(hdr.server || r.provider)}</td><td>HTTPS check</td><td>${r.data.hsts ? 'HSTS enabled' : 'No HSTS'}</td></tr>`)
        } else {
          rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${escHtml(r.domain)}</td><td><span class="status-badge status-badge--error">Invalid</span></td><td colspan="3">SSL check failed</td></tr>`)
        }
      }
    }
    _admInitPage('ssl', rows)
    _admRenderPage('ssl', 'admSslBody', 'admSslPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── DNS ─────────────────────────────────────────────────────────────────────

async function admPopulateDns() {
  const loading = document.getElementById('admDnsLoading')
  const content = document.getElementById('admDnsContent')
  const noDomains = document.getElementById('admDnsNoDomains')
  const error = document.getElementById('admDnsError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admDnsDomainSelect')
  const activeDomains = admGetSelectedDomains('admDnsDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admDnsDomainSelect').onchange = () => { delete _admPageState['dns']; admPopulateDns() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      try {
        const data = await admCfProxy(d.id, 'dns_records')
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', data }
      } catch (err) {
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', data: null, error: err.message }
      }
    }))

    loading.hidden = true
    const rows = []

    for (const r of results) {
      if (r.error || !r.data) {
        rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="5" class="feature-empty">${escHtml(r.error || 'No data')}</td></tr>`)
        continue
      }
      if (r.provider === 'cloudflare') {
        const records = r.data.records || []
        if (!records.length) {
          rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="5" class="feature-empty">No DNS records</td></tr>`)
        } else {
          for (const rec of records) {
            const ttl = rec.ttl === 1 ? 'Auto' : `${rec.ttl}s`
            rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td><span class="status-badge" style="background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${escHtml(rec.type)}</span></td><td>${escHtml(rec.name)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(rec.content)}</td><td>${ttl}</td><td>${rec.proxied ? '<span class="status-badge status-badge--active">Proxied</span>' : '<span class="status-badge status-badge--pending">DNS only</span>'}</td></tr>`)
          }
        }
      } else {
        const recordMap = r.data.records || {}
        for (const [type, recs] of Object.entries(recordMap)) {
          for (const entry of recs) {
            rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td><span class="status-badge" style="background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${escHtml(type)}</span></td><td>${escHtml(r.domain)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(entry.data)}</td><td>${entry.ttl ? entry.ttl + 's' : 'N/A'}</td><td><span class="status-badge status-badge--pending">DNS lookup</span></td></tr>`)
          }
        }
        if (!Object.keys(r.data.records || {}).length) rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="5" class="feature-empty">No DNS records</td></tr>`)
      }
    }
    _admInitPage('dns', rows)
    _admRenderPage('dns', 'admDnsBody', 'admDnsPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── WAF ─────────────────────────────────────────────────────────────────────

async function admPopulateWaf() {
  const loading = document.getElementById('admWafLoading')
  const content = document.getElementById('admWafContent')
  const noDomains = document.getElementById('admWafNoDomains')
  const error = document.getElementById('admWafError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admWafDomainSelect')
  const activeDomains = admGetSelectedDomains('admWafDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admWafDomainSelect').onchange = () => { delete _admPageState['waf']; admPopulateWaf() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider !== 'cloudflare') return { domain: d.domain, provider, settings: null, message: 'WAF not available' }
      try {
        const data = await admCfProxy(d.id, 'settings')
        return { domain: d.domain, provider, settings: data.settings || {} }
      } catch (err) {
        return { domain: d.domain, provider, settings: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.settings) {
        return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td colspan="4" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      }
      const s = r.settings
      const level = s.security_level || 'medium'
      const levelCls = level === 'high' || level === 'under_attack' ? 'status-badge--error' : 'status-badge--active'
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td><span class="status-badge ${levelCls}">${level.charAt(0).toUpperCase() + level.slice(1)}</span></td><td>${admSettingBadge(s.browser_check)}</td><td>${admSettingBadge(s.email_obfuscation)}</td><td>${admSettingBadge(s.hotlink_protection)}</td></tr>`
    })
    _admInitPage('waf', rows)
    _admRenderPage('waf', 'admWafBody', 'admWafPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── Images ──────────────────────────────────────────────────────────────────

async function admPopulateImages() {
  const loading = document.getElementById('admImgLoading')
  const content = document.getElementById('admImgContent')
  const noDomains = document.getElementById('admImgNoDomains')
  const error = document.getElementById('admImgError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admImgDomainSelect')
  const activeDomains = admGetSelectedDomains('admImgDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admImgDomainSelect').onchange = () => { delete _admPageState['img']; admPopulateImages() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider !== 'cloudflare') return { domain: d.domain, provider, settings: null, message: 'Not available' }
      try {
        const data = await admCfProxy(d.id, 'settings')
        return { domain: d.domain, provider, settings: data.settings || {} }
      } catch (err) {
        return { domain: d.domain, provider, settings: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.settings) {
        return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td colspan="4" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      }
      const s = r.settings
      const polish = s.polish || 'off'
      const polishBadge = `<span class="status-badge ${polish !== 'off' ? 'status-badge--active' : 'status-badge--pending'}">${polish}</span>`
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td>${admSettingBadge(s.mirage)}</td><td>${polishBadge}</td><td>${admSettingBadge(s.webp)}</td><td>${admSettingBadge(s.rocket_loader)}</td></tr>`
    })
    _admInitPage('img', rows)
    _admRenderPage('img', 'admImgBody', 'admImgPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── Minification ────────────────────────────────────────────────────────────

async function admPopulateMinify() {
  const loading = document.getElementById('admMinifyLoading')
  const content = document.getElementById('admMinifyContent')
  const noDomains = document.getElementById('admMinifyNoDomains')
  const error = document.getElementById('admMinifyError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admMinifyDomainSelect')
  const activeDomains = admGetSelectedDomains('admMinifyDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admMinifyDomainSelect').onchange = () => { delete _admPageState['minify']; admPopulateMinify() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider !== 'cloudflare') return { domain: d.domain, provider, settings: null, message: 'Not available' }
      try {
        const data = await admCfProxy(d.id, 'settings')
        return { domain: d.domain, provider, settings: data.settings || {} }
      } catch (err) {
        return { domain: d.domain, provider, settings: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.settings) {
        return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td colspan="3" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      }
      const minify = r.settings.minify || { css: 'off', html: 'off', js: 'off' }
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td>${admSettingBadge(minify.html)}</td><td>${admSettingBadge(minify.css)}</td><td>${admSettingBadge(minify.js)}</td></tr>`
    })
    _admInitPage('minify', rows)
    _admRenderPage('minify', 'admMinifyBody', 'admMinifyPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── Uptime ──────────────────────────────────────────────────────────────────

async function admPopulateUptime() {
  const loading = document.getElementById('admUptimeLoading')
  const content = document.getElementById('admUptimeContent')
  const noDomains = document.getElementById('admUptimeNoDomains')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true

  const activeDomains = allDomains.filter(d => d.status === 'active')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  const results = await Promise.all(activeDomains.map(async (d) => {
    try {
      const data = await admCfProxy(d.id, 'uptime_check')
      return { domain: d.domain, owner: d.user_email, provider: d.cdn_provider || 'cloudflare', checks: data.checks || [] }
    } catch {
      return { domain: d.domain, owner: d.user_email, provider: d.cdn_provider || 'cloudflare', checks: [] }
    }
  }))

  loading.hidden = true
  content.hidden = false

  const rows = results.map(r => {
    const httpsCheck = r.checks.find(c => c.url?.startsWith('https'))
    const httpCheck = r.checks.find(c => c.url?.startsWith('http://'))
    const mainCheck = httpsCheck || httpCheck || {}
    const isUp = mainCheck.ok
    const statusBadge = isUp
      ? '<span class="status-badge status-badge--active">UP</span>'
      : '<span class="status-badge status-badge--error">DOWN</span>'
    const checkMark = (ok) => ok ? '<span style="color:#22c55e">&#10003;</span>' : '<span style="color:#ef4444">&#10007;</span>'
    const latencyText = mainCheck.latency != null ? `${mainCheck.latency}ms` : '--'

    return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${escHtml(r.owner || '')}</td><td>${providerBadge(r.provider)}</td><td>${statusBadge}</td><td>${checkMark(httpsCheck?.ok)}</td><td>${checkMark(httpCheck?.ok)}</td><td><strong>${latencyText}</strong></td></tr>`
  })
  _admInitPage('uptime', rows)
  _admRenderPage('uptime', 'admUptimeBody', 'admUptimePagination')

  const refreshBtn = document.getElementById('admUptimeRefreshBtn')
  if (refreshBtn) refreshBtn.onclick = () => {
    for (const key of Object.keys(_admCfCache)) {
      if (key.includes('uptime_check')) delete _admCfCache[key]
    }
    admPopulateUptime()
  }
}

// ─── DDoS ────────────────────────────────────────────────────────────────────

async function admPopulateDdos() {
  const loading = document.getElementById('admDdosLoading')
  const content = document.getElementById('admDdosContent')
  const noDomains = document.getElementById('admDdosNoDomains')
  const error = document.getElementById('admDdosError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  admPopulateDomainSelect('admDdosDomainSelect')
  const activeDomains = admGetSelectedDomains('admDdosDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('admDdosDomainSelect').onchange = () => { delete _admPageState['ddos']; admPopulateDdos() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider === 'none') return { domain: d.domain, provider, analytics: null, message: 'Not available' }
      try {
        const data = await admCfProxy(d.id, 'analytics', { since: '30d' })
        return { domain: d.domain, provider, analytics: data.analytics, message: data.message }
      } catch (err) {
        return { domain: d.domain, provider, analytics: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.analytics) {
        return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td colspan="3" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      }
      const a = r.analytics
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${providerBadge(r.provider)}</td><td>${fmtNum(a.threats_total)}</td><td>${fmtNum(a.requests_total)}</td><td>${formatBytes(a.bandwidth_total)}</td></tr>`
    })
    _admInitPage('ddos', rows)
    _admRenderPage('ddos', 'admDdosBody', 'admDdosPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS PANELS
// ═══════════════════════════════════════════════════════════════════════════════

const PLAN_PRICES_SELF = { none: 0, solo: 0, starter: 299, pro: 999, business: 1999, enterprise: 3499 }

function admPopulatePlansStats() {
  if (!allProfiles.length) return

  const paidUsers = allProfiles.filter(p => p.plan && p.plan !== 'none')
  const freeUsers = allProfiles.filter(p => !p.plan || p.plan === 'none')

  let mrr = 0
  paidUsers.forEach(p => { mrr += PLAN_PRICES_SELF[p.plan] || 0 })

  document.getElementById('settTotalPaidUsers').textContent = paidUsers.length
  document.getElementById('settFreeUsers').textContent = freeUsers.length
  document.getElementById('settMRR').textContent = '₱' + mrr.toLocaleString()
  document.getElementById('settTotalDomains').textContent = allDomains.length
}

function admPopulateNotifSettings() {
  const emailEl = document.getElementById('settAlertEmail')
  if (emailEl && !emailEl.value && currentProfile?.email) {
    emailEl.value = currentProfile.email
  }
}

function admShowToast(msg, isError = false) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.classList.toggle('toast--error', isError)
  toast.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.hidden = true }, isError ? 5000 : 2000)
}

// Settings save/load
function initSettingsHandlers() {
  document.getElementById('settGeneralSaveBtn')?.addEventListener('click', () => {
    const settings = {
      platformName: document.getElementById('settPlatformName')?.value,
      supportEmail: document.getElementById('settSupportEmail')?.value,
      maintenance: document.getElementById('settMaintenance')?.querySelector('input')?.checked,
      defaultProvider: document.getElementById('settDefaultProvider')?.value,
      autoApprove: document.getElementById('settAutoApprove')?.querySelector('input')?.checked,
      defaultPurgeInterval: document.getElementById('settDefaultPurgeInterval')?.value,
    }
    localStorage.setItem('luzerge_admin_settings', JSON.stringify(settings))
    admShowToast('General settings saved')
  })

  document.getElementById('settNotifSaveBtn')?.addEventListener('click', () => {
    const notifs = {
      newDomain: document.getElementById('settNotifNewDomain')?.querySelector('input')?.checked,
      downtime: document.getElementById('settNotifDowntime')?.querySelector('input')?.checked,
      sslExpiry: document.getElementById('settNotifSslExpiry')?.querySelector('input')?.checked,
      newUser: document.getElementById('settNotifNewUser')?.querySelector('input')?.checked,
      ddos: document.getElementById('settNotifDdos')?.querySelector('input')?.checked,
      alertEmail: document.getElementById('settAlertEmail')?.value,
    }
    localStorage.setItem('luzerge_admin_notifications', JSON.stringify(notifs))
    admShowToast('Notification settings saved')
  })

  document.getElementById('settApiSaveBtn')?.addEventListener('click', () => {
    const api = {
      cfGlobalToken: document.getElementById('settCfGlobalToken')?.value,
      cfAccountId: document.getElementById('settCfAccountId')?.value,
    }
    localStorage.setItem('luzerge_admin_api', JSON.stringify(api))
    admShowToast('API settings saved')
  })

  // Load saved settings
  try {
    const saved = JSON.parse(localStorage.getItem('luzerge_admin_settings') || '{}')
    if (saved.platformName) document.getElementById('settPlatformName').value = saved.platformName
    if (saved.supportEmail) document.getElementById('settSupportEmail').value = saved.supportEmail
    if (saved.defaultProvider) document.getElementById('settDefaultProvider').value = saved.defaultProvider
    if (saved.defaultPurgeInterval) document.getElementById('settDefaultPurgeInterval').value = saved.defaultPurgeInterval
    if (saved.maintenance) {
      const el = document.getElementById('settMaintenance')
      if (el) { el.querySelector('input').checked = true; el.classList.add('toggle-switch--on') }
    }
    if (saved.autoApprove === false) {
      const el = document.getElementById('settAutoApprove')
      if (el) { el.querySelector('input').checked = false; el.classList.remove('toggle-switch--on') }
    }
  } catch {}

  try {
    const notifs = JSON.parse(localStorage.getItem('luzerge_admin_notifications') || '{}')
    if (notifs.alertEmail) document.getElementById('settAlertEmail').value = notifs.alertEmail
    const notifMap = [['newDomain','settNotifNewDomain'],['downtime','settNotifDowntime'],['sslExpiry','settNotifSslExpiry'],['newUser','settNotifNewUser'],['ddos','settNotifDdos']]
    for (const [key, id] of notifMap) {
      if (notifs[key] !== undefined) {
        const el = document.getElementById(id)
        if (el) { el.querySelector('input').checked = notifs[key]; el.classList.toggle('toggle-switch--on', notifs[key]) }
      }
    }
  } catch {}

  try {
    const api = JSON.parse(localStorage.getItem('luzerge_admin_api') || '{}')
    if (api.cfGlobalToken) document.getElementById('settCfGlobalToken').value = api.cfGlobalToken
    if (api.cfAccountId) document.getElementById('settCfAccountId').value = api.cfAccountId
  } catch {}

  // ─── Admin Profile save ──────────────────────────────────────────────
  document.getElementById('admSettProfileSaveBtn')?.addEventListener('click', async () => {
    const fullName = document.getElementById('admSettFullName')?.value.trim()
    const avatarUrl = document.getElementById('admSettAvatar')?.value.trim()
    const newPass = document.getElementById('admSettNewPass')?.value
    const confirmPass = document.getElementById('admSettConfirmPass')?.value

    const updates = {}
    if (fullName !== (currentProfile?.full_name || '')) updates.full_name = fullName
    if (avatarUrl !== (currentProfile?.avatar_url || '')) updates.avatar_url = avatarUrl

    if (Object.keys(updates).length) {
      const { error } = await _supabase.from('profiles').update(updates).eq('id', currentUser.id)
      if (error) { admShowToast('Failed to update profile', true); return }
      Object.assign(currentProfile, updates)
      const navAvatar = document.getElementById('navAvatar')
      if (navAvatar && updates.avatar_url) {
        navAvatar.innerHTML = `<img src="${escHtml(updates.avatar_url)}" alt="" />`
      }
    }

    if (newPass) {
      if (newPass !== confirmPass) { admShowToast('Passwords do not match', true); return }
      if (newPass.length < 6) { admShowToast('Password must be at least 6 characters', true); return }
      const { error } = await _supabase.auth.updateUser({ password: newPass })
      if (error) { admShowToast('Failed to change password: ' + error.message, true); return }
      document.getElementById('admSettNewPass').value = ''
      document.getElementById('admSettConfirmPass').value = ''
    }

    admShowToast('Profile updated')
  })

  // ─── 2FA toggle ──────────────────────────────────────────────────────
  document.getElementById('admSett2faToggle')?.addEventListener('click', async () => {
    const factors = await _supabase.auth.mfa.listFactors()
    const totpFactors = (factors.data?.totp || []).filter(f => f.status === 'verified')

    if (totpFactors.length > 0) {
      if (!confirm('Disable two-factor authentication?')) return
      const { error } = await _supabase.auth.mfa.unenroll({ factorId: totpFactors[0].id })
      if (error) { admShowToast('Failed to disable 2FA: ' + error.message, true); return }
      admUpdate2faUI(false)
      admShowToast('Two-factor authentication disabled')
      return
    }

    // Enroll
    const { data, error } = await _supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Luzerge Admin' })
    if (error) { admShowToast('Failed to start 2FA setup: ' + error.message, true); return }

    window._admTfaFactorId = data.id
    document.getElementById('admTfaQrImg').src = data.totp.qr_code
    document.getElementById('admTfaSecret').textContent = data.totp.secret
    document.getElementById('admTfaCode').value = ''
    document.getElementById('admTfaError').hidden = true
    document.getElementById('admTfaModal').hidden = false
  })

  // Admin 2FA modal cancel
  document.getElementById('admTfaCancelBtn')?.addEventListener('click', async () => {
    if (window._admTfaFactorId) {
      await _supabase.auth.mfa.unenroll({ factorId: window._admTfaFactorId }).catch(() => {})
      window._admTfaFactorId = null
    }
    document.getElementById('admTfaModal').hidden = true
  })

  // Admin 2FA modal verify
  document.getElementById('admTfaVerifyBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('admTfaCode').value.trim()
    const errEl = document.getElementById('admTfaError')
    errEl.hidden = true

    if (!/^\d{6}$/.test(code)) {
      errEl.textContent = 'Please enter a valid 6-digit code.'
      errEl.hidden = false
      return
    }

    const btn = document.getElementById('admTfaVerifyBtn')
    btn.disabled = true
    btn.textContent = 'Verifying...'

    const { data: challenge, error: chalErr } = await _supabase.auth.mfa.challenge({ factorId: window._admTfaFactorId })
    if (chalErr) {
      errEl.textContent = 'Challenge failed: ' + chalErr.message
      errEl.hidden = false
      btn.disabled = false
      btn.textContent = 'Verify & Enable'
      return
    }

    const { error: verifyErr } = await _supabase.auth.mfa.verify({ factorId: window._admTfaFactorId, challengeId: challenge.id, code })
    btn.disabled = false
    btn.textContent = 'Verify & Enable'

    if (verifyErr) {
      errEl.textContent = 'Invalid code. Please try again.'
      errEl.hidden = false
      return
    }

    window._admTfaFactorId = null
    document.getElementById('admTfaModal').hidden = true
    admUpdate2faUI(true)
    admShowToast('Two-factor authentication enabled!')
  })

  // ─── Revoke sessions ─────────────────────────────────────────────────
  document.getElementById('admSettRevokeAllBtn')?.addEventListener('click', async () => {
    if (!confirm('Revoke all other sessions? You will remain signed in.')) return
    const { error } = await _supabase.auth.signOut({ scope: 'others' })
    if (error) { admShowToast('Failed to revoke sessions', true); return }
    admShowToast('All other sessions revoked')
  })
}

// ─── Admin Profile populate ───────────────────────────────────────────────────

function admPopulateProfile() {
  document.getElementById('admSettFullName').value = currentProfile?.full_name || ''
  document.getElementById('admSettEmail').value = currentProfile?.email || currentUser?.email || ''
  document.getElementById('admSettAvatar').value = currentProfile?.avatar_url || ''
  document.getElementById('admSettNewPass').value = ''
  document.getElementById('admSettConfirmPass').value = ''
}

// ─── Admin Security populate ──────────────────────────────────────────────────

async function admPopulateSecurity() {
  document.getElementById('admSettLastLogin').textContent = admFormatDate(currentUser?.last_sign_in_at)
  document.getElementById('admSettAccountCreated').textContent = admFormatDate(currentUser?.created_at)

  const ua = navigator.userAgent
  let browser = 'Unknown Browser'
  if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Edg/')) browser = 'Microsoft Edge'
  else if (ua.includes('Chrome')) browser = 'Google Chrome'
  else if (ua.includes('Safari')) browser = 'Safari'
  document.getElementById('admSettCurrentDevice').textContent = browser + ' on ' + navigator.platform
  document.getElementById('admSettCurrentMeta').textContent = 'Current session · last active now'

  // Check 2FA status
  const factors = await _supabase.auth.mfa.listFactors()
  const has2fa = (factors.data?.totp || []).some(f => f.status === 'verified')
  admUpdate2faUI(has2fa)
}

function admUpdate2faUI(enabled) {
  const statusEl = document.getElementById('admSett2faStatus')
  const btn = document.getElementById('admSett2faToggle')
  if (statusEl) {
    statusEl.textContent = enabled ? 'Enabled' : 'Disabled'
    statusEl.className = `settings-badge settings-badge--${enabled ? 'on' : 'off'}`
  }
  if (btn) btn.textContent = enabled ? 'Disable 2FA' : 'Enable 2FA'
}

function admFormatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Admin User Management ────────────────────────────────────────────────────

function admPopulateUsersTable() {
  if (!allProfiles.length) {
    const tbody = document.getElementById('admUsersTableBody')
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:2rem;text-align:center;color:rgba(255,255,255,0.4)">No users found.</td></tr>'
    return
  }

  // Stats
  document.getElementById('admTotalUsers').textContent = allProfiles.length
  const adminCount = allProfiles.filter(p => p.role === 'admin').length
  const suspendedCount = allProfiles.filter(p => p.status === 'suspended').length
  document.getElementById('admActiveUsers').textContent = allProfiles.length - suspendedCount
  document.getElementById('admAdminCount').textContent = adminCount
  document.getElementById('admSuspendedUsers').textContent = suspendedCount

  // Table
  const tbody = document.getElementById('admUsersTableBody')
  if (!tbody) return

  const planLabels = { none: 'Free', solo: 'Solo', starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' }

  const userRows = allProfiles.map(p => {
    const plan = p.plan || 'none'
    const role = p.role || 'user'
    const domainCount = allDomains.filter(d => d.user_id === p.id).length
    const joinDate = admFormatDate(p.created_at)
    const isSuspended = p.status === 'suspended'
    const statusBadge = isSuspended
      ? '<span class="status-badge status-badge--rejected">Suspended</span>'
      : '<span class="status-badge status-badge--active">Active</span>'
    const roleBadge = role === 'admin'
      ? '<span class="status-badge" style="background:rgba(139,92,246,0.12);color:#8b5cf6;border:1px solid rgba(139,92,246,0.25);font-size:0.7rem">Admin</span>'
      : '<span class="status-badge" style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.1);font-size:0.7rem">User</span>'
    const planBadge = `<span class="status-badge status-badge--${plan === 'none' ? 'pending' : 'active'}" style="font-size:0.7rem">${planLabels[plan] || plan}</span>`

    return `<tr>
      <td>
        <div style="display:flex;flex-direction:column;gap:2px">
          <strong style="font-size:0.8rem">${escHtml(p.full_name || '—')}</strong>
          <span style="font-size:0.7rem;color:rgba(255,255,255,0.5)">${escHtml(p.email || '—')}</span>
        </div>
      </td>
      <td>${planBadge}</td>
      <td style="text-align:center">${domainCount}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td style="font-size:0.75rem;color:rgba(255,255,255,0.6)">${joinDate}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn--ghost btn--sm adm-user-role-btn" data-user-id="${p.id}" data-role="${role}" title="Toggle role" style="font-size:0.7rem;padding:2px 6px">
            ${role === 'admin' ? '↓ User' : '↑ Admin'}
          </button>
          <button class="btn btn--ghost btn--sm adm-user-suspend-btn" data-user-id="${p.id}" data-suspended="${isSuspended ? 'true' : 'false'}" title="${isSuspended ? 'Reactivate' : 'Suspend'}" style="font-size:0.7rem;padding:2px 6px;color:${isSuspended ? '#22c55e' : '#ef4444'}">
            ${isSuspended ? 'Activate' : 'Suspend'}
          </button>
        </div>
      </td>
    </tr>`
  })
  _admInitPage('users', userRows)
  _admRenderPage('users', 'admUsersTableBody', 'admUsersPagination')

  // Wire action buttons
  tbody.querySelectorAll('.adm-user-role-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId
      const currentRole = btn.dataset.role
      const newRole = currentRole === 'admin' ? 'user' : 'admin'
      if (userId === currentUser.id) { admShowToast('Cannot change your own role', true); return }
      if (!confirm(`Change this user's role to ${newRole}?`)) return
      const { error } = await _supabase.from('profiles').update({ role: newRole }).eq('id', userId)
      if (error) { admShowToast('Failed to update role', true); return }
      const profile = allProfiles.find(p => p.id === userId)
      if (profile) profile.role = newRole
      admPopulateUsersTable()
      admShowToast(`User role changed to ${newRole}`)
    })
  })

  tbody.querySelectorAll('.adm-user-suspend-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId
      const isSuspended = btn.dataset.suspended === 'true'
      if (userId === currentUser.id) { admShowToast('Cannot suspend yourself', true); return }
      if (!confirm(isSuspended ? 'Reactivate this user?' : 'Suspend this user? They will lose access.')) return
      const newStatus = isSuspended ? 'active' : 'suspended'
      const { error } = await _supabase.from('profiles').update({ status: newStatus }).eq('id', userId)
      if (error) { admShowToast('Failed to update user status', true); return }
      const profile = allProfiles.find(p => p.id === userId)
      if (profile) profile.status = newStatus
      admPopulateUsersTable()
      admShowToast(isSuspended ? 'User reactivated' : 'User suspended')
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW FEATURE PANELS (Admin)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Bot Fight Mode ──────────────────────────────────────────────────────────

async function admLoadBotFight() {
  const loading = document.getElementById('admBotFightLoading')
  const content = document.getElementById('admBotFightContent')
  const noDomains = document.getElementById('admBotFightNoDomains')
  const errorEl = document.getElementById('admBotFightError')
  const body = document.getElementById('admBotFightBody')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; errorEl.hidden = true

  admPopulateDomainSelect('admBotFightDomainSelect')
  const domains = admGetSelectedDomains('admBotFightDomainSelect')
  document.getElementById('admBotFightDomainSelect').onchange = () => admLoadBotFight()

  if (!domains.length) { loading.hidden = true; noDomains.hidden = false; return }

  try {
    const session = await getSession()
    if (!session) { loading.hidden = true; errorEl.textContent = 'Session expired. Please reload.'; errorEl.hidden = false; return }

    const rows = await Promise.all(domains.map(async (d) => {
      try {
        const res = await fetch(`${EDGE_BASE}/bot-fight-mode?domain_id=${d.id}`, {
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return { domain: d.domain, id: d.id, fight_mode: false, error: `HTTP ${res.status}` }
        const data = await res.json()
        return { domain: d.domain, id: d.id, fight_mode: data.fight_mode ?? false, error: data.error }
      } catch (e) { return { domain: d.domain, id: d.id, fight_mode: false, error: e?.name === 'TimeoutError' ? 'Timeout' : 'Not available' } }
    }))

    body.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.domain)}</td>
        <td>${r.error ? `<span class="status-badge status-badge--pending">${escHtml(r.error)}</span>` : admSettingBadge(r.fight_mode)}</td>
        <td><a href="https://dash.cloudflare.com/?to=/:account/${encodeURIComponent(r.domain)}/security/bots" target="_blank" rel="noopener" class="btn btn--xs btn--outline">Toggle in Cloudflare ↗</a></td>
      </tr>
    `).join('')

    loading.hidden = true; content.hidden = false
  } catch (err) {
    loading.hidden = true; errorEl.textContent = err.message; errorEl.hidden = false
  }
}

// ─── Always Online ───────────────────────────────────────────────────────────

async function admLoadAlwaysOnline() {
  const loading = document.getElementById('admAlwaysOnlineLoading')
  const content = document.getElementById('admAlwaysOnlineContent')
  const noDomains = document.getElementById('admAlwaysOnlineNoDomains')
  const errorEl = document.getElementById('admAlwaysOnlineError')
  const body = document.getElementById('admAlwaysOnlineBody')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; errorEl.hidden = true

  admPopulateDomainSelect('admAlwaysOnlineDomainSelect')
  const domains = admGetSelectedDomains('admAlwaysOnlineDomainSelect')
  document.getElementById('admAlwaysOnlineDomainSelect').onchange = () => admLoadAlwaysOnline()

  if (!domains.length) { loading.hidden = true; noDomains.hidden = false; return }

  try {
    const session = await getSession()
    if (!session) { loading.hidden = true; errorEl.textContent = 'Session expired. Please reload.'; errorEl.hidden = false; return }

    const rows = await Promise.all(domains.map(async (d) => {
      try {
        const res = await fetch(`${EDGE_BASE}/always-online?domain_id=${d.id}`, {
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return { domain: d.domain, id: d.id, enabled: false, error: `HTTP ${res.status}` }
        const data = await res.json()
        return { domain: d.domain, id: d.id, enabled: data.enabled ?? false, error: data.error }
      } catch (e) { return { domain: d.domain, id: d.id, enabled: false, error: e?.name === 'TimeoutError' ? 'Timeout' : 'Not available' } }
    }))

    body.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.domain)}</td>
        <td>
          <label class="toggle-switch toggle-switch--sm">
            <input type="checkbox" ${r.enabled ? 'checked' : ''} data-domain-id="${r.id}" class="adm-always-online-toggle" ${r.error ? 'disabled' : ''} />
            <span class="toggle-switch__slider"></span>
          </label>
        </td>
        <td>${r.error ? `<span class="status-badge status-badge--pending">${escHtml(r.error)}</span>` : admSettingBadge(r.enabled)}</td>
      </tr>
    `).join('')

    body.querySelectorAll('.adm-always-online-toggle').forEach(toggle => {
      toggle.addEventListener('change', async () => {
        const domainId = toggle.dataset.domainId
        const enabled = toggle.checked
        try {
          const s = await getSession()
          await fetch(`${EDGE_BASE}/always-online?domain_id=${domainId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          })
          admShowToast(`Always Online ${enabled ? 'enabled' : 'disabled'}`)
        } catch { admShowToast('Failed to update Always Online', true) }
      })
    })

    loading.hidden = true; content.hidden = false
  } catch (err) {
    loading.hidden = true; errorEl.textContent = err.message; errorEl.hidden = false
  }
}

// ─── Email Routing ───────────────────────────────────────────────────────────

async function admLoadEmailRouting() {
  const loading = document.getElementById('admEmailRoutingLoading')
  const content = document.getElementById('admEmailRoutingContent')
  const noDomains = document.getElementById('admEmailRoutingNoDomains')
  const errorEl = document.getElementById('admEmailRoutingError')
  const body = document.getElementById('admEmailRoutingBody')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; errorEl.hidden = true

  admPopulateDomainSelect('admEmailRoutingDomainSelect')
  const domains = admGetSelectedDomains('admEmailRoutingDomainSelect')
  document.getElementById('admEmailRoutingDomainSelect').onchange = () => admLoadEmailRouting()

  if (!domains.length) { loading.hidden = true; noDomains.hidden = false; return }

  try {
    const session = await getSession()
    if (!session) { loading.hidden = true; errorEl.textContent = 'Session expired. Please reload.'; errorEl.hidden = false; return }

    const allRows = []
    for (const d of domains) {
      try {
        const res = await fetch(`${EDGE_BASE}/email-routing?domain_id=${d.id}`, {
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) continue
        const data = await res.json()
        for (const r of (data.rules || [])) {
          allRows.push({ ...r, domain: d.domain, domainId: d.id })
        }
      } catch { /* skip */ }
    }

    body.innerHTML = allRows.length
      ? allRows.map(r => {
          const from = r.matchers?.[0]?.value || '—'
          const to = r.actions?.[0]?.value?.[0] || r.actions?.[0]?.value || '—'
          return `<tr>
            <td>${escHtml(from)}</td>
            <td>${escHtml(to)}</td>
            <td>${escHtml(r.domain)}</td>
            <td>${admSettingBadge(r.enabled)}</td>
            <td><button class="btn btn--ghost btn--sm btn--danger-text adm-email-route-delete" data-rule-id="${r.id}" data-domain-id="${r.domainId}">Delete</button></td>
          </tr>`
        }).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#64748b">No email routes configured</td></tr>'

    body.querySelectorAll('.adm-email-route-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this email route?')) return
        try {
          const s = await getSession()
          await fetch(`${EDGE_BASE}/email-routing?domain_id=${btn.dataset.domainId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', rule_id: btn.dataset.ruleId }),
          })
          admShowToast('Email route deleted')
          admLoadEmailRouting()
        } catch { admShowToast('Failed to delete route', true) }
      })
    })

    loading.hidden = true; content.hidden = false
  } catch (err) {
    loading.hidden = true; errorEl.textContent = err.message; errorEl.hidden = false
  }
}

// ─── Header Inspector ────────────────────────────────────────────────────────

let _admHeaderInspectorBound = false
function admInitHeaderInspector() {
  if (_admHeaderInspectorBound) return
  _admHeaderInspectorBound = true

  document.getElementById('admHeaderInspectorForm')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const urlInput = document.getElementById('admHeaderInspectorUrl')
    const loading = document.getElementById('admHeaderInspectorLoading')
    const content = document.getElementById('admHeaderInspectorContent')
    const errorEl = document.getElementById('admHeaderInspectorError')
    const body = document.getElementById('admHeaderInspectorBody')

    const targetUrl = urlInput.value.trim()
    if (!targetUrl) return

    loading.hidden = false; content.hidden = true; errorEl.hidden = true

    try {
      const res = await fetch(`${EDGE_BASE}/header-inspector?url=${encodeURIComponent(targetUrl)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const rows = Object.entries(data.headers || {}).map(([key, val]) => {
        const isSecHeader = data.security && key in data.security
        return `<tr>
          <td><code style="font-size:12px;${isSecHeader ? 'color:#22c55e' : ''}">${escHtml(key)}</code></td>
          <td style="font-size:12px;word-break:break-all">${escHtml(val)}</td>
        </tr>`
      })

      const summary = `<tr style="background:rgba(59,130,246,0.08)">
        <td><strong>Status</strong></td>
        <td><strong>${data.status} ${escHtml(data.status_text || '')}</strong> · ${data.latency_ms}ms${data.cdn ? ` · CDN: ${escHtml(data.cdn)}` : ''}${data.redirected ? ' · Redirected' : ''}</td>
      </tr>`

      body.innerHTML = summary + rows.join('')
      loading.hidden = true; content.hidden = false
    } catch (err) {
      loading.hidden = true; errorEl.textContent = err.message; errorEl.hidden = false
    }
  })
}

// ─── Page Speed Insights ─────────────────────────────────────────────────────

let _admPageSpeedBound = false
function admInitPageSpeed() {
  if (_admPageSpeedBound) return
  _admPageSpeedBound = true

  document.getElementById('admPageSpeedForm')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const urlInput = document.getElementById('admPageSpeedUrl')
    const strategy = document.getElementById('admPageSpeedStrategy').value
    const loading = document.getElementById('admPageSpeedLoading')
    const content = document.getElementById('admPageSpeedContent')
    const errorEl = document.getElementById('admPageSpeedError')
    const scoresEl = document.getElementById('admPageSpeedScores')
    const auditsEl = document.getElementById('admPageSpeedAudits')

    const targetUrl = urlInput.value.trim()
    if (!targetUrl) return

    loading.hidden = false; content.hidden = true; errorEl.hidden = true

    try {
      const res = await fetch(`${EDGE_BASE}/page-speed?url=${encodeURIComponent(targetUrl)}&strategy=${strategy}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const scoreColors = (s) => s >= 90 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444'
      scoresEl.innerHTML = Object.entries(data.scores || {}).map(([cat, score]) => `
        <div class="stat-card" style="text-align:center">
          <div class="stat-card__value" style="color:${scoreColors(score)}">${score}</div>
          <div class="stat-card__label">${escHtml(cat.replace(/-/g, ' '))}</div>
        </div>
      `).join('')

      auditsEl.innerHTML = '<h3 style="font-size:14px;color:#94a3b8;margin:1rem 0 0.5rem;text-transform:uppercase">Core Web Vitals</h3>' +
        '<div class="feature-table-wrap"><table class="history-table"><thead><tr><th>Metric</th><th>Value</th><th>Score</th></tr></thead><tbody>' +
        Object.entries(data.metrics || {}).map(([key, m]) => `
          <tr>
            <td>${escHtml(key.replace(/-/g, ' '))}</td>
            <td>${escHtml(m.value || '—')}</td>
            <td><span style="color:${scoreColors(m.score)}">${m.score}/100</span></td>
          </tr>
        `).join('') +
        '</tbody></table></div>'

      loading.hidden = true; content.hidden = false
    } catch (err) {
      loading.hidden = true; errorEl.textContent = err.message; errorEl.hidden = false
    }
  })
}

// ─── Whois Lookup ────────────────────────────────────────────────────────────

let _admWhoisBound = false
function admInitWhois() {
  if (_admWhoisBound) return
  _admWhoisBound = true

  document.getElementById('admWhoisForm')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const domainInput = document.getElementById('admWhoisDomain')
    const loading = document.getElementById('admWhoisLoading')
    const content = document.getElementById('admWhoisContent')
    const errorEl = document.getElementById('admWhoisError')
    const body = document.getElementById('admWhoisBody')

    const domain = domainInput.value.trim()
    if (!domain) return

    loading.hidden = false; content.hidden = true; errorEl.hidden = true

    try {
      const res = await fetch(`${EDGE_BASE}/whois-lookup?domain=${encodeURIComponent(domain)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const fields = [
        ['Domain', data.domain],
        ['Registrar', data.registrar],
        ['Registrant', data.registrant],
        ['Registered', data.registered ? formatDate(data.registered) : '—'],
        ['Expires', data.expires ? formatDate(data.expires) : '—'],
        ['Last Updated', data.last_updated ? formatDate(data.last_updated) : '—'],
        ['Nameservers', (data.nameservers || []).join(', ') || '—'],
        ['DNSSEC', data.dnssec ? 'Signed' : 'Unsigned'],
        ['Status', (data.status || []).join(', ') || '—'],
      ]

      body.innerHTML = fields.map(([label, val]) => `
        <tr><td><strong>${escHtml(label)}</strong></td><td>${escHtml(val || '—')}</td></tr>
      `).join('')

      loading.hidden = true; content.hidden = false
    } catch (err) {
      loading.hidden = true; errorEl.textContent = err.message; errorEl.hidden = false
    }
  })
}

// ─── Scheduled Reports ───────────────────────────────────────────────────────

async function admLoadScheduledReports() {
  const session = await getSession()
  if (!session) return // no loading spinner to hide for this panel

  try {
    const res = await fetch(`${EDGE_BASE}/scheduled-reports`, {
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
    })
    const data = await res.json()
    const settings = data.settings || []

    const weekly = settings.find(s => s.frequency === 'weekly')
    const daily = settings.find(s => s.frequency === 'daily')
    const monthly = settings.find(s => s.frequency === 'monthly')

    const weeklyEl = document.getElementById('admReportWeeklyPerf')
    const dailyEl = document.getElementById('admReportDailyUptime')
    const monthlyEl = document.getElementById('admReportMonthlySecurity')

    if (weeklyEl) { weeklyEl.checked = weekly?.enabled ?? false; weeklyEl.dataset.settingId = weekly?.id || '' }
    if (dailyEl) { dailyEl.checked = daily?.enabled ?? false; dailyEl.dataset.settingId = daily?.id || '' }
    if (monthlyEl) { monthlyEl.checked = monthly?.enabled ?? false; monthlyEl.dataset.settingId = monthly?.id || '' }
  } catch { /* first load, no settings yet */ }

  const saveBtn = document.getElementById('admSaveReportSettingsBtn')
  saveBtn.onclick = async () => {
    const s = await getSession()
    if (!s) return

    const email = currentUser?.email || ''
    const domain = allDomains.find(d => d.status === 'active')?.domain || ''
    const headers = { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }

    const reports = [
      { el: document.getElementById('admReportWeeklyPerf'), frequency: 'weekly' },
      { el: document.getElementById('admReportDailyUptime'), frequency: 'daily' },
      { el: document.getElementById('admReportMonthlySecurity'), frequency: 'monthly' },
    ]

    try {
      for (const r of reports) {
        const reqBody = { domain, frequency: r.frequency, email, enabled: r.el.checked }
        if (r.el.dataset.settingId) reqBody.id = r.el.dataset.settingId
        await fetch(`${EDGE_BASE}/scheduled-reports`, { method: 'POST', headers, body: JSON.stringify(reqBody) })
      }
      admShowToast('Report settings saved')
    } catch { admShowToast('Failed to save report settings', true) }
  }
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

let _admAuditLogPage = 1

async function admLoadAuditLog(page = 1) {
  _admAuditLogPage = page
  const loading = document.getElementById('admAuditLogLoading')
  const content = document.getElementById('admAuditLogContent')
  const empty = document.getElementById('admAuditLogEmpty')
  const body = document.getElementById('admAuditLogBody')
  const pagination = document.getElementById('admAuditLogPagination')

  loading.hidden = false; content.hidden = true; empty.hidden = true

  try {
    const session = await getSession()
    if (!session) { loading.hidden = true; empty.textContent = 'Session expired. Please reload.'; empty.hidden = false; return }

    const res = await fetch(`${EDGE_BASE}/audit-log?page=${page}&limit=25`, {
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)

    const logs = data.logs || []
    if (!logs.length && page === 1) {
      loading.hidden = true; empty.hidden = false; return
    }

    body.innerHTML = logs.map(log => `
      <tr>
        <td style="white-space:nowrap;font-size:12px">${new Date(log.created_at).toLocaleString()}</td>
        <td style="font-size:12px">${escHtml(log.user_id?.substring(0, 8) || '—')}...</td>
        <td><span class="status-badge status-badge--active" style="font-size:11px">${escHtml(log.action)}</span></td>
        <td style="font-size:12px">${escHtml(log.detail || log.domain || '—')}</td>
        <td style="font-size:12px;color:#64748b">${escHtml(log.ip_address || '—')}</td>
      </tr>
    `).join('')

    if (data.pages > 1) {
      let paginationHtml = ''
      for (let i = 1; i <= data.pages; i++) {
        paginationHtml += `<button class="btn btn--ghost btn--sm ${i === page ? 'btn--primary' : ''}" onclick="admLoadAuditLog(${i})">${i}</button> `
      }
      pagination.innerHTML = paginationHtml
    } else {
      pagination.innerHTML = ''
    }

    loading.hidden = true; content.hidden = false
  } catch (err) {
    loading.hidden = true
    empty.textContent = err.message
    empty.hidden = false
  }
}

document.getElementById('admAuditRefreshBtn')?.addEventListener('click', () => admLoadAuditLog(_admAuditLogPage))

// ─── Email Marketing ────────────────────────────────────────────────────────

let _emInitDone = false
let _emSubscribers = []
let _emSelectedEmails = new Set()
let _emCurrentFilter = 'all'
let _emSearchQuery = ''

// Custom modal confirm (replaces browser confirm)
function emConfirm(title, message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('emModal')
    document.getElementById('emModalTitle').textContent = title
    document.getElementById('emModalMessage').textContent = message
    overlay.hidden = false

    const cleanup = (result) => {
      overlay.hidden = true
      document.getElementById('emModalConfirm').removeEventListener('click', onConfirm)
      document.getElementById('emModalCancel').removeEventListener('click', onCancel)
      resolve(result)
    }
    const onConfirm = () => cleanup(true)
    const onCancel = () => cleanup(false)

    document.getElementById('emModalConfirm').addEventListener('click', onConfirm)
    document.getElementById('emModalCancel').addEventListener('click', onCancel)
  })
}

// Update selected count badge
function emUpdateSelectedCount() {
  const badge = document.getElementById('emSelectedCount')
  if (_emSelectedEmails.size > 0) {
    badge.textContent = `${_emSelectedEmails.size} selected`
    badge.hidden = false
  } else {
    badge.hidden = true
  }
}

// Update stats cards
function emUpdateStats() {
  const total = _emSubscribers.length
  const active = _emSubscribers.filter(s => s.status === 'active').length
  const unsub = _emSubscribers.filter(s => s.status === 'unsubscribed').length
  document.getElementById('emStatTotal').textContent = total
  document.getElementById('emStatActive').textContent = active
  document.getElementById('emStatUnsub').textContent = unsub
}

// Filter and render subscriber table
function emRenderSubscribers() {
  const body = document.getElementById('emSubBody')
  const countEl = document.getElementById('emSubCount')
  const content = document.getElementById('emSubContent')
  const empty = document.getElementById('emSubEmpty')

  let filtered = _emSubscribers
  if (_emCurrentFilter !== 'all') {
    filtered = filtered.filter(s => s.status === _emCurrentFilter)
  }
  if (_emSearchQuery) {
    const q = _emSearchQuery.toLowerCase()
    filtered = filtered.filter(s =>
      s.email.toLowerCase().includes(q) || (s.name && s.name.toLowerCase().includes(q))
    )
  }

  if (!_emSubscribers.length) { content.hidden = true; empty.hidden = false; return }
  empty.hidden = true; content.hidden = false

  const active = _emSubscribers.filter(s => s.status === 'active').length
  countEl.textContent = `${active} active / ${_emSubscribers.length} total` + (filtered.length !== _emSubscribers.length ? ` (showing ${filtered.length})` : '')

  body.innerHTML = filtered.map(s => `
    <tr>
      <td><input type="checkbox" class="em-sub-check" data-email="${escHtml(s.email)}" ${s.status !== 'active' ? 'disabled' : ''} ${_emSelectedEmails.has(s.email) ? 'checked' : ''} /></td>
      <td>${escHtml(s.email)}</td>
      <td>${escHtml(s.name || '—')}</td>
      <td>${s.status === 'active'
        ? '<span class="status-badge status-badge--healthy">Active</span>'
        : '<span class="status-badge status-badge--down">Unsubscribed</span>'}</td>
      <td>${new Date(s.created_at).toLocaleDateString()}</td>
      <td>${s.status === 'active'
        ? `<button class="btn btn--ghost btn--xs em-unsub-btn" data-email="${escHtml(s.email)}">Remove</button>`
        : '—'}</td>
    </tr>
  `).join('')

  // Bind checkboxes
  body.querySelectorAll('.em-sub-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) _emSelectedEmails.add(cb.dataset.email)
      else _emSelectedEmails.delete(cb.dataset.email)
      emUpdateSelectedCount()
    })
  })

  // Bind remove buttons
  body.querySelectorAll('.em-unsub-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await emConfirm('Remove Subscriber', `Remove ${btn.dataset.email} from your subscriber list? They will be marked as unsubscribed.`)
      if (!confirmed) return
      try {
        const s = await getSession()
        await fetch(`${EDGE_BASE}/email-marketing?action=remove_subscriber`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: btn.dataset.email }),
        })
        admShowToast('Subscriber removed')
        emLoadSubscribers()
      } catch { admShowToast('Failed to remove', true) }
    })
  })
}

// Live preview update
function emUpdatePreview() {
  const subject = document.getElementById('emSubject').value.trim()
  const bodyVal = document.getElementById('emBody').value
  const provider = document.getElementById('emFromProvider').value

  // Subject preview
  const subEl = document.getElementById('emPreviewSubject')
  if (subject) {
    subEl.textContent = subject
    subEl.classList.remove('em-preview-placeholder')
  } else {
    subEl.textContent = 'Your subject line'
    subEl.classList.add('em-preview-placeholder')
  }

  // From preview
  document.getElementById('emPreviewFrom').textContent = provider === 'resend' ? 'noreply@luzerge.com' : 'luzergeservices@gmail.com'

  // Body preview
  const bodyEl = document.getElementById('emPreviewBody')
  if (bodyVal.trim()) {
    bodyEl.textContent = bodyVal
    bodyEl.classList.remove('em-preview-placeholder')
  } else {
    bodyEl.innerHTML = '<p class="em-preview-placeholder">Your email content will appear here as you type...</p>'
  }

  // Word count
  const words = bodyVal.trim() ? bodyVal.trim().split(/\s+/).length : 0
  const chars = bodyVal.length
  document.getElementById('emWordCount').textContent = `${words} word${words !== 1 ? 's' : ''} / ${chars} char${chars !== 1 ? 's' : ''}`
}

// CSV file handler (shared between file input and drag & drop)
async function emHandleCsvFile(file) {
  const statusEl = document.getElementById('emImportStatus')
  statusEl.textContent = 'Parsing CSV...'

  const text = await file.text()
  const lines = text.split('\n')
  if (lines.length < 2) { statusEl.textContent = 'Empty CSV'; return }

  const header = parseCSVLine(lines[0])
  const firstNameIdx = header.findIndex(h => h.trim().toLowerCase() === 'first name')
  const lastNameIdx = header.findIndex(h => h.trim().toLowerCase() === 'last name')
  const emailIdx = header.findIndex(h => h.trim().toLowerCase().includes('e-mail') && h.trim().toLowerCase().includes('value'))
  const emailIdx2 = emailIdx >= 0 ? emailIdx : header.findIndex(h => h.trim().toLowerCase() === 'email')

  const finalEmailIdx = emailIdx >= 0 ? emailIdx : emailIdx2
  if (finalEmailIdx < 0) { statusEl.textContent = 'No email column found in CSV'; admShowToast('CSV must have an "E-mail 1 - Value" or "Email" column', true); return }

  const contacts = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = parseCSVLine(lines[i])
    const email = (cols[finalEmailIdx] || '').trim()
    if (!email || !email.includes('@')) continue
    const firstName = firstNameIdx >= 0 ? (cols[firstNameIdx] || '').trim() : ''
    const lastName = lastNameIdx >= 0 ? (cols[lastNameIdx] || '').trim() : ''
    const name = [firstName, lastName].filter(Boolean).join(' ') || null
    contacts.push({ email, name })
  }

  if (!contacts.length) { statusEl.textContent = 'No valid emails found'; return }
  statusEl.textContent = `Found ${contacts.length} contacts. Importing...`

  try {
    const s = await getSession()
    const res = await fetch(`${EDGE_BASE}/email-marketing?action=bulk_add_named`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    statusEl.textContent = `${data.added} imported`
    admShowToast(`${data.added} subscriber(s) imported from CSV`)
    emLoadSubscribers()
  } catch (err) { statusEl.textContent = ''; admShowToast(err.message, true) }
}

function admInitEmailMarketing() {
  if (_emInitDone) return
  _emInitDone = true

  // Tab switching
  document.querySelectorAll('[data-emtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-emtab]').forEach(b => b.classList.remove('em-tab-btn--active'))
      btn.classList.add('em-tab-btn--active')
      document.getElementById('emTabSubscribers').hidden = btn.dataset.emtab !== 'subscribers'
      document.getElementById('emTabCompose').hidden = btn.dataset.emtab !== 'compose'
      document.getElementById('emTabCampaigns').hidden = btn.dataset.emtab !== 'campaigns'
      if (btn.dataset.emtab === 'campaigns') emLoadCampaigns()
    })
  })

  // Search input
  document.getElementById('emSearchInput').addEventListener('input', (e) => {
    _emSearchQuery = e.target.value
    emRenderSubscribers()
  })

  // Filter pills
  document.querySelectorAll('[data-emfilter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-emfilter]').forEach(b => b.classList.remove('em-filter-pill--active'))
      btn.classList.add('em-filter-pill--active')
      _emCurrentFilter = btn.dataset.emfilter
      emRenderSubscribers()
    })
  })

  // Add single subscriber
  document.getElementById('emAddSubBtn').addEventListener('click', async () => {
    const email = document.getElementById('emSubEmail').value.trim()
    const name = document.getElementById('emSubName').value.trim()
    if (!email) return
    try {
      const s = await getSession()
      const res = await fetch(`${EDGE_BASE}/email-marketing?action=add_subscriber`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      document.getElementById('emSubEmail').value = ''
      document.getElementById('emSubName').value = ''
      admShowToast('Subscriber added')
      emLoadSubscribers()
    } catch (err) { admShowToast(err.message, true) }
  })

  // Bulk add
  document.getElementById('emBulkAddBtn').addEventListener('click', async () => {
    const raw = document.getElementById('emBulkEmails').value.trim()
    if (!raw) return
    const emails = raw.split('\n').map(e => e.trim()).filter(e => e && e.includes('@'))
    if (!emails.length) { admShowToast('No valid emails found', true); return }
    try {
      const s = await getSession()
      const res = await fetch(`${EDGE_BASE}/email-marketing?action=bulk_add`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      document.getElementById('emBulkEmails').value = ''
      admShowToast(`${data.added} subscriber(s) added`)
      emLoadSubscribers()
    } catch (err) { admShowToast(err.message, true) }
  })

  // Select all checkbox
  document.getElementById('emSelectAll').addEventListener('change', (e) => {
    const checked = e.target.checked
    _emSelectedEmails.clear()
    document.querySelectorAll('.em-sub-check').forEach(cb => {
      cb.checked = checked
      if (checked) _emSelectedEmails.add(cb.dataset.email)
    })
    emUpdateSelectedCount()
  })

  // Export CSV
  document.getElementById('emExportBtn').addEventListener('click', () => {
    const csv = 'Email,Name,Status,Added\n' + _emSubscribers.map(s =>
      `${s.email},${(s.name || '').replace(/,/g, '')},${s.status},${s.created_at}`
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'luzerge-subscribers.csv'
    a.click()
  })

  // CSV Import via file input
  document.getElementById('emCsvFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    await emHandleCsvFile(file)
    e.target.value = ''
  })

  // Drag & Drop CSV
  const dropZone = document.getElementById('emDropZone')
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('em-drop-zone--active') })
  dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('em-drop-zone--active') })
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropZone.classList.remove('em-drop-zone--active')
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      await emHandleCsvFile(file)
    } else {
      admShowToast('Please drop a CSV file', true)
    }
  })

  // Import Platform Users
  document.getElementById('emImportUsersBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('emImportStatus')
    statusEl.textContent = 'Fetching platform users...'
    try {
      const s = await getSession()
      const res = await fetch(`${EDGE_BASE}/email-marketing?action=import_platform_users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      statusEl.textContent = `${data.added} user(s) imported`
      admShowToast(`${data.added} platform user(s) imported as subscribers`)
      emLoadSubscribers()
    } catch (err) { statusEl.textContent = ''; admShowToast(err.message, true) }
  })

  // Live preview bindings
  document.getElementById('emSubject').addEventListener('input', emUpdatePreview)
  document.getElementById('emBody').addEventListener('input', emUpdatePreview)
  document.getElementById('emFromProvider').addEventListener('change', emUpdatePreview)

  // Send test
  document.getElementById('emTestBtn').addEventListener('click', async () => {
    const subject = document.getElementById('emSubject').value.trim()
    const body = document.getElementById('emBody').value.trim()
    const provider = document.getElementById('emFromProvider').value
    const testEmail = document.getElementById('emTestEmail').value.trim()
    if (!subject || !body) { admShowToast('Subject and body required', true); return }
    if (!testEmail || !testEmail.includes('@')) { admShowToast('Enter a valid test email address', true); return }
    const status = document.getElementById('emSendStatus')
    status.textContent = `Sending test to ${testEmail}...`
    try {
      const s = await getSession()
      const res = await fetch(`${EDGE_BASE}/email-marketing?action=send_test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, provider, to: testEmail }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      status.textContent = data.message || 'Test sent!'
    } catch (err) { status.textContent = ''; admShowToast(err.message, true) }
  })

  // Send campaign (with styled modal instead of browser confirm)
  document.getElementById('emSendBtn').addEventListener('click', async () => {
    const subject = document.getElementById('emSubject').value.trim()
    const body = document.getElementById('emBody').value.trim()
    const provider = document.getElementById('emFromProvider').value
    const recipientMode = document.getElementById('emRecipients').value
    if (!subject || !body) { admShowToast('Subject and body required', true); return }

    const emails = recipientMode === 'selected' ? [..._emSelectedEmails] : null
    if (recipientMode === 'selected' && (!emails || !emails.length)) {
      admShowToast('No subscribers selected. Go to Subscribers tab and check the ones you want.', true)
      return
    }

    const count = emails ? emails.length : _emSubscribers.filter(s => s.status === 'active').length
    const confirmed = await emConfirm('Send Campaign', `You are about to send "${subject}" to ${count} recipient(s). This action cannot be undone.`)
    if (!confirmed) return

    const status = document.getElementById('emSendStatus')
    status.textContent = `Sending to ${count} recipients...`
    document.getElementById('emSendBtn').disabled = true

    try {
      const s = await getSession()
      const res = await fetch(`${EDGE_BASE}/email-marketing?action=send_campaign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, provider, emails }),
        signal: AbortSignal.timeout(120000),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      status.textContent = `Done! Sent: ${data.sent}, Failed: ${data.failed}`
      admShowToast(`Campaign sent to ${data.sent} recipients`)
    } catch (err) {
      status.textContent = ''
      admShowToast(err.message, true)
    } finally {
      document.getElementById('emSendBtn').disabled = false
    }
  })

  emLoadSubscribers()
  emLoadCampaignStats()
}

async function emLoadSubscribers() {
  const loading = document.getElementById('emSubLoading')
  const content = document.getElementById('emSubContent')
  const empty = document.getElementById('emSubEmpty')

  loading.hidden = false; content.hidden = true; empty.hidden = true

  try {
    const s = await getSession()
    if (!s) { loading.hidden = true; return }
    const res = await fetch(`${EDGE_BASE}/email-marketing?action=subscribers`, {
      headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)

    _emSubscribers = data.subscribers || []
    emUpdateStats()
    emRenderSubscribers()
    loading.hidden = true
  } catch (err) {
    loading.hidden = true
    document.getElementById('emError').textContent = err.message
    document.getElementById('emError').hidden = false
  }
}

async function emLoadCampaignStats() {
  try {
    const s = await getSession()
    if (!s) return
    const res = await fetch(`${EDGE_BASE}/email-marketing?action=campaigns`, {
      headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (!data.error) {
      document.getElementById('emStatCampaigns').textContent = (data.campaigns || []).length
    }
  } catch {}
}

async function emLoadCampaigns() {
  const loading = document.getElementById('emCampLoading')
  const content = document.getElementById('emCampContent')
  const empty = document.getElementById('emCampEmpty')
  const body = document.getElementById('emCampBody')

  loading.hidden = false; content.hidden = true; empty.hidden = true

  try {
    const s = await getSession()
    if (!s) { loading.hidden = true; return }
    const res = await fetch(`${EDGE_BASE}/email-marketing?action=campaigns`, {
      headers: { Authorization: `Bearer ${s.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)

    const campaigns = data.campaigns || []
    if (!campaigns.length) { loading.hidden = true; empty.hidden = false; return }

    document.getElementById('emStatCampaigns').textContent = campaigns.length

    body.innerHTML = campaigns.map((c, i) => `
      <tr>
        <td>${new Date(c.created_at).toLocaleString()}</td>
        <td>${escHtml(c.subject)}</td>
        <td>${escHtml(c.provider)}</td>
        <td>${c.recipient_count}${c.failed_count ? ` <span style="color:#ef4444">(${c.failed_count} failed)</span>` : ''}</td>
        <td>${c.status === 'sent'
          ? '<span class="status-badge status-badge--healthy">Sent</span>'
          : c.status === 'partial'
          ? '<span class="status-badge status-badge--pending">Partial</span>'
          : '<span class="status-badge status-badge--down">Failed</span>'}</td>
        <td>
          <button class="em-camp-toggle" data-camp-idx="${i}" title="View email body">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </td>
      </tr>
      <tr class="em-camp-detail" id="emCampDetail${i}" hidden>
        <td colspan="6">${escHtml(c.body || 'No body saved')}</td>
      </tr>
    `).join('')

    // Bind campaign expand toggles
    body.querySelectorAll('.em-camp-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.campIdx
        const detail = document.getElementById(`emCampDetail${idx}`)
        const isOpen = !detail.hidden
        detail.hidden = isOpen
        btn.classList.toggle('em-camp-toggle--open', !isOpen)
      })
    })

    loading.hidden = true; content.hidden = false
  } catch (err) {
    loading.hidden = true; empty.textContent = err.message; empty.hidden = false
  }
}

// Parse a CSV line handling quoted fields with commas
function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue }
    current += ch
  }
  result.push(current)
  return result
}
