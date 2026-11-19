import fs from 'node:fs'
import { newerVersion } from '../desktop.mjs'

const { name, version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const CHANNEL = 'https://caffrey-li.github.io/QuotaPot/dsh/'
const VERSION = /^\d+\.\d+\.\d+$/

export function createUpdater(getManager) {
  let pending

  async function check() {
    try {
      const response = await fetch(new URL('latest.json', CHANNEL), {
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const manifest = await response.json()
      if (manifest?.name !== name || typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) {
        throw new Error('更新清单格式无效')
      }
      const file = new URL(`${name}-${manifest.version}.tgz`, CHANNEL).href
      if (manifest.file !== file) throw new Error('更新包地址与发布清单不符')
      return { ok: true, current: version, latest: manifest.version, newer: newerVersion(manifest.version, version) }
    } catch (error) {
      return { ok: false, current: version, error: `检查更新失败：${error.message}` }
    }
  }

  async function update() {
    const manager = getManager()
    if (typeof manager?.installBundle !== 'function') {
      return { ok: false, error: '当前 DSH 配置没有可用的插件管理器' }
    }
    const found = await check()
    if (!found.ok) return found
    if (!found.newer) return { ok: true, upToDate: true, version }
    const installed = (await manager.listBundles()).find((bundle) => bundle.name === name && bundle.installed)
    if (installed?.version && !newerVersion(found.latest, installed.version)) {
      return { ok: true, version: installed.version, restartRequired: true }
    }
    // A versioned spec lets DSH replace the dependency in place and restore it if installation fails.
    const file = new URL(`${name}-${found.latest}.tgz`, CHANNEL).href
    const result = await manager.installBundle(file, { enabled: installed?.enabled ?? true })
    if (result.error || !['applied', 'restart-required'].includes(result.application) ||
        result.bundle !== name || result.version !== found.latest) {
      return { ok: false, error: `DSH 更新失败：${result.error?.code ?? result.application}` }
    }
    return { ok: true, version: found.latest, restartRequired: result.application === 'restart-required' }
  }

  function install() {
    pending ??= update().catch((error) => ({ ok: false, error: `DSH 更新失败：${error.message}` }))
      .finally(() => { pending = undefined })
    return pending
  }

  return { check, install }
}
