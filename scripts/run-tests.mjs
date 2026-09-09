import { build } from 'vite'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const directory = await mkdtemp(join(tmpdir(), 'langqueue-tests-'))
try {
  const files = (await readdir('tests')).filter((file) => file.endsWith('.test.mjs'))
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: true,
      target: 'node24',
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: files.map((file) => join('tests', file)),
        output: { entryFileNames: '[name].mjs' },
      },
    },
  })
  const result = spawnSync(process.execPath, ['--test', ...files.map((file) => join(directory, file))], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
