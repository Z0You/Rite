const T = require('../authenticator/totp.js')
const assert = require('assert')
// RFC 6238 Appendix B test vectors (8 digits)
const keys = {
  SHA1: Buffer.from('12345678901234567890'),
  SHA256: Buffer.from('12345678901234567890123456789012'),
  SHA512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
}
const vectors = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
]
function b32(buf) { const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,val=0,out=''; for (const b of buf){val=(val<<8)|b;bits+=8;while(bits>=5){out+=a[(val>>>(bits-5))&31];bits-=5}} if(bits>0) out+=a[(val<<(5-bits))&31]; return out }
;(async () => {
  for (const [t, s1, s256, s512] of vectors) {
    for (const [alg, exp] of [['SHA1', s1], ['SHA256', s256], ['SHA512', s512]]) {
      const r = await T.totp({ secret: b32(keys[alg]), digits: 8, period: 30, algorithm: alg }, t * 1000)
      assert.strictEqual(r.code, exp, `${alg} @${t}: got ${r.code} want ${exp}`)
    }
  }
  const p = T.parseOtpauthUri('otpauth://totp/ACME%20Co:john.doe@email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30')
  assert.deepStrictEqual([p.service, p.account, p.digits, p.period], ['ACME Co', 'john.doe@email.com', 6, 30])
  assert.throws(() => T.parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP'), /TOTP/)
  assert.throws(() => T.parseOtpauthUri('https://example.com'), /otpauth/)
  assert.throws(() => T.base32Decode('abc!'), /not valid/)
  assert.strictEqual(T.formatCode('123456'), '123 456')
  const r = await T.totp({ secret: 'jbsw y3dp ehpk 3pxp' }, 0)
  assert.strictEqual(r.remaining, 30)
  console.log('All TOTP tests passed (18 RFC 6238 vectors + parsing)')
})().catch(e => { console.error(e.message); process.exit(1) })
