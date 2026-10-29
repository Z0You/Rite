// Runs Rite's editor tests: node packages/web/rite-editors/tests/run.js
const { execFileSync } = require('child_process')
const path = require('path')
for (const file of ['totp.test.js', 'csv.test.js']) {
  execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' })
}
