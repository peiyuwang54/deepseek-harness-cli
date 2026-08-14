/**
 * Lay out the npm distribution of the deepseek-harness-cli: one main shim package at
 * `@peiyuwang54/deepseek-harness-cli@<ver>` and one per-platform package at
 * `@peiyuwang54/deepseek-harness-cli@<ver>-<os>-<cpu>`. The per-platform packages carry the
 * single-file exe under `bin/` (plus the macOS spawn-helper) and are selected by
 * npm through `os`/`cpu` plus optionalDependencies aliases — the same contract
 * OpenAI Codex uses. The layout is importable so tests can package the host
 * target without a registry; `main()` prints the produced package directories.
 */

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')

export const PACKAGE_NAME = '@peiyuwang54/deepseek-harness-cli'
export const REPOSITORY = 'git+https://github.com/peiyuwang54/deepseek-harness-cli.git'

export interface PlatformTarget {
  readonly os: 'macos' | 'linux'
  readonly cpu: 'arm64' | 'x64'
  /** optionalDependencies alias key and shim package name, e.g. @peiyuwang54/deepseek-harness-cli-macos-arm64. */
  readonly name: string
}

export const PLATFORMS: ReadonlyArray<PlatformTarget> = ([
  { os: 'macos', cpu: 'arm64' },
  { os: 'macos', cpu: 'x64' },
  { os: 'linux', cpu: 'arm64' },
  { os: 'linux', cpu: 'x64' },
] as const).map(target => ({ ...target, name: `${PACKAGE_NAME}-${target.os}-${target.cpu}` }))

const OS_FROM_PLATFORM: Readonly<Record<string, PlatformTarget['os']>> = { darwin: 'macos', linux: 'linux' }
const CPU_FROM_ARCH: Readonly<Record<string, PlatformTarget['cpu']>> = { arm64: 'arm64', x64: 'x64' }

/**
 * Map Node's platform/arch identifiers to the npm dist-tag suffixes.
 * @param platform - `process.platform`, defaulted at call sites.
 * @param arch - `process.arch`, defaulted at call sites.
 * @returns the target, or null for an unsupported combination.
 */
export function platformTarget(platform = process.platform, arch = process.arch): PlatformTarget | null {
  const os = OS_FROM_PLATFORM[platform]
  const cpu = CPU_FROM_ARCH[arch]
  if (os === undefined || cpu === undefined) return null
  return { os, cpu, name: `${PACKAGE_NAME}-${os}-${cpu}` }
}

function platformManifest(target: PlatformTarget, version: string) {
  return {
    name: PACKAGE_NAME,
    version: `${version}-${target.os}-${target.cpu}`,
    description: `deepseek-harness-cli single-file executable for ${target.os}-${target.cpu}`,
    os: [target.os],
    cpu: [target.cpu],
    // No `bin` field: the platform exe would collide with the main shim's
    // `deepseek-harness-cli` in node_modules/.bin. The shim resolves
    // bin/deepseek-harness-cli by package path.
    files: ['bin'],
    repository: { type: 'git', url: REPOSITORY },
    license: 'MIT',
    publishConfig: { access: 'public' },
  }
}

/**
 * Copy one target's exe (and macOS spawn-helper) into a publishable package
 * directory whose package.json carries the matching `os`/`cpu` fields.
 * @param outDir - the packaging output root.
 * @param target - the platform being packaged.
 * @param version - the release version, without a leading `v`.
 * @param distDir - the directory holding the built exes.
 * @returns the package directory.
 */
export async function layoutPlatformPackage(
  outDir: string,
  target: PlatformTarget,
  version: string,
  distDir: string,
): Promise<string> {
  const packageDir = resolve(outDir, 'platform', `${version}-${target.os}-${target.cpu}`)
  const binDir = join(packageDir, 'bin')
  await mkdir(binDir, { recursive: true })

  const exeSource = resolve(distDir, `deepseek-harness-cli-${target.os}-${target.cpu}`)
  if (!existsSync(exeSource)) {
    throw new Error(`package-dsh-cli-npm: ${exeSource} missing — build ${target.os}-${target.cpu} first.`)
  }
  await copyFile(exeSource, join(binDir, 'deepseek-harness-cli'))
  await chmod(join(binDir, 'deepseek-harness-cli'), 0o755)

  if (target.os === 'macos') {
    const helperSource = `${exeSource}-spawn-helper`
    if (!existsSync(helperSource)) {
      throw new Error(`package-dsh-cli-npm: ${helperSource} missing — build the macOS target first.`)
    }
    await copyFile(helperSource, join(binDir, 'deepseek-harness-cli-spawn-helper'))
    await chmod(join(binDir, 'deepseek-harness-cli-spawn-helper'), 0o755)
  }

  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify(platformManifest(target, version), null, 2)}\n`)
  return packageDir
}

function mainManifest(version: string) {
  const optionalDependencies: Record<string, string> = {}
  for (const target of PLATFORMS) {
    optionalDependencies[target.name] = `npm:${PACKAGE_NAME}@${version}-${target.os}-${target.cpu}`
  }
  return {
    name: PACKAGE_NAME,
    version,
    type: 'module',
    description:
      'deepseek-harness-cli: profile boot, plugin management, and shipped terminal/browser aliases — npm shim over per-platform single-file executables',
    bin: { 'deepseek-harness-cli': 'bin/deepseek-harness-cli.js' },
    files: ['bin'],
    optionalDependencies,
    repository: { type: 'git', url: REPOSITORY },
    license: 'MIT',
    publishConfig: { access: 'public' },
  }
}

/**
 * Lay out the main shim package: the ESM shim that resolves and spawns the
 * per-platform exe, plus optionalDependencies aliases for all four targets.
 * @param outDir - the packaging output root.
 * @param version - the release version, without a leading `v`.
 * @returns the package directory.
 */
export async function layoutMainPackage(outDir: string, version: string): Promise<string> {
  const packageDir = resolve(outDir, 'main')
  const binDir = join(packageDir, 'bin')
  await mkdir(binDir, { recursive: true })
  const shimSource = join(root, 'scripts', 'dsh-npm-shim.js')
  await copyFile(shimSource, join(binDir, 'deepseek-harness-cli.js'))
  await chmod(join(binDir, 'deepseek-harness-cli.js'), 0o755)
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify(mainManifest(version), null, 2)}\n`)
  return packageDir
}

function usage(): void {
  console.log(`Usage: pnpm exec tsx scripts/package-dsh-cli-npm.ts --version <ver> [flags]

  --version <ver>      release version, e.g. 0.1.0-rc.5 (required)
  --dir <dir>          directory holding the built exes (default: dist-exe)
  --out <dir>          packaging output root (default: dist-exe/npm)
  --platforms <spec>   targets to package: 'all', 'host', or a comma list
                       of <os>-<cpu> (default: all)`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      version: { type: 'string' },
      dir: { type: 'string', default: 'dist-exe' },
      out: { type: 'string', default: 'dist-exe/npm' },
      platforms: { type: 'string', default: 'all' },
    },
  })
  if (values.version === undefined) {
    usage()
    process.exit(1)
  }
  const version = values.version.replace(/^v/, '')

  const targets = resolveTargets(values.platforms)
  const distDir = resolve(root, values.dir)
  const outDir = resolve(root, values.out)

  const directories = []
  for (const target of targets) directories.push(await layoutPlatformPackage(outDir, target, version, distDir))
  directories.push(await layoutMainPackage(outDir, version))
  for (const directory of directories) console.log(directory)
}

function resolveTargets(spec: string): ReadonlyArray<PlatformTarget> {
  if (spec === 'all') return PLATFORMS
  if (spec === 'host') {
    const host = platformTarget()
    if (host === null) throw new Error(`package-dsh-cli-npm: unsupported host ${process.platform}-${process.arch}.`)
    return [host]
  }
  return spec.split(',').map((entry) => {
    const [os, cpu] = entry.trim().split('-') as [PlatformTarget['os'], PlatformTarget['cpu']]
    const target = PLATFORMS.find(candidate => candidate.os === os && candidate.cpu === cpu)
    if (target === undefined) throw new Error(`package-dsh-cli-npm: unknown target ${entry}.`)
    return target
  })
}

// Only run the CLI when executed directly; importing for tests must not exit.
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
