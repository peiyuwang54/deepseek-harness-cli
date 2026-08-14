import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitBranch } from '../src/chat/helpers.ts'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => 'main\n'),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('chat helpers', () => {
  it('scrubs ambient credentials and DSH names from the Git child', () => {
    vi.stubEnv('TUI_TEST_PASSWORD', 'ambient-password')
    vi.stubEnv('DSH_TUI_TEST_FLAG', 'ambient-harness-state')
    expect(gitBranch('/workspace')).toBe('main')
    const call = vi.mocked(execFileSync).mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ]
    expect(call[0]).toBe('git')
    expect(call[1]).toEqual(['branch', '--show-current'])
    expect(call[2].env).not.toHaveProperty('TUI_TEST_PASSWORD')
    expect(call[2].env).not.toHaveProperty('DSH_TUI_TEST_FLAG')
  })
})
