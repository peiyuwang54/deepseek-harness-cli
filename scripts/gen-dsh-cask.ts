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
import { requireReleaseVersion } from './release-version.ts'

const root = resolve(import.meta.dirname, '..')
const REPO = 'peiyuwang54/deepseek-harness-cli'
const HOMEPAGE = `https://github.com/${REPO}`

const TARGETS = ['macos-arm64', 'macos-x64', 'linux-arm64', 'linux-x64'] as const
type Target = (typeof TARGETS)[number]

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

  binary "bin/deepseek-harness-cli", target: "deepseek"
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
 * Read the four `dsh-<target>.sha256` sidecars. Each sidecar is
 * `<hexdigest>  dsh-<arch>-<os>.tar.gz` as published with the release.
 * @param dir - the directory holding the sidecars.
 * @returns the parsed digests.
 */
export async function readPlatformShas(dir: string): Promise<PlatformShas> {
  const shas = {} as PlatformShas
  for (const target of TARGETS) {
    const sidecar = join(dir, `deepseek-harness-cli-${target}.sha256`)
    if (!existsSync(sidecar)) throw new Error(`gen-dsh-cask: ${sidecar} missing — build ${target} first.`)
    const digest = (await readFile(sidecar, 'utf8')).trim().split(/\s+/)[0]
    if (digest === undefined || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`gen-dsh-cask: ${sidecar} does not contain a 64-hex sha256 digest.`)
    }
    shas[target] = digest
  }
  return shas
}

const CLI_OPTIONS = {
  version: { type: 'string' },
  dir: { type: 'string', default: 'dist-exe' },
  out: { type: 'string' },
} as const

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: CLI_OPTIONS,
  })
  const version = requireReleaseVersion(values.version, usage)
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

function usage(): void {
  console.log(`Usage: pnpm exec tsx scripts/gen-dsh-cask.ts --version <ver> [flags]

  --version <ver>  release version, e.g. 0.1.0-rc.5 (required)
  --dir <dir>      directory holding the dsh-<target>.sha256 sidecars (default: dist-exe)
  --out <file>     write the cask to a file instead of stdout`)
}

// Only run the CLI when executed directly; importing for tests must not exit.
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
