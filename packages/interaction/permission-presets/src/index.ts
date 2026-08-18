/**
 * User-facing permission presets over the independent sandbox-mode and
 * approval-policy knobs. A switch records the selected preset, then writes
 * changed knobs through their canonical setters. Execution, prompt narration,
 * and replay keep reading their knob folds. The preset event preserves user
 * intent when two presets share a bundle. The read side ships as the
 * `permissions` session projection; the write side ships as the
 * `/permissions` command — both optional children over the same service.
 *
 * @module dsh-permission-presets
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
// Side-effect type import: declaration-merges `ctx.shell` (the capability fact
// `sandboxMode` this service reads), without a value dependency on the seam.
import type {} from '@deepseek-ai/dsh-shell'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { APPROVAL_POLICIES, effectiveApprovalPolicy, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: resolves ctx.sessionProjections / ctx.commands for the optional children.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-commands'
import type { PermissionSelect, PresetOption } from './types.ts'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export { SANDBOX_MODES } from '@deepseek-ai/dsh-sandbox-policy'
export { APPROVAL_POLICIES } from '@deepseek-ai/dsh-user-approval'

// The `permissions` projection-key declaration lives in src/types.ts (its one
// home); this re-export projects the type face onto the package root AND
// keeps the module edge in the emitted index.d.ts, so aggregate programs
// consuming the declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    permissionPresets: PermissionPresetService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records the selected preset as durable, log-only user intent. The knob
     * events follow in the same turn and control execution; this event stays
     * out of the model transcript and lets {@link effectivePermissionPreset}
     * preserve a selection when bundles match.
     */
    'permission/preset': { preset: string }
  }
}

/** One preset's sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}

/** Independently selected startup permission knobs. */
export interface PermissionPolicySelection {
  /** Sandbox mode to pin; omitted to retain the session's effective mode. */
  sandbox?: SandboxMode
  /** Approval policy to pin; omitted to retain the session's effective policy. */
  approval?: ApprovalPolicy
}

/**
 * Returned when effective knob values match no table entry. Clients may show
 * it as the current value, but it is never a switch target or event payload.
 */
export const CUSTOM_PRESET = 'custom'

/** Settings namespace carrying the default for future sessions. */
export const PERMISSION_SETTINGS_NAMESPACE = settingsNamespace('permission')

/**
 * Fold the last selected preset from the durable log; replay needs no catch-up
 * state.
 * @param events - session events in log order; other event types are ignored.
 * @returns the last selected preset, or undefined when none was recorded.
 */
export function effectivePermissionPreset(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'permission/preset') return event.data.preset
  }
  return undefined
}

/**
 * The projection unit's state: the last seen value of each knob event, null
 * before an override (composition defaults apply at view time). Plain JSON
 * (persisted-cache precondition).
 */
export interface KnobState {
  /** Last `permission/preset` payload, or null. */
  preset: string | null
  /** Last `sandbox/mode` payload, or null. */
  sandbox: SandboxMode | null
  /** Last `approval/policy` payload, or null. */
  approval: ApprovalPolicy | null
}

/** State for the empty log: every knob at its composition default. */
const EMPTY_KNOBS: KnobState = { preset: null, sandbox: null, approval: null }

/**
 * One-event knob transition (the projection unit's `apply`). Uninterested
 * events return the same reference — the registry's change gate.
 * @param state - the folded knob state before `event`.
 * @param event - one committed session event.
 * @returns the next state; the same reference when the event is not a knob.
 */
export function applyKnobEvent(state: KnobState, event: SessionEvent): KnobState {
  switch (event.type) {
    case 'permission/preset':
      return { ...state, preset: event.data.preset }
    case 'sandbox/mode':
      return { ...state, sandbox: event.data.mode }
    case 'approval/policy':
      return { ...state, approval: event.data.policy }
    default:
      return state
  }
}

/** Whole-log knob fold (the cold-read parallel of {@link applyKnobEvent}). */
function foldKnobs(events: readonly SessionEvent[]): KnobState {
  let state = EMPTY_KNOBS
  for (const event of events) state = applyKnobEvent(state, event)
  return state
}

/** User setting resolved when a new session receives its initial permission. */
export interface PermissionSettings {
  /** Preset pinned into a newly created session. */
  defaultPreset: string
}

/** The {@link PermissionPresetService} config: preset table and composition default. */
export interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask), `full-auto` (workspace-write + never), and
   * `danger-full-access` (danger-full-access + never). The name `custom` is
   * reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
  /** Additional execution policy applied before any tool dispatch. */
  security?: SecurityPolicyConfig
}

/** Deployment-level execution restrictions shared by model-facing tools. */
export interface SecurityPolicyConfig {
  /** Tool names allowed when non-empty; deny rules still take precedence. */
  toolAllow?: string[]
  /** Tool names denied before approval or dispatch. */
  toolDeny?: string[]
  /** JavaScript regular expressions matched against bash/pwsh command text. */
  commandAllow?: string[]
  /** JavaScript regular expressions that deny bash/pwsh command text. */
  commandDeny?: string[]
  /** Exact hosts or `*.domain` patterns allowed for `web_fetch`. */
  networkAllowlist?: string[]
  /** MCP server name → trust action for `mcp__<server>__*` tools. */
  mcpTrust?: Record<string, 'trusted' | 'prompt' | 'blocked'>
  /** Prevent `/permissions` from changing the selected preset at runtime. */
  administratorLocked?: boolean
}

interface ResolvedSecurityPolicy {
  readonly toolAllow: readonly string[]
  readonly toolDeny: readonly string[]
  readonly commandAllow: readonly RegExp[]
  readonly commandDeny: readonly RegExp[]
  readonly networkAllowlist: readonly string[] | undefined
  readonly mcpTrust: Readonly<Record<string, 'trusted' | 'prompt' | 'blocked'>>
  readonly administratorLocked: boolean
}

function compilePatterns(patterns: readonly string[] | undefined, label: string): readonly RegExp[] {
  return (patterns ?? []).map((pattern) => {
    try {
      return new RegExp(pattern, 'u')
    } catch (error) {
      throw new Error(`permission: invalid ${label} regular expression ${JSON.stringify(pattern)}`, { cause: error })
    }
  })
}

function normalizeHostPattern(pattern: string, label: string): string {
  const normalized = pattern.trim().toLowerCase()
  if (normalized === '' || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(normalized)) {
    throw new Error(`permission: ${label} contains invalid host pattern ${JSON.stringify(pattern)}`)
  }
  return normalized
}

function hostAllowed(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return patterns.some(pattern => pattern.startsWith('*.')
    ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
    : host === pattern)
}

function commandText(exec: ToolExecution): string | undefined {
  if (exec.name !== 'bash' && exec.name !== 'pwsh') return undefined
  const args = exec.arguments
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : undefined
}

function mcpServerName(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined
  const separator = toolName.indexOf('__', 5)
  return separator <= 5 ? undefined : toolName.slice(5, separator)
}

/**
 * Owns the deployment's permission presets and their write path. Requires a
 * confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are
 * reported as {@link CUSTOM_PRESET}, not an error.
 */
export class PermissionPresetService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    presets: z.dict(z.object({
      sandbox: z.union(SANDBOX_MODES as SandboxMode[]).required(),
      approval: z.union(APPROVAL_POLICIES as ApprovalPolicy[]).required(),
      name: z.string(),
      description: z.string(),
    })).default({
      'workspace-write': {
        sandbox: 'workspace-write', approval: 'ask',
        name: 'workspace-write', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
      },
      'full-auto': {
        sandbox: 'workspace-write', approval: 'never',
        name: 'full-auto', description: 'Run without prompts inside the workspace; wider actions are denied.',
      },
      'danger-full-access': {
        sandbox: 'danger-full-access', approval: 'never',
        name: 'danger-full-access', description: 'Full file access without approval prompts.',
      },
    }),
    defaultPreset: z.string(),
    security: z.object({
      toolAllow: z.array(String).default([]),
      toolDeny: z.array(String).default([]),
      commandAllow: z.array(String).default([]),
      commandDeny: z.array(String).default([]),
      networkAllowlist: z.array(String).default(undefined as unknown as string[]),
      mcpTrust: z.dict(z.union(['trusted', 'prompt', 'blocked'] as const)).default({}),
      administratorLocked: z.boolean().default(false),
    }).default(undefined as unknown as {
      toolAllow: string[]
      toolDeny: string[]
      commandAllow: string[]
      commandDeny: string[]
      networkAllowlist: string[]
      mcpTrust: Record<string, 'trusted' | 'prompt' | 'blocked'>
      administratorLocked: boolean
    }),
  })

  static inject = ['shell', 'approval', 'sessions']

  private readonly presets: Record<string, PresetSpec>
  private readonly security: ResolvedSecurityPolicy
  private defaultSettings: () => PermissionSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'permissionPresets')
    // The schema defaulted the table — the cast records that runtime fact.
    this.presets = config.presets as Record<string, PresetSpec>
    const security = config.security ?? {}
    this.security = Object.freeze({
      toolAllow: Object.freeze([...(security.toolAllow ?? [])]),
      toolDeny: Object.freeze([...(security.toolDeny ?? [])]),
      commandAllow: Object.freeze(compilePatterns(security.commandAllow, 'commandAllow')),
      commandDeny: Object.freeze(compilePatterns(security.commandDeny, 'commandDeny')),
      networkAllowlist: security.networkAllowlist === undefined
        ? undefined
        : Object.freeze(security.networkAllowlist.map(pattern => normalizeHostPattern(pattern, 'networkAllowlist'))),
      mcpTrust: Object.freeze({ ...(security.mcpTrust ?? {}) }),
      administratorLocked: security.administratorLocked ?? false,
    })
    if (CUSTOM_PRESET in this.presets) {
      throw new Error(`permission: "${CUSTOM_PRESET}" is reserved for the derived not-a-preset state and cannot name a table entry`)
    }
    if (ctx.shell.sandboxMode === undefined) {
      throw new Error('permission: the mounted bash executor does not confine (no sandboxMode) — presets bundle a sandbox mode, so composing this plugin over an unconfined executor is a misconfiguration')
    }
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
        const toolDenied = this.security.toolDeny.includes(exec.name)
        const toolMissingFromAllow = this.security.toolAllow.length > 0 && !this.security.toolAllow.includes(exec.name)
        if (toolDenied || toolMissingFromAllow) {
          return { kind: 'deny', reason: `tool "${exec.name}" is blocked by the administrator security policy` }
        }

        const trust = mcpServerName(exec.name)
        const trustPolicy = trust === undefined ? undefined : this.security.mcpTrust[trust]
        if (trustPolicy === 'blocked') return { kind: 'deny', reason: `MCP server "${trust}" is blocked by the administrator security policy` }
        if (trustPolicy === 'prompt') return { kind: 'ask', reason: `MCP server "${trust}" requires approval for this tool call` }

        const command = commandText(exec)
        if (command !== undefined) {
          if (this.security.commandDeny.some(pattern => pattern.test(command))) {
            return { kind: 'deny', reason: `command is blocked by the administrator security policy: ${JSON.stringify(command)}` }
          }
          if (this.security.commandAllow.length > 0 && !this.security.commandAllow.some(pattern => pattern.test(command))) {
            return { kind: 'deny', reason: `command does not match the administrator command allowlist: ${JSON.stringify(command)}` }
          }
        }

        if (exec.name === 'web_fetch' && this.security.networkAllowlist !== undefined) {
          const args = exec.arguments
          const url = typeof args === 'object' && args !== null && !Array.isArray(args)
            ? (args as Record<string, unknown>).url
            : undefined
          if (typeof url !== 'string') return { kind: 'deny', reason: 'web_fetch URL is missing from the security policy check' }
          let hostname: string
          try {
            hostname = new URL(url).hostname
          } catch {
            return { kind: 'deny', reason: `web_fetch URL is invalid under the administrator security policy: ${JSON.stringify(url)}` }
          }
          if (!hostAllowed(hostname, this.security.networkAllowlist)) {
            return { kind: 'deny', reason: `web_fetch host "${hostname}" is not in the administrator network allowlist` }
          }
        }
        return next()
      })
    })
    const inferredDefault = this.derive(EMPTY_KNOBS)
    const defaultPreset = config.defaultPreset ?? inferredDefault
    if (defaultPreset === CUSTOM_PRESET) {
      throw new Error('permission: composed sandbox and approval defaults match no preset; configure defaultPreset explicitly')
    }
    this.resolve(defaultPreset)
    const baseSettings: PermissionSettings = { defaultPreset }
    this.defaultSettings = () => baseSettings
    const presetChoices = this.names.map((name) => {
      const choice = z.const(name)
      const label = this.presets[name]?.name
      return label === undefined ? choice : choice.description(label)
    })
    const settingsSchema: z<PermissionSettings> = z.object({
      defaultPreset: z.union(presetChoices).required(),
    })
    installSettingsSection(ctx, PERMISSION_SETTINGS_NAMESPACE, settingsSchema, baseSettings, {
      setSource: (current) => {
        this.defaultSettings = current
      },
      // The source thunk reads the latest scope snapshot at session creation;
      // no process-level registration needs replacement on change.
      onChange: () => {},
    })

    ctx.on('session/created', (session) => {
      this.pinInitialPermission(session)
    })
    for (const session of ctx.sessions.list()) {
      this.pinInitialPermission(session)
    }

    // The permissions projection unit: fold the three whole-value knob
    // events; view derives the select over the composition defaults this
    // service already owns. The unit child activates only when a projection
    // registry is composed (headless assemblies stay unaffected).
    // zod `.optional()` types the key `string | undefined` while the domain
    // says `description?: string`; on the JSON wire the two serialize
    // identically (absent), so the cast records exactly that
    // exactOptionalPropertyTypes widening (the Wire<T> precedent).
    const selectSchema = zod.object({
      options: zod.array(zod.object({
        value: zod.string().min(1),
        name: zod.string().min(1),
        description: zod.string().optional(),
      })),
      currentValue: zod.string().min(1),
    }) as unknown as zod.ZodType<PermissionSelect>
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'permissions', KnobState>({
        key: 'permissions',
        schema: selectSchema,
        init: () => EMPTY_KNOBS,
        apply: applyKnobEvent,
        view: state => this.selectFor(state),
        stateVersion: 1,
      })
    })

    // The command write path activates only when a command registry is
    // composed. Interactive surfaces submit /permissions; process startup
    // owns any high-risk launch shortcut before the Agent is published.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'permissions',
        description: 'Switch the permission preset (sandbox mode + approval policy)',
        input: { hint: '<preset>' },
        // No settlement text labels its value with this command's own name: a
        // surface that renders `name · text` (the web command row) would
        // otherwise read `permission · Permission preset: workspace-write.`
        handler: ({ agent, rawInput }) => {
          const name = rawInput.trim()
          if (name === '') {
            return { kind: 'success', text: `current preset ${this.current(agent.session.events)} (available: ${this.names.join(', ')})` }
          }
          if (!this.names.includes(name)) {
            return { kind: 'error', text: `unknown preset "${name}" (available: ${this.names.join(', ')})` }
          }
          if (this.security.administratorLocked) {
            return { kind: 'error', text: 'permission presets are locked by the administrator policy' }
          }
          this.apply(agent.session, name, (policy) =>{  this.ctx.approval.setPolicy(agent, policy) })
          return { kind: 'success', text: `preset ${name}` }
        },
      })
    })
  }

  /**
   * The advertised preset names, in the preset table's declaration order.
   * @returns every switchable preset name.
   */
  get names(): readonly string[] {
    return Object.keys(this.presets)
  }

  /**
   * Resolve the configured preset that disables both confinement and prompts.
   * @returns the matching preset name, or undefined when this deployment offers none.
   */
  get fullAccessPreset(): string | undefined {
    return this.names.find((name) => {
      const preset = this.presets[name]
      return preset?.sandbox === 'danger-full-access' && preset.approval === 'never'
    })
  }

  /**
   * Resolve the configured preset that runs unattended while retaining the
   * workspace confinement boundary.
   * @returns the matching preset name, or undefined when this deployment offers none.
   */
  get fullAutoPreset(): string | undefined {
    return this.names.find((name) => {
      const preset = this.presets[name]
      return preset?.sandbox === 'workspace-write' && preset.approval === 'never'
    })
  }

  /**
   * The preset currently selected as the default for future sessions.
   * @returns the resolved settings value, or the composition default without
   * a mounted settings provider.
   */
  get defaultPreset(): string {
    return this.defaultSettings().defaultPreset
  }

  /**
   * Resolve the preset matching the effective knob values. A still-matching
   * last selection wins shared-bundle ties; otherwise the first table match
   * wins, or {@link CUSTOM_PRESET} when no entry matches.
   * @param events - the session's events in log order.
   * @returns the effective preset name, or `custom` when nothing matches.
   */
  current(events: readonly SessionEvent[]): string {
    return this.derive(foldKnobs(events))
  }

  /** Resolve the preset for one folded knob state (the shared mathematics of `current` and the projection unit). */
  private derive(state: KnobState): string {
    const sandbox = state.sandbox ?? this.ctx.shell.sandboxMode
    const approval = state.approval ?? this.ctx.approval.config.policy ?? 'ask'
    const matches = (spec: PresetSpec): boolean => spec.sandbox === sandbox && spec.approval === approval
    if (state.preset !== null) {
      const spec = this.presets[state.preset]
      if (spec !== undefined && matches(spec)) return state.preset
    }
    for (const [name, spec] of Object.entries(this.presets)) {
      if (matches(spec)) return name
    }
    return CUSTOM_PRESET
  }

  /**
   * Build the whole select value for one folded knob state: every table
   * option in declaration order, `custom` appended exactly while derived.
   * @param state - the folded knob overrides.
   * @returns the `permissions` projection payload.
   */
  selectFor(state: KnobState): PermissionSelect {
    const currentValue = this.derive(state)
    return {
      options: [
        ...this.names.map(name => this.optionOf(name)),
        ...currentValue === CUSTOM_PRESET ? [this.optionOf(CUSTOM_PRESET)] : [],
      ],
      currentValue,
    }
  }

  /**
   * Resolve a preset's knob bundle.
   * @param name - the preset name to resolve.
   * @returns the configured bundle.
   * @throws when `name` is not in the table.
   */
  resolve(name: string): PresetSpec {
    const spec = this.presets[name]
    if (spec === undefined) {
      throw new Error(`permission: unknown preset "${name}" (known: ${Object.keys(this.presets).join(', ')})`)
    }
    return spec
  }

  /**
   * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
   * missing label falls back to the table key.
   * @param name - a table key, or `custom`.
   * @returns the option a client renders.
   * @throws when `name` is neither a table key nor `custom`.
   */
  optionOf(name: string): PresetOption {
    if (name === CUSTOM_PRESET) {
      return { value: CUSTOM_PRESET, name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }
    }
    const spec = this.resolve(name)
    return { value: name, name: spec.name ?? name, ...spec.description !== undefined ? { description: spec.description } : {} }
  }

  /**
   * Record a changed preset, then update each changed knob through its own
   * setter. Selecting the effective preset again appends nothing.
   * @param session - the session the switch belongs to.
   * @param name - the preset to switch to; unknown names throw.
   */
  set(session: Session, name: string): void {
    if (this.security.administratorLocked) throw new Error('permission presets are locked by the administrator policy')
    this.apply(session, name, (policy) =>{  setApprovalPolicy(session, policy) })
  }

  /**
   * Apply independently selected permission knobs without claiming a named
   * preset. The derived current value still resolves to a matching preset when
   * the resulting pair exists in the table, otherwise it becomes `custom`.
   * @param session - Session receiving the startup policy.
   * @param selection - Explicit knobs; omitted fields retain their effective values.
   */
  setPolicy(session: Session, selection: PermissionPolicySelection): void {
    if (this.security.administratorLocked) throw new Error('permission presets are locked by the administrator policy')
    const events = session.events
    if (selection.sandbox !== undefined
      && selection.sandbox !== (effectiveSandboxMode(events) ?? this.ctx.shell.sandboxMode)) {
      setSandboxMode(session, selection.sandbox)
    }
    if (selection.approval !== undefined
      && selection.approval !== (effectiveApprovalPolicy(events) ?? this.ctx.approval.config.policy ?? 'ask')) {
      setApprovalPolicy(session, selection.approval)
    }
  }

  /** Apply one preset with the caller-selected live or initialization policy writer. */
  private apply(session: Session, name: string, setApproval: (policy: ApprovalPolicy) => void): void {
    const spec = this.resolve(name)
    if (this.current(session.events) !== name) {
      session.append('permission/preset', { preset: name })
    }
    const events = session.events
    if (spec.sandbox !== (effectiveSandboxMode(events) ?? this.ctx.shell.sandboxMode)) {
      setSandboxMode(session, spec.sandbox)
    }
    if (spec.approval !== (effectiveApprovalPolicy(events) ?? this.ctx.approval.config.policy ?? 'ask')) {
      setApproval(spec.approval)
    }
  }

  /**
   * Fill every missing permission fact before a session is published. A
   * genuinely fresh session uses the current user default; seeded or partially
   * initialized sessions preserve their effective knob values and only gain
   * the missing durable facts.
   */
  private pinInitialPermission(session: Session): void {
    const events = session.events
    const selected = effectivePermissionPreset(events)
    const sandbox = effectiveSandboxMode(events)
    const approval = effectiveApprovalPolicy(events)
    const seeded = events.some(event => event.type === 'session/end-seed')
    if (selected === undefined && sandbox === undefined && approval === undefined && !seeded) {
      const name = this.defaultPreset
      const spec = this.resolve(name)
      session.append('permission/preset', { preset: name })
      setSandboxMode(session, spec.sandbox)
      setApprovalPolicy(session, spec.approval)
      return
    }

    const state: KnobState = {
      preset: selected ?? null,
      sandbox: sandbox ?? null,
      approval: approval ?? null,
    }
    const effective = this.derive(state)
    if (selected === undefined && effective !== CUSTOM_PRESET) {
      session.append('permission/preset', { preset: effective })
    }
    if (sandbox === undefined) {
      setSandboxMode(session, this.ctx.shell.sandboxMode as SandboxMode)
    }
    if (approval === undefined) {
      setApprovalPolicy(session, this.ctx.approval.config.policy ?? 'ask')
    }
  }
}

export default PermissionPresetService
