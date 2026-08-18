import { describe, expect, it } from 'vitest'
import { resolveHmrBaseDir } from '@deepseek-ai/cordis-plugin-hmr'

describe('HMR base path resolution', () => {
  it('accepts packaged Windows profile directories without parsing the drive as a URL scheme', () => {
    expect(resolveHmrBaseDir(
      String.raw`C:\Users\tester\.deepseek-harness-cli\profiles\tui`,
      'file:///C:/snapshot/deepseek-harness-cli/dist-exe/.staging/cli/node_modules/@deepseek-ai/dsh/',
    )).toBe(String.raw`C:\Users\tester\.deepseek-harness-cli\profiles\tui`)
  })

  it('accepts Windows UNC directories and preserves file-URL and relative behavior', () => {
    expect(resolveHmrBaseDir(String.raw`\\server\share\dsh`, 'file:///C:/snapshot/app/'))
      .toBe(String.raw`\\server\share\dsh`)
    expect(resolveHmrBaseDir('file:///C:/Users/tester/.dsh', 'file:///C:/snapshot/app/'))
      .toMatch(/C:[/\\]Users[/\\]tester[/\\]\.dsh$/u)
    expect(resolveHmrBaseDir('profiles/tui', 'file:///tmp/dsh/'))
      .toBe('/tmp/dsh/profiles/tui')
  })

  it('resolves a relative root when the embedded loader anchor is a Windows path', () => {
    expect(resolveHmrBaseDir(undefined, String.raw`C:\snapshot\deepseek-harness-cli\dist-exe\.staging\cli`))
      .toBe(String.raw`C:\snapshot\deepseek-harness-cli\dist-exe\.staging\cli`)
    expect(resolveHmrBaseDir('profiles/tui', String.raw`C:\snapshot\deepseek-harness-cli\dist-exe\.staging\cli`))
      .toBe(String.raw`C:\snapshot\deepseek-harness-cli\dist-exe\.staging\cli\profiles\tui`)
  })
})
