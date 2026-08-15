/**
 * Lay out the npm distribution of the deepseek-harness-cli: one main shim package at
 * `@peiyu_wang/deepseek-harness-cli@<ver>` and one per-platform package at
 * `@peiyu_wang/deepseek-harness-cli@<ver>-<os>-<cpu>`. The per-platform packages carry the
 * single-file exe under `bin/` (plus the macOS spawn-helper) and are selected by
 * npm through `os`/`cpu` plus optionalDependencies aliases — the same contract
 * OpenAI Codex uses. The layout is importable so tests can package the host
 * target without a registry; `main()` prints the produced package directories.
 */

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { requireReleaseVersion } from './release-version.ts'

const root = resolve(import.meta.dirname, '..')

export const PACKAGE_NAME = '@peiyu_wang/deepseek-harness-cli'
export const REPOSITORY = 'git+https://github.com/peiyuwang54/deepseek-harness-cli.git'

export interface PlatformTarget {
  readonly os: 'macos' | 'linux' | 'win'
  readonly cpu: 'arm64' | 'x64'
  /** optionalDependencies alias key and shim package name, e.g. @peiyu_wang/deepseek-harness-cli-macos-arm64. */
  readonly name: string
}

export const PLATFORMS: ReadonlyArray<PlatformTarget> = ([
  { os: 'macos', cpu: 'arm64' },
  { os: 'macos', cpu: 'x64' },
  { os: 'linux', cpu: 'arm64' },
  { os: 'linux', cpu: 'x64' },
  { os: 'win', cpu: 'x64' },
] as const).map(target => ({ ...target, name: `${PACKAGE_NAME}-${target.os}-${target.cpu}` }))

const OS_FROM_PLATFORM: Readonly<Record<string, PlatformTarget['os']>> = { darwin: 'macos', linux: 'linux', win32: 'win' }
const CPU_FROM_ARCH: Readonly<Record<string, PlatformTarget['cpu']>> = { arm64: 'arm64', x64: 'x64' }
const NPM_OS: Readonly<Record<PlatformTarget['os'], 'darwin' | 'linux' | 'win32'>> = {
  macos: 'darwin',
  linux: 'linux',
  win: 'win32',
}

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
  return PLATFORMS.find(target => target.os === os && target.cpu === cpu) ?? null
}

function platformManifest(target: PlatformTarget, version: string) {
  const executable = target.os === 'win' ? 'bin/deepseek-harness-cli.exe' : 'bin/deepseek-harness-cli'
  return {
    name: PACKAGE_NAME,
    version: `${version}-${target.os}-${target.cpu}`,
    description: `deepseek-harness-cli single-file executable for ${target.os}-${target.cpu}`,
    os: [NPM_OS[target.os]],
    cpu: [target.cpu],
    // npm normalizes ordinary packed files to mode 0644. A private bin name
    // preserves the executable bit without colliding with the public shims.
    bin: { 'deepseek-harness-cli-platform': executable },
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

  const exeSource = resolvePlatformExe(distDir, target)
  const destName = target.os === 'win' ? 'deepseek-harness-cli.exe' : 'deepseek-harness-cli'
  await copyFile(exeSource, join(binDir, destName))
  await chmod(join(binDir, destName), 0o755)

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
    bin: {
      'deepseek-harness-cli': 'bin/deepseek-harness-cli.js',
      deepseek: 'bin/deepseek-harness-cli.js',
      dsh: 'bin/deepseek-harness-cli.js',
    },
    files: ['bin'],
    optionalDependencies,
    repository: { type: 'git', url: REPOSITORY },
    license: 'MIT',
    publishConfig: { access: 'public' },
  }
}

/**
 * Lay out the main shim package: the ESM shim that resolves and spawns the
 * per-platform exe, plus optionalDependencies aliases for every published target.
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
  const version = requireReleaseVersion(values.version, usage)

  const targets = resolveTargets(values.platforms)
  const distDir = resolve(root, values.dir)
  const outDir = resolve(root, values.out)

  const directories = []
  for (const target of targets) directories.push(await layoutPlatformPackage(outDir, target, version, distDir))
  directories.push(await layoutMainPackage(outDir, version))
  for (const directory of directories) console.log(directory)
}

/**
 * Locate the built exe for a target. Windows products use a `.exe` suffix.
 * @param distDir - the directory holding the built exes.
 * @param target - the platform being packaged.
 * @returns the absolute exe path.
 */
function resolvePlatformExe(distDir: string, target: PlatformTarget): string {
  const stem = resolve(distDir, `deepseek-harness-cli-${target.os}-${target.cpu}`)
  const candidates = target.os === 'win' ? [`${stem}.exe`, stem] : [stem]
  const found = candidates.find(path => existsSync(path))
  if (found === undefined) {
    throw new Error(`package-dsh-cli-npm: ${stem} missing — build ${target.os}-${target.cpu} first.`)
  }
  return found
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
