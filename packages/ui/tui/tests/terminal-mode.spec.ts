import { describe, expect, it, vi } from 'vitest'
import {
  createTuiTerminalMode,
  parseTuiMouseEvent,
} from '../src/chat/terminal-mode.ts'

describe('TUI terminal mode', () => {
  it('owns and idempotently restores alternate-screen and mouse modes', () => {
    const write = vi.fn<(data: string) => void>()
    const mode = createTuiTerminalMode({ write }, { fullscreen: true, mouse: true })

    mode.enter()
    mode.enter()
    mode.leave()
    mode.leave()

    expect(write.mock.calls.map(([value]) => value)).toEqual([
      '\x1b[?1049h\x1b[2J\x1b[H',
      '\x1b[?1000h\x1b[?1006h',
      '\x1b[?1006l\x1b[?1000l',
      '\x1b[?1049l',
    ])
  })

  it('leaves terminal modes untouched for inline rendering', () => {
    const write = vi.fn<(data: string) => void>()
    const mode = createTuiTerminalMode({ write }, { fullscreen: false, mouse: true })
    mode.enter()
    mode.leave()
    expect(write).not.toHaveBeenCalled()
  })

  it('requests a blinking input cursor once and restores the terminal default', () => {
    const write = vi.fn<(data: string) => void>()
    const mode = createTuiTerminalMode(
      { write },
      { fullscreen: false, mouse: false, showHardwareCursor: true },
    )

    mode.enter()
    mode.enter()
    mode.leave()
    mode.leave()

    expect(write.mock.calls.map(([value]) => value)).toEqual([
      '\x1b[5 q',
      '\x1b[0 q',
    ])
  })

  it('decodes SGR clicks, releases, and wheel input', () => {
    expect(parseTuiMouseEvent('\x1b[<0;12;7M')).toEqual({
      button: 'left', column: 12, row: 7, action: 'press',
    })
    expect(parseTuiMouseEvent('\x1b[<2;3;4m')).toEqual({
      button: 'right', column: 3, row: 4, action: 'release',
    })
    expect(parseTuiMouseEvent('\x1b[<64;8;9M')).toEqual({
      button: 'wheel-up', column: 8, row: 9, action: 'wheel',
    })
    expect(parseTuiMouseEvent('\x1b[<65;8;9M')).toEqual({
      button: 'wheel-down', column: 8, row: 9, action: 'wheel',
    })
    expect(parseTuiMouseEvent('\x1b[<32;8;9M')).toBeUndefined()
    expect(parseTuiMouseEvent('not mouse')).toBeUndefined()
  })
})
