export type MhtmlResource = {
  location?: string
  contentId?: string
  mimeType: string
  bytes: Uint8Array
}

function parseHeaders(value: string) {
  const unfolded = value.replace(/^\r?\n/, '').replace(/\r?\n[ \t]+/g, ' ')
  const headers = new Map<string, string>()
  unfolded.split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(':')
    if (separator < 0) return
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  })
  return headers
}

function decodeQuotedPrintable(value: string) {
  const compact = value.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  let plain = ''
  const flushPlain = () => {
    if (!plain) return
    bytes.push(...new TextEncoder().encode(plain))
    plain = ''
  }

  for (let index = 0; index < compact.length; index += 1) {
    if (compact[index] === '=' && /^[0-9a-f]{2}$/i.test(compact.slice(index + 1, index + 3))) {
      flushPlain()
      bytes.push(Number.parseInt(compact.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      plain += compact[index]
    }
  }
  flushPlain()
  return new Uint8Array(bytes)
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function decodePartBody(value: string, transferEncoding?: string) {
  if (transferEncoding?.toLowerCase() === 'base64') return decodeBase64(value)
  if (transferEncoding?.toLowerCase() === 'quoted-printable') return decodeQuotedPrintable(value)
  return new TextEncoder().encode(value)
}

function normalizeKey(value: string) {
  const trimmed = value.trim().replace(/^<|>$/g, '')
  try {
    const url = new URL(trimmed)
    url.hash = ''
    return url.href
  } catch {
    return trimmed.toLowerCase()
  }
}

export function findMhtmlResource(resources: MhtmlResource[], reference: string, baseLocation?: string) {
  const references = [reference]
  if (baseLocation) {
    try {
      references.push(new URL(reference, baseLocation).href)
    } catch {
      // Keep the original reference when it is not a URL.
    }
  }
  const keys = references.map(normalizeKey)
  return resources.find((resource) => [resource.location, resource.contentId].filter(Boolean).some((key) => keys.includes(normalizeKey(key!))))
}

export function resourceDataUrl(resource: MhtmlResource) {
  let binary = ''
  for (let index = 0; index < resource.bytes.length; index += 8192) {
    binary += String.fromCharCode(...resource.bytes.subarray(index, index + 8192))
  }
  return `data:${resource.mimeType};base64,${btoa(binary)}`
}

export function resourceText(resource: MhtmlResource) {
  return new TextDecoder().decode(resource.bytes)
}

export async function parseMhtmlResources(file: Blob) {
  const raw = await file.text()
  const headerEnd = raw.search(/\r?\n\r?\n/)
  if (headerEnd < 0) return []
  const headerText = raw.slice(0, headerEnd)
  const headers = parseHeaders(headerText)
  const boundaryMatch = headers.get('content-type')?.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]
  if (!boundary) return []

  return raw.split(`--${boundary}`).slice(1).flatMap((part): MhtmlResource[] => {
    if (part.trim().startsWith('--')) return []
    const partHeaderEnd = part.search(/\r?\n\r?\n/)
    if (partHeaderEnd < 0) return []
    const partHeaders = parseHeaders(part.slice(0, partHeaderEnd))
    const mimeType = partHeaders.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (!mimeType) return []
    return [{
      location: partHeaders.get('content-location'),
      contentId: partHeaders.get('content-id'),
      mimeType,
      bytes: decodePartBody(part.slice(partHeaderEnd).replace(/^\r?\n\r?\n/, ''), partHeaders.get('content-transfer-encoding')),
    }]
  })
}
