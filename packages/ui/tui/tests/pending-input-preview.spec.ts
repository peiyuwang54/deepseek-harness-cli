import { describe, expect, it } from 'vitest'
import { PendingInputPreviewComponent } from '../src/components/pending-input-preview.ts'
import { createPalette } from '../src/components/theme.ts'

describe('pending steering preview', () => {
  it('stays absent without messages and below the minimum render width', () => {
    const component = new PendingInputPreviewComponent(() => 'en', createPalette(false))

    expect(component.render(80)).toEqual([])
    component.invalidate()
    component.update(['wait for the next tool'])
    expect(component.render(3)).toEqual([])
  })

  it('renders submitted messages in order and bounds each preview', () => {
    const component = new PendingInputPreviewComponent(() => 'en', createPalette(false))
    component.update(['first message', 'line one\nline two\nline three\nline four'])

    expect(component.render(120)).toEqual([
      '• Messages to be submitted after next tool call (press esc to interrupt and send immediately)',
      '  ↳ first message',
      '  ↳ line one',
      '    line two',
      '    line three',
      '    …',
    ])
  })

  it('uses the active locale and wraps long pending text', () => {
    let locale: 'zh' | 'en' = 'zh'
    const component = new PendingInputPreviewComponent(() => locale, createPalette(false))
    component.update(['这是一条需要等待下一次工具调用的长消息'])

    const chinese = component.render(20)
    expect(chinese.join('\n')).toContain('将在下次工具调用')
    expect(chinese.join('\n')).toContain('后提交的消息')
    expect(chinese.join('\n')).toContain('下一次工具调用')

    locale = 'en'
    expect(component.render(100)[0]).toContain('Messages to be submitted after next tool call')
  })
})
