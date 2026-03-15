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
  const { data: { session } } = await _supabase.auth.getSession()
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
 * Returns the user's profile (including role), or null.
 */
async function getProfile() {
  const { data: { user } } = await _supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await _supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, role')
    .eq('id', user.id)
    .single()

  return profile
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
