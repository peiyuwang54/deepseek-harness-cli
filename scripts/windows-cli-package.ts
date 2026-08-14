/**
 * Layout and launcher text for the Windows directory package. The packer
 * (`pack-windows-cli.ts`) and installer (`scripts/install/install.ps1`) share
 * these names so a package built from a clone installs without rewriting paths.
 */

import { parseArgs } from 'node:util'

/** Workspace package that `pnpm deploy` copies into the directory package. */
export const WINDOWS_CLI_DEPLOY_FILTER = '@deepseek-ai/dsh'
/** Built launcher inside the deployed package. */
export const WINDOWS_CLI_ENTRY = 'lib/bin.js'
/** Directory under the repo root that holds the packed tree and zip. */
export const WINDOWS_CLI_DIST_DIR = 'dist-windows'
/** Folder name of the portable tree inside {@link WINDOWS_CLI_DIST_DIR}. */
export const WINDOWS_CLI_PACKAGE_DIRNAME = 'dsh'
/** Installer-owned manifest written next to `dsh.cmd`. */
export const WINDOWS_CLI_MANIFEST_NAME = 'dsh-install.json'
/** cmd.exe launcher that adds `tui` when the user passes no arguments. */
export const WINDOWS_CLI_LAUNCHER_NAME = 'dsh.cmd'
/** Copied host Node binary. */
export const WINDOWS_CLI_NODE_NAME = 'node.exe'
/** Default profile the bare `dsh` command boots. */
export const WINDOWS_CLI_DEFAULT_PROFILE = 'tui'
/** Host libraries the TUI and headless profiles need; skips the Web frontend. */
export const WINDOWS_CLI_BUILD_SCRIPT = 'build:lib'

/**
 * Files that must exist before the installer copies the tree to LocalAppData.
 */
export const WINDOWS_CLI_REQUIRED_RELATIVE_PATHS = [
  WINDOWS_CLI_NODE_NAME,
  WINDOWS_CLI_LAUNCHER_NAME,
  WINDOWS_CLI_ENTRY,
  WINDOWS_CLI_MANIFEST_NAME,
  'package.json',
] as const

/**
 * Parsed packer flags. Construction owns help and parse-error exits when used
 * from the CLI; tests call {@link parsePackWindowsCliArgs} directly.
 */
export interface PackWindowsCliArgs {
  /** Skip `pnpm run build:lib`; `lib/` artifacts must already exist. */
  skipBuild: boolean
  /** Print commands and filesystem intent without writing a package. */
  dryRun: boolean
  /** Skip the zip beside the directory tree. */
  skipZip: boolean
}

/**
 * Identity recorded in {@link WINDOWS_CLI_MANIFEST_NAME} so the installer can
 * refuse a package built for another CPU.
 */
export interface WindowsCliInstallManifest {
  name: 'dsh'
  version: string
  platform: 'win32'
  arch: string
  node: string
  entry: typeof WINDOWS_CLI_ENTRY
  defaultProfile: typeof WINDOWS_CLI_DEFAULT_PROFILE
}

/**
 * Parse packer argv. Help exits 0; unknown flags throw.
 * @param argv - arguments after the Node binary and script.
 * @returns the parsed flags.
 */
export function parsePackWindowsCliArgs(argv: string[]): PackWindowsCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'skip-build': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'skip-zip': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(packWindowsCliUsage())
    process.exit(0)
  }
  return {
    skipBuild: values['skip-build'],
    dryRun: values['dry-run'],
    skipZip: values['skip-zip'],
  }
}

/**
 * @returns the packer help text.
 */
export function packWindowsCliUsage(): string {
  return [
    'Usage: pnpm exec tsx scripts/pack-windows-cli.ts [flags]',
    '',
    '  --skip-build  skip `pnpm run build:lib` (lib/ artifacts must already exist).',
    '  --dry-run     print every command without writing dist-windows/.',
    '  --skip-zip    write the directory tree only.',
    '  --help        print this help.',
    '',
    'Produces a portable win32 directory package from this checkout: official',
    `node.exe, the @deepseek-ai/dsh production closure, and ${WINDOWS_CLI_LAUNCHER_NAME}.`,
    'Run on Windows so native addons and node.exe match the target machine.',
  ].join('\n')
}

/**
 * Build the cmd.exe launcher. A bare invocation becomes `dsh tui`; every
 * explicit argument reaches `lib/bin.js` unchanged, including `--version`.
 * @returns the complete `dsh.cmd` file body, including the trailing newline.
 */
export function windowsCliLauncherScript(): string {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'set "NODE_USE_ENV_PROXY=1"',
    'set "DSH_PACKAGE=%~dp0"',
    'if "%~1"=="" (',
    `  "%DSH_PACKAGE%${WINDOWS_CLI_NODE_NAME}" "%DSH_PACKAGE%${WINDOWS_CLI_ENTRY.replaceAll('/', '\\')}" ${WINDOWS_CLI_DEFAULT_PROFILE}`,
    '  exit /b %ERRORLEVEL%',
    ')',
    `"%DSH_PACKAGE%${WINDOWS_CLI_NODE_NAME}" "%DSH_PACKAGE%${WINDOWS_CLI_ENTRY.replaceAll('/', '\\')}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
}

/**
 * @param input - version, architecture, and the Node binary that will be copied.
 * @returns the installer manifest object.
 */
export function windowsCliInstallManifest(input: {
  version: string
  arch: string
  node: string
}): WindowsCliInstallManifest {
  return {
    name: 'dsh',
    version: input.version,
    platform: 'win32',
    arch: input.arch,
    node: input.node,
    entry: WINDOWS_CLI_ENTRY,
    defaultProfile: WINDOWS_CLI_DEFAULT_PROFILE,
  }
}

/**
 * @param arch - `process.arch` of the pack host.
 * @returns the zip basename, e.g. `dsh-win32-x64.zip`.
 */
export function windowsCliZipName(arch: string): string {
  return `dsh-win32-${arch}.zip`
}

/**
 * Refuse a destination that is the repo root or that contains it, so a failed
 * deploy cannot delete the checkout.
 * @param root - repository root.
 * @param destination - directory the packer will clear and rewrite.
 */
export function assertSafePackageDestination(root: string, destination: string): void {
  const normalizedRoot = normalizeDir(root)
  const normalizedDestination = normalizeDir(destination)
  if (normalizedDestination === normalizedRoot) {
    throw new Error(`pack-windows-cli: refusing to clear ${destination}: it is the repository root.`)
  }
  if (normalizedRoot.startsWith(`${normalizedDestination}/`)) {
    throw new Error(`pack-windows-cli: refusing to clear ${destination}: it contains the repository root.`)
  }
}

/**
 * @param path - a filesystem path.
 * @returns a lowercase, slash-normalized directory path without a trailing slash.
 */
function normalizeDir(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}
