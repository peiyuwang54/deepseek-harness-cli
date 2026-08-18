import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlugin } from '../src/plugin.ts'

function profileFixture(active = true): { home: string; installAnchor: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-inspect-'))
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'demo')
  const bundle = join(profile, 'node_modules', 'demo-bundle')
  const install = join(root, 'install')
  mkdirSync(bundle, { recursive: true })
  mkdirSync(install, { recursive: true })
  writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'dsh-test-install' }))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-demo',
    private: true,
    dependencies: { 'demo-bundle': 'file:demo-bundle' },
    dsh: { profile: { bundles: active ? ['demo-bundle'] : [] } },
  }))
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'demo-bundle',
    repository: { type: 'git', url: 'https://github.com/example/demo-bundle.git' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), '[]\n')
  return { home, installAnchor: join(install, 'package.json') }
}

describe('plugin inspection', () => {
  it('lists installed dependencies without invoking pnpm', () => {
    const fixture = profileFixture()
    let output = ''
    expect(runPlugin('demo', ['list'], { ...fixture, stdout: (text) => { output += text } })).toBe(0)
    expect(output).toContain('demo-bundle@file:demo-bundle · bundle · active')
  })

  it('verifies active bundle layers and emits JSON', () => {
    const fixture = profileFixture()
    let output = ''
    expect(runPlugin('demo', ['verify', '--json'], { ...fixture, stdout: (text) => { output += text } })).toBe(0)
    expect(JSON.parse(output)).toMatchObject({ profile: 'demo', valid: true, activeBundles: ['demo-bundle'] })
  })

  it('rejects a declared bundle that is not active', () => {
    const fixture = profileFixture(false)
    let output = ''
    expect(runPlugin('demo', ['verify'], { ...fixture, stdout: (text) => { output += text } })).toBe(1)
    expect(output).toContain('Inactive bundle declarations: demo-bundle')
  })

  it('shows the installed source and toggles a bundle without pnpm', () => {
    const fixture = profileFixture()
    let output = ''
    expect(runPlugin('demo', ['source', 'demo-bundle', '--json'], { ...fixture, stdout: (text) => { output += text } })).toBe(0)
    expect(JSON.parse(output)).toMatchObject({
      name: 'demo-bundle',
      source: 'https://github.com/example/demo-bundle.git',
    })

    output = ''
    expect(runPlugin('demo', ['disable', 'demo-bundle'], { ...fixture, stdout: (text) => { output += text } })).toBe(0)
    expect(output).toContain('Disabled plugin "demo-bundle"')
    output = ''
    expect(runPlugin('demo', ['enable', 'demo-bundle'], { ...fixture, stdout: (text) => { output += text } })).toBe(0)
    expect(output).toContain('Enabled plugin "demo-bundle"')
  })
})
