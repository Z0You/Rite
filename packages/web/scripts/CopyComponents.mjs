import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { doesDirExist, emptyExistingDir, ensureDirExists, copyFileOrDir } from '../../../scripts/ScriptUtils.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Open-source (AGPL) editors published on npm. Rite does not ship the authenticator,
 * spreadsheet, minimal-markdown or task editors from upstream: their packages carry no
 * open-source license. Rite's own Authenticator and Spreadsheet live in ../rite-editors.
 */
const components = {
  '@standardnotes/bold-editor': 'org.standardnotes.bold-editor',
  '@standardnotes/classic-code-editor': 'org.standardnotes.code-editor',
  '@standardnotes/markdown-basic': 'org.standardnotes.simple-markdown-editor',
  '@standardnotes/markdown-hybrid': 'org.standardnotes.advanced-markdown-editor',
  '@standardnotes/markdown-math': 'org.standardnotes.fancy-markdown-editor',
  '@standardnotes/markdown-visual': 'org.standardnotes.markdown-visual-editor',
  '@standardnotes/rich-text': 'org.standardnotes.plus-editor',
}

const BasePath = path.join(__dirname, '../../../node_modules')
const RiteEditorsPath = path.join(__dirname, '../rite-editors')
const AssetsPath = 'src/components/assets'

const FilesToCopy = ['index.html', 'dist', 'build', 'package.json']

const copyComponentAssets = async (srcComponentPath, destination, exludedFilesGlob) => {
  if (!doesDirExist(srcComponentPath)) {
    return false
  }

  emptyExistingDir(destination)
  ensureDirExists(destination)

  for (const file of FilesToCopy) {
    const srcFilePath = path.join(srcComponentPath, file)
    if (!fs.existsSync(srcFilePath)) {
      continue
    }

    const targetFilePath = path.join(destination, file)
    copyFileOrDir(srcFilePath, targetFilePath, exludedFilesGlob)
  }

  return true
}

for (const packageName of Object.keys(components)) {
  const identifier = components[packageName]
  const packagePath = `${BasePath}/${packageName}`

  const assetsPath = `${AssetsPath}/${identifier}`
  fs.mkdirSync(assetsPath, { recursive: true })

  await copyComponentAssets(packagePath, assetsPath, '**/package.json')
}

/* ------------------------------------------------------------- Rite editors */

const requireFile = (file) => {
  if (!fs.existsSync(file)) {
    throw new Error(`Rite editors: missing ${file}. Run "yarn install" first.`)
  }
  return file
}

const copyInto = (src, destDir, name = path.basename(src)) => {
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(requireFile(src), path.join(destDir, name))
}

const copyRiteEditor = (folder, identifier) => {
  const destination = `${AssetsPath}/${identifier}`
  if (doesDirExist(destination)) {
    emptyExistingDir(destination)
  }
  ensureDirExists(destination)
  fs.cpSync(path.join(RiteEditorsPath, folder), destination, { recursive: true })
  return destination
}

const shared = copyRiteEditor('shared', 'app.rite.shared')
copyInto(`${BasePath}/@standardnotes/component-relay/dist/dist.js`, shared, 'component-relay.js')
copyInto(`${BasePath}/@standardnotes/component-relay/LICENSE`, shared, 'component-relay.LICENSE')

const authenticator = copyRiteEditor('authenticator', 'app.rite.authenticator')
copyInto(`${BasePath}/jsqr/dist/jsQR.js`, `${authenticator}/lib`)
copyInto(`${BasePath}/jsqr/LICENSE`, `${authenticator}/lib`, 'jsQR.LICENSE')

const spreadsheet = copyRiteEditor('spreadsheet', 'app.rite.spreadsheet')
const xsDist = `${BasePath}/x-data-spreadsheet/dist`
for (const file of fs.readdirSync(requireFile(xsDist))) {
  if (/\.(js|css|svg)$/.test(file)) {
    copyInto(`${xsDist}/${file}`, `${spreadsheet}/lib`)
  }
}
copyInto(`${BasePath}/x-data-spreadsheet/LICENSE`, `${spreadsheet}/lib`, 'x-spreadsheet.LICENSE')
