/**
 * Luzerge — Auth helper (shared across login + dashboard + admin pages)
 * Initializes Supabase client and exposes session / role utilities.
 */

'use strict'

// Config is loaded from js/config.js (gitignored) — see js/config.example.js
const { SUPABASE_URL, SUPABASE_ANON_KEY } = __LUZERGE_CONFIG

// Global supabase client (available to all inline scripts)
// eslint-disable-next-line no-unused-vars
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/**
 * Returns the current session, or null if not logged in.
 */
async function getSession() {
  // getSession() reads from cache and may return an expired token.
  // Try it first, then refresh if the token is close to expiry.
  const { data: { session } } = await _supabase.auth.getSession()
  if (!session) return null
  // If token expires within 60s, force a refresh
  const expiresAt = session.expires_at // unix seconds
  if (expiresAt && expiresAt - Math.floor(Date.now() / 1000) < 60) {
    const { data: { session: refreshed } } = await _supabase.auth.refreshSession()
    return refreshed
  }
  return session
}

/**
 * Returns the current user, or null if not logged in.
 */
async function getUser() {
  const { data: { user } } = await _supabase.auth.getUser()
  return user
}

/**
 * Ensures a profile exists for the current user.
 * Creates one if missing (handles cases where the DB trigger didn't fire).
 */
async function ensureProfile(user) {
  if (!user) return null

  // Try to fetch existing profile
  const { data: profile } = await _supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, role, plan, payment_status, status, created_at')
    .eq('id', user.id)
    .single()

  if (profile) return profile

  // Profile doesn't exist — create it
  const meta = user.user_metadata || {}
  const newProfile = {
    id: user.id,
    email: user.email,
    full_name: meta.full_name || meta.name || '',
    avatar_url: meta.avatar_url || meta.picture || '',
    role: 'user',
  }

  const { data: created, error } = await _supabase
    .from('profiles')
    .upsert(newProfile, { onConflict: 'id' })
    .select('id, email, full_name, avatar_url, role, plan, payment_status, status, created_at')
    .single()

  if (error) {
    console.warn('Failed to create profile:', error.message)
    return null
  }

  return created
}

/**
 * Returns the user's profile (including role), or null.
 * Auto-creates the profile if it doesn't exist yet.
 */
async function getProfile() {
  const { data: { user } } = await _supabase.auth.getUser()
  if (!user) return null
  return ensureProfile(user)
}

/**
 * Signs the user out and redirects to login.
 */
async function signOut() {
  await _supabase.auth.signOut()
  window.location.replace('/login.html')
}

/**
 * Guard: if not logged in, redirect to login page.
 * Call at the top of protected pages.
 */
async function requireAuth() {
  const session = await getSession()
  if (!session) {
    window.location.replace('/login.html')
    return null
  }
  return session
}

/**
 * Routes user to the correct dashboard based on role.
 * Call after login or on pages that need role-based routing.
 */
async function routeByRole() {
  const profile = await getProfile()
  if (!profile) return

  if (profile.role === 'admin' && !window.location.pathname.includes('admin.html')) {
    window.location.replace('/admin.html')
  } else if (profile.role === 'user' && !window.location.pathname.includes('dashboard.html')) {
    window.location.replace('/dashboard.html')
  }
}
