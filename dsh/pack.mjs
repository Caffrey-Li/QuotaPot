import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANNEL } from './update.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const output = process.argv[2]
if (!output || !process.env.npm_execpath) throw new Error('用法：npm run pack:dsh -- <产物目录>')
const destination = path.resolve(output)
fs.mkdirSync(destination, { recursive: true })
const stage = fs.mkdtempSync(path.join(destination, '.quotapot-pack-'))
try {
  const stem = `${name}-${version}`
  const archive = `${stem}.tgz`
  const bundle = path.join(stage, archive)
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--pack-destination', stage], {
    cwd: root,
    stdio: 'ignore',
  })
  const assets = fs.readFileSync(bundle)
  const folder = path.join(stage, stem)
  fs.mkdirSync(folder)
  execFileSync('tar', ['-xzf', bundle, '--strip-components=1', '-C', folder])
  const zip = `${stem}.zip`
  if (process.platform === 'win32') execFileSync('tar.exe', ['-a', '-cf', zip, stem], { cwd: stage })
  else execFileSync('zip', ['-qr', zip, stem], { cwd: stage })
  const file = new URL(archive, CHANNEL).href
  fs.writeFileSync(path.join(stage, 'latest.json'), JSON.stringify({
    name, version, file,
    channel: new URL('latest.tgz', CHANNEL).href,
    tgz: file,
    sha256: createHash('sha256').update(assets).digest('hex'),
    size: assets.length,
    releasedAt: new Date().toISOString(),
  }, null, 2) + '\n')
  fs.copyFileSync(bundle, path.join(stage, 'latest.tgz'))
  for (const artifact of [archive, zip, 'latest.tgz', 'latest.json']) {
    fs.copyFileSync(path.join(stage, artifact), path.join(destination, artifact))
  }
  console.log(destination)
} finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
