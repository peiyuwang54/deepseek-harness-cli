/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  loadProfile,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR, shippedProfileTemplate } from './profile-boot.ts'

const NAME = 'dsh'

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string, installAnchor = INSTALL_ANCHOR): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, installAnchor, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string, installAnchor = INSTALL_ANCHOR): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir, installAnchor)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir, installAnchor)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/** Output and filesystem overrides used by boot-free plugin inspection. */
export interface PluginCommandOptions {
  /** Harness home containing the profile; defaults to the resolved user home. */
  readonly home?: string
  /** Installation package manifest used as the first module-resolution anchor. */
  readonly installAnchor?: string
  /** Receive ordinary command output. */
  readonly stdout?: (text: string) => void
  /** Receive validation and usage diagnostics. */
  readonly stderr?: (text: string) => void
}

interface PluginInventoryEntry {
  readonly name: string
  readonly spec: string
  readonly bundle: boolean
  readonly active: boolean
}

function pluginInventory(profile: string, options: PluginCommandOptions): {
  readonly dir: string
  readonly entries: readonly PluginInventoryEntry[]
  readonly activeBundles: readonly string[]
} {
  const home = options.home
  const dir = resolveProfileDir(profile, home)
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`profile ${JSON.stringify(profile)} is not initialized; run dsh plugin --profile ${profile} add <package>`)
  }
  const manifest = readProfileManifest(NAME, dir)
  const active = manifest.dsh?.profile?.bundles ?? []
  const dependencies = manifest.dependencies ?? {}
  const entries = Object.entries(dependencies).toSorted(([left], [right]) => left.localeCompare(right)).map(([name, spec]) => ({
    name,
    spec,
    bundle: exportsPatch(name, dir, options.installAnchor),
    active: active.includes(name),
  }))
  return { dir, entries, activeBundles: [...active] }
}

function renderPluginInventory(profile: string, inventory: ReturnType<typeof pluginInventory>): string {
  const lines = [`Profile ${profile} · ${inventory.dir}`]
  if (inventory.entries.length === 0) {
    lines.push('No external plugins installed.')
  } else {
    lines.push(...inventory.entries.map((entry) => {
      const kind = entry.bundle ? (entry.active ? 'bundle · active' : 'bundle · inactive') : 'dependency'
      return `- ${entry.name}@${entry.spec} · ${kind}`
    }))
  }
  return `${lines.join('\n')}\n`
}

function inspectPlugins(profile: string, args: readonly string[], options: PluginCommandOptions): number {
  const command = args[0] ?? 'list'
  const json = args.includes('--json')
  if (args.some(argument => argument !== command && argument !== '--json') || (json && args.filter(argument => argument === '--json').length > 1)) {
    throw new Error(`${command} accepts only the optional --json flag`)
  }
  const inventory = pluginInventory(profile, options)
  if (command === 'list' || command === 'ls') {
    if (json) {
      options.stdout?.(`${JSON.stringify({ profile, directory: inventory.dir, plugins: inventory.entries }, null, 2)}\n`)
    } else {
      options.stdout?.(renderPluginInventory(profile, inventory))
    }
    return 0
  }
  if (command !== 'verify') throw new Error(`unknown inspection command ${JSON.stringify(command)}`)
  const declaredBundles = inventory.entries.filter(entry => entry.bundle).map(entry => entry.name)
  const active = inventory.activeBundles
  const inactive = declaredBundles.filter(name => !active.includes(name))
  const stale = active.filter(name => !declaredBundles.includes(name))
  let profileError: string | undefined
  try {
    loadProfile(NAME, profile, options.installAnchor ?? INSTALL_ANCHOR, options.home, { userLayer: false })
  } catch (error) {
    profileError = error instanceof Error ? error.message : String(error)
  }
  const valid = profileError === undefined && inactive.length === 0 && stale.length === 0
  const result = {
    profile,
    directory: inventory.dir,
    valid,
    plugins: inventory.entries,
    activeBundles: active,
    inactiveBundles: inactive,
    staleBundles: stale,
    ...(profileError === undefined ? {} : { error: profileError }),
  }
  if (json) {
    options.stdout?.(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    options.stdout?.(`${valid ? 'Plugin profile is valid.' : 'Plugin profile has errors.'}\n`)
    if (inactive.length > 0) options.stdout?.(`Inactive bundle declarations: ${inactive.join(', ')}\n`)
    if (stale.length > 0) options.stdout?.(`Stale active bundles: ${stale.join(', ')}\n`)
    if (profileError !== undefined) options.stdout?.(`${profileError}\n`)
  }
  return valid ? 0 : 1
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @param options - optional home, installation anchor, and output overrides.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[], options: PluginCommandOptions = {}): number {
  const stdout = options.stdout ?? ((text) => { process.stdout.write(text) })
  const stderr = options.stderr ?? ((text) => { process.stderr.write(text) })
  if (args[0] === 'list' || args[0] === 'ls' || args[0] === 'verify') {
    try {
      return inspectPlugins(profile, args, { ...options, stdout, stderr })
    } catch (error) {
      stderr(`${NAME} plugin: ${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  const dir = resolveProfileDir(profile, options.home)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, shippedProfileTemplate(profile) ?? DEFAULT_PROFILE_BUNDLES)
    stderr(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      stderr(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir, options.installAnchor)
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    stderr(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      stderr(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
  }
  return exitCode
}
