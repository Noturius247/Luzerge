import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Whois Lookup Edge Function
 * Uses RDAP (free, no API key needed) to fetch domain registration details.
 */

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const url = new URL(req.url)
    const domain = url.searchParams.get('domain')

    if (!domain) {
      return json({ error: 'domain parameter is required' }, 400, cors)
    }

    // Clean domain — strip protocol and path
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()

    // Use RDAP protocol (successor to WHOIS, free and structured)
    const rdapRes = await fetch(`https://rdap.org/domain/${encodeURIComponent(cleanDomain)}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(15000),
    })

    if (!rdapRes.ok) {
      return json({ error: 'Domain not found or RDAP lookup failed', status: rdapRes.status }, 404, cors)
    }

    const data = await rdapRes.json()

    // Extract key info
    const events: Record<string, string> = {}
    for (const evt of data.events || []) {
      if (evt.eventAction && evt.eventDate) {
        events[evt.eventAction] = evt.eventDate
      }
    }

    // Extract nameservers
    const nameservers = (data.nameservers || []).map((ns: Record<string, unknown>) =>
      (ns.ldhName as string || '').toLowerCase()
    ).filter(Boolean)

    // Extract status
    const status = data.status || []

    // Extract registrar from entities
    let registrar: string | null = null
    let registrant: string | null = null
    for (const entity of data.entities || []) {
      const roles = entity.roles || []
      const name = entity.vcardArray?.[1]?.find((v: unknown[]) => v[0] === 'fn')?.[3]
        || entity.publicIds?.[0]?.identifier
        || entity.handle
        || null

      if (roles.includes('registrar') && name) registrar = name
      if (roles.includes('registrant') && name) registrant = name
    }

    return json({
      domain: cleanDomain,
      registered: events['registration'] || null,
      expires: events['expiration'] || null,
      last_updated: events['last changed'] || events['last update of RDAP database'] || null,
      registrar,
      registrant,
      nameservers,
      status,
      dnssec: data.secureDNS?.delegationSigned || false,
    }, 200, cors)
  } catch (err) {
    return json({ error: 'Whois lookup failed', detail: String(err) }, 502, cors)
  }
})

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
