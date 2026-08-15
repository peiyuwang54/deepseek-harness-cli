import { describe, expect, it, vi } from 'vitest'
import * as invariant from '@deepseek-ai/dsh-command-jobs/invariant'

describe('command-jobs invariant companion', () => {
  it('registers package ownership without claiming registry-owned state', async () => {
    const dispose = () => {}
    const register = vi.fn(() => dispose)
    await expect(invariant.apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(invariant.name).toBe('command-jobs-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-command-jobs', expect.any(Function))
  })
})
