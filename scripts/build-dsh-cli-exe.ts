/**
 * Build the dsh CLI single-file executable for the curl|sh, npm, and brew
 * distribution channels. The fixed `@yao-pkg/pkg --sea` route, deploy flags,
 * and artifact layout are owned by
 * .agents/notes/implemented/feature/2026-08-15-dsh-cli-exe-distribution.md.
 * The pipeline is shared with the Python SDK build in scripts/exe-build/.
 */

import type { ExeProduct } from './exe-build/config.ts'
import { BuildCli } from './exe-build/config.ts'
import { ExeBuild } from './exe-build/pipeline.ts'

/** Short product name used in CLI and log prefixes. */
const LABEL = 'build-dsh-cli-exe'

/** The dsh CLI product: the `@deepseek-ai/dsh` app packaged as a single exe. */
const CLI_PRODUCT: ExeProduct = {
  label: LABEL,
  deployFilter: 'dsh-cli-exe-pkg',
  entryBin: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
  outputBasename: 'dsh',
  // Transient staging under the gitignored dist-exe/ tree; unlike the Python
  // node carrier, the CLI closure is never a published artifact.
  stagingDir: 'dist-exe/.staging/cli',
  deploySourceNodeModules: 'apps/cli/exe/node_modules',
  deployOnlyDocs: [],
  linuxPtySource: 'packages/subprocess/subprocess-local/node_modules/node-pty/build/Release/pty.node',
  closureManifest: 'apps/cli/exe/package.json',
  notePath: '.agents/notes/implemented/feature/2026-08-15-dsh-cli-exe-distribution.md',
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2), CLI_PRODUCT)
  const pipeline = new ExeBuild(CLI_PRODUCT, cli)
  console.log(`${LABEL}: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`${LABEL}: staging: ${pipeline.staging}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployStaging()
  await pipeline.injectPkgConfig()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
}

await main()
