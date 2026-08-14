/**
 * Verify that each executable deploy manifest supplies every required workspace
 * peer in its dependency graph. With auto peer installation disabled, a missing
 * root peer can otherwise fail only when Cordis loads the packaged plugin.
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

/** Closure manifests verified when `--manifest` is absent. */
const DEFAULT_MANIFESTS = ['python/sdk-runtime/package.json', 'apps/cli/exe/package.json'] as const

/** One manifest's closure-verification outcome. */
interface VerificationResult {
  /** Repository-relative manifest path. */
  readonly manifestPath: string
  /** The manifest's package name. */
  readonly name: string
  /** Missing-peer chains; empty means the closure is closed. */
  readonly failures: readonly string[]
  /** Number of workspace packages reachable from the manifest's dependencies. */
  readonly visited: number
}

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { manifest: { type: 'string', multiple: true } },
})
// Accept repeated `--manifest=` flags and comma-separated values.
const requested = (values.manifest ?? []).flatMap(value => value.split(',').map(part => part.trim()).filter(part => part !== ''))
const manifestPaths = (requested.length > 0 ? requested : [...DEFAULT_MANIFESTS]).map(relative => resolve(root, relative))
const workspace = await loadWorkspacePackages()

const results: VerificationResult[] = []
for (const manifestPath of manifestPaths) results.push(await verifyManifest(manifestPath, workspace))

let failed = false
for (const result of results) {
  if (result.failures.length === 0) continue
  failed = true
  console.error(`verify-runtime-closure: required workspace peers are missing from ${result.manifestPath}:`)
  for (const failure of result.failures) console.error(`  ${failure}`)
}
if (failed) process.exit(1)

for (const result of results) {
  console.log(`verify-runtime-closure: ${result.name}: ${result.visited} workspace packages form a closed runtime dependency graph.`)
}

/**
 * Verify one deploy manifest's dependency graph, reporting every missing
 * workspace peer as a chain from the manifest root.
 * @param manifestPath - absolute path to the closure manifest.
 * @param workspace - workspace package manifests by package name.
 * @returns the verification result for that manifest.
 */
async function verifyManifest(manifestPath: string, workspace: ReadonlyMap<string, WorkspacePackage>): Promise<VerificationResult> {
  const manifest = await loadManifest(manifestPath)
  const name = manifest.name ?? basename(dirname(manifestPath))
  const dependencies = manifest.dependencies ?? {}
  const parents = new Map<string, string | undefined>()
  const queue: string[] = []

  for (const dependency of Object.keys(dependencies).sort()) {
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    queue.push(dependency)
  }

  const failures: string[] = []
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    for (const peer of Object.keys(peers).sort()) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
      if (dependencies[peer]?.startsWith('workspace:') === true) continue
      failures.push(`${formatChain(name, packageName, parents)} -> ${peer}`)
    }
    const packageDependencies = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(packageDependencies).sort()) {
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      queue.push(dependency)
    }
  }

  return { manifestPath, name, failures, visited: queue.length }
}

async function loadWorkspacePackages(): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}
