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
const PLAN_LIMITS = { none: 1, solo: 1, starter: 3, pro: 10, business: 50, enterprise: Infinity }
const PLAN_PRICES = { none: 'Free', solo: '₱99/mo', starter: '₱299/mo', pro: '₱999/mo', business: '₱1,999/mo', enterprise: '₱3,499/mo' }

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

  // Handle payment return from PayMongo
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.get('payment') === 'success') {
    showToast('Payment successful! Your plan has been activated.')
    // Re-fetch profile to get updated plan
    currentProfile = await getProfile()
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname)
  } else if (urlParams.get('payment') === 'cancelled') {
    showToast('Payment cancelled. You can try again anytime.')
    window.history.replaceState({}, '', window.location.pathname)
  }

  // Load domains then overview sections
  await loadDomains()
  loadOverviewSections()

  // Scan domain form
  document.getElementById('addDomainForm')?.addEventListener('submit', handleScanDomain)

  // Submit domain button (inside report panel)
  document.getElementById('reportSubmitBtn')?.addEventListener('click', handleSubmitDomain)

  // Setup mode radio toggle
  document.querySelectorAll('input[name="setupMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isSelf = radio.value === 'self' && radio.checked
      document.getElementById('selfManagedFields').hidden = !isSelf
      document.getElementById('optManaged').classList.toggle('setup-mode-option--active', !isSelf)
      document.getElementById('optSelfManaged').classList.toggle('setup-mode-option--active', isSelf)
    })
  })

  // CDN provider dropdown — show/hide correct credential fields
  document.getElementById('inputCdnProvider')?.addEventListener('change', (e) => {
    const prov = e.target.value
    const cfFields = document.getElementById('cfCredentialFields')
    const genericFields = document.getElementById('genericCredentialFields')
    const noneMsg = document.getElementById('noneProviderMsg')
    const cfGuide = document.getElementById('cfGuide')

    if (cfFields) cfFields.hidden = prov !== 'cloudflare'
    if (genericFields) genericFields.hidden = prov === 'cloudflare' || prov === 'none'
    if (noneMsg) noneMsg.hidden = prov !== 'none'
    if (cfGuide) cfGuide.hidden = prov !== 'cloudflare'

    // Update generic labels
    if (prov === 'cloudfront') {
      document.getElementById('labelDistId').textContent = 'Distribution ID'
      document.getElementById('labelCdnApiKey').textContent = 'AWS Access Key'
      document.getElementById('hintDistId').textContent = 'Found in CloudFront console → Distributions'
      document.getElementById('hintCdnApiKey').textContent = 'IAM user access key with CloudFront permissions'
    } else if (prov === 'fastly') {
      document.getElementById('labelDistId').textContent = 'Service ID'
      document.getElementById('labelCdnApiKey').textContent = 'API Token'
      document.getElementById('hintDistId').textContent = 'Found in Fastly dashboard → your service → Service ID'
      document.getElementById('hintCdnApiKey').textContent = 'Create a token at Account → API tokens'
    }
  })

  // CF guide collapsible
  document.getElementById('cfGuideToggle')?.addEventListener('click', () => {
    const guide = document.getElementById('cfGuide')
    const body = document.getElementById('cfGuideBody')
    const isOpen = !body.hidden
    body.hidden = isOpen
    guide.classList.toggle('cf-guide--open', !isOpen)
  })

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

  // CF toggle switches
  initCfToggles()

  // Domain settings handlers (detail panel)
  initDomainSettingsHandlers()

  // User settings handlers
  initUserSettingsHandlers()

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

  // Collapsible sidebar sections
  document.querySelectorAll('.sidebar-section-toggle').forEach(label => {
    label.addEventListener('click', () => {
      label.closest('.sidebar-section')?.classList.toggle('sidebar-section--collapsed')
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

  // Populate panel data from Cloudflare
  if (panelId === 'analytics') populateAnalytics()
  if (panelId === 'ssl') populateSslPanel()
  if (panelId === 'dns') populateDnsPanel()
  if (panelId === 'minify') populateMinifyPanel()
  if (panelId === 'images') populateImagesPanel()
  if (panelId === 'waf') populateWafPanel()
  if (panelId === 'ddos') populateDdosPanel()
  if (panelId === 'uptime') populateUptimePanel()
  if (panelId === 'settingsProfile') populateProfileSettings()
  if (panelId === 'settingsDomains') populateDomainDefaults()
  if (panelId === 'settingsNotifications') populateNotifSettings()
  if (panelId === 'settingsCredentials') populateCredsSettings()
  if (panelId === 'settingsPlan') populatePlanSettings()
  if (panelId === 'settingsSecurity') populateSecuritySettings()
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.classList.toggle('toast--error', isError)
  toast.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.hidden = true }, isError ? 5000 : 2000)
}

// ─── CF-Proxy helper ─────────────────────────────────────────────────────────

const _cfCache = {}          // keyed by `${domainId}:${action}:${extraKey}`
const CF_CACHE_TTL = 60_000  // 60 seconds

async function cfProxy(domainId, action, extra = {}) {
  const cacheKey = `${domainId}:${action}:${JSON.stringify(extra)}`
  const cached = _cfCache[cacheKey]
  if (cached && Date.now() - cached.ts < CF_CACHE_TTL) {
    return cached.data
  }

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
  _cfCache[cacheKey] = { data, ts: Date.now() }
  return data
}

function invalidateCache(domainId, action) {
  for (const key of Object.keys(_cfCache)) {
    if (key.startsWith(`${domainId}:${action}`)) delete _cfCache[key]
  }
}

async function cfProxyPost(domainId, action, body) {
  const session = await getSession()
  if (!session) return null
  const params = new URLSearchParams({ domain_id: domainId, action })
  const res = await fetch(`${EDGE_BASE}/cf-proxy?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function formatBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// ─── Generic pagination for monitoring tables ──────────────────────────────
const _pagPerPage = 15
const _pagState = {} // { key: { rows: [], page: 1 } }

function _pagInit(key, rows) {
  _pagState[key] = { rows, page: (_pagState[key]?.page > 1 ? Math.min(_pagState[key].page, Math.ceil(rows.length / _pagPerPage) || 1) : 1) }
}

function _pagRender(key, tbodyId, pagId) {
  const state = _pagState[key]
  if (!state) return
  const tbody = document.getElementById(tbodyId)
  const pag = document.getElementById(pagId)
  if (!tbody || !pag) return

  const totalPages = Math.ceil(state.rows.length / _pagPerPage) || 1
  if (state.page > totalPages) state.page = totalPages
  const start = (state.page - 1) * _pagPerPage
  tbody.innerHTML = state.rows.slice(start, start + _pagPerPage).join('')

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
      _pagRender(key, tbodyId, pagId)
    }
  })
}

// ─── Multi-domain select helper ──────────────────────────────────────────────

function populateMultiDomainSelect(selectId) {
  const select = document.getElementById(selectId)
  if (!select) return null
  const active = userDomains.filter(d => d.status === 'active')
  if (!active.length) {
    select.innerHTML = '<option value="">No active domains</option>'
    return null
  }
  const prev = select.value
  select.innerHTML = '<option value="__all__">All Domains</option>' + active.map(d => {
    const prov = d.cdn_provider || 'cloudflare'
    const label = prov === 'cloudflare' ? '' : ` [${prov}]`
    return `<option value="${d.id}">${escHtml(d.domain)}${label}</option>`
  }).join('')
  if (prev && select.querySelector(`option[value="${prev}"]`)) select.value = prev
  return '__all__'
}

function getSelectedDomains(selectId) {
  const select = document.getElementById(selectId)
  const val = select?.value || '__all__'
  const active = userDomains.filter(d => d.status === 'active')
  if (val === '__all__') return active
  return active.filter(d => d.id === val)
}

function settingBadge(value) {
  const isOn = value === 'on' || value === true
  return `<span class="status-badge ${isOn ? 'status-badge--active' : 'status-badge--pending'}">${isOn ? 'On' : 'Off'}</span>`
}

// ─── Panel domain selectors ──────────────────────────────────────────────────

function populateDomainSelect(selectId) {
  const select = document.getElementById(selectId)
  if (!select) return null
  const active = userDomains.filter(d => d.status === 'active')
  select.innerHTML = active.length
    ? active.map(d => {
        const prov = d.cdn_provider || 'cloudflare'
        const label = prov === 'cloudflare' ? '' : ` [${prov}]`
        return `<option value="${d.id}" data-provider="${prov}">${escHtml(d.domain)}${label}</option>`
      }).join('')
    : '<option value="">No active domains</option>'
  return active.length ? active[0].id : null
}

/** Get the cdn_provider for a domain ID */
function getDomainProvider(domainId) {
  const d = userDomains.find(x => x.id === domainId)
  return d?.cdn_provider || 'cloudflare'
}

// ─── CF Toggle switches — persist to Cloudflare ─────────────────────────────

let _cfPanelDomainId = null // currently selected domain for settings panels
let _cfSettings = {}        // cached zone settings
const _toggleLocks = new Set() // prevent rapid toggle spam

function initCfToggles() {
  document.querySelectorAll('[data-cf-setting]').forEach(input => {
    input.addEventListener('change', async () => {
      if (!_cfPanelDomainId) {
        showToast('Select a domain first')
        input.checked = !input.checked
        return
      }

      if (getDomainProvider(_cfPanelDomainId) !== 'cloudflare') {
        showToast('Settings can only be changed for Cloudflare domains')
        input.checked = !input.checked
        return
      }

      const label = input.closest('.toggle-switch')
      const setting = input.dataset.cfSetting
      const lockKey = `${_cfPanelDomainId}:${setting}`
      if (_toggleLocks.has(lockKey)) {
        input.checked = !input.checked
        return
      }
      _toggleLocks.add(lockKey)
      let value

      if (setting === 'minify') {
        // Minify is a compound setting {css, html, js}
        const key = input.dataset.cfKey
        const current = _cfSettings.minify || { css: 'off', html: 'off', js: 'off' }
        current[key] = input.checked ? 'on' : 'off'
        value = current
      } else if (input.dataset.onValue) {
        value = input.checked ? input.dataset.onValue : input.dataset.offValue
      } else {
        value = input.checked ? 'on' : 'off'
      }

      label.classList.toggle('toggle-switch--on', input.checked)
      label.style.opacity = '0.5'

      try {
        await cfProxyPost(_cfPanelDomainId, 'update_setting', { setting, value })
        invalidateCache(_cfPanelDomainId, 'settings')
        if (setting === 'minify') _cfSettings.minify = value
        else _cfSettings[setting] = value
        showToast('Setting saved')
      } catch (err) {
        input.checked = !input.checked
        label.classList.toggle('toggle-switch--on', input.checked)
        showToast('Failed to save: ' + err.message, true)
      } finally {
        label.style.opacity = ''
        _toggleLocks.delete(lockKey)
      }
    })
  })
}

function applyCfToggle(id, settingValue) {
  const label = document.getElementById(id)
  if (!label) return
  const input = label.querySelector('input')
  if (!input) return
  const isOn = settingValue === 'on' || settingValue === true
  input.checked = isOn
  label.classList.toggle('toggle-switch--on', isOn)
}

// ─── Analytics panel ─────────────────────────────────────────────────────────

let _anlRange = '24h'
let _anlChart = null

function _anlPopulateDomainSelect() { return populateMultiDomainSelect('anlDomainSelect') }
function _anlGetSelectedDomains() { return getSelectedDomains('anlDomainSelect') }

function _anlStatusColor(code) {
  if (code >= 200 && code < 300) return 'status-badge--active'
  if (code >= 300 && code < 400) return 'status-badge--pending'
  return 'status-badge--error'
}

async function populateAnalytics() {
  const loading = document.getElementById('anlLoading')
  const content = document.getElementById('anlContent')
  const noDomains = document.getElementById('anlNoDomains')
  const error = document.getElementById('anlError')

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  _anlPopulateDomainSelect()
  const activeDomains = _anlGetSelectedDomains()
  if (!activeDomains.length) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  // Bind domain selector change
  document.getElementById('anlDomainSelect').onchange = () => populateAnalytics()

  // Bind range pills
  document.querySelectorAll('#panelAnalytics .purge-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#panelAnalytics .purge-tab').forEach(b => b.classList.remove('purge-tab--active'))
      btn.classList.add('purge-tab--active')
      _anlRange = btn.dataset.range || '24h'
      populateAnalytics()
    }
  })

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      try {
        const data = await cfProxy(d.id, 'analytics', { since: _anlRange })
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', analytics: data.analytics, message: data.message }
      } catch (err) {
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', analytics: null, message: err.message }
      }
    }))

    loading.hidden = true

    // ── Aggregate totals ──
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
    document.getElementById('anlStats').innerHTML = `
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
    const chartWrap = document.querySelector('#panelAnalytics .anl-chart-wrap')
    if (dates.length > 1 && typeof Chart !== 'undefined') {
      chartWrap.hidden = false
      const reqData = dates.map(d => dailyMap[d].requests)
      const bwData = dates.map(d => dailyMap[d].bytes)
      const labels = dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))

      if (_anlChart) _anlChart.destroy()
      const ctx = document.getElementById('anlChart').getContext('2d')
      _anlChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Requests', data: reqData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.3, pointRadius: 3, yAxisID: 'y' },
            { label: 'Bandwidth', data: bwData, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true, tension: 0.3, pointRadius: 3, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: '#94a3b8', font: { size: 12 } } } },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { position: 'left', ticks: { color: '#3b82f6', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Requests', color: '#3b82f6' } },
            y1: { position: 'right', ticks: { color: '#06b6d4', font: { size: 11 }, callback: v => formatBytes(v) }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Bandwidth', color: '#06b6d4' } }
          }
        }
      })
    } else {
      chartWrap.hidden = true
    }

    // ── Per-domain table ──
    document.getElementById('anlBody').innerHTML = results.map(r => {
      if (!r.analytics) {
        return `<tr><td>${escHtml(r.domain)}</td><td colspan="6" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      }
      const a = r.analytics
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${fmtNum(a.requests_total)}</td><td>${fmtNum(a.requests_cached)}</td><td>${formatBytes(a.bandwidth_total)}</td><td>${a.unique_visitors != null ? fmtNum(a.unique_visitors) : 'N/A'}</td><td>${fmtNum(a.threats_total)}</td><td>${a.cache_hit_rate != null ? a.cache_hit_rate + '%' : 'N/A'}</td></tr>`
    }).join('')

    // ── Top Countries ──
    const countries = Object.entries(countryAgg).map(([c, v]) => ({ country: c, ...v })).sort((a, b) => b.requests - a.requests).slice(0, 15)
    document.getElementById('anlCountries').innerHTML = countries.length
      ? countries.map(c => `<tr><td><strong>${escHtml(c.country)}</strong></td><td>${fmtNum(c.requests)}</td><td>${formatBytes(c.bytes)}</td><td>${fmtNum(c.threats)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="feature-empty">No data</td></tr>'

    // ── HTTP Status Codes ──
    const statuses = Object.entries(statusAgg).map(([s, r]) => ({ status: Number(s), requests: r })).sort((a, b) => b.requests - a.requests)
    document.getElementById('anlStatus').innerHTML = statuses.length
      ? statuses.map(s => {
          const pct = agg.requests > 0 ? ((s.requests / agg.requests) * 100).toFixed(1) : '0'
          return `<tr><td><span class="status-badge ${_anlStatusColor(s.status)}">${s.status}</span></td><td>${fmtNum(s.requests)}</td><td>${pct}%</td></tr>`
        }).join('')
      : '<tr><td colspan="3" class="feature-empty">No data</td></tr>'

    // ── Content Types ──
    const contentTypes = Object.entries(contentAgg).map(([t, v]) => ({ type: t, ...v })).sort((a, b) => b.requests - a.requests).slice(0, 15)
    document.getElementById('anlContentType').innerHTML = contentTypes.length
      ? contentTypes.map(c => `<tr><td>${escHtml(c.type)}</td><td>${fmtNum(c.requests)}</td><td>${formatBytes(c.bytes)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="feature-empty">No data</td></tr>'

    // ── SSL/TLS Versions ──
    const sslVersions = Object.entries(sslAgg).map(([p, r]) => ({ protocol: p, requests: r })).sort((a, b) => b.requests - a.requests)
    document.getElementById('anlSslVersions').innerHTML = sslVersions.length
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

// ─── SSL panel ───────────────────────────────────────────────────────────────

async function populateSslPanel() {
  const loading = document.getElementById('sslLoading')
  const content = document.getElementById('sslContent')
  const noDomains = document.getElementById('sslNoDomains')
  const error = document.getElementById('sslError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  populateMultiDomainSelect('sslDomainSelect')
  const activeDomains = getSelectedDomains('sslDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('sslDomainSelect').onchange = () => { delete _pagState['ssl']; populateSslPanel() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      try {
        const certData = await cfProxy(d.id, 'ssl_certs')
        return { domain: d.domain, provider: d.cdn_provider || 'cloudflare', data: certData }
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
    // Add SSL expiry summary from database
    const sslSummary = document.getElementById('sslExpirySummary')
    if (sslSummary) {
      const summaryCards = activeDomains.filter(d => d.ssl_expires_at).map(d => {
        const daysLeft = Math.round((new Date(d.ssl_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        const color = daysLeft <= 7 ? '#ef4444' : daysLeft <= 14 ? '#f59e0b' : daysLeft <= 30 ? '#3b82f6' : '#22c55e'
        return `<div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;margin:4px">
          <strong>${escHtml(d.domain)}</strong>
          <span style="color:${color};font-weight:700">${daysLeft}d</span>
          <span style="color:#64748b;font-size:12px">${d.ssl_issuer || ''}</span>
        </div>`
      })
      sslSummary.innerHTML = summaryCards.length ? summaryCards.join('') : ''
    }

    _pagInit('ssl', rows)
    _pagRender('ssl', 'sslBody', 'sslPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── DNS panel ───────────────────────────────────────────────────────────────

async function populateDnsPanel() {
  const loading = document.getElementById('dnsLoading')
  const content = document.getElementById('dnsContent')
  const noDomains = document.getElementById('dnsNoDomains')
  const error = document.getElementById('dnsError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  populateMultiDomainSelect('dnsDomainSelect')
  const activeDomains = getSelectedDomains('dnsDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('dnsDomainSelect').onchange = () => { delete _pagState['dns']; populateDnsPanel() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      try {
        const data = await cfProxy(d.id, 'dns_records')
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
        if (!Object.keys(recordMap).length) rows.push(`<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="5" class="feature-empty">No DNS records</td></tr>`)
      }
    }
    _pagInit('dns', rows)
    _pagRender('dns', 'dnsBody', 'dnsPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── Minification panel ──────────────────────────────────────────────────────

async function populateMinifyPanel() {
  const loading = document.getElementById('minifyLoading')
  const content = document.getElementById('minifyContent')
  const noDomains = document.getElementById('minifyNoDomains')
  const error = document.getElementById('minifyError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  populateMultiDomainSelect('minifyDomainSelect')
  const activeDomains = getSelectedDomains('minifyDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('minifyDomainSelect').onchange = () => { delete _pagState['minify']; populateMinifyPanel() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider !== 'cloudflare') return { domain: d.domain, settings: null, message: 'Not available' }
      try {
        const data = await cfProxy(d.id, 'settings')
        return { domain: d.domain, settings: data.settings || {} }
      } catch (err) {
        return { domain: d.domain, settings: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.settings) return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="3" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      const minify = r.settings.minify || { css: 'off', html: 'off', js: 'off' }
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${settingBadge(minify.html)}</td><td>${settingBadge(minify.css)}</td><td>${settingBadge(minify.js)}</td></tr>`
    })
    _pagInit('minify', rows)
    _pagRender('minify', 'minifyBody', 'minifyPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── Image Optimization panel ────────────────────────────────────────────────

async function populateImagesPanel() {
  const loading = document.getElementById('imgLoading')
  const content = document.getElementById('imgContent')
  const noDomains = document.getElementById('imgNoDomains')
  const error = document.getElementById('imgError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  populateMultiDomainSelect('imgDomainSelect')
  const activeDomains = getSelectedDomains('imgDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('imgDomainSelect').onchange = () => { delete _pagState['img']; populateImagesPanel() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider !== 'cloudflare') return { domain: d.domain, settings: null, message: 'Not available' }
      try {
        const data = await cfProxy(d.id, 'settings')
        return { domain: d.domain, settings: data.settings || {} }
      } catch (err) {
        return { domain: d.domain, settings: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.settings) return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="4" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      const s = r.settings
      const polish = s.polish || 'off'
      const polishBadge = `<span class="status-badge ${polish !== 'off' ? 'status-badge--active' : 'status-badge--pending'}">${polish}</span>`
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${settingBadge(s.mirage)}</td><td>${polishBadge}</td><td>${settingBadge(s.webp)}</td><td>${settingBadge(s.rocket_loader)}</td></tr>`
    })
    _pagInit('img', rows)
    _pagRender('img', 'imgBody', 'imgPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── WAF / Firewall panel ────────────────────────────────────────────────────

async function populateWafPanel() {
  const loading = document.getElementById('wafLoading')
  const content = document.getElementById('wafContent')
  const noDomains = document.getElementById('wafNoDomains')
  const error = document.getElementById('wafError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  populateMultiDomainSelect('wafDomainSelect')
  const activeDomains = getSelectedDomains('wafDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('wafDomainSelect').onchange = () => { delete _pagState['waf']; populateWafPanel() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider !== 'cloudflare') return { domain: d.domain, settings: null, message: 'WAF not available' }
      try {
        const data = await cfProxy(d.id, 'settings')
        return { domain: d.domain, settings: data.settings || {} }
      } catch (err) {
        return { domain: d.domain, settings: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.settings) return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="4" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      const s = r.settings
      const level = s.security_level || 'medium'
      const levelCls = level === 'high' || level === 'under_attack' ? 'status-badge--error' : 'status-badge--active'
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td><span class="status-badge ${levelCls}">${level.charAt(0).toUpperCase() + level.slice(1)}</span></td><td>${settingBadge(s.browser_check)}</td><td>${settingBadge(s.email_obfuscation)}</td><td>${settingBadge(s.hotlink_protection)}</td></tr>`
    })
    _pagInit('waf', rows)
    _pagRender('waf', 'wafBody', 'wafPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── DDoS panel ──────────────────────────────────────────────────────────────

async function populateDdosPanel() {
  const loading = document.getElementById('ddosLoading')
  const content = document.getElementById('ddosContent')
  const noDomains = document.getElementById('ddosNoDomains')
  const error = document.getElementById('ddosError')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true; error.hidden = true

  populateMultiDomainSelect('ddosDomainSelect')
  const activeDomains = getSelectedDomains('ddosDomainSelect')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  document.getElementById('ddosDomainSelect').onchange = () => { delete _pagState['ddos']; populateDdosPanel() }

  try {
    const results = await Promise.all(activeDomains.map(async (d) => {
      const provider = d.cdn_provider || 'cloudflare'
      if (provider === 'none') return { domain: d.domain, analytics: null, message: 'Not available' }
      try {
        const data = await cfProxy(d.id, 'analytics', { since: '30d' })
        return { domain: d.domain, analytics: data.analytics, message: data.message }
      } catch (err) {
        return { domain: d.domain, analytics: null, message: err.message }
      }
    }))

    loading.hidden = true
    const rows = results.map(r => {
      if (!r.analytics) return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td colspan="3" class="feature-empty">${escHtml(r.message || 'No data')}</td></tr>`
      const a = r.analytics
      return `<tr><td><strong>${escHtml(r.domain)}</strong></td><td>${fmtNum(a.threats_total)}</td><td>${fmtNum(a.requests_total)}</td><td>${formatBytes(a.bandwidth_total)}</td></tr>`
    })
    _pagInit('ddos', rows)
    _pagRender('ddos', 'ddosBody', 'ddosPagination')
    content.hidden = false
  } catch (err) {
    loading.hidden = true
    error.textContent = err.message
    error.hidden = false
  }
}

// ─── Uptime panel ────────────────────────────────────────────────────────────

async function populateUptimePanel() {
  const loading = document.getElementById('uptimeLoading')
  const content = document.getElementById('uptimeContent')
  const noDomains = document.getElementById('uptimeNoDomains')

  loading.hidden = false; content.hidden = true; noDomains.hidden = true

  const activeDomains = userDomains.filter(d => d.status === 'active')
  if (!activeDomains.length) { loading.hidden = true; noDomains.hidden = false; return }

  // Determine period
  const periodSelect = document.getElementById('uptimePeriodSelect')
  const period = periodSelect ? periodSelect.value : '24h'
  const periodMs = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
  const since = new Date(Date.now() - (periodMs[period] || 86400000)).toISOString()

  // Fetch live checks + stored history in parallel
  const results = await Promise.all(activeDomains.map(async (d) => {
    try {
      // Live check
      const liveData = await cfProxy(d.id, 'uptime_check')
      // Historical data from Supabase
      const { data: checks } = await _supabase
        .from('uptime_checks')
        .select('status, latency_ms, checked_at')
        .eq('domain_id', d.id)
        .gte('checked_at', since)
        .order('checked_at', { ascending: false })
      // Downtime incidents
      const { data: incidents } = await _supabase
        .from('downtime_incidents')
        .select('started_at, ended_at, duration_seconds')
        .eq('domain_id', d.id)
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(10)
      return { domain: d.domain, domainId: d.id, live: liveData.checks || [], checks: checks || [], incidents: incidents || [] }
    } catch {
      return { domain: d.domain, domainId: d.id, live: [], checks: [], incidents: [] }
    }
  }))

  loading.hidden = true
  content.hidden = false

  // Bind period selector
  if (periodSelect) periodSelect.onchange = () => { delete _pagState['uptime']; populateUptimePanel() }

  const checkMark = (ok) => ok ? '<span style="color:#22c55e">&#10003;</span>' : '<span style="color:#ef4444">&#10007;</span>'
  const rows = results.map(r => {
    const httpsCheck = r.live.find(c => c.url?.startsWith('https'))
    const httpCheck = r.live.find(c => c.url?.startsWith('http://'))
    const mainCheck = httpsCheck || httpCheck || {}
    const isUp = mainCheck.ok
    const statusBadge = isUp
      ? '<span class="status-badge status-badge--active">UP</span>'
      : '<span class="status-badge status-badge--error">DOWN</span>'
    const latencyText = mainCheck.latency != null ? `${mainCheck.latency}ms` : '--'

    // Uptime percentage from historical data
    const totalChecks = r.checks.length
    const upChecks = r.checks.filter(c => c.status === 'up').length
    const uptimePct = totalChecks > 0 ? ((upChecks / totalChecks) * 100).toFixed(2) : 'N/A'
    const uptimeColor = uptimePct === 'N/A' ? '#94a3b8' : parseFloat(uptimePct) >= 99.9 ? '#22c55e' : parseFloat(uptimePct) >= 99 ? '#f59e0b' : '#ef4444'

    // Average latency from history
    const latencies = r.checks.filter(c => c.latency_ms).map(c => c.latency_ms)
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null

    // Incidents count
    const incidentCount = r.incidents.length

    return `<tr>
      <td><strong>${escHtml(r.domain)}</strong></td>
      <td>${statusBadge}</td>
      <td>${checkMark(httpsCheck?.ok)}</td>
      <td>${checkMark(httpCheck?.ok)}</td>
      <td><strong>${latencyText}</strong></td>
      <td><strong style="color:${uptimeColor}">${uptimePct}%</strong></td>
      <td>${avgLatency ? avgLatency + 'ms' : '--'}</td>
      <td>${incidentCount > 0 ? `<span style="color:#ef4444;font-weight:600">${incidentCount}</span>` : '<span style="color:#22c55e">0</span>'}</td>
    </tr>`
  })
  _pagInit('uptime', rows)
  _pagRender('uptime', 'uptimeBody', 'uptimePagination')

  const refreshBtn = document.getElementById('uptimeRefreshBtn')
  if (refreshBtn) refreshBtn.onclick = () => populateUptimePanel()
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
    .select('id, domain, status, admin_notes, last_purged_at, auto_purge_enabled, auto_purge_interval, created_at, cdn_provider')
    .order('created_at', { ascending: false })

  loading.hidden = true

  if (error) {
    list.innerHTML = `<div class="dash-alert dash-alert--error">Failed to load domains. Please try again or contact support.</div>`
    console.error('Load domains error:', error)
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
          ${d.cdn_provider && d.cdn_provider !== 'cloudflare' ? `<span class="status-badge" style="font-size:0.65rem;padding:2px 6px;background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${escHtml(d.cdn_provider)}</span>` : ''}
        </div>
        <span class="domain-card__meta">
          Submitted ${formatDate(d.created_at)}
          ${d.last_purged_at ? ` · Last purged ${formatDate(d.last_purged_at)}` : ''}
        </span>
        ${d.status === 'rejected' && d.admin_notes ? `<span class="domain-card__note">Note: ${escHtml(d.admin_notes)}</span>` : ''}
        ${d.status === 'rejected' ? '<span class="domain-card__hint">Remove this domain and re-submit to try again.</span>' : ''}
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

  const isSelfManaged = document.querySelector('input[name="setupMode"][value="self"]')?.checked

  // Validate self-managed fields
  if (isSelfManaged) {
    const provider = document.getElementById('inputCdnProvider')?.value || 'cloudflare'

    if (provider === 'cloudflare') {
      const zoneId = document.getElementById('inputZoneId').value.trim()
      const apiToken = document.getElementById('inputApiToken').value.trim()
      if (!zoneId || !apiToken) {
        errEl.textContent = 'Please provide both your Cloudflare Zone ID and API Token.'
        errEl.hidden = false
        return
      }
    } else if (provider === 'cloudfront') {
      const distId = document.getElementById('inputDistributionId').value.trim()
      const apiKey = document.getElementById('inputCdnApiKey').value.trim()
      if (!distId || !apiKey) {
        errEl.textContent = 'Please provide both your CloudFront Distribution ID and AWS Access Key.'
        errEl.hidden = false
        return
      }
    } else if (provider === 'fastly') {
      const svcId = document.getElementById('inputDistributionId').value.trim()
      const apiKey = document.getElementById('inputCdnApiKey').value.trim()
      if (!svcId || !apiKey) {
        errEl.textContent = 'Please provide both your Fastly Service ID and API Token.'
        errEl.hidden = false
        return
      }
    }
    // 'none' requires no credentials
  }

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span> Submitting...'

  const defaults = loadUserSettings()
  const insertData = {
    user_id: currentUser.id,
    domain: scannedDomain,
    status: isSelfManaged ? 'active' : 'pending',
    auto_purge_enabled: defaults.defaultAutoPurge || false,
    auto_purge_interval: parseInt(defaults.defaultPurgeInterval) || 43200,
  }

  // Collect CDN credentials separately — they'll be encrypted server-side
  let cdnCredentials = null
  if (isSelfManaged) {
    const provider = document.getElementById('inputCdnProvider')?.value || 'cloudflare'
    insertData.cdn_provider = provider

    if (provider === 'cloudflare') {
      insertData.cloudflare_zone_id = document.getElementById('inputZoneId').value.trim()
      cdnCredentials = { field: 'cloudflare_api_token', value: document.getElementById('inputApiToken').value.trim() }
    } else if (provider === 'cloudfront' || provider === 'fastly') {
      insertData.cdn_distribution_id = document.getElementById('inputDistributionId').value.trim()
      cdnCredentials = { field: 'cdn_api_key', value: document.getElementById('inputCdnApiKey').value.trim() }
    }
    // 'none' = monitoring only, no credentials needed
  }

  const { data: inserted, error } = await _supabase.from('user_domains').insert(insertData).select('id').single()

  // Encrypt CDN credentials server-side after insert
  if (!error && inserted && cdnCredentials) {
    const session = await getSession()
    if (session) {
      await fetch(`${SUPABASE_URL}/functions/v1/encrypt-credentials/encrypt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain_id: inserted.id, ...cdnCredentials }),
      }).catch(console.error)
    }
  }

  btn.disabled = false
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Submit Domain'

  if (error) {
    errEl.textContent = error.message.includes('unique') ? `${scannedDomain} is already submitted.` : error.message
    errEl.hidden = false
    return
  }

  const successMsg = isSelfManaged
    ? `<strong>${escHtml(scannedDomain)}</strong> is now <span class="status-badge status-badge--active" style="display:inline-flex;vertical-align:middle;margin:0 4px">active</span>! All panels are pulling live data from your Cloudflare account.`
    : `<strong>${escHtml(scannedDomain)}</strong> submitted! Our team will set it up and you'll see it go <span class="status-badge status-badge--active" style="display:inline-flex;vertical-align:middle;margin:0 4px">active</span> once ready.`
  successEl.innerHTML = successMsg
  successEl.hidden = false

  // Hide the submit button row after success
  btn.hidden = true

  // Reset forms
  document.getElementById('addDomainForm').reset()
  document.getElementById('inputZoneId').value = ''
  document.getElementById('inputApiToken').value = ''
  const distIdEl = document.getElementById('inputDistributionId')
  const cdnKeyEl = document.getElementById('inputCdnApiKey')
  if (distIdEl) distIdEl.value = ''
  if (cdnKeyEl) cdnKeyEl.value = ''
  const provSelect = document.getElementById('inputCdnProvider')
  if (provSelect) provSelect.value = 'cloudflare'
  document.getElementById('selfManagedFields').hidden = true
  document.getElementById('optManaged').classList.add('setup-mode-option--active')
  document.getElementById('optSelfManaged').classList.remove('setup-mode-option--active')
  // Reset provider credential fields visibility
  const cfFields = document.getElementById('cfCredentialFields')
  const genericFields = document.getElementById('genericCredentialFields')
  const noneMsg = document.getElementById('noneProviderMsg')
  if (cfFields) cfFields.hidden = false
  if (genericFields) genericFields.hidden = true
  if (noneMsg) noneMsg.hidden = true
  scannedDomain = null

  await loadDomains()
}

function showAddError(msg) {
  const el = document.getElementById('addDomainError')
  el.textContent = msg
  el.hidden = false
}

// ─── Overview Sections ────────────────────────────────────────────────────

async function loadOverviewSections() {
  updateHeroSub()
  renderAccountSummary()
  renderQuickStats()
  renderChecklist()
  initQuickActions()
  await loadActivityFeed()
}

function updateHeroSub() {
  const el = document.getElementById('heroSub')
  if (!el) return
  const active = userDomains.filter(d => d.status === 'active').length
  const pending = userDomains.filter(d => d.status === 'pending').length
  if (active > 0 && pending > 0) {
    el.textContent = `You have ${active} active domain${active > 1 ? 's' : ''} and ${pending} pending approval. Monitor performance across all your sites.`
  } else if (active > 0) {
    el.textContent = `You have ${active} active domain${active > 1 ? 's' : ''}. Monitor performance, manage cache, and track uptime in real time.`
  } else if (pending > 0) {
    el.textContent = `You have ${pending} domain${pending > 1 ? 's' : ''} pending approval. We'll set them up and notify you once ready.`
  } else {
    el.textContent = 'Submit your domain and we\'ll handle the technical setup for you. Track your website\'s cache status in real time.'
  }
}

function renderAccountSummary() {
  const plan = currentProfile?.plan || 'none'
  const payment = currentProfile?.payment_status || 'unpaid'

  const badge = document.getElementById('summaryPlanBadge')
  if (badge) {
    badge.textContent = plan
    badge.className = `plan-badge plan-badge--${plan}`
  }

  const paymentEl = document.getElementById('summaryPayment')
  if (paymentEl) {
    paymentEl.innerHTML = `<span class="payment-badge payment-badge--${payment}">${payment}</span>`
  }

  const usageEl = document.getElementById('summaryDomainUsage')
  if (usageEl) {
    const limit = PLAN_LIMITS[plan] || 1
    usageEl.textContent = limit === Infinity ? `${userDomains.length} / Unlimited` : `${userDomains.length} / ${limit}`
  }

  const sinceEl = document.getElementById('summaryMemberSince')
  if (sinceEl) sinceEl.textContent = formatDate(currentProfile?.created_at)

  const upgradeBtn = document.getElementById('upgradeBtn')
  if (upgradeBtn && (plan === 'none' || plan === 'starter')) {
    upgradeBtn.hidden = false
    upgradeBtn.addEventListener('click', () => {
      showToast('Contact us at hello@luzerge.com to upgrade your plan')
    })
  }
}

function renderQuickStats() {
  const activeDomains = userDomains.filter(d => d.status === 'active')

  // Last purge
  const lastPurged = userDomains
    .map(d => d.last_purged_at)
    .filter(Boolean)
    .sort()
    .pop()
  document.getElementById('qsLastPurge').textContent = timeAgo(lastPurged)

  // Active domains count
  document.getElementById('qsActiveDomains').textContent = activeDomains.length

  // Purges this month — fetch count
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // Fetch purge count for this month across all user's domains
  const domainIds = userDomains.map(d => d.id)
  if (domainIds.length) {
    _supabase
      .from('cache_purge_history')
      .select('id', { count: 'exact', head: true })
      .in('domain_id', domainIds)
      .gte('created_at', startOfMonth.toISOString())
      .then(({ count }) => {
        document.getElementById('qsPurgesMonth').textContent = count || 0
      })
  } else {
    document.getElementById('qsPurgesMonth').textContent = '0'
  }

  // Cache hit rate — fetch from domain-stats for active domains
  if (activeDomains.length) {
    fetchAverageCacheRate(activeDomains)
  } else {
    document.getElementById('qsCacheHitRate').textContent = 'N/A'
  }
}

async function fetchAverageCacheRate(activeDomains) {
  const session = await getSession()
  if (!session) return

  let totalRate = 0
  let count = 0

  const promises = activeDomains.slice(0, 5).map(async (d) => {
    try {
      const res = await fetch(`${EDGE_BASE}/domain-stats?domain_id=${d.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.cf_analytics?.cache_hit_rate != null) {
        totalRate += data.cf_analytics.cache_hit_rate
        count++
      }
    } catch {}
  })

  await Promise.all(promises)

  const el = document.getElementById('qsCacheHitRate')
  el.textContent = count > 0 ? `${Math.round(totalRate / count)}%` : 'N/A'
}

function renderChecklist() {
  const steps = [
    { label: 'Submit your first domain', done: userDomains.length > 0 },
    { label: 'Get a domain approved', done: userDomains.some(d => d.status === 'active') },
    { label: 'Purge cache for the first time', done: userDomains.some(d => d.last_purged_at) },
    { label: 'Enable auto-purge on a domain', done: userDomains.some(d => d.auto_purge_enabled) },
  ]

  const completed = steps.filter(s => s.done).length
  document.getElementById('checklistProgress').textContent = `${completed} / ${steps.length}`

  const container = document.getElementById('checklist')
  container.innerHTML = steps.map(s => `
    <div class="checklist-item checklist-item--${s.done ? 'done' : 'pending'}">
      <span class="checklist-item__icon">${s.done ? '&#10003;' : '&#9675;'}</span>
      <span class="checklist-item__text">${s.label}</span>
    </div>
  `).join('')

  // Hide if all complete
  if (completed === steps.length) {
    document.getElementById('gettingStartedPanel').hidden = true
  }
}

function initQuickActions() {
  const activeDomains = userDomains.filter(d => d.status === 'active')

  // Purge All
  const purgeAllBtn = document.getElementById('purgeAllDomainsBtn')
  if (!activeDomains.length) {
    purgeAllBtn.disabled = true
    purgeAllBtn.title = 'No active domains to purge'
  }
  purgeAllBtn.addEventListener('click', async () => {
    if (!activeDomains.length) return
    if (!confirm(`Purge cache for all ${activeDomains.length} active domain(s)?`)) return

    purgeAllBtn.disabled = true
    purgeAllBtn.innerHTML = '<span class="btn-spinner"></span> Purging...'

    const session = await getSession()
    let success = 0
    for (const d of activeDomains) {
      try {
        const res = await fetch(`${EDGE_BASE}/purge-cache`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ domain_id: d.id, purge_type: 'everything' }),
        })
        const data = await res.json()
        if (data.success) success++
      } catch {}
    }

    purgeAllBtn.disabled = false
    purgeAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Purge All Domains'
    showToast(`Purged ${success} of ${activeDomains.length} domain(s)`)
    await loadDomains()
    renderQuickStats()
  })

  // Toggle All Auto-Purge
  const toggleBtn = document.getElementById('toggleAllAutoPurgeBtn')
  const allOn = activeDomains.length > 0 && activeDomains.every(d => d.auto_purge_enabled)
  if (allOn) {
    toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Disable Auto-Purge on All'
  }
  if (!activeDomains.length) {
    toggleBtn.disabled = true
    toggleBtn.title = 'No active domains'
  }
  toggleBtn.addEventListener('click', async () => {
    if (!activeDomains.length) return
    const enabling = !activeDomains.every(d => d.auto_purge_enabled)

    toggleBtn.disabled = true
    for (const d of activeDomains) {
      await _supabase.from('user_domains').update({ auto_purge_enabled: enabling }).eq('id', d.id)
    }
    toggleBtn.disabled = false

    showToast(enabling ? 'Auto-purge enabled on all domains' : 'Auto-purge disabled on all domains')
    await loadDomains()
    renderChecklist()
    toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${enabling ? 'Disable' : 'Enable'} Auto-Purge on All`
  })
}

async function loadActivityFeed() {
  const feedEl = document.getElementById('activityFeed')
  const loadingEl = document.getElementById('activityFeedLoading')
  const emptyEl = document.getElementById('activityFeedEmpty')

  const domainIds = userDomains.map(d => d.id)
  if (!domainIds.length) {
    loadingEl.hidden = true
    emptyEl.hidden = false
    return
  }

  const { data: history, error } = await _supabase
    .from('cache_purge_history')
    .select('id, purge_type, urls_purged, success, created_at, domain_id')
    .in('domain_id', domainIds)
    .order('created_at', { ascending: false })
    .limit(10)

  loadingEl.hidden = true

  if (error) {
    emptyEl.textContent = 'Failed to load activity feed'
    emptyEl.hidden = false
    return
  }

  if (!history?.length) {
    emptyEl.textContent = 'No recent activity yet'
    emptyEl.hidden = false
    return
  }

  // Map domain IDs to names
  const domainMap = {}
  userDomains.forEach(d => { domainMap[d.id] = d.domain })

  feedEl.hidden = false
  feedEl.innerHTML = history.map(h => {
    const domain = domainMap[h.domain_id] || 'Unknown'
    const typeLabel = h.purge_type === 'everything'
      ? 'Purged <strong>everything</strong>'
      : h.purge_type === 'auto'
        ? '<strong>Auto-purged</strong> cache'
        : `Purged <strong>${(h.urls_purged || []).length} URL(s)</strong>`
    return `
      <div class="activity-item">
        <div class="activity-item__dot activity-item__dot--${h.success ? 'success' : 'error'}"></div>
        <div class="activity-item__content">
          <span class="activity-item__text">${typeLabel} on <strong>${escHtml(domain)}</strong></span>
          <span class="activity-item__time">${timeAgo(h.created_at)} &middot; ${formatDate(h.created_at)}</span>
        </div>
      </div>
    `
  }).join('')
}

function timeAgo(iso) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
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
  // Reset setup mode to managed
  document.getElementById('selfManagedFields').hidden = true
  document.getElementById('optManaged').classList.add('setup-mode-option--active')
  document.getElementById('optSelfManaged').classList.remove('setup-mode-option--active')
  const managedRadio = document.querySelector('input[name="setupMode"][value="managed"]')
  if (managedRadio) managedRadio.checked = true

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
    .select('domain, auto_purge_enabled, auto_purge_interval, cdn_provider, cloudflare_zone_id, cloudflare_api_token, cdn_distribution_id, cdn_api_key, uptime_check_enabled, uptime_check_interval, public_status_enabled, public_status_token')
    .eq('id', domainId)
    .single()

  if (domain) {
    document.getElementById('detailTitle').textContent = domain.domain
    renderAutoPurgeSettings(domainId, domain.auto_purge_enabled, domain.auto_purge_interval)
    populateDomainSettings(domain)
  }

  await loadStats(domainId)
}

function closeDetail() {
  document.getElementById('detailPanel').hidden = true
  selectedDomainId = null
}

// ─── Domain Settings (detail panel) ──────────────────────────────────────────

function populateDomainSettings(domain) {
  const provider = domain.cdn_provider || 'cloudflare'
  const providerEl = document.getElementById('detailCdnProvider')
  providerEl.value = provider
  toggleCdnProviderFields(provider)

  // Cloudflare fields
  document.getElementById('detailZoneId').value = domain.cloudflare_zone_id || ''
  document.getElementById('detailApiToken').value = domain.cloudflare_api_token || ''

  // Generic CDN fields
  document.getElementById('detailDistId').value = domain.cdn_distribution_id || ''
  document.getElementById('detailApiKey').value = domain.cdn_api_key || ''

  // Uptime monitoring
  document.getElementById('detailUptimeEnabled').checked = domain.uptime_check_enabled !== false
  document.getElementById('detailUptimeInterval').value = domain.uptime_check_interval || '5min'

  // Public status page
  const statusEnabled = !!domain.public_status_enabled
  document.getElementById('detailStatusEnabled').checked = statusEnabled
  const statusUrlDiv = document.getElementById('detailStatusUrl')
  statusUrlDiv.hidden = !statusEnabled
  if (domain.public_status_token) {
    document.getElementById('detailStatusLink').value =
      `${window.location.origin}/status.html?token=${domain.public_status_token}`
  }

  // Reset save status
  document.getElementById('detailSettingsStatus').hidden = true
}

function toggleCdnProviderFields(provider) {
  const cfFields = document.getElementById('detailCfFields')
  const genericFields = document.getElementById('detailGenericFields')
  const distLabel = document.getElementById('detailDistLabel')
  const apiLabel = document.getElementById('detailApiKeyLabel')

  if (provider === 'cloudflare') {
    cfFields.hidden = false
    genericFields.hidden = true
  } else if (provider === 'none') {
    cfFields.hidden = true
    genericFields.hidden = true
  } else {
    cfFields.hidden = true
    genericFields.hidden = false
    if (provider === 'cloudfront') {
      distLabel.textContent = 'Distribution ID'
      apiLabel.textContent = 'AWS Access Key'
    } else if (provider === 'fastly') {
      distLabel.textContent = 'Service ID'
      apiLabel.textContent = 'API Token'
    }
  }
}

function initDomainSettingsHandlers() {
  // CDN provider change
  document.getElementById('detailCdnProvider')?.addEventListener('change', (e) => {
    toggleCdnProviderFields(e.target.value)
  })

  // Status page toggle
  document.getElementById('detailStatusEnabled')?.addEventListener('change', (e) => {
    document.getElementById('detailStatusUrl').hidden = !e.target.checked
  })

  // Copy status URL
  document.getElementById('detailCopyStatusBtn')?.addEventListener('click', () => {
    const link = document.getElementById('detailStatusLink')
    navigator.clipboard.writeText(link.value).then(() => {
      const btn = document.getElementById('detailCopyStatusBtn')
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.textContent = 'Copy' }, 2000)
    })
  })

  // Save domain settings
  document.getElementById('detailSettingsSaveBtn')?.addEventListener('click', saveDomainSettings)
}

async function saveDomainSettings() {
  if (!selectedDomainId) return

  const btn = document.getElementById('detailSettingsSaveBtn')
  const statusEl = document.getElementById('detailSettingsStatus')
  btn.disabled = true
  btn.textContent = 'Saving…'
  statusEl.hidden = true

  const provider = document.getElementById('detailCdnProvider').value

  const updates = {
    cdn_provider: provider,
    uptime_check_enabled: document.getElementById('detailUptimeEnabled').checked,
    uptime_check_interval: document.getElementById('detailUptimeInterval').value,
    public_status_enabled: document.getElementById('detailStatusEnabled').checked,
  }

  // CDN credential fields — credentials go through server-side encryption
  let credentialToEncrypt = null
  if (provider === 'cloudflare') {
    updates.cloudflare_zone_id = document.getElementById('detailZoneId').value.trim() || null
    const apiToken = document.getElementById('detailApiToken').value.trim()
    if (apiToken) {
      credentialToEncrypt = { field: 'cloudflare_api_token', value: apiToken }
    }
  } else if (provider !== 'none') {
    updates.cdn_distribution_id = document.getElementById('detailDistId').value.trim() || null
    const apiKey = document.getElementById('detailApiKey').value.trim()
    if (apiKey) {
      credentialToEncrypt = { field: 'cdn_api_key', value: apiKey }
    }
  }

  const { error } = await _supabase
    .from('user_domains')
    .update(updates)
    .eq('id', selectedDomainId)

  // Encrypt credentials server-side
  if (!error && credentialToEncrypt) {
    const session = await getSession()
    if (session) {
      await fetch(`${SUPABASE_URL}/functions/v1/encrypt-credentials/encrypt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain_id: selectedDomainId, ...credentialToEncrypt }),
      }).catch(console.error)
    }
  }

  btn.disabled = false
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Domain Settings'

  if (error) {
    statusEl.style.color = '#ef4444'
    statusEl.textContent = 'Failed to save settings. Please try again.'
    console.error('Save settings error:', error)
  } else {
    statusEl.style.color = '#22c55e'
    statusEl.textContent = 'Settings saved!'
  }
  statusEl.hidden = false
  setTimeout(() => { statusEl.hidden = true }, 4000)
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
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
  })

  if (!res.ok) {
    ;['statRequests','statCacheRate','statThreats','statPurges'].forEach(id => {
      document.getElementById(id).textContent = '—'
    })
    document.getElementById('historyLoading').hidden = true
    const emptyEl = document.getElementById('historyEmpty')
    emptyEl.textContent = 'Failed to load stats'
    emptyEl.hidden = false
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
      apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
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
  if (!confirm(`Purge all cached files for ${domainName}?`)) return
  const origHtml = btn.innerHTML

  btn.disabled = true
  btn.innerHTML = '<span class="btn-spinner"></span>'

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
    showToast(`Cache purged for ${domainName}`)
    setTimeout(() => { btn.innerHTML = origHtml }, 2000)
    await loadDomains()
  } else {
    btn.innerHTML = origHtml
    showToast('Purge failed — check Cloudflare config', true)
  }
}

// ─── Auto-Purge Toggle ──────────────────────────────────────────────────────

async function handleAutoPurgeToggle(domainId, enabled) {
  const { error } = await _supabase
    .from('user_domains')
    .update({ auto_purge_enabled: enabled })
    .eq('id', domainId)

  if (error) {
    showToast('Failed to update auto-purge', true)
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
    showToast('Failed to update schedule', true)
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

// ─── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'luzerge_user_settings'

function loadUserSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch { return {} }
}

function saveUserSettings(data) {
  const existing = loadUserSettings()
  Object.assign(existing, data)
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(existing))
}

function populateProfileSettings() {
  const el = (id) => document.getElementById(id)
  el('settFullName').value = currentProfile?.full_name || ''
  el('settEmail').value = currentProfile?.email || currentUser?.email || ''
  el('settAvatar').value = currentProfile?.avatar_url || ''
  el('settNewPassword').value = ''
  el('settConfirmPassword').value = ''
  updateAvatarPreview(currentProfile?.avatar_url)
}

function updateAvatarPreview(url) {
  const preview = document.getElementById('settAvatarPreview')
  if (!preview) return
  if (url && url.trim()) {
    const img = document.createElement('img')
    img.src = url.trim()
    img.alt = 'Avatar'
    img.onerror = () => { preview.innerHTML = '<span class="settings-avatar-preview__placeholder">Invalid</span>' }
    preview.innerHTML = ''
    preview.appendChild(img)
  } else {
    preview.innerHTML = '<span class="settings-avatar-preview__placeholder">No preview</span>'
  }
}

async function populatePlanSettings() {
  const plan = currentProfile?.plan || 'none'
  const paymentStatus = currentProfile?.payment_status || 'unpaid'
  const planName = plan === 'none' ? 'Free' : plan.charAt(0).toUpperCase() + plan.slice(1)
  const el = (id) => document.getElementById(id)

  const statusLabels = {
    unpaid: '', paid: '', pending: ' (Pending Payment)',
    overdue: ' (Overdue)', trial: ' (Free Trial)', cancelled: ' (Cancelled)',
  }
  el('settPlanName').textContent = planName + (statusLabels[paymentStatus] || '')
  el('settPlanPrice').textContent = PLAN_PRICES[plan] || '₱0/mo'

  const domainCount = userDomains.length
  const limit = PLAN_LIMITS[plan] || 1
  el('settDomainsUsed').textContent = `${domainCount} / ${limit === Infinity ? '∞' : limit}`

  el('settMemberSince').textContent = formatDate(currentUser?.created_at)
  el('settBillingCycle').textContent = plan === 'none' ? 'N/A' : paymentStatus === 'pending' ? 'Awaiting payment' : 'Monthly'

  // Highlight current plan
  document.querySelectorAll('.plan-option').forEach(opt => {
    opt.classList.toggle('plan-option--current', opt.dataset.plan === plan)
  })

  // Fetch subscription status and payment history
  try {
    const session = await getSession()
    if (!session) return

    const res = await fetch(`${EDGE_BASE}/paymongo-checkout/status`, {
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY },
    })
    if (!res.ok) return

    const { subscription, payments } = await res.json()

    // Show subscription info
    const subInfo = el('settSubscriptionInfo')
    const subStatus = el('settSubStatus')
    const renewBtn = el('settRenewBtn')
    const cancelBtn = el('settCancelSubBtn')

    if (subscription) {
      subInfo.style.display = 'block'
      const statusColors = { trial: 'on', active: 'on', past_due: 'off', cancelled: 'off' }
      const statusTexts = { trial: 'Trial', active: 'Active', past_due: 'Past Due', cancelled: 'Cancelled' }
      subStatus.textContent = statusTexts[subscription.status] || subscription.status
      subStatus.className = `settings-badge settings-badge--${statusColors[subscription.status] || 'off'}`

      el('settNextBilling').textContent = subscription.current_period_end
        ? new Date(subscription.current_period_end).toLocaleDateString() : '—'

      const trialEl = el('settTrialEnds')
      if (subscription.trial_ends_at) {
        trialEl.textContent = new Date(subscription.trial_ends_at).toLocaleDateString()
        trialEl.parentElement.style.display = ''
      } else {
        trialEl.parentElement.style.display = 'none'
      }

      // Show renew button for past_due or overdue
      renewBtn.style.display = subscription.status === 'past_due' ? '' : 'none'
      // Show cancel button for trial or active
      cancelBtn.style.display = (subscription.status === 'trial' || subscription.status === 'active') ? '' : 'none'

      el('settBillingCycle').textContent = subscription.status === 'trial' ? 'Free trial' :
        subscription.status === 'active' ? 'Monthly' : subscription.status === 'past_due' ? 'Payment required' : 'Cancelled'
    } else {
      subInfo.style.display = 'none'
    }

    // Populate payment history
    const paymentTable = el('settPaymentTable')
    const paymentRows = el('settPaymentRows')
    const paymentEmpty = el('settPaymentEmpty')

    if (payments && payments.length > 0) {
      paymentTable.style.display = 'table'
      paymentEmpty.style.display = 'none'
      paymentRows.innerHTML = payments.map(p => {
        const amt = (p.amount_cents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
        const date = new Date(p.created_at).toLocaleDateString()
        const pName = p.plan.charAt(0).toUpperCase() + p.plan.slice(1)
        const method = (p.payment_method || '—').replace('paymaya', 'Maya').replace('gcash', 'GCash').replace('grab_pay', 'GrabPay').replace('card', 'Card')
        const statusColor = p.status === 'paid' ? '#10b981' : p.status === 'failed' ? '#ef4444' : '#f59e0b'
        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:0.5rem;">${date}</td>
          <td style="padding:0.5rem;">${pName}</td>
          <td style="padding:0.5rem;">${amt}</td>
          <td style="padding:0.5rem;">${method}</td>
          <td style="padding:0.5rem;"><span style="color:${statusColor};">${p.status}</span></td>
        </tr>`
      }).join('')
    } else {
      paymentTable.style.display = 'none'
      paymentEmpty.style.display = ''
    }
  } catch (e) {
    console.warn('Failed to load subscription info:', e)
  }
}

async function populateSecuritySettings() {
  const el = (id) => document.getElementById(id)
  el('settLastLogin').textContent = formatDate(currentUser?.last_sign_in_at)
  el('settAccountCreated').textContent = formatDate(currentUser?.created_at)

  // Detect browser
  const ua = navigator.userAgent
  let browser = 'Unknown Browser'
  if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Edg/')) browser = 'Microsoft Edge'
  else if (ua.includes('Chrome')) browser = 'Google Chrome'
  else if (ua.includes('Safari')) browser = 'Safari'
  el('settCurrentDevice').textContent = browser + ' on ' + navigator.platform
  el('settCurrentMeta').textContent = 'Current session · last active now'

  // Check 2FA status
  const factors = await _supabase.auth.mfa.listFactors()
  const has2fa = (factors.data?.totp || []).some(f => f.status === 'verified')
  update2faUI(has2fa)

  // Load API tokens
  await loadApiTokens()
}

function update2faUI(enabled) {
  const statusEl = document.getElementById('sett2faStatus')
  const btn = document.getElementById('sett2faToggle')
  if (statusEl) {
    statusEl.textContent = enabled ? 'Enabled' : 'Disabled'
    statusEl.className = `settings-badge settings-badge--${enabled ? 'on' : 'off'}`
  }
  if (btn) btn.textContent = enabled ? 'Disable 2FA' : 'Enable 2FA'
}

async function populateNotifSettings() {
  const el = (id) => document.getElementById(id)
  // Try loading from database first, fallback to localStorage
  try {
    const { data } = await _supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', currentUser.id)
      .single()
    if (data) {
      el('settNotifDowntime').checked = data.notify_downtime
      el('settNotifSsl').checked = data.notify_ssl_expiry
      if (el('settNotifWeekly')) el('settNotifWeekly').checked = data.notify_weekly_report
      if (data.alert_email) el('settNotifEmail').value = data.alert_email
      // Keep other toggles from localStorage
      const s = loadUserSettings()
      if (s.notifDdos != null) el('settNotifDdos').checked = s.notifDdos
      if (s.notifPurge != null) el('settNotifPurge').checked = s.notifPurge
      if (s.notifStatus != null) el('settNotifStatus').checked = s.notifStatus
      return
    }
  } catch { /* fallback to localStorage */ }
  const s = loadUserSettings()
  if (s.notifDowntime != null) el('settNotifDowntime').checked = s.notifDowntime
  if (s.notifSsl != null) el('settNotifSsl').checked = s.notifSsl
  if (s.notifDdos != null) el('settNotifDdos').checked = s.notifDdos
  if (s.notifPurge != null) el('settNotifPurge').checked = s.notifPurge
  if (s.notifStatus != null) el('settNotifStatus').checked = s.notifStatus
  if (s.notifEmail) el('settNotifEmail').value = s.notifEmail
}

function populateDomainDefaults() {
  const s = loadUserSettings()
  const el = (id) => document.getElementById(id)
  if (s.defaultAutoPurge != null) el('settDefaultAutoPurge').checked = s.defaultAutoPurge
  if (s.defaultPurgeInterval) el('settDefaultPurgeInterval').value = s.defaultPurgeInterval
  if (s.defaultProvider) el('settDefaultProvider').value = s.defaultProvider
  if (s.defaultTTL) el('settDefaultTTL').value = s.defaultTTL
}

function populateCredsSettings() {
  const s = loadUserSettings()
  const el = (id) => document.getElementById(id)
  if (s.cfToken) el('settCfToken').value = s.cfToken
  if (s.cfZone) el('settCfZone').value = s.cfZone
  if (s.awsKey) el('settAwsKey').value = s.awsKey
  if (s.awsDist) el('settAwsDist').value = s.awsDist
  if (s.fastlyToken) el('settFastlyToken').value = s.fastlyToken
  if (s.fastlyService) el('settFastlyService').value = s.fastlyService
}

function initUserSettingsHandlers() {
  const el = (id) => document.getElementById(id)

  // Avatar preview on input
  el('settAvatar')?.addEventListener('input', (e) => updateAvatarPreview(e.target.value))

  // Profile save
  el('settProfileSaveBtn')?.addEventListener('click', async () => {
    const fullName = el('settFullName').value.trim()
    const avatarUrl = el('settAvatar').value.trim()
    const newPass = el('settNewPassword').value
    const confirmPass = el('settConfirmPassword').value

    // Update profile in Supabase
    const updates = {}
    if (fullName !== (currentProfile?.full_name || '')) updates.full_name = fullName
    if (avatarUrl !== (currentProfile?.avatar_url || '')) updates.avatar_url = avatarUrl

    if (Object.keys(updates).length) {
      const { error } = await _supabase.from('profiles').update(updates).eq('id', currentUser.id)
      if (error) { showToast('Failed to update profile', true); return }
      Object.assign(currentProfile, updates)
      // Update nav
      const navUser = document.getElementById('navUser')
      if (navUser) navUser.textContent = currentProfile.email || currentUser.email
      const navAvatar = document.getElementById('navAvatar')
      if (navAvatar && updates.avatar_url) {
        navAvatar.innerHTML = `<img src="${escHtml(updates.avatar_url)}" alt="" />`
      }
    }

    // Change password
    if (newPass) {
      if (newPass !== confirmPass) { showToast('Passwords do not match', true); return }
      if (newPass.length < 6) { showToast('Password must be at least 6 characters', true); return }
      const { error } = await _supabase.auth.updateUser({ password: newPass })
      if (error) { showToast('Failed to update password: ' + error.message, true); return }
      el('settNewPassword').value = ''
      el('settConfirmPassword').value = ''
    }

    showToast('Profile updated')
  })

  // Domain defaults save
  el('settDomainsSaveBtn')?.addEventListener('click', () => {
    saveUserSettings({
      defaultAutoPurge: el('settDefaultAutoPurge').checked,
      defaultPurgeInterval: el('settDefaultPurgeInterval').value,
      defaultProvider: el('settDefaultProvider').value,
      defaultTTL: el('settDefaultTTL').value,
    })
    showToast('Domain defaults saved')
  })

  // Notifications save — persist to DB + localStorage
  el('settNotifSaveBtn')?.addEventListener('click', async () => {
    const prefs = {
      notifDowntime: el('settNotifDowntime').checked,
      notifSsl: el('settNotifSsl').checked,
      notifDdos: el('settNotifDdos').checked,
      notifPurge: el('settNotifPurge').checked,
      notifStatus: el('settNotifStatus').checked,
      notifEmail: el('settNotifEmail').value.trim(),
    }
    saveUserSettings(prefs)
    // Save to database for server-side functions (uptime alerts, weekly reports)
    try {
      const dbPrefs = {
        user_id: currentUser.id,
        notify_downtime: prefs.notifDowntime,
        notify_recovery: prefs.notifDowntime, // same toggle controls both
        notify_ssl_expiry: prefs.notifSsl,
        notify_weekly_report: el('settNotifWeekly') ? el('settNotifWeekly').checked : true,
        alert_email: prefs.notifEmail || null,
      }
      await _supabase.from('notification_preferences').upsert(dbPrefs, { onConflict: 'user_id' })
    } catch { /* localStorage fallback still works */ }
    showToast('Notification settings saved')
  })

  // Credentials save
  el('settCredsSaveBtn')?.addEventListener('click', () => {
    saveUserSettings({
      cfToken: el('settCfToken').value.trim(),
      cfZone: el('settCfZone').value.trim(),
      awsKey: el('settAwsKey').value.trim(),
      awsDist: el('settAwsDist').value.trim(),
      fastlyToken: el('settFastlyToken').value.trim(),
      fastlyService: el('settFastlyService').value.trim(),
    })
    showToast('Credentials saved')
  })

  // Upgrade plan button — scrolls to plans grid
  el('settUpgradeBtn')?.addEventListener('click', () => {
    document.getElementById('settPlansGrid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  // Plan option click — change plan via PayMongo
  document.querySelectorAll('.plan-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      const newPlan = opt.dataset.plan
      const currentPlan = currentProfile?.plan || 'none'
      if (newPlan === currentPlan) { showToast('You are already on this plan'); return }

      const planName = newPlan === 'none' ? 'Free' : newPlan.charAt(0).toUpperCase() + newPlan.slice(1)
      const price = PLAN_PRICES[newPlan] || 'Free'

      // Downgrade to Free — instant + cancel subscription
      if (newPlan === 'none') {
        if (!confirm('Downgrade to Free? You will lose managed features and extra domain slots.')) return
        const session = await getSession()
        // Cancel active subscription if exists
        if (session) {
          try {
            await fetch(`${EDGE_BASE}/paymongo-checkout/cancel`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            })
          } catch { /* ignore if no sub */ }
        }
        const { error } = await _supabase.from('profiles').update({
          plan: 'none',
          payment_status: 'unpaid',
        }).eq('id', currentUser.id)
        if (error) { showToast('Failed to downgrade: ' + error.message, true); return }
        currentProfile.plan = 'none'
        currentProfile.payment_status = 'unpaid'
        populatePlanSettings()
        renderAccountSummary()
        showToast('Downgraded to Free plan')
        return
      }

      // Paid plan — PayMongo checkout
      const domainLimit = PLAN_LIMITS[newPlan] === Infinity ? 'Unlimited' : PLAN_LIMITS[newPlan]
      if (!confirm(
        `Upgrade to ${planName} (${price})?\n\n` +
        `Domain limit: ${domainLimit}\n` +
        `First month is FREE for new subscribers!\n\n` +
        `You'll be redirected to a secure payment page (GCash, Maya, Card, or GrabPay).`
      )) return

      const session = await getSession()
      if (!session) { showToast('Please sign in again', true); return }

      showToast('Setting up payment...')

      try {
        const res = await fetch(`${EDGE_BASE}/paymongo-checkout/create`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ plan: newPlan }),
        })

        const data = await res.json()

        if (!res.ok) {
          showToast(data.error || 'Failed to create checkout', true)
          return
        }

        if (data.type === 'trial') {
          // Free trial started — no payment needed
          currentProfile.plan = newPlan
          currentProfile.payment_status = 'trial'
          populatePlanSettings()
          renderAccountSummary()
          showToast(data.message || `Your free trial for ${planName} has started!`)
          return
        }

        if (data.type === 'checkout' && data.checkout_url) {
          // Redirect to PayMongo checkout
          window.location.href = data.checkout_url
          return
        }

        showToast('Unexpected response. Please try again.', true)
      } catch (err) {
        console.error('Payment error:', err)
        showToast('Payment setup failed. Please try again.', true)
      }
    })
  })

  // Renew button (for past_due subscriptions)
  el('settRenewBtn')?.addEventListener('click', async () => {
    const plan = currentProfile?.plan || 'none'
    if (plan === 'none') return

    const session = await getSession()
    if (!session) { showToast('Please sign in again', true); return }

    showToast('Setting up payment...')
    try {
      const res = await fetch(`${EDGE_BASE}/paymongo-checkout/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to create checkout', true); return }
      if (data.checkout_url) window.location.href = data.checkout_url
    } catch { showToast('Payment setup failed. Please try again.', true) }
  })

  // Cancel subscription button
  el('settCancelSubBtn')?.addEventListener('click', async () => {
    if (!confirm('Cancel your subscription? Your plan will remain active until the current billing period ends.')) return
    const session = await getSession()
    if (!session) return

    try {
      const res = await fetch(`${EDGE_BASE}/paymongo-checkout/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: __LUZERGE_CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to cancel', true); return }
      showToast(data.message || 'Subscription cancelled')
      populatePlanSettings()
    } catch { showToast('Failed to cancel subscription', true) }
  })

  // Delete account
  el('settDeleteAccountBtn')?.addEventListener('click', () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) return
    const typed = prompt('This will permanently delete all your domains and data.\nType DELETE to confirm:')
    if (typed !== 'DELETE') { showToast('Account deletion cancelled', true); return }
    showToast('Account deletion requires admin approval. Please contact support.')
  })

  // 2FA toggle
  el('sett2faToggle')?.addEventListener('click', async () => {
    const factors = await _supabase.auth.mfa.listFactors()
    const totpFactors = (factors.data?.totp || []).filter(f => f.status === 'verified')

    if (totpFactors.length > 0) {
      // Already enabled — unenroll
      if (!confirm('Disable two-factor authentication? This will make your account less secure.')) return
      const { error } = await _supabase.auth.mfa.unenroll({ factorId: totpFactors[0].id })
      if (error) { showToast('Failed to disable 2FA: ' + error.message, true); return }
      update2faUI(false)
      showToast('Two-factor authentication disabled')
      return
    }

    // Enroll — show QR modal
    const { data, error } = await _supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Luzerge' })
    if (error) { showToast('Failed to start 2FA setup: ' + error.message, true); return }

    window._tfaFactorId = data.id
    document.getElementById('tfaQrImg').src = data.totp.qr_code
    document.getElementById('tfaSecret').textContent = data.totp.secret
    document.getElementById('tfaCode').value = ''
    document.getElementById('tfaError').hidden = true
    document.getElementById('tfaModal').hidden = false
  })

  // 2FA modal cancel
  document.getElementById('tfaCancelBtn')?.addEventListener('click', async () => {
    // Unenroll the unverified factor
    if (window._tfaFactorId) {
      await _supabase.auth.mfa.unenroll({ factorId: window._tfaFactorId }).catch(() => {})
      window._tfaFactorId = null
    }
    document.getElementById('tfaModal').hidden = true
  })

  // 2FA modal verify
  document.getElementById('tfaVerifyBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('tfaCode').value.trim()
    const errEl = document.getElementById('tfaError')
    errEl.hidden = true

    if (!/^\d{6}$/.test(code)) {
      errEl.textContent = 'Please enter a valid 6-digit code.'
      errEl.hidden = false
      return
    }

    const btn = document.getElementById('tfaVerifyBtn')
    btn.disabled = true
    btn.textContent = 'Verifying...'

    // Challenge + verify
    const { data: challenge, error: chalErr } = await _supabase.auth.mfa.challenge({ factorId: window._tfaFactorId })
    if (chalErr) {
      errEl.textContent = 'Challenge failed: ' + chalErr.message
      errEl.hidden = false
      btn.disabled = false
      btn.textContent = 'Verify & Enable'
      return
    }

    const { error: verifyErr } = await _supabase.auth.mfa.verify({ factorId: window._tfaFactorId, challengeId: challenge.id, code })
    btn.disabled = false
    btn.textContent = 'Verify & Enable'

    if (verifyErr) {
      errEl.textContent = 'Invalid code. Please try again.'
      errEl.hidden = false
      return
    }

    window._tfaFactorId = null
    document.getElementById('tfaModal').hidden = true
    update2faUI(true)
    showToast('Two-factor authentication enabled!')
  })

  // Revoke sessions
  el('settRevokeAllBtn')?.addEventListener('click', async () => {
    const { error } = await _supabase.auth.signOut({ scope: 'others' })
    if (error) { showToast('Failed to revoke sessions', true); return }
    showToast('All other sessions revoked')
  })

  // Generate API token
  el('settGenerateTokenBtn')?.addEventListener('click', async () => {
    const name = prompt('Token name (e.g., "CI Pipeline"):')
    if (!name) return

    const expiryChoice = prompt('Token expiry? Enter: 30d, 90d, 1y, or "never"', '90d')
    if (!expiryChoice) return
    let expiresAt = null
    const expiryMap = { '30d': 30, '90d': 90, '1y': 365 }
    if (expiryChoice !== 'never') {
      const days = expiryMap[expiryChoice]
      if (!days) { showToast('Invalid expiry. Use 30d, 90d, 1y, or never.', true); return }
      expiresAt = new Date(Date.now() + days * 86400000).toISOString()
    }

    const btn = el('settGenerateTokenBtn')
    btn.disabled = true
    btn.textContent = 'Generating...'

    // Generate a random token client-side (user sees this once)
    const rawToken = 'lzg_' + crypto.randomUUID().replace(/-/g, '')

    // Hash server-side with HMAC-SHA256 + pepper + per-token salt (3-layer protection)
    const session = await getSession()
    if (!session) { btn.disabled = false; btn.textContent = 'Generate New Token'; showToast('Session expired. Please refresh.', true); return }

    const hashRes = await fetch(`${SUPABASE_URL}/functions/v1/encrypt-credentials/hash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw_token: rawToken,
        token_name: name.trim(),
        expires_at: expiresAt,
      }),
    })

    const hashData = await hashRes.json()

    btn.disabled = false
    btn.textContent = 'Generate New Token'

    if (!hashRes.ok || !hashData.success) { console.error('Token creation error:', hashData); showToast('Failed to create token. Please try again.', true); return }

    // Show the raw token (only chance to copy it)
    const tokenDisplay = document.createElement('div')
    tokenDisplay.className = 'dash-alert dash-alert--success'
    tokenDisplay.style.marginBottom = '1rem'
    tokenDisplay.innerHTML = `
      <strong>Token created!</strong> Copy it now — you won't see it again.<br>
      <code style="user-select:all;word-break:break-all;display:block;margin-top:6px;padding:6px;background:rgba(0,0,0,0.3);border-radius:4px">${escHtml(rawToken)}</code>
    `
    const listEl = document.getElementById('settApiTokensList')
    listEl.parentNode.insertBefore(tokenDisplay, listEl)
    setTimeout(() => tokenDisplay.remove(), 30000)

    await loadApiTokens()
    showToast(`Token "${name}" created`)
  })
}

// ─── API Tokens ──────────────────────────────────────────────────────────────

async function loadApiTokens() {
  const listEl = document.getElementById('settApiTokensList')
  if (!listEl) return

  const { data: tokens, error } = await _supabase
    .from('api_tokens')
    .select('id, name, last_used, created_at, expires_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })

  if (error || !tokens?.length) {
    listEl.innerHTML = '<p class="settings-empty">No API tokens generated yet.</p>'
    return
  }

  listEl.innerHTML = tokens.map(t => {
    const isExpired = t.expires_at && new Date(t.expires_at) < new Date()
    const expiryLabel = t.expires_at
      ? (isExpired ? ' · <span style="color:#ef4444">Expired</span>' : ` · Expires ${formatDate(t.expires_at)}`)
      : ' · No expiry'
    return `
    <div class="api-token-item${isExpired ? ' api-token-item--expired' : ''}">
      <div class="api-token-item__info">
        <strong class="api-token-item__name">${escHtml(t.name)}</strong>
        <span class="api-token-item__meta">Created ${formatDate(t.created_at)}${t.last_used ? ' · Last used ' + formatDate(t.last_used) : ' · Never used'}${expiryLabel}</span>
      </div>
      <button class="btn btn--ghost btn--sm btn--danger-text api-revoke-btn" data-token-id="${t.id}" type="button" aria-label="Revoke token">Revoke</button>
    </div>
  `}).join('')

  // Bind revoke buttons
  listEl.querySelectorAll('.api-revoke-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this API token? Any integrations using it will stop working.')) return
      const tokenId = btn.dataset.tokenId
      const { error: delErr } = await _supabase.from('api_tokens').delete().eq('id', tokenId)
      if (delErr) { showToast('Failed to revoke token', true); return }
      showToast('Token revoked')
      await loadApiTokens()
    })
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
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
