/**
 * Shared single-file executable build pipeline. A product (ExeProduct) supplies
 * its deploy root, entry, and staging layout; ExeBuild then verifies the closure,
 * deploys it, verifies runtime-data asset coverage, injects pkg assets, and
 * packs each requested target. The staged closure is symlink-free, and
 * whole-tree assets cover Cordis's runtime imports that pkg cannot discover
 * statically.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { OUT_DIR, PKG_SPEC, Target, productFileName, type BuildCli, type ExeProduct } from './config.ts'
import { ASSET_GLOBS, collectBundlePatchOverlays, expandGlob, findUncoveredAssets } from './asset-coverage.ts'
import { copyPackageTree, materializePackageLinks } from './package-tree.ts'
import { resolveLinuxNodePtyAddon } from '../build-exe-for-python-sdk-native-pty.ts'

const root = resolve(import.meta.dirname, '..', '..')

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Sequential build pipeline for one product. Subprocesses inherit stdio and
 * errors include the command; dry runs print commands and filesystem changes.
 */
class ExeBuild {
  /** The cleared deploy target and pkg input. */
  readonly staging: string
  private readonly outDir = resolve(root, OUT_DIR)

  constructor(
    private readonly product: ExeProduct,
    private readonly cli: BuildCli,
  ) {
    this.staging = resolve(root, product.stagingDir)
  }

  /** Verify the product's closure before compiling or packaging. */
  async verifyClosure(): Promise<void> {
    // Call tsx directly: `pnpm run` inserts a `--` separator, which Node's
    // parseArgs treats as end-of-options and turns the flag into a positional.
    await this.run('runtime dependency closure', pnpmBin(), [
      'exec',
      'tsx',
      'scripts/verify-runtime-closure.ts',
      `--manifest=${this.product.closureManifest}`,
    ])
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log(`${this.product.label}: skipping pnpm run build (--skip-build)`)
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
  }

  /** Clear and deploy the runtime closure into the staging directory. */
  async deployStaging(): Promise<void> {
    if (this.staging === root || root.startsWith(this.staging + sep)) {
      throw new Error(`${this.product.label}: refusing to clear staging dir ${this.staging}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`${this.product.label}: [dry-run] rm -rf ${this.staging}`)
    else await rm(this.staging, { recursive: true, force: true })
    await this.run('deploy', pnpmBin(), [
      '--filter',
      this.product.deployFilter,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      // Product closures intentionally exclude product-only packages and patches.
      '--config.allow-unused-patches=true',
      this.staging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    if (this.cli.dryRun) {
      for (const name of this.product.deployOnlyDocs) {
        console.log(`${this.product.label}: [dry-run] rm -f ${join(this.staging, name)}`)
      }
    } else {
      await Promise.all(this.product.deployOnlyDocs.map(name => rm(join(this.staging, name), { force: true })))
    }
  }

  /**
   * Restore direct packages that pnpm's legacy hoister places beside the deploy
   * source instead of in the target. The runtime manifest supplies every peer,
   * so package-local node_modules trees are omitted to preserve one flat Cordis
   * instance and a symlink-free packaged payload.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] restore direct dependencies omitted by legacy deploy`)
      return
    }
    const manifestPath = join(this.staging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(root, this.product.deploySourceNodeModules)
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.staging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `${this.product.label}: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await copyPackageTree(source, destination)
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.staging, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`${this.product.label}: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`${this.product.label}: restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] materialize staged package links`)
      return
    }
    await materializePackageLinks(join(this.staging, 'node_modules'))
  }

  /**
   * Verify that every file the composed application reads at runtime is
   * covered by an asset glob: each staged `dsh.bundle.patch` overlay plus every
   * file the product's `requiredAssets` globs select. A `requiredAssets` glob
   * that matches nothing fails here, so an unbuilt input (for example a
   * frontend dist that a skipped `pnpm run build` never produced) fails the
   * build instead of the user's first run.
   */
  async verifyAssetCoverage(): Promise<void> {
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] verify pkg asset coverage for ${this.product.requiredAssets.join(', ') || '(bundle overlays only)'}`)
      return
    }
    const required = new Set(await collectBundlePatchOverlays(this.staging))
    for (const pattern of this.product.requiredAssets) {
      const files = expandGlob(this.staging, pattern)
      if (files.length === 0) {
        throw new Error(`${this.product.label}: required asset glob ${pattern} matched nothing under ${this.staging}; the staged closure is incomplete.`)
      }
      for (const file of files) required.add(file)
    }
    const uncovered = findUncoveredAssets(this.staging, [...required])
    if (uncovered.length > 0) {
      throw new Error(`${this.product.label}: runtime-read staged files are not covered by pkg assets (add a matching ASSET_GLOBS entry): ${uncovered.join(', ')}.`)
    }
    console.log(`${this.product.label}: ${required.size} runtime-read staged files are covered by pkg assets.`)
  }

  /** Add the executable entry and pkg assets to the staged manifest. */
  async injectPkgConfig(): Promise<void> {
    const patch = { bin: this.product.entryBin, pkg: { assets: ASSET_GLOBS } }
    const manifestPath = join(this.staging, 'package.json')
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
      return
    }
    if (!existsSync(manifestPath)) {
      throw new Error(`${this.product.label}: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
    }
    if (!existsSync(join(this.staging, this.product.entryBin))) {
      throw new Error(`${this.product.label}: ${join(this.staging, this.product.entryBin)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
    console.log(`${this.product.label}: injected pkg config into ${manifestPath}`)
  }

  /**
   * Package one target; SEA mode accepts one target per invocation.
   * @param target - the pkg target triple to build.
   * @returns the executable and configured sidecar paths.
   */
  async pack(target: Target): Promise<string[]> {
    const product = join(this.outDir, productFileName(this.product.outputBasename, target))
    await this.prepareNativePty(target)
    if (!this.cli.dryRun) await mkdir(this.outDir, { recursive: true })
    await this.run(`pkg ${target.spec}`, pnpmBin(), [
      'dlx',
      PKG_SPEC,
      this.staging,
      '--sea',
      '--targets',
      target.spec,
      '--output',
      product,
    ])
    if (!this.cli.dryRun && !existsSync(product)) {
      throw new Error(`${this.product.label}: product ${product} is missing after the pkg run; inspect ${this.outDir}.`)
    }
    const products = [product]
    if (this.product.ripgrepSidecar) products.push(await this.copyRipgrepSidecar(target, product))
    if (target.platform !== 'macos') return products
    const spawnHelper = `${product}-spawn-helper`
    const source = join(this.staging, 'node_modules', 'node-pty', 'prebuilds', `darwin-${target.arch}`, 'spawn-helper')
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] cp ${source} ${spawnHelper}`)
    } else {
      await copyFile(source, spawnHelper)
      await chmod(spawnHelper, 0o755)
    }
    return [...products, spawnHelper]
  }

  /** Copy the target ripgrep binary beside the executable for native spawning. */
  private async copyRipgrepSidecar(target: Target, product: string): Promise<string> {
    const platform = target.platform === 'macos' ? 'darwin' : target.platform === 'win' ? 'win32' : 'linux'
    const executable = target.platform === 'win' ? 'rg.exe' : 'rg'
    const source = join(
      this.staging,
      'node_modules',
      '@vscode',
      `ripgrep-${platform}-${target.arch}`,
      'bin',
      executable,
    )
    const destination = `${product}-rg`
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] cp ${source} ${destination}`)
      return destination
    }
    if (!existsSync(source)) {
      throw new Error(`${this.product.label}: target ripgrep binary is missing at ${source}.`)
    }
    await copyFile(source, destination)
    await chmod(destination, 0o755)
    return destination
  }

  /**
   * Put the target node-pty addon in the staged closure. Linux npm installs
   * build it from source, but legacy deploy omits that side-effect directory.
   * @param target - the pkg target whose native addon is being staged.
   */
  private async prepareNativePty(target: Target): Promise<void> {
    const stagedBuild = join(this.staging, 'node_modules', 'node-pty', 'build')
    if (this.cli.dryRun) console.log(`${this.product.label}: [dry-run] rm -rf ${stagedBuild}`)
    else await rm(stagedBuild, { recursive: true, force: true })
    if (target.platform !== 'linux') return
    const source = resolveLinuxNodePtyAddon(
      join(root, this.product.linuxPtyPackageDir),
      target.arch,
      this.product.label,
    )
    const destination = join(stagedBuild, 'Release', 'pty.node')
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] cp ${source} ${destination}`)
      return
    }
    const host = Target.host(this.product.label)
    if (target.platform !== host.platform || target.arch !== host.arch) {
      throw new Error(
        `${this.product.label}: build the Linux runtime on its target architecture; `
        + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  /**
   * Print each product path and, outside dry-run mode, its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    console.log(this.cli.dryRun ? `${this.product.label}: [dry-run] would produce:` : `${this.product.label}: products:`)
    for (const path of products) {
      if (this.cli.dryRun) {
        console.log(`  ${path}`)
        continue
      }
      const megabytes = statSync(path).size / (1024 * 1024)
      console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
    }
  }

  /**
   * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors
   * include the command; dry runs only print it.
   * @param label - the step name used in logs and error messages.
   * @param command - the executable.
   * @param args - its arguments.
   */
  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`${this.product.label}: [dry-run] ${printable}`)
      return
    }
    console.log(`${this.product.label}: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        // Node cannot execute Windows .cmd shims directly. Product commands and
        // their arguments are fixed by this pipeline or parsed from closed target enums.
        shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
        // Artifact builds must not mutate or validate a developer's Git hooks.
        env: { ...process.env, CI: 'true' },
      })
      child.once('error', (error) => {
        reject(new Error(`${this.product.label}: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`${this.product.label}: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

/**
 * Run the shared executable pipeline for one parsed product invocation.
 * @param product - Product-specific deploy and artifact configuration.
 * @param cli - Parsed build targets and switches.
 * @returns Paths of every packed executable and sidecar.
 */
export async function buildExeProduct(product: ExeProduct, cli: BuildCli): Promise<string[]> {
  const pipeline = new ExeBuild(product, cli)
  console.log(`${product.label}: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`${product.label}: staging: ${pipeline.staging}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployStaging()
  await pipeline.verifyAssetCoverage()
  await pipeline.injectPkgConfig()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
  return products
}
