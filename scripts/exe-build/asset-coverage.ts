/**
 * Runtime-data asset coverage for the packaged executable. pkg's `--sea` mode
 * serves a staged file from the embedded `/snapshot/` filesystem only when it
 * matches a `pkg.assets` glob, so every file the composed application reads at
 * runtime must be covered by {@link ASSET_GLOBS} or the built executable fails
 * at boot with ENOENT exactly where the file is read.
 */

import { globSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Glob patterns pkg embeds into the executable snapshot, relative to the
 * staging root. The code patterns cover Cordis's runtime bare-package imports,
 * which pkg's static analysis cannot see; the data patterns cover the files
 * the composed application reads at runtime: bundle `cordis.patch.yml`
 * overlays, the app package's shipped `config/` tree, and the built web
 * frontend dist.
 */
export const ASSET_GLOBS = [
  'package.json',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  'node_modules/**/*.node',
  'node_modules/**/*.wasm',
  'node_modules/**/*.yml',
  'node_modules/@deepseek-ai/dsh/config/**/*.md',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*',
] as const

/** Normalize one glob result path to the posix-relative form ASSET_GLOBS use. */
function toPosix(path: string): string {
  return path.split('\\').join('/')
}

/**
 * Expand one staging-relative glob to its staged files. A `**` walk also
 * selects directories; they are dropped, because pkg embeds files.
 * @param root - the staging root (the pnpm deploy target).
 * @param pattern - a staging-relative glob pattern.
 * @returns the matched file paths, posix-relative to the staging root.
 */
export function expandGlob(root: string, pattern: string): string[] {
  const files: string[] = []
  for (const path of globSync(pattern, { cwd: root })) {
    if (statSync(join(root, path)).isFile()) files.push(toPosix(path))
  }
  return files
}

/**
 * Report staged runtime files that no asset glob covers.
 * @param root - the staging root (the pnpm deploy target).
 * @param required - paths the composed application reads at runtime,
 * posix-relative to the staging root.
 * @returns the uncovered paths, sorted; empty means coverage is complete.
 */
export function findUncoveredAssets(root: string, required: readonly string[]): string[] {
  const covered = new Set<string>()
  for (const pattern of ASSET_GLOBS) {
    for (const file of expandGlob(root, pattern)) covered.add(file)
  }
  return [...new Set(required.map(toPosix))].filter(file => !covered.has(file)).sort()
}

/**
 * Collect every staged bundle's overlay patch file from its manifest's
 * `dsh.bundle.patch` field — the file profile composition must read at boot.
 * @param root - the staging root (the pnpm deploy target).
 * @returns the declared overlay paths, posix-relative to the staging root.
 */
export async function collectBundlePatchOverlays(root: string): Promise<string[]> {
  const overlays: string[] = []
  for (const manifestPath of expandGlob(root, 'node_modules/**/package.json')) {
    const manifest = JSON.parse(await readFile(join(root, manifestPath), 'utf8')) as {
      dsh?: { bundle?: { patch?: unknown } }
    }
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch === 'string') overlays.push(toPosix(join(dirname(toPosix(manifestPath)), patch)))
  }
  return overlays
}
