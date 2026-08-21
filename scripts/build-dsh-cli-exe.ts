/**
 * Build the deepseek-harness-cli single-file executable for the curl|sh, npm, and brew
 * distribution channels. The fixed `@yao-pkg/pkg --sea` route, deploy flags,
 * and artifact layout are owned by
 * .agents/notes/implemented/feature/2026-08-15-dsh-cli-exe-distribution.md.
 * The pipeline is shared with the Python SDK build in scripts/exe-build/.
 */

import type { ExeProduct } from './exe-build/config.ts'
import { BuildCli } from './exe-build/config.ts'
import { buildExeProduct } from './exe-build/pipeline.ts'

/** Short product name used in CLI and log prefixes. */
const LABEL = 'build-dsh-cli-exe'

/** The deepseek-harness-cli product: the `@deepseek-ai/dsh` app packaged as a single exe. */
const CLI_PRODUCT: ExeProduct = {
  label: LABEL,
  deployFilter: 'deepseek-harness-cli-exe-pkg',
  entryBin: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
  outputBasename: 'deepseek-harness-cli',
  // Transient staging under the gitignored dist-exe/ tree; unlike the Python
  // node carrier, the CLI closure is never a published artifact.
  stagingDir: 'dist-exe/.staging/cli',
  deploySourceNodeModules: 'apps/cli/exe/node_modules',
  deployOnlyDocs: [],
  linuxPtyPackageDir: 'packages/subprocess/subprocess-local/node_modules/node-pty',
  ripgrepSidecar: true,
  // Runtime-read data trees the booted profiles read: the shipped
  // agent-preset root under @deepseek-ai/dsh's own config, and the web
  // frontend dist the web profile serves.
  requiredAssets: [
    'node_modules/@deepseek-ai/dsh/config/**/*',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*',
    // sharp's lib/ tree also contains a compile-time glibconfig.h. Only the
    // native modules and shared libraries are read after installation.
    'node_modules/@img/sharp-*/lib/**/*.{node,dylib,so*,dll}',
  ],
  closureManifest: 'apps/cli/exe/package.json',
  notePath: '.agents/notes/implemented/feature/2026-08-15-dsh-cli-exe-distribution.md',
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2), CLI_PRODUCT)
  await buildExeProduct(CLI_PRODUCT, cli)
}

await main()
