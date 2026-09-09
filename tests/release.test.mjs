import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function runValidation(change) {
  const directory = mkdtempSync(join(tmpdir(), 'langqueue-release-'))
  try {
    const manifest = {
      manifest_version: 3, name: 'Fixture', version: '1.0.0', description: 'Test extension',
      permissions: ['storage'], host_permissions: ['https://example.com/*'],
      background: { service_worker: 'worker.js', type: 'module' },
      action: { default_popup: 'popup.html', default_icon: { 16: 'icons/icon.png' } },
      icons: { 16: 'icons/icon.png' },
      content_scripts: [{ matches: ['https://example.com/*'], js: ['content.js'], run_at: 'document_idle' }],
      web_accessible_resources: [{ matches: ['https://example.com/*'], resources: ['assets/*.js'] }],
    }
    const sourcePath = join(directory, 'source.json')
    writeFileSync(sourcePath, JSON.stringify(manifest))
    for (const file of ['worker.js', 'popup.html', 'icons/icon.png', 'content.js', 'assets/shared.js']) {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      writeFileSync(join(directory, file), 'fixture')
    }
    change?.(manifest, directory)
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest))
    return spawnSync(process.execPath, [resolve('scripts/validate-build.mjs'), directory, sourcePath], { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('validates compiled manifest entries and wildcard resources', () => {
  const result = runValidation()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Validated Fixture 1.0.0/)
})

test('rejects a missing emitted file', () => {
  const result = runValidation((manifest, directory) => rmSync(join(directory, 'content.js')))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing build resource: content.js/)
})

test('rejects a TypeScript service worker in a release build', () => {
  const result = runValidation(manifest => { manifest.background.service_worker = 'worker.ts' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /JavaScript service worker/)
})

test('rejects build permissions that differ from source', () => {
  const result = runValidation(manifest => { manifest.permissions.push('tabs') })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /changed permissions/)
})

test('rejects a changed content script site', () => {
  const result = runValidation(manifest => { manifest.content_scripts[0].matches = ['https://unexpected.example/*'] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /changed supported sites/)
})

test('rejects resource paths outside the build directory', () => {
  const result = runValidation(manifest => { manifest.icons[16] = '../outside.png' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Invalid resource path/)
})

test('rejects Finder metadata and directory placeholders anywhere in the package', () => {
  for (const file of ['.DS_Store', 'icons/.gitkeep']) {
    const result = runValidation((manifest, directory) => writeFileSync(join(directory, file), 'unwanted'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unexpected build artifact/)
  }
})

test('package cleanup removes metadata while retaining emitted assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'langqueue-package-'))
  try {
    mkdirSync(join(directory, 'dist/icons'), { recursive: true })
    for (const file of ['.DS_Store', 'icons/.gitkeep', 'icons/icon.png']) writeFileSync(join(directory, 'dist', file), 'fixture')
    const result = spawnSync(process.execPath, [resolve('scripts/clean-build.mjs')], { cwd: directory, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(directory, 'dist/.DS_Store')), false)
    assert.equal(existsSync(join(directory, 'dist/icons/.gitkeep')), false)
    assert.equal(readFileSync(join(directory, 'dist/icons/icon.png'), 'utf8'), 'fixture')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
