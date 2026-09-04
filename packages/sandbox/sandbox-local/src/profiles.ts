/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { homedir } from 'node:os'
import { declaredWritableRoots, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    for (const root of declaredWritableRoots(policy)) args.push('--bind', root, root)
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', ...declaredWritableRoots(policy))
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/** Container control paths whose access would escape workspace file policy. */
function seatbeltContainerIsolationForms(): string[] {
  const fileTargets = [
    ['literal', '/var/run/docker.sock'],
    ['literal', '/var/run/docker.sock.raw'],
    ['literal', '/private/var/run/docker.sock'],
    ['literal', '/private/var/run/docker.sock.raw'],
    ['subpath', '/var/run/docker'],
    ['subpath', '/private/var/run/docker'],
    ['subpath', '/Users/Shared/.docker'],
    ['subpath', `${homedir()}/.docker/run`],
    ['subpath', `${homedir()}/.docker/desktop`],
    ['subpath', `${homedir()}/.colima`],
    ['subpath', `${homedir()}/.orbstack/run`],
    ['subpath', `${homedir()}/.rd`],
  ] as const
  const executableTargets = [
    ['literal', '/usr/local/bin/docker'],
    ['literal', '/usr/local/bin/dockerd'],
    ['literal', '/usr/local/bin/docker-compose'],
    ['literal', '/usr/bin/docker'],
    ['literal', '/opt/homebrew/bin/docker'],
    ['literal', '/opt/homebrew/bin/dockerd'],
    ['literal', '/opt/homebrew/bin/docker-compose'],
    ['literal', '/opt/homebrew/bin/podman'],
    ['literal', '/usr/local/bin/podman'],
    ['literal', '/opt/homebrew/bin/colima'],
    ['literal', '/usr/local/bin/colima'],
    ['literal', '/opt/homebrew/bin/orb'],
    ['subpath', '/opt/homebrew/Cellar/docker'],
    ['subpath', '/opt/homebrew/Cellar/docker-compose'],
    ['subpath', '/opt/homebrew/Cellar/podman'],
    ['subpath', '/opt/homebrew/Cellar/colima'],
    ['subpath', '/usr/local/Cellar/docker'],
    ['subpath', '/usr/local/Cellar/docker-compose'],
    ['subpath', '/usr/local/Cellar/podman'],
    ['subpath', '/usr/local/Cellar/colima'],
    ['literal', '/Applications/Docker.app/Contents/Resources/bin/docker'],
    ['subpath', '/Applications/Docker.app/Contents/MacOS/'],
    ['subpath', '/Applications/OrbStack.app/Contents/MacOS/'],
    ['subpath', '/Applications/Rancher Desktop.app/Contents/MacOS/'],
  ] as const
  const selectors = (targets: readonly (readonly ['literal' | 'subpath', string])[]): string =>
    targets.map(([kind, path]) => `(${kind} ${sbplString(path)})`).join(' ')
  return [
    `(deny file-read* file-write* ${selectors(fileTargets)})`,
    `(deny process-exec ${selectors(executableTargets)})`,
    '(deny mach-lookup (xpc-service-name-prefix "com.docker.") (global-name-prefix "com.docker.") (global-name-prefix "dev.kdrag0n.OrbStack"))',
    '(deny ipc-posix-shm* (ipc-posix-name-prefix "docker") (ipc-posix-name-prefix "com.docker."))',
  ]
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  forms.push(...seatbeltContainerIsolationForms())
  return ['-p', forms.join(' ')]
}
