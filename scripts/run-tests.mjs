import { build } from 'vite';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Bundles stay inside the repository so their external imports, such as playwright-core, resolve from node_modules
await mkdir(join('node_modules', '.tmp'), { recursive: true });
const directory = await mkdtemp(resolve('node_modules', '.tmp', 'langqueue-tests-'));
try {
  // `npm test -- site-replay` runs only the test files whose names contain an argument
  const filters = process.argv.slice(2);
  const files = (await readdir('tests')).filter((file) => file.endsWith('.test.mjs') && (!filters.length || filters.some((filter) => file.includes(filter))));
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
  });
  const result = spawnSync(process.execPath, ['--test', ...files.map((file) => join(directory, file))], { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
