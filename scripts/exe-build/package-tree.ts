/** Filesystem helpers shared by executable distribution staging pipelines. */

import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

/**
 * Copy one package directory as ordinary files without its nested dependency tree.
 * @param source - Resolved source package directory.
 * @param destination - Staged package directory.
 */
export async function copyPackageTree(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const nestedNodeModules = join(source, 'node_modules')
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
  })
}

/** Return the first symbolic link below a directory, if one exists. */
async function findSymlink(directory: string): Promise<string | undefined> {
  if (!existsSync(directory)) return undefined
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Replace package links under a staged `node_modules` directory with files and
 * remove package-manager `.bin` link directories.
 * @param nodeModules - Staged dependency root.
 */
export async function materializePackageLinks(nodeModules: string): Promise<void> {
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      const destination = remaining
      const source = await realpath(destination)
      await rm(destination, { recursive: true, force: true })
      await copyPackageTree(source, destination)
    }
    remaining = await findSymlink(nodeModules)
  }
}
