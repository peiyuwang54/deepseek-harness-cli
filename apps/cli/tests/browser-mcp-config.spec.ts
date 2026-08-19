/**
 * The Playwright example stays config-only. This suite pins its executable,
 * safety arguments, and package version, then substitutes the package-owned
 * keyless fixture and proves the real Loader discovers a browser-namespaced
 * tool through the generic MCP bridge.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpRegistry from '@deepseek-ai/dsh-mcp'
import * as McpClient from '@deepseek-ai/dsh-mcp-client/src/index.ts'

interface InsertedRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

const root = resolve(import.meta.dirname, '../../..')
const overlay = resolve(root, 'examples/mcp-browser/playwright.cordis.yml')
const baseConfig = resolve(root, 'examples/mcp-browser/tests/fixtures/base.cordis.yml')
const fixtureServer = resolve(root, 'packages/mcp/mcp-client/tests/fixture-server.ts')
const liveContexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...liveContexts].map(async ctx => ctx.fiber.dispose()))
  liveContexts.clear()
})

function insertedRow(patches: PatchOptions[]): InsertedRow {
  expect(patches).toHaveLength(1)
  const insert = patches[0]?.insert
  expect(insert).toHaveLength(1)
  return insert?.[0] as InsertedRow
}

async function waitForTool(ctx: Context, name: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!ctx.tools.schemas().some(schema => schema.name === name)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${name}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
}

describe('Playwright MCP browser validation example', () => {
  it('pins a preinstalled executable and restrictive defaults', () => {
    const source = readFileSync(overlay, 'utf8')
    const row = insertedRow(loadOverlayPatches('browser-mcp-config-test', overlay))

    expect(source.split('\n', 1)[0]).toContain('@playwright/mcp 0.0.79')
    expect(row).toMatchObject({
      id: 'browser-playwright',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'playwright',
        transport: 'stdio',
        command: 'playwright-mcp',
        args: [
          '--headless',
          '--isolated',
          '--block-service-workers',
          '--image-responses',
          'omit',
          '--allowed-origins',
          'http://localhost:*;http://127.0.0.1:*',
        ],
        cwd: { __jsExpr: 'process.cwd()' },
      },
    })
    expect(source).not.toMatch(/\bnpx\b/)
    expect(source).not.toContain('--no-sandbox')
    expect(source).not.toContain('--allow-unrestricted-file-access')
    expect(source).not.toContain('DEEPSEEK_API_KEY')
  })

  it('loads the overlay and discovers a keyless fixture tool', async () => {
    const patches = loadOverlayPatches('browser-mcp-config-test', overlay)
    const row = insertedRow(patches)
    row.name = 'cordis:browser-test-mcp-client'
    const fixturePatch: PatchOptions = {
      id: 'browser-playwright',
      config: {
        serverName: 'playwright',
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        env: {},
        cwd: root,
        toolCallTimeoutMs: 5_000,
      },
    }
    const ctx = await boot(
      'browser-mcp-config-test',
      baseConfig,
      [...patches, fixturePatch],
      (ctx) => {
        liveContexts.add(ctx)
        ctx.loader.builtins['browser-test-system-prompt'] = SystemPrompt
        ctx.loader.builtins['browser-test-tools'] = ToolRuntime
        ctx.loader.builtins['browser-test-mcp'] = McpRegistry
        ctx.loader.builtins['browser-test-mcp-client'] = McpClient
      },
    )
    await waitForTool(ctx, 'mcp__playwright__greet')
  }, 15_000)
})
