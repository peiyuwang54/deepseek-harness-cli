/**
 * Build the Windows directory package from this checkout. The route is
 * `pnpm run build:lib` → `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod`
 * into `dist-windows/dsh`, then copy the host `node.exe` and write `dsh.cmd`.
 * Ownership: .agents/notes/implemented/feature/2026-08-15-windows-cli-directory-package.md.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSafePackageDestination,
  packWindowsCliUsage,
  parsePackWindowsCliArgs,
  WINDOWS_CLI_BUILD_SCRIPT,
  WINDOWS_CLI_BRANDED_LAUNCHER_NAME,
  WINDOWS_CLI_DEPLOY_FILTER,
  WINDOWS_CLI_DIST_DIR,
  WINDOWS_CLI_ENTRY,
  WINDOWS_CLI_LAUNCHER_NAME,
  WINDOWS_CLI_MANIFEST_NAME,
  WINDOWS_CLI_NODE_NAME,
  WINDOWS_CLI_PACKAGE_DIRNAME,
  WINDOWS_CLI_REQUIRED_RELATIVE_PATHS,
  windowsCliInstallManifest,
  windowsCliLauncherScript,
  windowsCliZipName,
  type PackWindowsCliArgs,
} from './windows-cli-package.ts'
import { copyPackageTree, materializePackageLinks } from './exe-build/package-tree.ts'

const root = resolve(import.meta.dirname, '..')
const DEPLOY_ONLY_DOCS = ['README.md', 'README.zh.md', 'README.i18n.yaml']
const HOIST_SOURCES = ['apps/cli/node_modules', 'node_modules'] as const
const NATIVE_MARKERS = [
  join('node_modules', 'node-pty'),
  join('node_modules', 'koffi'),
  join('node_modules', '@vscode', 'ripgrep'),
] as const

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Environment for packer subprocesses.
 *
 * `CI=true` makes `pnpm run` treat the checkout as a production install and
 * delete workspace `devDependencies` (the `install.ps1` comment names the
 * same footgun). A developer machine running the Windows installer must keep
 * those packages so `build:lib` can still compile.
 * @param base - usually `process.env`.
 * @returns a copy that cannot enable a production prune.
 */
export function packerSubprocessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  delete env.CI
  env.npm_config_production = 'false'
  env.NODE_ENV = base.NODE_ENV === 'production' ? 'development' : (base.NODE_ENV ?? 'development')
  return env
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
export function formatPackCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Sequential pack pipeline. Subprocesses inherit stdio; dry runs print commands
 * and filesystem changes without writing `dist-windows/`.
 */
export class WindowsCliPack {
  /** Cleared destination of the portable tree. */
  readonly packageDir = resolve(root, WINDOWS_CLI_DIST_DIR, WINDOWS_CLI_PACKAGE_DIRNAME)
  private readonly distDir = resolve(root, WINDOWS_CLI_DIST_DIR)
  private workspacePackages: Map<string, string> | undefined

  constructor(private readonly cli: PackWindowsCliArgs) {}

  /**
   * Refuse a non-Windows host unless this is a dry run. Native addons and
   * `node.exe` must come from a win32 machine.
   */
  assertHost(): void {
    if (this.cli.dryRun) return
    if (process.platform !== 'win32') {
      throw new Error('pack-windows-cli: this packer must run on Windows so node.exe and native addons match the target.')
    }
    if (process.arch !== 'x64' && process.arch !== 'arm64') {
      throw new Error(`pack-windows-cli: unsupported architecture ${process.arch}; expected x64 or arm64.`)
    }
  }

  /** Build host and client libraries unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('pack-windows-cli: skipping pnpm run build:lib (--skip-build)')
      return
    }
    await this.run('build', pnpmBin(), ['run', WINDOWS_CLI_BUILD_SCRIPT])
  }

  /** Clear and deploy the CLI production closure into `dist-windows/dsh`. */
  async deployPackage(): Promise<void> {
    assertSafePackageDestination(root, this.packageDir)
    if (this.cli.dryRun) {
      console.log(`pack-windows-cli: [dry-run] rm -rf ${this.packageDir}`)
    } else {
      await rm(this.packageDir, { recursive: true, force: true })
      await mkdir(this.distDir, { recursive: true })
    }
    await this.run('deploy', pnpmBin(), [
      '--filter',
      WINDOWS_CLI_DEPLOY_FILTER,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      this.packageDir,
    ])
    await this.restoreMissingDependencies()
    await this.materializeStagedLinks()
    if (this.cli.dryRun) {
      for (const name of DEPLOY_ONLY_DOCS) console.log(`pack-windows-cli: [dry-run] rm -f ${join(this.packageDir, name)}`)
      return
    }
    await Promise.all(DEPLOY_ONLY_DOCS.map(name => rm(join(this.packageDir, name), { force: true })))
  }

  /**
   * Copy workspace and hoisted packages that legacy deploy omitted, including
   * transitive `@deepseek-ai/*` packages such as cosmokit. Repeats until a scan
   * adds nothing, because each restored package can declare more dependencies.
   */
  private async restoreMissingDependencies(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('pack-windows-cli: [dry-run] restore missing workspace and hoist dependencies')
      return
    }
    const restored: string[] = []
    let progress = true
    while (progress) {
      progress = false
      for (const dependency of await this.collectDeclaredDependencies()) {
        const destination = join(this.packageDir, 'node_modules', ...dependency.split('/'))
        if (existsSync(destination)) continue
        const source = this.findHoistSource(dependency)
        if (source === undefined) continue
        await copyPackageTree(source, destination)
        restored.push(dependency)
        progress = true
      }
    }
    const missingWorkspace = (await this.collectDeclaredDependencies())
      .filter(name => name.startsWith('@deepseek-ai/'))
      .filter(name => !existsSync(join(this.packageDir, 'node_modules', ...name.split('/'))))
    if (missingWorkspace.length > 0) {
      throw new Error(`pack-windows-cli: workspace packages remain missing: ${missingWorkspace.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`pack-windows-cli: restored missing dependencies: ${restored.join(', ')}`)
    }
  }

  /**
   * @returns dependency and peer names declared by the deployed package and
   *   each top-level package under its `node_modules`.
   */
  private async collectDeclaredDependencies(): Promise<string[]> {
    const names = new Set<string>()
    const addFrom = async (manifestPath: string): Promise<void> => {
      if (!existsSync(manifestPath)) return
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      for (const name of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]) {
        names.add(name)
      }
    }
    await addFrom(join(this.packageDir, 'package.json'))
    const nodeModules = join(this.packageDir, 'node_modules')
    if (!existsSync(nodeModules)) return [...names].sort()
    for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.name.startsWith('@')) {
        if (!entry.isDirectory()) continue
        const scope = join(nodeModules, entry.name)
        for (const child of await readdir(scope, { withFileTypes: true })) {
          if (child.isDirectory()) await addFrom(join(scope, child.name, 'package.json'))
        }
        continue
      }
      if (entry.isDirectory()) await addFrom(join(nodeModules, entry.name, 'package.json'))
    }
    return [...names].sort()
  }

  /**
   * @param dependency - a package name from the deployed manifest.
   * @returns the first hoist source that contains that package, if any.
   */
  private findHoistSource(dependency: string): string | undefined {
    for (const relative of HOIST_SOURCES) {
      const source = join(root, relative, dependency)
      if (existsSync(source)) return source
    }
    return this.loadWorkspacePackages().get(dependency)
  }

  /**
   * @returns workspace package name to checkout directory, including `vendor/`.
   */
  private loadWorkspacePackages(): Map<string, string> {
    if (this.workspacePackages !== undefined) return this.workspacePackages
    const map = new Map<string, string>()
    const directories = [
      ...listPackageDirectories(join(root, 'vendor')),
      ...listPackageDirectories(join(root, 'apps')),
      ...listPackageDirectories(join(root, 'packages')).flatMap(listPackageDirectories),
      join(root, 'native', 'landlock-run'),
      ...listPackageDirectories(join(root, 'native', 'landlock-run', 'packages')),
    ]
    for (const directory of directories) {
      const manifestPath = join(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
      if (typeof manifest.name === 'string' && manifest.name !== '') map.set(manifest.name, directory)
    }
    this.workspacePackages = map
    return map
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('pack-windows-cli: [dry-run] materialize staged package links')
      return
    }
    await materializePackageLinks(join(this.packageDir, 'node_modules'))
  }

  /** Copy Node, write the compatibility and branded launchers, and record the manifest. */
  async writeRuntimeFiles(): Promise<void> {
    const nodeDestination = join(this.packageDir, WINDOWS_CLI_NODE_NAME)
    const launcherDestination = join(this.packageDir, WINDOWS_CLI_LAUNCHER_NAME)
    const brandedLauncherDestination = join(this.packageDir, WINDOWS_CLI_BRANDED_LAUNCHER_NAME)
    const manifestDestination = join(this.packageDir, WINDOWS_CLI_MANIFEST_NAME)
    if (this.cli.dryRun) {
      console.log(`pack-windows-cli: [dry-run] cp ${process.execPath} ${nodeDestination}`)
      console.log(`pack-windows-cli: [dry-run] write ${launcherDestination}`)
      console.log(`pack-windows-cli: [dry-run] write ${brandedLauncherDestination}`)
      console.log(`pack-windows-cli: [dry-run] write ${manifestDestination}`)
      return
    }
    if (!existsSync(join(this.packageDir, WINDOWS_CLI_ENTRY))) {
      throw new Error(`pack-windows-cli: ${join(this.packageDir, WINDOWS_CLI_ENTRY)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    await copyFile(process.execPath, nodeDestination)
    await writeFile(launcherDestination, windowsCliLauncherScript())
    await writeFile(brandedLauncherDestination, windowsCliLauncherScript())
    const version = await this.readCliVersion()
    const manifest = windowsCliInstallManifest({
      version,
      arch: process.arch,
      node: process.versions.node,
    })
    await writeFile(manifestDestination, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  /**
   * @returns the version from the deployed CLI manifest.
   */
  private async readCliVersion(): Promise<string> {
    const manifest = JSON.parse(await readFile(join(this.packageDir, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error('pack-windows-cli: deployed package.json is missing a version.')
    }
    return manifest.version
  }

  /** Fail if the portable tree is missing a required file or native addon. */
  async verifyPackage(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('pack-windows-cli: [dry-run] verify package contents')
      return
    }
    for (const relative of WINDOWS_CLI_REQUIRED_RELATIVE_PATHS) {
      const path = join(this.packageDir, relative)
      if (!existsSync(path)) {
        throw new Error(`pack-windows-cli: packed tree is missing ${relative}.`)
      }
    }
    const missingNative = NATIVE_MARKERS.filter(relative => !existsSync(join(this.packageDir, relative)))
    if (missingNative.length > 0) {
      throw new Error(`pack-windows-cli: packed tree is missing native addons: ${missingNative.join(', ')}.`)
    }
    await this.run('verify', join(this.packageDir, WINDOWS_CLI_NODE_NAME), [
      join(this.packageDir, WINDOWS_CLI_ENTRY),
      '--version',
    ])
  }

  /** Zip the directory tree beside it as `dsh-win32-<arch>.zip`. */
  async zipPackage(): Promise<void> {
    if (this.cli.skipZip) {
      console.log('pack-windows-cli: skipping zip (--skip-zip)')
      return
    }
    const zipPath = join(this.distDir, windowsCliZipName(process.arch))
    if (this.cli.dryRun) {
      console.log(`pack-windows-cli: [dry-run] tar -a -cf ${zipPath} -C ${this.distDir} ${WINDOWS_CLI_PACKAGE_DIRNAME}`)
      return
    }
    await rm(zipPath, { force: true })
    await this.run('zip', 'tar', ['-a', '-cf', zipPath, '-C', this.distDir, WINDOWS_CLI_PACKAGE_DIRNAME])
    if (!existsSync(zipPath)) {
      throw new Error(`pack-windows-cli: zip ${zipPath} is missing after tar.`)
    }
  }

  /** Print the package path and, outside dry-run mode, its size. */
  printProduct(): void {
    if (this.cli.dryRun) {
      console.log(`pack-windows-cli: [dry-run] would produce ${this.packageDir}`)
      return
    }
    const megabytes = directorySize(this.packageDir) / (1024 * 1024)
    console.log(`pack-windows-cli: package ${this.packageDir}  (${megabytes.toFixed(1)} MB)`)
    if (!this.cli.skipZip) {
      const zipPath = join(this.distDir, windowsCliZipName(process.arch))
      const zipMegabytes = statSync(zipPath).size / (1024 * 1024)
      console.log(`pack-windows-cli: zip ${zipPath}  (${zipMegabytes.toFixed(1)} MB)`)
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
    const printable = formatPackCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`pack-windows-cli: [dry-run] ${printable}`)
      return
    }
    console.log(`pack-windows-cli: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: packerSubprocessEnv(),
      })
      child.once('error', (error) => {
        reject(new Error(`pack-windows-cli: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`pack-windows-cli: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

/**
 * @param directory - a directory to measure.
 * @returns the sum of file sizes under it, in bytes.
 */
/**
 * @param directory - a workspace parent such as `vendor/` or `packages/core/`.
 * @returns its immediate subdirectory paths, or an empty list if it is absent.
 */
function listPackageDirectories(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name))
}

function directorySize(directory: string): number {
  let total = 0
  const stack = [directory]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    const metadata = statSync(current)
    if (metadata.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry))
      continue
    }
    total += metadata.size
  }
  return total
}

/**
 * Pack the Windows directory package from this checkout.
 * @param argv - arguments after the Node binary and script.
 */
export async function packWindowsCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  let cli: PackWindowsCliArgs
  try {
    cli = parsePackWindowsCliArgs(argv)
  } catch (error) {
    console.error(`pack-windows-cli: ${error instanceof Error ? error.message : String(error)}\n`)
    console.error(packWindowsCliUsage())
    process.exitCode = 1
    return
  }
  const pipeline = new WindowsCliPack(cli)
  pipeline.assertHost()
  console.log(`pack-windows-cli: package: ${pipeline.packageDir}`)
  await pipeline.build()
  await pipeline.deployPackage()
  await pipeline.writeRuntimeFiles()
  await pipeline.verifyPackage()
  await pipeline.zipPackage()
  pipeline.printProduct()
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]).toLowerCase() === scriptPath.toLowerCase()) {
  try {
    await packWindowsCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
