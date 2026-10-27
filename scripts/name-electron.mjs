import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url)
  const plist = join(require.resolve('electron'), '..', 'dist/Electron.app/Contents/Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', 'SuikoPen', plist])
    }
  }
}
