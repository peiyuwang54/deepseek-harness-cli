/**
 * Product configuration for the shared single-file executable build pipeline.
 * The fixed `@yao-pkg/pkg --sea` route, deploy flags, and artifact layout are
 * owned by each product's architecture note (`ExeProduct.notePath`); a product
 * parameterizes the `ExeBuild` pipeline in scripts/exe-build/pipeline.ts.
 */

import { parseArgs } from 'node:util'

/** Default Node major; SEA mode requires at least Node 22. */
const DEFAULT_NODE_RANGE = 'node24'
/** Pinned for reproducible builds. */
export const PKG_SPEC = '@yao-pkg/pkg@6.21.0'
/** Executable output directory, relative to the repository root. */
export const OUT_DIR = 'dist-exe'

/** Platform tags shared by pkg targets and release channel names. */
const PLATFORMS = ['linux', 'macos', 'win'] as const
type Platform = (typeof PLATFORMS)[number]

/** CPU tags shared by pkg targets and release channel names. */
const ARCHES = ['x64', 'arm64'] as const
type Arch = (typeof ARCHES)[number]

/** Whether a string is a supported platform tag. */
function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

/** Whether a string is a supported CPU tag. */
function isArch(value: string): value is Arch {
  return (ARCHES as readonly string[]).includes(value)
}

/** Product-specific constants that parameterize the shared pipeline. */
export interface ExeProduct {
  /** Short product name used in CLI and log prefixes. */
  readonly label: string
  /** pnpm deploy filter: the workspace package whose closure is staged. */
  readonly deployFilter: string
  /** The closed-runtime app entry inside the deployed closure. */
  readonly entryBin: string
  /** Output basename; products are `${basename}-${platform}-${arch}` in OUT_DIR. */
  readonly outputBasename: string
  /** Staging directory where the closure is deployed before packaging. */
  readonly stagingDir: string
  /** Source node_modules for restoring pnpm legacy deploy hoists. */
  readonly deploySourceNodeModules: string
  /** Documentation excluded from the staged closure root. */
  readonly deployOnlyDocs: readonly string[]
  /** Host-built node-pty addon staged into Linux closures. */
  readonly linuxPtySource: string
  /** The closure manifest whose dependencies define the executable. */
  readonly closureManifest: string
  /** Architecture note owning the build route, relative to the repo root. */
  readonly notePath: string
}

/**
 * A parsed pkg target triple, constructed from `--targets` or the host.
 */
export class Target {
  private constructor(
    /** pkg Node range (`node<major>`). */
    readonly nodeRange: string,
    /** pkg platform tag (`linux`, `macos`, or `win`). */
    readonly platform: Platform,
    /** pkg CPU tag. */
    readonly arch: Arch,
  ) {}

  /** The pkg `--targets` spec string `<nodeRange>-<platform>-<arch>`. */
  get spec(): string {
    return `${this.nodeRange}-${this.platform}-${this.arch}`
  }

  /**
   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.
   * @param spec - the raw triple, e.g. `node24-linux-x64`.
   * @param label - product label used in error messages.
   * @returns the parsed target.
   */
  static parse(spec: string, label: string): Target {
    const parts = spec.split('-')
    const [nodeRange, platform, arch] = parts
    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {
      throw new Error(`${label}: target ${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-linux-x64.`)
    }
    if (!/^node\d+$/.test(nodeRange)) {
      throw new Error(`${label}: target ${JSON.stringify(spec)}: node range must look like node24, got ${JSON.stringify(nodeRange)}.`)
    }
    if (!isPlatform(platform)) {
      throw new Error(`${label}: target ${JSON.stringify(spec)}: platform must be one of ${PLATFORMS.join(', ')}, got ${JSON.stringify(platform)}.`)
    }
    if (!isArch(arch)) {
      throw new Error(`${label}: target ${JSON.stringify(spec)}: arch must be one of ${ARCHES.join(', ')}, got ${JSON.stringify(arch)}.`)
    }
    return new Target(nodeRange, platform, arch)
  }

  /**
   * Resolve the host-platform default on Node 24.
   * @param label - product label used in error messages.
   * @returns the host target; throws on an unsupported host platform or arch.
   */
  static host(label: string): Target {
    const platform = process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'win'
          : undefined
    if (platform === undefined) {
      throw new Error(`${label}: unsupported host platform ${process.platform}; pass --targets explicitly.`)
    }
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
    if (arch === undefined) {
      throw new Error(`${label}: unsupported host arch ${process.arch}; pass --targets explicitly.`)
    }
    return new Target(DEFAULT_NODE_RANGE, platform, arch)
  }
}

/**
 * Canonical product filename for one target. pkg on Windows writes a `.exe`
 * suffix; the same name is used as `--output` so Linux and Windows hosts agree.
 * @param basename - the product `outputBasename`.
 * @param target - the parsed pkg target.
 * @returns the filename under `dist-exe/`.
 */
export function productFileName(basename: string, target: Target): string {
  const stem = `${basename}-${target.platform}-${target.arch}`
  return target.platform === 'win' ? `${stem}.exe` : stem
}

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
export class BuildCli {
  private constructor(
    /** Build targets; defaults to the host platform only. */
    readonly targets: readonly Target[],
    /** Skip step 1 (`pnpm run build`); lib/ artifacts must already exist. */
    readonly skipBuild: boolean,
    /** Print every command and config patch instead of executing. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv for one product. Help exits 0; malformed flags exit 1; invalid
   * or colliding targets throw.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @param product - the product whose label and staging shape messages.
   * @returns the parsed, validated configuration.
   */
  static parse(argv: string[], product: ExeProduct): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`${product.label}: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage(product))
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage(product))
      process.exit(0)
    }
    const targets = values.targets === undefined
      ? [Target.host(product.label)]
      : values.targets.split(',').map(part => part.trim()).filter(part => part !== '').map(spec => Target.parse(spec, product.label))
    if (targets.length === 0) throw new Error(`${product.label}: --targets is empty.`)
    const seen = new Set<string>()
    for (const target of targets) {
      const key = `${target.platform}-${target.arch}`
      if (seen.has(key)) {
        throw new Error(`${product.label}: duplicate platform-arch ${key} in --targets; canonical product names would collide.`)
      }
      seen.add(key)
    }
    return new BuildCli(targets, values['skip-build'], values['dry-run'])
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'targets': { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  /** Render the help text for a product. */
  static usage(product: ExeProduct): string {
    return [
      'Usage: pnpm exec tsx <product build script> [flags]',
      '',
      '  --targets=<t1,t2,...>  pkg targets, e.g. node24-linux-x64,node24-macos-arm64,node24-win-x64.',
      '                         Default: the host platform only (on node24).',
      '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
      '  --dry-run              print every command and config patch without executing.',
      '  --help                 print this help.',
      '',
      `Build route: ${PKG_SPEC} --sea; see ${product.notePath}.`,
      `Stages the closure in ${product.stagingDir} and writes executables to ${OUT_DIR}/.`,
    ].join('\n')
  }
}
