/**
 * External-editor process handoff for the terminal composer.
 * @module @deepseek-ai/dsh-tui/chat/external-editor
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Edits one composer draft outside the TUI and returns the saved text.
 * @param seed - Current composer text.
 * @returns Saved editor text.
 */
export type ExternalEditor = (seed: string) => Promise<string>

/** Process facts and launcher used by the editor file lifecycle. */
export interface ExternalEditorHost {
  /** Environment used to resolve and launch the editor. */
  readonly environment: NodeJS.ProcessEnv
  /** Quoting dialect selected for the launch command. */
  readonly platform: NodeJS.Platform
  /**
   * Run one editor command with the generated draft path in DSH_EDITOR_FILE.
   * @param command - Platform-shell command containing the environment-variable reference.
   * @param environment - Launch environment containing the generated draft path.
   * @returns A promise settled after the editor exits.
   */
  run(command: string, environment: NodeJS.ProcessEnv): Promise<void>
}

/** Error raised when the process has no configured external editor. */
export class MissingExternalEditorError extends Error {
  constructor() {
    super('set VISUAL or EDITOR before starting DeepSeek')
    this.name = 'MissingExternalEditorError'
  }
}

/**
 * Resolve the editor command, preferring VISUAL as terminal tools conventionally do.
 * @param environment - Process environment containing an optional VISUAL or EDITOR command.
 * @returns The non-empty command string.
 */
export function resolveExternalEditorCommand(environment: NodeJS.ProcessEnv): string {
  const visual = environment.VISUAL?.trim()
  if (visual !== undefined && visual !== '') return visual
  const editor = environment.EDITOR?.trim()
  if (editor !== undefined && editor !== '') return editor
  throw new MissingExternalEditorError()
}

/**
 * Build the platform-shell command that appends the temporary draft path.
 * The configured editor command is trusted user configuration; the generated
 * file path stays in an environment variable so it is never concatenated into
 * the command as untrusted text.
 * @param editorCommand - User-configured VISUAL or EDITOR command.
 * @param platform - Host process platform.
 * @returns One command string for Node's platform shell.
 */
export function externalEditorInvocation(
  editorCommand: string,
  platform: NodeJS.Platform,
): string {
  return platform === 'win32'
    ? `${editorCommand} "%DSH_EDITOR_FILE%"`
    : `${editorCommand} "$DSH_EDITOR_FILE"`
}

/* v8 ignore start -- production inherited-stdio process boundary; focused
   tests cover the file and terminal lifecycle through an injected host. */
const processExternalEditorHost: ExternalEditorHost = {
  environment: process.env,
  platform: process.platform,
  run(command, environment) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, {
        env: environment,
        shell: true,
        stdio: 'inherit',
      })
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(signal === null
          ? `editor exited with code ${String(code)}`
          : `editor was terminated by ${signal}`))
      })
    })
  },
}
/* v8 ignore stop */

/**
 * Launch the configured editor with inherited terminal streams.
 * @param seed - Existing composer text written into the temporary Markdown file.
 * @param host - Process launcher; production inherits the active terminal streams.
 * @returns The file contents after a successful editor exit.
 */
export async function editInExternalEditor(
  seed: string,
  host: ExternalEditorHost = processExternalEditorHost,
): Promise<string> {
  const editorCommand = resolveExternalEditorCommand(host.environment)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-editor-'))
  const draftPath = join(directory, 'draft.md')
  try {
    await writeFile(draftPath, seed, 'utf8')
    await host.run(
      externalEditorInvocation(editorCommand, host.platform),
      { ...host.environment, DSH_EDITOR_FILE: draftPath },
    )
    return await readFile(draftPath, 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
