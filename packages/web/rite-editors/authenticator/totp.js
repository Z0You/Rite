/*
 * Rite Authenticator — TOTP (RFC 6238) and otpauth:// helpers. AGPL-3.0.
 * Uses the browser's Web Crypto API for HMAC; works in Node 18+ too (for tests).
 */
;(function (root) {
  'use strict'

  var ALGORITHMS = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

  function normalizeSecret(secret) {
    return String(secret || '')
      .replace(/[\s-]/g, '')
      .replace(/=+$/, '')
      .toUpperCase()
  }

  function base32Decode(input) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    var clean = normalizeSecret(input)
    if (clean.length === 0) {
      throw new Error('The setup key is empty.')
    }
    var bits = 0
    var value = 0
    var output = []
    for (var i = 0; i < clean.length; i++) {
      var index = alphabet.indexOf(clean[i])
      if (index === -1) {
        throw new Error('The setup key contains characters that are not valid (only A–Z and 2–7).')
      }
      value = (value << 5) | index
      bits += 5
      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 0xff)
        bits -= 8
      }
    }
    return new Uint8Array(output)
  }

  function isValidSecret(secret) {
    try {
      return base32Decode(secret).length >= 5
    } catch (e) {
      return false
    }
  }

  function getSubtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || root.crypto
    if (!c || !c.subtle) {
      throw new Error('Secure cryptography is not available in this browser.')
    }
    return c.subtle
  }

  function counterBytes(counter) {
    var bytes = new Uint8Array(8)
    var high = Math.floor(counter / 0x100000000)
    var low = counter >>> 0
    for (var i = 3; i >= 0; i--) {
      bytes[i] = high & 0xff
      high = high >>> 8
      bytes[4 + i] = low & 0xff
      low = low >>> 8
    }
    return bytes
  }

  /** HOTP value for a raw key (RFC 4226). */
  async function hotpFromKey(keyBytes, counter, digits, algorithm) {
    var subtle = getSubtle()
    var hashName = ALGORITHMS[algorithm || 'SHA1'] || 'SHA-1'
    var key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: { name: hashName } }, false, ['sign'])
    var mac = new Uint8Array(await subtle.sign('HMAC', key, counterBytes(counter)))
    var offset = mac[mac.length - 1] & 0x0f
    var binary =
      ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
    var size = digits || 6
    var code = String(binary % Math.pow(10, size))
    while (code.length < size) code = '0' + code
    return code
  }

  /** Current TOTP code and the seconds left before it changes. */
  async function totp(entry, nowMs) {
    var period = Number(entry.period) || 30
    var seconds = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000)
    var counter = Math.floor(seconds / period)
    var code = await hotpFromKey(base32Decode(entry.secret), counter, Number(entry.digits) || 6, entry.algorithm)
    return { code: code, remaining: period - (seconds % period), period: period }
  }

  /** Parses otpauth://totp/Issuer:account?secret=...&issuer=... */
  function parseOtpauthUri(uri) {
    var text = String(uri || '').trim()
    if (/^otpauth-migration:/i.test(text)) {
      throw new Error(
        'This is a Google Authenticator export code. Export each account individually, or enter its setup key.',
      )
    }
    var match = text.match(/^otpauth:\/\/([a-z]+)\/([^?]*)(\?.*)?$/i)
    if (!match) {
      throw new Error('This is not an authenticator QR code (it should start with otpauth://).')
    }
    var type = match[1].toLowerCase()
    if (type !== 'totp') {
      throw new Error('Only time-based codes (TOTP) are supported. This code is "' + type + '".')
    }
    var label = safeDecode(match[2])
    var params = {}
    ;(match[3] || '')
      .replace(/^\?/, '')
      .split('&')
      .forEach(function (pair) {
        if (!pair) return
        var idx = pair.indexOf('=')
        var key = idx === -1 ? pair : pair.slice(0, idx)
        var value = idx === -1 ? '' : pair.slice(idx + 1)
        params[key.toLowerCase()] = safeDecode(value.replace(/\+/g, ' '))
      })

    var labelIssuer = ''
    var account = label
    var colon = label.indexOf(':')
    if (colon !== -1) {
      labelIssuer = label.slice(0, colon).trim()
      account = label.slice(colon + 1).trim()
    }

    if (!params.secret || !isValidSecret(params.secret)) {
      throw new Error('The QR code does not contain a valid setup key.')
    }

    var algorithm = (params.algorithm || 'SHA1').toUpperCase().replace('-', '')
    return {
      service: params.issuer || labelIssuer || account || 'Account',
      account: account,
      secret: normalizeSecret(params.secret),
      algorithm: ALGORITHMS[algorithm] ? algorithm : 'SHA1',
      digits: params.digits === '8' ? 8 : 6,
      period: Number(params.period) > 0 ? Number(params.period) : 30,
      notes: '',
    }
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value)
    } catch (e) {
      return value
    }
  }

  function formatCode(code) {
    if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3)
    if (code.length === 8) return code.slice(0, 4) + ' ' + code.slice(4)
    return code
  }

  var api = {
    base32Decode: base32Decode,
    normalizeSecret: normalizeSecret,
    isValidSecret: isValidSecret,
    hotpFromKey: hotpFromKey,
    totp: totp,
    parseOtpauthUri: parseOtpauthUri,
    formatCode: formatCode,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.RiteTotp = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
