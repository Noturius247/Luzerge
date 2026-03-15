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
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.hidden = true }, 2000)
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
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
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
        showToast('Failed to save: ' + err.message)
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

async function populateAnalytics() {
  const loading = document.getElementById('anlLoading')
  const content = document.getElementById('anlContent')
  const noDomains = document.getElementById('anlNoDomains')
  const error = document.getElementById('anlError')

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('anlDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  // Bind domain selector change
  const select = document.getElementById('anlDomainSelect')
  select.onchange = () => populateAnalytics()

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
    const selectedId = select.value || domainId
    const data = await cfProxy(selectedId, 'analytics', { since: _anlRange })
    loading.hidden = true

    if (!data.analytics) {
      error.textContent = data.message || 'No analytics data available for this domain.'
      error.hidden = false
      return
    }

    const a = data.analytics
    document.getElementById('anlRequests').textContent = fmtNum(a.requests_total)
    document.getElementById('anlBandwidth').textContent = formatBytes(a.bandwidth_total)
    document.getElementById('anlVisitors').textContent = a.unique_visitors != null ? fmtNum(a.unique_visitors) : 'N/A'
    document.getElementById('anlCacheRate').textContent = a.cache_hit_rate != null ? a.cache_hit_rate + '%' : 'N/A'

    // Show provider badge
    const provBadge = document.getElementById('anlProviderBadge')
    if (provBadge) {
      const prov = data.provider || 'cloudflare'
      provBadge.textContent = prov
      provBadge.hidden = prov === 'cloudflare'
    }

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
  const settingsLoading = document.getElementById('sslSettingsLoading')

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('sslDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const select = document.getElementById('sslDomainSelect')
  select.onchange = () => populateSslPanel()

  try {
    const selectedId = select.value || domainId
    const provider = getDomainProvider(selectedId)
    const isCf = provider === 'cloudflare'
    const sslSettingsEl = document.getElementById('sslSettingsSection')

    // For non-CF, use ssl_check universal action; for CF, fetch certs + settings
    settingsLoading.hidden = false

    if (isCf) {
      const [certData, settingsData] = await Promise.all([
        cfProxy(selectedId, 'ssl_certs'),
        cfProxy(selectedId, 'settings'),
      ])
      loading.hidden = true
      settingsLoading.hidden = true

      // Populate cert table
      const tbody = document.getElementById('sslBody')
      const certs = certData.certs || []
      if (certs.length) {
        tbody.innerHTML = certs.map(c => {
          const hosts = (c.hosts || []).join(', ')
          const statusClass = c.status === 'active' ? 'active' : 'pending'
          return `<tr>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(hosts)}</td>
            <td><span class="status-badge status-badge--${statusClass}">${escHtml(c.status)}</span></td>
            <td>${escHtml(c.issuer || 'Cloudflare')}</td>
            <td>${escHtml(c.type || 'universal')}</td>
            <td>${c.expires_on ? formatDate(c.expires_on) : 'Auto-renewed'}</td>
          </tr>`
        }).join('')
      } else {
        tbody.innerHTML = '<tr><td colspan="5" class="feature-empty">No certificate packs found — Universal SSL may still be active</td></tr>'
      }

      // Show SSL settings section for CF
      if (sslSettingsEl) sslSettingsEl.hidden = false

      const s = settingsData.settings || {}
      _cfSettings = s
      _cfPanelDomainId = selectedId

      const sslMode = s.ssl || 'off'
      const badge = document.getElementById('sslModeBadge')
      badge.textContent = sslMode
      badge.className = 'status-badge ' + (sslMode === 'full' || sslMode === 'strict' ? 'status-badge--active' : 'status-badge--pending')

      applyCfToggle('toggleAlwaysHttps', s.always_use_https)
      const tls13 = s.min_tls_version === '1.3'
      const tls13Label = document.getElementById('toggleTls13')
      if (tls13Label) {
        const inp = tls13Label.querySelector('input')
        inp.checked = tls13
        tls13Label.classList.toggle('toggle-switch--on', tls13)
      }
    } else {
      // Non-CF: use ssl_check for basic info, use ssl_certs action (edge fn routes to sslCheck)
      const certData = await cfProxy(selectedId, 'ssl_certs')
      loading.hidden = true
      settingsLoading.hidden = true

      const tbody = document.getElementById('sslBody')
      if (certData.ssl_valid) {
        const hdr = certData.headers || {}
        tbody.innerHTML = `<tr>
          <td>${escHtml(userDomains.find(d => d.id === selectedId)?.domain || '')}</td>
          <td><span class="status-badge status-badge--active">Valid</span></td>
          <td>${escHtml(hdr.server || provider)}</td>
          <td>HTTPS check</td>
          <td>${certData.hsts ? 'HSTS enabled' : 'No HSTS'}</td>
        </tr>`
      } else {
        tbody.innerHTML = `<tr>
          <td>${escHtml(userDomains.find(d => d.id === selectedId)?.domain || '')}</td>
          <td><span class="status-badge status-badge--error">Invalid</span></td>
          <td colspan="3">SSL check failed — ${escHtml(certData.error || 'Connection error')}</td>
        </tr>`
      }

      // Hide CF-specific settings for non-CF
      if (sslSettingsEl) sslSettingsEl.hidden = true
    }

    content.hidden = false
  } catch (err) {
    loading.hidden = true
    settingsLoading.hidden = true
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

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('dnsDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const select = document.getElementById('dnsDomainSelect')
  select.onchange = () => populateDnsPanel()

  try {
    const selectedId = select.value || domainId
    const provider = getDomainProvider(selectedId)
    const isCf = provider === 'cloudflare'
    const data = await cfProxy(selectedId, 'dns_records')
    loading.hidden = true

    const tbody = document.getElementById('dnsBody')

    if (isCf) {
      // CF returns array of {type, name, content, ttl, proxied}
      const records = data.records || []
      if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="feature-empty">No DNS records found</td></tr>'
      } else {
        tbody.innerHTML = records.map(r => {
          const ttl = r.ttl === 1 ? 'Auto' : `${r.ttl}s`
          return `<tr>
            <td><span class="status-badge" style="background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${escHtml(r.type)}</span></td>
            <td>${escHtml(r.name)}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.content)}">${escHtml(r.content)}</td>
            <td>${ttl}</td>
            <td>${r.proxied ? '<span class="status-badge status-badge--active">Proxied</span>' : '<span class="status-badge status-badge--pending">DNS only</span>'}</td>
          </tr>`
        }).join('')
      }
    } else {
      // Non-CF: dns_lookup returns {records: {A: [{data, ttl}], CNAME: [...]}}
      const recordMap = data.records || {}
      const domainName = userDomains.find(d => d.id === selectedId)?.domain || ''
      const rows = []
      for (const [type, entries] of Object.entries(recordMap)) {
        for (const entry of entries) {
          rows.push(`<tr>
            <td><span class="status-badge" style="background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${escHtml(type)}</span></td>
            <td>${escHtml(domainName)}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(entry.data)}">${escHtml(entry.data)}</td>
            <td>${entry.ttl ? entry.ttl + 's' : 'N/A'}</td>
            <td><span class="status-badge status-badge--pending">DNS lookup</span></td>
          </tr>`)
        }
      }
      tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="5" class="feature-empty">No DNS records found via lookup</td></tr>'
    }
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

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('minifyDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const select = document.getElementById('minifyDomainSelect')
  select.onchange = () => populateMinifyPanel()

  try {
    const selectedId = select.value || domainId
    const provider = getDomainProvider(selectedId)

    if (provider !== 'cloudflare') {
      loading.hidden = true
      error.textContent = 'Minification settings are only available for Cloudflare domains.'
      error.hidden = false
      return
    }

    const data = await cfProxy(selectedId, 'settings')
    loading.hidden = true

    const s = data.settings || {}
    _cfSettings = s
    _cfPanelDomainId = selectedId

    const minify = s.minify || { css: 'off', html: 'off', js: 'off' }
    applyCfToggle('toggleMinHtml', minify.html)
    applyCfToggle('toggleMinCss', minify.css)
    applyCfToggle('toggleMinJs', minify.js)
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

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('imgDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const select = document.getElementById('imgDomainSelect')
  select.onchange = () => populateImagesPanel()

  try {
    const selectedId = select.value || domainId
    const provider = getDomainProvider(selectedId)

    if (provider !== 'cloudflare') {
      loading.hidden = true
      error.textContent = 'Image optimization settings are only available for Cloudflare domains.'
      error.hidden = false
      return
    }

    const data = await cfProxy(selectedId, 'settings')
    loading.hidden = true

    const s = data.settings || {}
    _cfSettings = s
    _cfPanelDomainId = selectedId

    applyCfToggle('toggleMirage', s.mirage)
    applyCfToggle('toggleRocketLoader', s.rocket_loader)
    applyCfToggle('toggleWebp', s.webp)

    const polishBadge = document.getElementById('imgPolishBadge')
    const polish = s.polish || 'off'
    polishBadge.textContent = polish
    polishBadge.className = 'status-badge ' + (polish !== 'off' ? 'status-badge--active' : 'status-badge--pending')

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

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('wafDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const select = document.getElementById('wafDomainSelect')
  select.onchange = () => populateWafPanel()

  try {
    const selectedId = select.value || domainId
    const provider = getDomainProvider(selectedId)

    if (provider !== 'cloudflare') {
      loading.hidden = true
      error.textContent = 'WAF / Firewall settings are only available for Cloudflare domains.'
      error.hidden = false
      return
    }

    const data = await cfProxy(selectedId, 'settings')
    loading.hidden = true

    const s = data.settings || {}
    _cfSettings = s
    _cfPanelDomainId = selectedId

    const levelBadge = document.getElementById('wafSecurityLevel')
    const level = s.security_level || 'medium'
    levelBadge.textContent = level.charAt(0).toUpperCase() + level.slice(1)
    const levelClass = level === 'high' || level === 'under_attack' ? 'status-badge--error' : 'status-badge--active'
    levelBadge.className = `status-badge ${levelClass}`

    applyCfToggle('toggleBrowserCheck', s.browser_check)
    applyCfToggle('toggleEmailObfuscation', s.email_obfuscation)
    applyCfToggle('toggleHotlink', s.hotlink_protection)
    applyCfToggle('toggleSSE', s.server_side_exclude)

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

  loading.hidden = false
  content.hidden = true
  noDomains.hidden = true
  error.hidden = true

  const domainId = populateDomainSelect('ddosDomainSelect')
  if (!domainId) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const select = document.getElementById('ddosDomainSelect')
  select.onchange = () => populateDdosPanel()

  try {
    const selectedId = select.value || domainId
    const provider = getDomainProvider(selectedId)

    if (provider === 'none') {
      loading.hidden = true
      error.textContent = 'DDoS analytics are not available for monitoring-only domains.'
      error.hidden = false
      return
    }

    const data = await cfProxy(selectedId, 'analytics', { since: '30d' })
    loading.hidden = true

    if (!data.analytics) {
      error.textContent = data.message || 'No analytics data available for this domain.'
      error.hidden = false
      return
    }

    const a = data.analytics
    document.getElementById('ddosThreats').textContent = fmtNum(a.threats_total)
    document.getElementById('ddosRequests').textContent = fmtNum(a.requests_total)
    document.getElementById('ddosBandwidth').textContent = formatBytes(a.bandwidth_total)
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
  const list = document.getElementById('uptimeList')
  const noDomains = document.getElementById('uptimeNoDomains')

  loading.hidden = false
  list.hidden = true
  noDomains.hidden = true

  const activeDomains = userDomains.filter(d => d.status === 'active')
  if (!activeDomains.length) {
    loading.hidden = true
    noDomains.hidden = false
    return
  }

  const session = await getSession()
  if (!session) { loading.hidden = true; return }

  // Run uptime checks in parallel for all active domains
  const results = await Promise.all(activeDomains.map(async (d) => {
    try {
      const data = await cfProxy(d.id, 'uptime_check')
      return { domain: d.domain, checks: data.checks || [] }
    } catch {
      return { domain: d.domain, checks: [] }
    }
  }))

  loading.hidden = true
  list.hidden = false

  list.innerHTML = results.map(r => {
    const httpsCheck = r.checks.find(c => c.url?.startsWith('https'))
    const httpCheck = r.checks.find(c => c.url?.startsWith('http://'))
    const mainCheck = httpsCheck || httpCheck || {}
    const isUp = mainCheck.ok
    const latency = mainCheck.latency

    const pctClass = isUp ? 'good' : 'bad'
    const statusText = isUp ? 'UP' : 'DOWN'
    const latencyText = latency != null ? `${latency}ms` : '--'

    return `<div class="uptime-card">
      <div class="uptime-card__top">
        <span class="uptime-card__domain">${escHtml(r.domain)}</span>
        <span class="uptime-card__pct uptime-card__pct--${pctClass}">${statusText}</span>
      </div>
      <div style="display:flex;gap:1rem;font-size:0.85rem;color:rgba(255,255,255,0.6);margin-top:0.3rem">
        <span>HTTPS: ${httpsCheck?.ok ? '<span style="color:#22c55e">&#10003; ' + (httpsCheck.status || '') + '</span>' : '<span style="color:#ef4444">&#10007; ' + (httpsCheck?.status || 'Timeout') + '</span>'}</span>
        <span>HTTP: ${httpCheck?.ok ? '<span style="color:#22c55e">&#10003; ' + (httpCheck.status || '') + '</span>' : '<span style="color:#ef4444">&#10007; ' + (httpCheck?.status || 'Timeout') + '</span>'}</span>
        <span>Latency: <strong>${latencyText}</strong></span>
      </div>
    </div>`
  }).join('')

  // Bind refresh button
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
          ${d.cdn_provider && d.cdn_provider !== 'cloudflare' ? `<span class="status-badge" style="font-size:0.65rem;padding:2px 6px;background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2)">${escHtml(d.cdn_provider)}</span>` : ''}
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

  const insertData = {
    user_id: currentUser.id,
    domain: scannedDomain,
    status: isSelfManaged ? 'active' : 'pending',
  }

  if (isSelfManaged) {
    const provider = document.getElementById('inputCdnProvider')?.value || 'cloudflare'
    insertData.cdn_provider = provider

    if (provider === 'cloudflare') {
      insertData.cloudflare_zone_id = document.getElementById('inputZoneId').value.trim()
      insertData.cloudflare_api_token = document.getElementById('inputApiToken').value.trim()
    } else if (provider === 'cloudfront' || provider === 'fastly') {
      insertData.cdn_distribution_id = document.getElementById('inputDistributionId').value.trim()
      insertData.cdn_api_key = document.getElementById('inputCdnApiKey').value.trim()
    }
    // 'none' = monitoring only, no credentials needed
  }

  const { error } = await _supabase.from('user_domains').insert(insertData)

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
  renderAccountSummary()
  renderQuickStats()
  renderChecklist()
  initQuickActions()
  await loadActivityFeed()
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
        headers: { Authorization: `Bearer ${session.access_token}` },
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

  if (error || !history?.length) {
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
