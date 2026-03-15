/**
 * Luzerge — User Dashboard JavaScript
 * Handles: sidebar nav, domain submission, status monitoring, cache purge, feature panels
 */

'use strict'

const EDGE_BASE = 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1'

let currentUser = null
let currentProfile = null
let selectedDomainId = null
let domainToDelete = null
let userDomains = []
let scannedDomain = null  // holds the domain name after a successful scan

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for Supabase to process OAuth tokens from URL hash (if present)
  const { data: { session } } = await _supabase.auth.getSession()

  if (!session) {
    const { data: { subscription } } = _supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (event === 'SIGNED_IN' && newSession) {
          subscription.unsubscribe()
          window.location.reload()
        }
      }
    )
    setTimeout(async () => {
      const { data: { session: recheck } } = await _supabase.auth.getSession()
      if (!recheck) {
        subscription.unsubscribe()
        window.location.replace('/login.html')
      }
    }, 2000)
    return
  }

  currentUser = session.user
  currentProfile = await getProfile()

  if (currentProfile?.role === 'admin') {
    window.location.replace('/admin.html')
    return
  }

  // Show user info
  const navUser = document.getElementById('navUser')
  if (navUser) navUser.textContent = currentProfile?.email || currentUser.email

  const navAvatar = document.getElementById('navAvatar')
  if (navAvatar && currentProfile?.avatar_url) {
    navAvatar.innerHTML = `<img src="${escHtml(currentProfile.avatar_url)}" alt="" />`
  } else if (navAvatar) {
    navAvatar.textContent = (currentProfile?.full_name || currentUser.email || '?')[0].toUpperCase()
  }

  const heroName = document.getElementById('heroName')
  if (heroName) {
    const firstName = (currentProfile?.full_name || '').split(' ')[0] || 'there'
    heroName.textContent = firstName
  }

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', signOut)

  // Load domains
  await loadDomains()

  // Scan domain form
  document.getElementById('addDomainForm')?.addEventListener('submit', handleScanDomain)

  // Submit domain button (inside report panel)
  document.getElementById('reportSubmitBtn')?.addEventListener('click', handleSubmitDomain)

  // Close detail
  document.getElementById('closeDetailBtn')?.addEventListener('click', closeDetail)

  // Close domain report
  document.getElementById('closeReportBtn')?.addEventListener('click', () => {
    document.getElementById('domainReportPanel').hidden = true
  })

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

  // Sidebar
  initSidebar()

  // Toggle switches
  initToggles()

  // Init starfield
  initDashStarfield()

  // Scroll reveals
  initScrollReveals()
})

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function initSidebar() {
  const sidebar = document.getElementById('dashSidebar')
  const overlay = document.getElementById('sidebarOverlay')
  const toggle = document.getElementById('sidebarToggle')

  // Sidebar nav items
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      switchPanel(item.dataset.panel)
      // Close mobile sidebar
      sidebar?.classList.remove('is-open')
      overlay?.classList.remove('is-open')
    })
  })

  // Mobile hamburger
  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('is-open')
    overlay?.classList.toggle('is-open')
  })

  // Overlay click to close
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('is-open')
    overlay?.classList.remove('is-open')
  })
}

function switchPanel(panelId) {
  // Update sidebar active state
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('sidebar-item--active', item.dataset.panel === panelId)
  })

  // Hide all panels, show target
  document.querySelectorAll('[data-feature-panel]').forEach(panel => {
    panel.hidden = true
  })

  const target = document.getElementById('panel' + panelId.charAt(0).toUpperCase() + panelId.slice(1))
  if (target) {
    target.hidden = false
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Populate mock data for panels that need it
  if (panelId === 'ssl') populateSslTable()
  if (panelId === 'dns') populateDnsTable()
  if (panelId === 'uptime') populateUptime()
}

// ─── Toggle switches ──────────────────────────────────────────────────────────

function initToggles() {
  document.querySelectorAll('.toggle-switch input').forEach(input => {
    input.addEventListener('change', () => {
      const label = input.closest('.toggle-switch')
      label.classList.toggle('toggle-switch--on', input.checked)
      showToast('Settings saved')
    })
  })
}

function showToast(msg) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.hidden = true }, 2000)
}

// ─── Mock data populators ─────────────────────────────────────────────────────

function populateSslTable() {
  const tbody = document.getElementById('sslBody')
  if (!tbody || !userDomains.length) return

  const activeDomains = userDomains.filter(d => d.status === 'active')
  if (!activeDomains.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="feature-empty">No active domains yet</td></tr>'
    return
  }

  tbody.innerHTML = activeDomains.map(d => {
    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + 3)
    return `<tr>
      <td>${escHtml(d.domain)}</td>
      <td><span class="status-badge status-badge--active">Active</span></td>
      <td>Let's Encrypt</td>
      <td>${formatDate(expiry.toISOString())}</td>
      <td><span class="status-badge status-badge--active">On</span></td>
    </tr>`
  }).join('')
}

function populateDnsTable() {
  const tbody = document.getElementById('dnsBody')
  if (!tbody || !userDomains.length) return

  const activeDomains = userDomains.filter(d => d.status === 'active')
  if (!activeDomains.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="feature-empty">No active domains yet</td></tr>'
    return
  }

  const records = []
  activeDomains.forEach(d => {
    records.push(
      { type: 'A', name: d.domain, value: '104.21.xx.xx', ttl: 'Auto', proxied: true },
      { type: 'AAAA', name: d.domain, value: '2606:4700:xxxx::xxxx', ttl: 'Auto', proxied: true },
      { type: 'CNAME', name: `www.${d.domain}`, value: d.domain, ttl: 'Auto', proxied: true },
    )
  })

  tbody.innerHTML = records.map(r => `<tr>
    <td><span class="status-badge" style="background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${r.type}</span></td>
    <td>${escHtml(r.name)}</td>
    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.value)}</td>
    <td>${r.ttl}</td>
    <td>${r.proxied ? '<span class="status-badge status-badge--active">Proxied</span>' : 'DNS only'}</td>
  </tr>`).join('')
}

function populateUptime() {
  const container = document.getElementById('uptimeList')
  if (!container || !userDomains.length) return

  const activeDomains = userDomains.filter(d => d.status === 'active')
  if (!activeDomains.length) {
    container.innerHTML = `<div class="uptime-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="dash-empty__icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <p>No active domains to monitor</p>
      <span>Domains will appear here once approved</span>
    </div>`
    return
  }

  container.innerHTML = activeDomains.map(d => {
    // Generate random uptime bars (24 blocks for 24 hours)
    const blocks = Array.from({ length: 24 }, () => {
      const r = Math.random()
      return r < 0.95 ? 'up' : r < 0.98 ? 'down' : 'unknown'
    })
    const upCount = blocks.filter(b => b === 'up').length
    const pct = ((upCount / 24) * 100).toFixed(1)
    const pctClass = pct >= 99 ? 'good' : pct >= 95 ? 'warn' : 'bad'

    return `<div class="uptime-card">
      <div class="uptime-card__top">
        <span class="uptime-card__domain">${escHtml(d.domain)}</span>
        <span class="uptime-card__pct uptime-card__pct--${pctClass}">${pct}%</span>
      </div>
      <div class="uptime-bar">
        ${blocks.map(b => `<div class="uptime-bar__block uptime-bar__block--${b}"></div>`).join('')}
      </div>
    </div>`
  }).join('')
}

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
    .select('id, domain, status, admin_notes, last_purged_at, auto_purge_enabled, auto_purge_interval, created_at')
    .order('created_at', { ascending: false })

  loading.hidden = true

  if (error) {
    list.innerHTML = `<div class="dash-alert dash-alert--error">Failed to load domains: ${escHtml(error.message)}</div>`
    return
  }

  userDomains = domains || []

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
        <button class="btn btn--outline btn--sm" data-action="lookup" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Lookup
        </button>
        ${d.status === 'active' ? `<button class="btn btn--outline btn--sm" data-action="quickpurge" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Purge
        </button>` : ''}
        ${d.status === 'active' ? `<button class="btn btn--outline btn--sm" data-action="view" data-id="${d.id}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Stats
        </button>` : ''}
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete" data-id="${d.id}" data-domain="${escHtml(d.domain)}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('')

  // Events
  list.querySelectorAll('[data-action="lookup"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      runDomainLookup(btn.dataset.domain)
    })
  })
  list.querySelectorAll('[data-action="quickpurge"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleQuickPurge(btn)
    })
  })
  list.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openDetail(btn.dataset.id)
    })
  })
  list.querySelectorAll('.domain-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('domain-card--active')) openDetail(card.dataset.id)
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

// ─── Scan & Submit domain (two-step flow) ─────────────────────────────────────

function parseDomainInput() {
  return document.getElementById('inputDomain').value.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

async function handleScanDomain(e) {
  e.preventDefault()

  const btn = document.getElementById('scanDomainBtn')
  const errEl = document.getElementById('addDomainError')
  const successEl = document.getElementById('addDomainSuccess')
  errEl.hidden = true
  successEl.hidden = true

  const domain = parseDomainInput()

  if (!domain) {
    showAddError('Please enter a domain name.')
    return
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
    showAddError('Please enter a valid domain (e.g., yourdomain.com)')
    return
  }

  // Check if already submitted
  const alreadySubmitted = userDomains.find(d => d.domain === domain)
  if (alreadySubmitted) {
    showAddError(`${domain} is already submitted.`)
    return
  }

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Scanning...'

  // Run lookup — this will show the report panel with submit button
  scannedDomain = domain
  await runDomainLookup(domain, true)

  btn.disabled = false
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan Domain'
}

async function handleSubmitDomain() {
  if (!scannedDomain) return

  const btn = document.getElementById('reportSubmitBtn')
  const errEl = document.getElementById('reportSubmitError')
  const successEl = document.getElementById('reportSubmitSuccess')
  errEl.hidden = true
  successEl.hidden = true

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Submitting...'

  const { error } = await _supabase.from('user_domains').insert({
    user_id: currentUser.id,
    domain: scannedDomain,
    status: 'pending',
  })

  btn.disabled = false
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Submit Domain'

  if (error) {
    errEl.textContent = error.message.includes('unique') ? `${scannedDomain} is already submitted.` : error.message
    errEl.hidden = false
    return
  }

  successEl.innerHTML = `<strong>${escHtml(scannedDomain)}</strong> submitted! Our team will set it up and you'll see it go <span class="status-badge status-badge--active" style="display:inline-flex;vertical-align:middle;margin:0 4px">active</span> once ready.`
  successEl.hidden = false

  // Hide the submit button row after success
  btn.hidden = true

  // Reset the scan form
  document.getElementById('addDomainForm').reset()
  scannedDomain = null

  await loadDomains()
}

function showAddError(msg) {
  const el = document.getElementById('addDomainError')
  el.textContent = msg
  el.hidden = false
}

// ─── Domain Lookup ────────────────────────────────────────────────────────

async function runDomainLookup(domain, showSubmit = false) {
  const panel = document.getElementById('domainReportPanel')
  panel.hidden = false
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Reset submit section
  const submitSection = document.getElementById('reportSubmitSection')
  submitSection.hidden = true
  document.getElementById('reportSubmitError').hidden = true
  document.getElementById('reportSubmitSuccess').hidden = true
  document.getElementById('reportSubmitBtn').hidden = false

  // Set loading state
  document.getElementById('reportDomainName').textContent = domain
  document.getElementById('reportStatus').innerHTML = '<span class="report-loading">Scanning...</span>'
  document.getElementById('reportPlatform').textContent = '...'
  document.getElementById('reportHosting').textContent = '...'
  document.getElementById('reportIP').textContent = '...'
  document.getElementById('reportCountry').textContent = '...'
  document.getElementById('reportCloudflare').textContent = '...'
  document.getElementById('reportNameservers').innerHTML = '<li>Scanning...</li>'
  document.getElementById('reportRecordsGroup').hidden = true
  document.getElementById('reportAction').innerHTML = ''

  try {
    const res = await fetch(`${EDGE_BASE}/domain-lookup?domain=${encodeURIComponent(domain)}`, {
      headers: {
        Authorization: `Bearer ${__LUZERGE_CONFIG.SUPABASE_ANON_KEY}`,
        apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
      },
    })
    const data = await res.json()

    if (!data.registered) {
      document.getElementById('reportStatus').innerHTML =
        '<span class="status-badge status-badge--error">Not Found</span>'
      document.getElementById('reportPlatform').textContent = '—'
      document.getElementById('reportHosting').textContent = '—'
      document.getElementById('reportIP').textContent = '—'
      document.getElementById('reportCountry').textContent = '—'
      document.getElementById('reportCloudflare').textContent = '—'
      document.getElementById('reportNameservers').innerHTML = '<li>Domain does not exist</li>'
      document.getElementById('reportAction').innerHTML =
        '<div class="dash-alert dash-alert--error">This domain is not registered or does not have DNS records.</div>'
      return
    }

    // Status
    document.getElementById('reportStatus').innerHTML =
      '<span class="status-badge status-badge--active">Registered</span>'

    // Platform
    const platformEl = document.getElementById('reportPlatform')
    platformEl.textContent = data.platform || 'Unknown'
    if (data.is_on_cloudflare) {
      platformEl.innerHTML = `<span class="report-highlight report-highlight--green">${escHtml(data.platform)}</span>`
    }

    // Hosting
    document.getElementById('reportHosting').textContent = data.hosting?.provider || 'Unknown'

    // IP
    document.getElementById('reportIP').textContent = data.hosting?.ip || 'N/A'

    // Country
    const countryCode = data.hosting?.country || ''
    document.getElementById('reportCountry').textContent = countryCode || 'N/A'

    // Cloudflare status
    const cfEl = document.getElementById('reportCloudflare')
    if (data.is_on_cloudflare) {
      cfEl.innerHTML = '<span class="report-highlight report-highlight--green">Yes — On Cloudflare</span>'
    } else {
      cfEl.innerHTML = '<span class="report-highlight report-highlight--amber">No — Not on Cloudflare</span>'
    }

    // Nameservers
    const nsList = document.getElementById('reportNameservers')
    if (data.nameservers?.length) {
      nsList.innerHTML = data.nameservers.map(ns =>
        `<li><code>${escHtml(ns)}</code></li>`
      ).join('')
    } else {
      nsList.innerHTML = '<li>No nameservers found</li>'
    }

    // DNS Records
    const hasRecords = (data.a_records?.length || data.aaaa_records?.length || data.mx_records?.length)
    if (hasRecords) {
      document.getElementById('reportRecordsGroup').hidden = false
      const recordsHtml = []
      if (data.a_records?.length) {
        data.a_records.forEach(r => {
          recordsHtml.push(`<div class="report-record"><span class="report-record__type report-record__type--a">A</span><span class="report-record__value">${escHtml(r)}</span></div>`)
        })
      }
      if (data.aaaa_records?.length) {
        data.aaaa_records.forEach(r => {
          recordsHtml.push(`<div class="report-record"><span class="report-record__type report-record__type--aaaa">AAAA</span><span class="report-record__value">${escHtml(r)}</span></div>`)
        })
      }
      if (data.mx_records?.length) {
        data.mx_records.forEach(r => {
          recordsHtml.push(`<div class="report-record"><span class="report-record__type report-record__type--mx">MX</span><span class="report-record__value">${escHtml(r)}</span></div>`)
        })
      }
      document.getElementById('reportRecords').innerHTML = recordsHtml.join('')
    }

    // Action message
    const actionEl = document.getElementById('reportAction')
    if (data.is_on_cloudflare) {
      actionEl.innerHTML = `<div class="dash-alert dash-alert--success">
        <strong>Already on Cloudflare!</strong> Our team will configure the CDN settings for this domain. You can provide your Zone ID and API Token to speed things up, or we'll handle everything for you.
      </div>`
    } else {
      actionEl.innerHTML = `<div class="dash-alert dash-alert--info">
        <strong>Not on Cloudflare yet.</strong> No worries — our team will set up Cloudflare for your domain. You'll just need to update your nameservers when we send you the instructions. It takes about 5 minutes!
      </div>`
    }

    // Show "Submit Domain" button if this is a new scan
    if (showSubmit && data.registered) {
      submitSection.hidden = false
      document.getElementById('reportSubmitDomain').textContent = domain
    }

    // Scroll to show full report after content loads
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })

  } catch (err) {
    document.getElementById('reportStatus').innerHTML =
      '<span class="status-badge status-badge--error">Error</span>'
    document.getElementById('reportAction').innerHTML =
      `<div class="dash-alert dash-alert--error">Failed to look up domain: ${escHtml(String(err))}</div>`
  }
}

// ─── Domain detail ────────────────────────────────────────────────────────────

async function openDetail(domainId) {
  // Make sure we're on the overview panel
  switchPanel('overview')

  selectedDomainId = domainId
  document.getElementById('detailPanel').hidden = false
  document.getElementById('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })

  document.getElementById('purgeSuccess').hidden = true
  document.getElementById('purgeError').hidden = true

  const { data: domain } = await _supabase
    .from('user_domains')
    .select('domain, auto_purge_enabled, auto_purge_interval')
    .eq('id', domainId)
    .single()

  if (domain) {
    document.getElementById('detailTitle').textContent = domain.domain
    renderAutoPurgeSettings(domainId, domain.auto_purge_enabled, domain.auto_purge_interval)
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
  document.getElementById('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ─── Purge ────────────────────────────────────────────────────────────────────

function switchPurgeTab(tab) {
  document.querySelectorAll('.purge-tab').forEach(t => t.classList.remove('purge-tab--active'))
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('purge-tab--active')
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
    successEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    await loadStats(selectedDomainId)
  } else {
    const msg = data.cf_response?.errors?.[0]?.message ?? data.error ?? 'Purge failed'
    errorEl.textContent = `Error: ${msg}`
    errorEl.hidden = false
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

// ─── Auto-Purge Settings in Detail Panel ─────────────────────────────────────

function renderAutoPurgeSettings(domainId, enabled, interval) {
  let container = document.getElementById('autoPurgeSection')
  if (!container) {
    // Create the section after the purge section
    const purgeSection = document.querySelector('.purge-section')
    if (!purgeSection) return
    container = document.createElement('div')
    container.id = 'autoPurgeSection'
    container.className = 'auto-purge-section'
    purgeSection.parentNode.insertBefore(container, purgeSection.nextSibling)
  }

  const intervalLabels = {
    hourly: 'Every hour',
    every6h: 'Every 6 hours',
    every12h: 'Every 12 hours',
    daily: 'Once a day',
    weekly: 'Once a week',
  }

  container.innerHTML = `
    <h3 class="purge-section__title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Auto-Purge Schedule
    </h3>
    <p class="purge-desc">Automatically purge cache on a schedule — runs 24/7 on our servers, even when your PC is off.</p>
    <div class="auto-purge-controls">
      <div class="auto-purge-toggle">
        <label class="toggle-switch ${enabled ? 'toggle-switch--on' : ''}">
          <input type="checkbox" id="autoPurgeToggle" ${enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <span class="auto-purge-toggle__label">${enabled ? 'Auto-purge is <strong>on</strong>' : 'Auto-purge is <strong>off</strong>'}</span>
      </div>
      <div class="auto-purge-interval ${enabled ? '' : 'auto-purge-interval--disabled'}">
        <label class="form-label" for="autoPurgeInterval">Frequency</label>
        <select class="form-input form-select" id="autoPurgeInterval" ${enabled ? '' : 'disabled'}>
          ${Object.entries(intervalLabels).map(([val, label]) =>
            `<option value="${val}" ${interval === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
      </div>
    </div>
  `

  // Bind events
  const toggle = container.querySelector('#autoPurgeToggle')
  const select = container.querySelector('#autoPurgeInterval')
  const intervalWrap = container.querySelector('.auto-purge-interval')
  const labelEl = container.querySelector('.auto-purge-toggle__label')

  toggle.addEventListener('change', async () => {
    const on = toggle.checked
    const ok = await handleAutoPurgeToggle(domainId, on)
    if (ok) {
      toggle.closest('.toggle-switch').classList.toggle('toggle-switch--on', on)
      labelEl.innerHTML = on ? 'Auto-purge is <strong>on</strong>' : 'Auto-purge is <strong>off</strong>'
      select.disabled = !on
      intervalWrap.classList.toggle('auto-purge-interval--disabled', !on)
    } else {
      toggle.checked = !on // revert
    }
  })

  select.addEventListener('change', () => {
    handleAutoPurgeInterval(domainId, select.value)
  })
}

// ─── Quick Purge (from domain card) ──────────────────────────────────────────

async function handleQuickPurge(btn) {
  const domainId = btn.dataset.id
  const domainName = btn.dataset.domain
  const origHtml = btn.innerHTML

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span>'

  const session = await getSession()
  if (!session) { btn.disabled = false; btn.innerHTML = origHtml; return }

  const res = await fetch(`${EDGE_BASE}/purge-cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain_id: domainId, purge_type: 'everything' }),
  })

  const data = await res.json()
  btn.disabled = false

  if (res.ok && data.success) {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Done!'
    showToast(`Cache purged for ${domainName}`)
    setTimeout(() => { btn.innerHTML = origHtml }, 2000)
    await loadDomains()
  } else {
    btn.innerHTML = origHtml
    showToast('Purge failed — check Cloudflare config')
  }
}

// ─── Auto-Purge Toggle ──────────────────────────────────────────────────────

async function handleAutoPurgeToggle(domainId, enabled) {
  const { error } = await _supabase
    .from('user_domains')
    .update({ auto_purge_enabled: enabled })
    .eq('id', domainId)

  if (error) {
    showToast('Failed to update auto-purge')
    return false
  }
  showToast(enabled ? 'Auto-purge enabled' : 'Auto-purge disabled')
  return true
}

async function handleAutoPurgeInterval(domainId, interval) {
  const { error } = await _supabase
    .from('user_domains')
    .update({ auto_purge_interval: interval })
    .eq('id', domainId)

  if (error) {
    showToast('Failed to update schedule')
    return
  }
  showToast('Auto-purge schedule updated')
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
