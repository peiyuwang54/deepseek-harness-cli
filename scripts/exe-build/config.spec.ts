/**
 * Tests for the shared exe target parser: published triples, the Windows
 * product filename, and host mapping on this machine.
 */

import { describe, expect, it } from 'vitest'

import { Target, productFileName } from './config.ts'

describe('Target.parse', () => {
  it('accepts the published linux, macos, and win triples', () => {
    expect(Target.parse('node24-linux-x64', 'test').spec).toBe('node24-linux-x64')
    expect(Target.parse('node24-macos-arm64', 'test').platform).toBe('macos')
    expect(Target.parse('node24-win-x64', 'test')).toMatchObject({ platform: 'win', arch: 'x64' })
  })

  it('rejects npm platform names and unknown arches', () => {
    expect(() => Target.parse('node24-windows-x64', 'test')).toThrow(/platform must be/)
    expect(() => Target.parse('node24-win-arm64', 'test')).not.toThrow()
    expect(() => Target.parse('node24-win-ia32', 'test')).toThrow(/arch must be/)
  })
})

describe('productFileName', () => {
  it('adds .exe only for the win pkg platform', () => {
    expect(productFileName('deepseek-harness-cli', Target.parse('node24-win-x64', 'test'))).toBe(
      'deepseek-harness-cli-win-x64.exe',
    )
    expect(productFileName('deepseek-harness-cli', Target.parse('node24-linux-x64', 'test'))).toBe(
      'deepseek-harness-cli-linux-x64',
    )
  })
})

describe('Target.host', () => {
  it('resolves this machine without throwing on a supported OS', () => {
    const host = Target.host('test')
    expect(['linux', 'macos', 'win']).toContain(host.platform)
    expect(['x64', 'arm64']).toContain(host.arch)
  })
})
