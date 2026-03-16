import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Domain Lookup Edge Function
 * Performs DNS lookups via Google DNS-over-HTTPS to detect:
 * - Nameservers (and which platform they belong to)
 * - Hosting provider (via A record → IP → ASN)
 * - Whether the domain is registered
 * - SSL issuer (not available via DNS, but we note the CDN)
 *
 * No auth required — this is a public lookup tool.
 */

const PLATFORM_PATTERNS: Record<string, string> = {
  'cloudflare.com': 'Cloudflare',
  'awsdns': 'AWS Route 53',
  'azure-dns': 'Microsoft Azure',
  'googledomains.com': 'Google Domains',
  'google.com': 'Google Cloud DNS',
  'akam.net': 'Akamai',
  'fastly.net': 'Fastly',
  'sucuri.net': 'Sucuri',
  'registrar-servers.com': 'Namecheap (Default)',
  'domaincontrol.com': 'GoDaddy',
  'hostgator.com': 'HostGator',
  'digitalocean.com': 'DigitalOcean',
  'linode.com': 'Linode',
  'vultr.com': 'Vultr',
  'hetzner.com': 'Hetzner',
  'netlify.com': 'Netlify',
  'vercel-dns.com': 'Vercel',
  'wixdns.net': 'Wix',
  'squarespace.com': 'Squarespace',
  'wordpress.com': 'WordPress.com',
  'shopify.com': 'Shopify',
  'nsone.net': 'NS1',
  'dynect.net': 'Oracle Dyn',
}

const HOSTING_PATTERNS: Record<string, string> = {
  'cloudflare': 'Cloudflare',
  'amazon': 'AWS',
  'google': 'Google Cloud',
  'microsoft': 'Microsoft Azure',
  'digitalocean': 'DigitalOcean',
  'linode': 'Akamai/Linode',
  'vultr': 'Vultr',
  'hetzner': 'Hetzner',
  'ovh': 'OVH',
  'hostgator': 'HostGator',
  'godaddy': 'GoDaddy',
  'bluehost': 'Bluehost',
  'netlify': 'Netlify',
  'vercel': 'Vercel',
  'fastly': 'Fastly',
  'shopify': 'Shopify',
  'squarespace': 'Squarespace',
  'wix': 'Wix',
  'automattic': 'WordPress.com',
}

function detectPlatform(nameservers: string[]): string {
  for (const ns of nameservers) {
    const lower = ns.toLowerCase()
    for (const [pattern, name] of Object.entries(PLATFORM_PATTERNS)) {
      if (lower.includes(pattern)) return name
    }
  }
  return 'Unknown'
}

function detectHosting(org: string): string {
  const lower = org.toLowerCase()
  for (const [pattern, name] of Object.entries(HOSTING_PATTERNS)) {
    if (lower.includes(pattern)) return name
  }
  return org || 'Unknown'
}

async function dnsQuery(domain: string, type: string): Promise<any> {
  const res = await fetch(
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
    { headers: { Accept: 'application/dns-json' } }
  )
  if (!res.ok) return null
  return res.json()
}

async function ipLookup(ip: string): Promise<{ org: string; country: string }> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`)
    if (!res.ok) return { org: '', country: '' }
    const data = await res.json()
    return { org: data.org || '', country: data.country || '' }
  } catch {
    return { org: '', country: '' }
  }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const domain = url.searchParams.get('domain')?.trim().toLowerCase()
      ?.replace(/^https?:\/\//, '')
      ?.replace(/^www\./, '')
      ?.replace(/\/.*$/, '')

    if (!domain) {
      return new Response(JSON.stringify({ error: 'domain parameter is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parallel DNS queries
    const [nsResult, aResult, aaaaResult, mxResult] = await Promise.all([
      dnsQuery(domain, 'NS'),
      dnsQuery(domain, 'A'),
      dnsQuery(domain, 'AAAA'),
      dnsQuery(domain, 'MX'),
    ])

    // Check if domain exists
    const status = nsResult?.Status
    if (status === 3) {
      // NXDOMAIN — domain doesn't exist
      return new Response(JSON.stringify({
        domain,
        registered: false,
        error: 'Domain not found (NXDOMAIN)',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Extract nameservers
    const nameservers: string[] = (nsResult?.Answer || [])
      .filter((a: any) => a.type === 2)
      .map((a: any) => a.data?.replace(/\.$/, '') || '')
      .filter(Boolean)

    // Detect platform from nameservers
    const platform = detectPlatform(nameservers)
    const isOnCloudflare = platform === 'Cloudflare'

    // Extract A records (IPv4)
    const aRecords: string[] = (aResult?.Answer || [])
      .filter((a: any) => a.type === 1)
      .map((a: any) => a.data)
      .filter(Boolean)

    // Extract AAAA records (IPv6)
    const aaaaRecords: string[] = (aaaaResult?.Answer || [])
      .filter((a: any) => a.type === 28)
      .map((a: any) => a.data)
      .filter(Boolean)

    // Extract MX records
    const mxRecords: string[] = (mxResult?.Answer || [])
      .filter((a: any) => a.type === 15)
      .map((a: any) => a.data)
      .filter(Boolean)

    // IP-based hosting lookup (use first A record)
    let hosting = 'Unknown'
    let hostingOrg = ''
    let country = ''
    if (aRecords.length > 0) {
      const ipInfo = await ipLookup(aRecords[0])
      hostingOrg = ipInfo.org
      country = ipInfo.country
      hosting = detectHosting(ipInfo.org)
    }

    return new Response(JSON.stringify({
      domain,
      registered: true,
      nameservers,
      platform,
      is_on_cloudflare: isOnCloudflare,
      a_records: aRecords,
      aaaa_records: aaaaRecords,
      mx_records: mxRecords,
      hosting: {
        provider: hosting,
        org: hostingOrg,
        country,
        ip: aRecords[0] || null,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Lookup failed', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
