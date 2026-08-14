import { describe, expect, it } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import { TranscriptViewport } from '../src/components/transcript-viewport.ts'

class Lines implements Component {
  values: string[]

  constructor(values: string[]) {
    this.values = values
  }

  invalidate(): void {}

  render(): string[] {
    return [...this.values]
  }
}

describe('TranscriptViewport', () => {
  it('passes the complete transcript through in inline mode', () => {
    const content = new Lines(['one', 'two', 'three'])
    const viewport = new TranscriptViewport(content, () => undefined)
    expect(viewport.render(80)).toEqual(['one', 'two', 'three'])
  })

  it('follows the tail until the user scrolls and resumes at the newest page', () => {
    const content = new Lines(Array.from({ length: 10 }, (_, index) => `row ${index}`))
    const viewport = new TranscriptViewport(content, () => 4)
    expect(viewport.render(80)).toEqual(['row 6', 'row 7', 'row 8', 'row 9'])

    viewport.scrollRows(-2)
    expect(viewport.render(80)).toEqual(['row 4', 'row 5', 'row 6', 'row 7'])
    content.values.push('row 10')
    expect(viewport.render(80)).toEqual(['row 4', 'row 5', 'row 6', 'row 7'])

    viewport.page(1)
    expect(viewport.render(80)).toEqual(['row 6', 'row 7', 'row 8', 'row 9'])
    viewport.page(1)
    expect(viewport.render(80)).toEqual(['row 7', 'row 8', 'row 9', 'row 10'])
    content.values.push('row 11')
    expect(viewport.render(80)).toEqual(['row 8', 'row 9', 'row 10', 'row 11'])
  })

  it('pads a short transcript so full-screen chrome stays anchored', () => {
    const viewport = new TranscriptViewport(new Lines(['only']), () => 3)
    expect(viewport.render(80)).toEqual(['only', '', ''])
  })

  it('resumes tail following when a rebuild shrinks past the retained position', () => {
    const content = new Lines(Array.from({ length: 10 }, (_, index) => `row ${index}`))
    const viewport = new TranscriptViewport(content, () => 4)
    viewport.render(80)
    viewport.scrollRows(-2)
    expect(viewport.render(80)).toEqual(['row 4', 'row 5', 'row 6', 'row 7'])

    content.values = ['row 0', 'row 1', 'row 2', 'row 3', 'row 4']
    expect(viewport.render(80)).toEqual(['row 1', 'row 2', 'row 3', 'row 4'])
    content.values.push('row 5')
    expect(viewport.render(80)).toEqual(['row 2', 'row 3', 'row 4', 'row 5'])
  })
})
