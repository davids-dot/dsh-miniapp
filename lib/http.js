/**
 * HTTP helpers for the miniapp API route — adapted from the shipped dshmarket
 * bundle (its lib/http.js), which is the working plain-JS reference for a bare
 * `exact` webServer route.
 *
 * Two independent defences, both required on every mutating request:
 *   - refuseUnadmitted(): the Host's own Host/Origin fence + browser login
 *     cookie check (401/403). Exact routes bypass DSH's `/api` prefix fence,
 *     so the plugin has to run this gate itself.
 *   - sameOrigin(): DNS-rebinding defence. `Host` is the one header an
 *     attacker's page cannot forge.
 * A missing Origin/Host is allowed (Desktop's proxy strips them, #648).
 * Chrome 151+ omits the port on loopback Origins (#1031), so a port-less
 * same-hostname Origin is accepted on the loopback fence.
 */
let trustedHostsSource = () => []
let requestGateSource = () => undefined

export function setRequestGateSource(source) {
  const previous = requestGateSource
  requestGateSource = source
  return previous
}

export function setTrustedHostsSource(source) {
  const previous = trustedHostsSource
  trustedHostsSource = source
  return previous
}

export function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Answer with the Host's rejection, if it has one. True when refused here. */
export function refuseUnadmitted(request, response) {
  const gate = requestGateSource()
  if (gate === undefined) return false
  let status
  try {
    status = gate(request)
  } catch {
    // A gate that throws has admitted nothing; never fail open.
    status = 403
  }
  if (status === undefined) return false
  sendJson(response, status, {
    error: status === 401
      ? 'DSH login required: reopen the URL dsh printed at startup.'
      : 'This request came from an untrusted origin and was refused.',
  })
  return true
}

function parseAuthority(value) {
  try {
    const url = new URL(`http://${value}`)
    const canonical = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
    return canonical === value.toLowerCase() ? url : null
  } catch {
    return null
  }
}

export function trustedAuthority(host, trustedHosts) {
  const hostUrl = parseAuthority(host)
  if (hostUrl === null) return false
  return trustedHosts.some(entry => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === null) return false
    return entryUrl.port === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

export function loopbackAuthority(host) {
  if (host === undefined) return false
  const lower = host.toLowerCase()
  const name = lower.startsWith('[')
    ? lower.slice(0, lower.indexOf(']') + 1)
    : lower.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

export function sameOrigin(request) {
  const host = request.headers.host
  if (host !== undefined && !loopbackAuthority(host) && !trustedAuthority(host, trustedHostsSource())) {
    return false
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true
    if (originUrl.port === '' && host !== undefined && loopbackAuthority(host)) {
      const hostUrl = parseAuthority(host)
      return hostUrl !== null && originUrl.hostname === hostUrl.hostname
    }
    return false
  } catch {
    return false
  }
}

/** Read and parse a JSON request body, rejecting anything over 16 KiB. */
export async function readJsonBody(request, maxBytes = 16 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
