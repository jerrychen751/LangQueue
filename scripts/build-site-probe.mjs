import { build } from 'vite';

export async function buildSiteProbe() {
  const [result] = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: { entry: 'tools/site_probe.ts', formats: ['iife'], name: 'LangQueueProbe' },
    },
  });
  return result.output[0].code;
}
