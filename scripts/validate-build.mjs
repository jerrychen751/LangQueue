import assert from 'node:assert/strict'
import { globSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

try {
  const directory = realpathSync(resolve(process.argv[2] || 'dist'))
  const source = JSON.parse(readFileSync(resolve(process.argv[3] || 'manifest.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 3, 'Build must use Manifest V3')
  for (const field of ['name', 'version', 'description', 'permissions', 'host_permissions', 'commands']) {
    assert.deepEqual(manifest[field], source[field], `Built manifest changed ${field}`)
  }
  assert.ok(manifest.background?.service_worker?.endsWith('.js'), 'Build must contain a JavaScript service worker')
  assert.equal(manifest.background.type, 'module', 'Service worker must be a module')
  assert.ok(manifest.action?.default_popup?.endsWith('.html'), 'Build must contain a popup HTML entry')
  assert.equal(manifest.content_scripts?.length, source.content_scripts.length, 'Build changed content script count')
  const resources = [manifest.background.service_worker, manifest.action.default_popup]
  resources.push(...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {}))
  for (const [index, script] of manifest.content_scripts.entries()) {
    assert.deepEqual(script.matches, source.content_scripts[index].matches, 'Build changed supported sites')
    assert.equal(script.run_at, source.content_scripts[index].run_at, 'Build changed content script timing')
    assert.ok(script.js?.length, 'Content script must reference JavaScript')
    assert.ok(script.js.every(path => path.endsWith('.js')), 'Content scripts must be compiled JavaScript')
    resources.push(...script.js, ...(script.css || []))
  }
  for (const group of manifest.web_accessible_resources || []) resources.push(...group.resources)
  for (const resource of new Set(resources)) {
    assert.equal(typeof resource, 'string', 'Resource path must be a string')
    assert.ok(resource && !isAbsolute(resource) && !resource.includes('..') && !resource.includes(':'), `Invalid resource path: ${resource}`)
    const files = globSync(resource, { cwd: directory })
    assert.ok(files.length, `Missing build resource: ${resource}`)
    for (const file of files) {
      const path = realpathSync(resolve(directory, file))
      const local = relative(directory, path)
      assert.ok(local && !local.startsWith(`..${sep}`) && !isAbsolute(local), `Resource escapes build: ${resource}`)
      assert.ok(statSync(path).isFile(), `Build resource is not a file: ${resource}`)
      assert.ok(statSync(path).size > 0, `Build resource is empty: ${resource}`)
    }
  }
  process.stdout.write(`Validated ${manifest.name} ${manifest.version}: ${new Set(resources).size} manifest resource paths.\n`)
} catch (error) {
  process.stderr.write(`Build validation failed: ${error.message}\n`)
  process.exitCode = 1
}
