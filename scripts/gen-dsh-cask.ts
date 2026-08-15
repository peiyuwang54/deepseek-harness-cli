/**
 * Generate the Homebrew cask for the dsh CLI. The four release tarballs have
 * distinct sha256 digests, so the cask nests `on_macos`/`on_linux` with
 * `on_arm`/`on_intel` blocks, and the per-platform URL is built from Homebrew's
 * `arch`/`os` macros — the same skeleton OpenAI Codex ships. Importable so
 * tests can exercise the pure generator; `main()` writes the cask to stdout or
 * `--out`.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const REPO = 'peiyuwang54/deepseek-harness-cli'
const HOMEPAGE = `https://github.com/${REPO}`

const TARGETS = ['macos-arm64', 'macos-x64', 'linux-arm64', 'linux-x64'] as const
type Target = (typeof TARGETS)[number]

/**
 * Published GitHub Release stem for one Homebrew target. install.sh downloads
 * `deepseek-harness-cli-<cpu>-<os>.tar.gz`; the cask URL uses the same order.
 * @param target - an `os-cpu` key such as `macos-arm64`.
 * @returns the `<cpu>-<os>` stem, e.g. `arm64-macos`.
 */
export function releaseAssetStem(target: Target): string {
  const [os, cpu] = target.split('-') as [string, string]
  return `${cpu}-${os}`
}

export type PlatformShas = Record<Target, string>

/**
 * Render the cask. `version` is the release version without a leading `v`; the
 * tag is always `deepseek-harness-cli-v#{version}`.
 * @param version - the release version.
 * @param shas - the four tarball sha256 digests, keyed by target.
 * @returns the cask source.
 */
export function generateCask(version: string, shas: PlatformShas): string {
  return `cask "deepseek-harness-cli" do
  version "${version}"

  arch arm: "arm64", intel: "x64"
  os macos: "macos", linux: "linux"

  url "https://github.com/${REPO}/releases/download/deepseek-harness-cli-v#{version}/deepseek-harness-cli-#{arch}-#{os}.tar.gz"
  name "deepseek-harness-cli"
  desc "deepseek-harness-cli: profile boot, plugin management, and shipped terminal/browser aliases"
  homepage "${HOMEPAGE}"

  on_macos do
    on_arm do
      sha256 "${shas['macos-arm64']}"
    end
    on_intel do
      sha256 "${shas['macos-x64']}"
    end
  end

  on_linux do
    on_arm do
      sha256 "${shas['linux-arm64']}"
    end
    on_intel do
      sha256 "${shas['linux-x64']}"
    end
  end

  binary "bin/deepseek-harness-cli"

  livecheck do
    url :url
    strategy :github_releases
    regex(/^deepseek-harness-cli-v(\\d+\\.\\d+\\.\\d+(?:-rc\\.\\d+)?)$/i)
  end
end
`
}

/**
 * Read the four `deepseek-harness-cli-<cpu>-<os>.sha256` sidecars. Each sidecar
 * is `<hexdigest>  deepseek-harness-cli-<cpu>-<os>.tar.gz` as published.
 * @param dir - the directory holding the sidecars.
 * @returns the parsed digests.
 */
export async function readPlatformShas(dir: string): Promise<PlatformShas> {
  const shas = {} as PlatformShas
  for (const target of TARGETS) {
    const sidecar = join(dir, `deepseek-harness-cli-${releaseAssetStem(target)}.sha256`)
    if (!existsSync(sidecar)) throw new Error(`gen-dsh-cask: ${sidecar} missing — build ${target} first.`)
    const digest = (await readFile(sidecar, 'utf8')).trim().split(/\s+/)[0]
    if (digest === undefined || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`gen-dsh-cask: ${sidecar} does not contain a 64-hex sha256 digest.`)
    }
    shas[target] = digest
  }
  return shas
}

function usage(): void {
  console.log(`Usage: pnpm exec tsx scripts/gen-dsh-cask.ts --version <ver> [flags]

  --version <ver>  release version, e.g. 0.1.0-rc.5 (required)
  --dir <dir>      directory holding the dsh-<target>.sha256 sidecars (default: dist-exe)
  --out <file>     write the cask to a file instead of stdout`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      version: { type: 'string' },
      dir: { type: 'string', default: 'dist-exe' },
      out: { type: 'string' },
    },
  })
  if (values.version === undefined) {
    usage()
    process.exit(1)
  }
  const version = values.version.replace(/^v/, '')
  const shas = await readPlatformShas(resolve(root, values.dir))
  const cask = generateCask(version, shas)
  if (values.out !== undefined) {
    const outPath = resolve(root, values.out)
    await writeFile(outPath, cask)
    console.log(outPath)
    return
  }
  process.stdout.write(cask)
}

// Only run the CLI when executed directly; importing for tests must not exit.
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
