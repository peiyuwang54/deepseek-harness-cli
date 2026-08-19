/**
 * Focused contracts for Loader metadata expressions and runtime-created
 * package resolution.
 */

import { describe, expect, it } from 'vitest'
import { chooserRootDependencyErrors, metadataExpressionErrors } from './verify-cordis-config.ts'

describe('verify-cordis-config metadata expressions', () => {
  it('accepts a disabled !!js expression', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
      '[0]',
    )
    expect(problems).toEqual([])
  })

  it('rejects an expression in a static metadata field', () => {
    const problems = metadataExpressionErrors({ id: { __jsExpr: 'process.platform' }, name: 'pkg' }, '[0]')
    expect(problems).toContain('[0].id: !!js is not interpolated here')
  })

  it('rejects an expression nested below disabled (only the field itself interpolates)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { when: { __jsExpr: 'process.platform' } } },
      '[0]',
    )
    expect(problems).toContain('[0].disabled.when: !!js is not interpolated here')
  })

  it('rejects a disabled expression that does not parse (the loader would fail the boot)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { __jsExpr: 'process.platform ===' } },
      '[0]',
    )
    expect(problems.some(problem => problem.includes('[0].disabled: disabled expression does not parse'))).toBe(true)
  })
})

describe('verify-cordis-config runtime-created packages', () => {
  const chooser = [{
    file: 'packages/bundle/web-app/cordis.patch.yml',
    name: '@deepseek-ai/dsh-host-directory-picker-auto',
  }]
  const runtimePackages = {
    '@deepseek-ai/dsh-host-directory-picker-native': 'workspace:^',
    '@deepseek-ai/dsh-host-directory-picker-browse': 'workspace:^',
    '@deepseek-ai/dsh-client-ui-directory-picker-browse': 'workspace:^',
    '@deepseek-ai/dsh-client-ui-directory-picker-native': 'workspace:^',
  }

  it('accepts direct app dependencies for every chooser-created root entry', () => {
    expect(chooserRootDependencyErrors(chooser, runtimePackages, 'apps/cli/package.json')).toEqual([])
  })

  it('rejects a chooser-created package available only through a bundle dependency', () => {
    const incomplete = Object.fromEntries(Object.entries(runtimePackages).filter(
      ([packageName]) => packageName !== '@deepseek-ai/dsh-host-directory-picker-native',
    ))

    expect(chooserRootDependencyErrors(chooser, incomplete, 'apps/cli/package.json')).toEqual([
      'packages/bundle/web-app/cordis.patch.yml: @deepseek-ai/dsh-host-directory-picker-native must be declared directly in apps/cli/package.json dependencies because @deepseek-ai/dsh-host-directory-picker-auto creates it through the Loader root',
    ])
  })
})
