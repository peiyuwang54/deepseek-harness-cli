/**
 * Build the SDK runtime executables and Python node carrier. The fixed
 * `@yao-pkg/pkg --sea` route, deploy flags, and artifact layout are owned by
 * .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md.
 * The pipeline itself is shared with the dsh CLI build in scripts/exe-build/.
 */

import { statSync } from 'node:fs'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { BuildCli, type ExeProduct } from './exe-build/config.ts'
import { buildExeProduct } from './exe-build/pipeline.ts'

const root = resolve(import.meta.dirname, '..')

/** Short product name used in CLI and log prefixes. */
const LABEL = 'build-exe-for-python-sdk'
/** Python package destination; created when absent. */
const PYTHON_RUNTIME_DIR = 'python/sdk-runtime/src/deepseek_harness_runtime/runtime'
/** The deployed closure doubles as the node-mode carrier. */
const PYTHON_NODE_SUBDIR = 'node'

/** The SDK product: the JSON-RPC agent packaged for the Python runtime. */
const SDK_PRODUCT: ExeProduct = {
  label: LABEL,
  deployFilter: 'dsh-jsonrpc-agent-pkg',
  entryBin: 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
  outputBasename: 'dsh-jsonrpc-agent-pkg',
  stagingDir: `${PYTHON_RUNTIME_DIR}/${PYTHON_NODE_SUBDIR}`,
  deploySourceNodeModules: 'python/sdk-runtime/node_modules',
  deployOnlyDocs: ['README.md', 'README.zh.md', 'README.i18n.yaml'],
  linuxPtySource: 'packages/subprocess/subprocess-local/node_modules/node-pty/build/Release/pty.node',
  // The JSON-RPC closure composes no profile bundles and ships no config or
  // frontend trees; only the generic bundle-overlay check applies to it.
  requiredAssets: [],
  closureManifest: 'python/sdk-runtime/package.json',
  notePath: '.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md',
}

/**
 * Copy each product into the Python runtime package. The deployed node
 * carrier is already in place, and `dist-exe/` retains upload copies.
 * @param products - the product paths returned by ExeBuild.pack.
 * @param dryRun - whether to print instead of copy.
 */
async function syncToPythonRuntime(products: readonly string[], dryRun: boolean): Promise<void> {
  const destDir = resolve(root, PYTHON_RUNTIME_DIR)
  if (dryRun) {
    for (const path of products) {
      console.log(`${LABEL}: [dry-run] cp ${path} ${join(destDir, basename(path))}`)
    }
    return
  }
  await mkdir(destDir, { recursive: true })
  for (const path of products) {
    const destination = join(destDir, basename(path))
    await copyFile(path, destination)
    await chmod(destination, statSync(path).mode & 0o777)
    console.log(`${LABEL}: synced ${destination}`)
  }
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2), SDK_PRODUCT)
  const products = await buildExeProduct(SDK_PRODUCT, cli)
  await syncToPythonRuntime(products, cli.dryRun)
}

await main()
