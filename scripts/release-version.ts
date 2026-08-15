/** Shared release-version parsing for distribution generators. */

/**
 * Require and normalize a release version, printing the caller's usage first.
 * @param value - Raw `--version` value.
 * @param usage - Caller-specific help printer.
 * @returns Version without an optional `v` prefix.
 */
export function requireReleaseVersion(value: string | undefined, usage: () => void): string {
  if (value === undefined) {
    usage()
    process.exit(1)
  }
  return value.replace(/^v/, '')
}
