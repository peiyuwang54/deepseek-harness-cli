/**
 * Workspace-selection controller for the terminal channel. A selection always
 * starts a fresh process/session in that directory; the current session's
 * immutable header cwd is never rewritten.
 * @module @deepseek-ai/dsh-tui/chat/workspace
 */

import { resolve } from 'node:path'
import {
  Input,
  Key,
  SelectList,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type SelectItem,
} from '@earendil-works/pi-tui'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { dialogSelectTheme } from '../components/theme.ts'
import { displayText } from '../components/text.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { TuiRuntime } from '../runtime.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** One workspace row rendered by the terminal picker. */
interface WorkspaceChoice {
  readonly workspace: Workspace
  readonly current: boolean
}

/** Searchable workspace selector. */
class WorkspaceDialog implements Component {
  private readonly filter = new Input()
  private list: SelectList
  private readonly items: ReadonlyMap<string, SelectItem>
  private readonly choices: ReadonlyMap<string, WorkspaceChoice>

  constructor(
    choices: readonly WorkspaceChoice[],
    private readonly maxVisible: number,
    private readonly palette: ChatChannelDeps['palette'],
    private readonly done: (choice: WorkspaceChoice) => void,
    private readonly cancel: () => void,
  ) {
    this.choices = new Map(choices.map(choice => [String(choice.workspace.id), choice]))
    this.items = new Map(choices.map((choice) => {
      const value = String(choice.workspace.id)
      return [value, {
        value,
        label: displayText(choice.workspace.title),
        description: `${displayText(choice.workspace.path)}${choice.current ? ' · current' : ''}`,
      }]
    }))
    this.list = this.buildList()
  }

  private filteredItems(): SelectItem[] {
    const query = this.filter.getValue().trim().toLocaleLowerCase()
    const items = [...this.items.values()]
    if (query === '') return items
    return items.filter((item) => {
      const choice = this.choices.get(item.value)
      return choice !== undefined && [choice.workspace.title, choice.workspace.path]
        .some(value => value.toLocaleLowerCase().includes(query))
    })
  }

  private buildList(selected?: string): SelectList {
    const items = this.filteredItems()
    const list = new SelectList(items, this.maxVisible, dialogSelectTheme(this.palette))
    const index = selected === undefined ? 0 : items.findIndex(item => item.value === selected)
    list.setSelectedIndex(Math.max(0, index))
    list.onSelect = (item) => {
      const choice = this.choices.get(item.value)
      if (choice !== undefined) this.done(choice)
    }
    list.onCancel = this.cancel
    return list
  }

  invalidate(): void {
    this.filter.invalidate()
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.filter.getValue() === '') this.cancel()
      else {
        this.filter.setValue('')
        this.list = this.buildList()
      }
    } else if (matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
    } else if (
      matchesKey(data, Key.up)
      || matchesKey(data, Key.down)
      || matchesKey(data, Key.enter)
    ) {
      this.list.handleInput(data)
    } else {
      const selected = this.list.getSelectedItem()?.value
      const previous = this.filter.getValue()
      this.filter.focused = true
      this.filter.handleInput(data)
      if (this.filter.getValue() !== previous) this.list = this.buildList(selected)
    }
    this.invalidate()
  }

  render(width: number): string[] {
    const cardWidth = Math.max(20, width)
    const innerWidth = Math.max(1, cardWidth - 4)
    this.filter.focused = true
    const filter = truncateToWidth(this.filter.render(innerWidth).join(''), innerWidth, '')
    const title = ' Select workspace '
    const rows = this.filteredItems().length === 0
      ? [this.palette.warning('No workspaces match the filter.')]
      : this.list.render(innerWidth)
    const body = [filter, '', ...rows, '', this.palette.dim('Type to filter • ↑/↓ move • Enter new session • Esc close')]
    return [
      this.palette.accent(`╭${title}${'─'.repeat(Math.max(0, cardWidth - visibleWidth(title) - 2))}╮`),
      ...body.map((line) => {
        const clipped = truncateToWidth(line, innerWidth, '')
        return `${this.palette.accent('│')} ${clipped}${' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${this.palette.accent('│')}`
      }),
      this.palette.accent(`╰${'─'.repeat(Math.max(0, cardWidth - 2))}╯`),
    ]
  }
}

/** Collaborators for one channel's workspace selector. */
export interface WorkspaceControllerDeps extends ChatChannelDeps, ChannelNotice {
  readonly agent: Agent
  readonly runtime: TuiRuntime
  /** Current status re-read around asynchronous preflight. */
  agentStatus(): AgentStatus
  /** Release pi-tui plus terminal modes immediately before process handoff. */
  releaseTerminal(): void
  /** Restore terminal modes and editor focus after a host failure. */
  restoreTerminal(): void
}

/** Workspace-selection controller. */
export interface WorkspaceController {
  /** Queue `/workspace`; empty input opens the registry picker, a path creates/selects it. */
  queueWorkspaceCommand(raw: string): void
  /** Forget the picker during shutdown. */
  clearOverlay(): void
}

/**
 * Build a workspace picker over the shared durable registry.
 * @param deps - channel, agent, terminal, and handoff collaborators.
 * @returns the command controller.
 */
export function createWorkspaceController(deps: WorkspaceControllerDeps): WorkspaceController {
  const { ctx, agent, runtime, resolved, palette, overlayManager } = deps
  let workspaceOverlay: TuiOverlaySession | undefined
  let operations = Promise.resolve()
  let handoffInFlight = false

  const registry = (): WorkspaceRegistry | undefined => ctx.get('workspaceRegistry')

  const handoff = async (workspace: Workspace): Promise<void> => {
    if (handoffInFlight) return
    if (deps.agentStatus() !== 'idle') {
      throw new Error(`Workspace selection requires an idle agent (status: ${deps.agentStatus()}).`)
    }
    // Claim before the first await: repeated Enter/mouse activation must not
    // run two status checks, flushes, or host handoffs in parallel.
    handoffInFlight = true
    let terminalReleased = false
    try {
      const host = runtime.handoffWorkspace
      if (host === undefined) {
        await workspaceOverlay?.close()
        workspaceOverlay = undefined
        deps.appendNotice('Workspace selection is available, but this host cannot start it in place.', 'warning')
        return
      }
      if (await workspace.status() !== 'ok') {
        throw new Error(`workspace directory is unavailable: ${workspace.path}`)
      }
      await ctx.sessions.flush(agent.session)
      if (deps.isDisposed()) return
      if (deps.agentStatus() !== 'idle') {
        throw new Error(`Workspace selection requires an idle agent (status: ${deps.agentStatus()}).`)
      }
      await workspaceOverlay?.close()
      workspaceOverlay = undefined
      await runtime.terminal.drainInput(100, 20)
      if (deps.isDisposed()) return
      deps.releaseTerminal()
      terminalReleased = true
      await host(workspace.path)
      throw new Error('workspace host returned without replacing the process')
    } catch (error: unknown) {
      if (!deps.isDisposed()) {
        if (terminalReleased) deps.restoreTerminal()
        deps.appendNotice(`Workspace switch failed: ${errorChain(error)}`, 'error')
      }
    } finally {
      handoffInFlight = false
    }
  }

  const showWorkspacePicker = (): void => {
    if (deps.agentStatus() !== 'idle') {
      deps.appendNotice('Workspace selection requires the current turn to finish or be cancelled first.', 'warning')
      return
    }
    const service = registry()
    if (service === undefined) {
      deps.appendNotice('Workspace registry is not available in this composition.', 'warning')
      return
    }
    const workspaces = service.list()
    if (workspaces.length === 0) {
      deps.appendNotice('No workspaces are registered. Use /workspace <directory> to add one.', 'warning')
      return
    }
    const choices = workspaces.map(workspace => ({
      workspace,
      current: workspace.path === agent.session.header.cwd,
    }))
    void workspaceOverlay?.close()
    const session = overlayManager.open({
      create: () => new WorkspaceDialog(
        choices,
        resolved.maxResumeOptions,
        palette,
        (choice) => {
          void handoff(choice.workspace).catch((error: unknown) => {
            if (!deps.isDisposed()) deps.appendNotice(`Workspace switch failed: ${errorChain(error)}`, 'error')
          })
        },
        () => { void session.close() },
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    })
    workspaceOverlay = session
    void session.closed.then(() => {
      if (workspaceOverlay === session) workspaceOverlay = undefined
    })
    deps.requestRender()
  }

  const runWorkspaceCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim()
    if (argument === '') {
      showWorkspacePicker()
      return
    }
    if (deps.agentStatus() !== 'idle') {
      deps.appendNotice('Workspace selection requires the current turn to finish or be cancelled first.', 'warning')
      return
    }
    const service = registry()
    if (service === undefined) {
      deps.appendNotice('Workspace registry is not available in this composition.', 'warning')
      return
    }
    const workspace = await service.create(resolve(argument))
    if (!deps.isDisposed()) await handoff(workspace)
  }

  return {
    queueWorkspaceCommand(raw): void {
      operations = operations.then(() => runWorkspaceCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Workspace command failed: ${errorChain(error)}`, 'error')
      })
    },
    clearOverlay(): void {
      workspaceOverlay = undefined
    },
  }
}
