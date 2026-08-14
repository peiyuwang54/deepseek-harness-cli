/**
 * Conservative readable-tree rendering for model-facing text containing one XML
 * document, used by the transcript's tool cards for unknown tool results. Injected
 * context is prose and is not parsed; only {@link preview} is shared with its card.
 * @module @deepseek-ai/dsh-tui/components/xml-tool-output
 */

import { SaxesParser } from 'saxes'

interface XmlElement {
  readonly name: string
  readonly attributes: readonly XmlAttribute[]
  readonly children: XmlNode[]
}

interface XmlAttribute {
  readonly name: string
  readonly value: string
}

type XmlNode = XmlElement | string

function parseXml(source: string, display: (text: string) => string): XmlElement | undefined {
  const parser = new SaxesParser({ xmlns: false })
  const stack: XmlElement[] = []
  let root: XmlElement | undefined
  const state = { invalid: false }
  const reject = (): void => { state.invalid = true }
  parser.on('opentag', (tag) => {
    const element: XmlElement = {
      name: tag.name,
      // Attribute values and text pass through `display` because character references can
      // expand to valid-XML control characters (tab, CR, DEL, C1) that pre-parse escaping
      // of the raw source never saw. Element names cannot carry them: control characters
      // are not XML name characters and character references do not apply inside names.
      attributes: Object.entries(tag.attributes).map(([name, value]) => ({ name, value: display(value) })),
      children: [],
    }
    const parent = stack.at(-1)
    if (parent === undefined) {
      if (root !== undefined) reject()
      root = element
    } else {
      parent.children.push(element)
    }
    stack.push(element)
  })
  parser.on('text', (text) => {
    const parent = stack.at(-1)
    if (parent === undefined) {
      if (text.trim() !== '') reject()
    } else {
      parent.children.push(display(text))
    }
  })
  parser.on('cdata', (text) => {
    const parent = stack.at(-1)
    if (parent === undefined) reject()
    else parent.children.push(display(text))
  })
  parser.on('closetag', () => { stack.pop() })
  parser.on('xmldecl', reject)
  parser.on('processinginstruction', reject)
  parser.on('doctype', reject)
  parser.on('comment', reject)
  parser.on('error', reject)
  parser.write(source).close()
  return state.invalid ? undefined : root
}

function elementLabel(element: XmlElement): string {
  const attributes = element.attributes.map(attribute => `${attribute.name}=${JSON.stringify(attribute.value)}`).join(' ')
  return attributes === '' ? element.name : `${element.name} (${attributes})`
}

function meaningfulChildren(element: XmlElement): readonly XmlNode[] {
  return element.children.filter(child => typeof child !== 'string' || child.trim() !== '')
}

function textBlock(text: string, depth: number, body: (text: string) => string): string[] {
  return text.replace(/^\n|\n$/gu, '').split('\n')
    .map(line => line === '' ? line : `${'  '.repeat(depth)}${body(line)}`)
}

function treeLines(
  element: XmlElement,
  depth: number,
  label: (text: string) => string,
  body: (text: string) => string,
): string[] {
  const indent = '  '.repeat(depth)
  const children = meaningfulChildren(element)
  if (children.length === 0) return [`${indent}${label(elementLabel(element))}`]
  if (children.length === 1 && typeof children[0] === 'string' && !children[0].includes('\n')) {
    return [`${indent}${label(`${elementLabel(element)}:`)} ${body(children[0].trim())}`]
  }
  const lines = [`${indent}${label(elementLabel(element))}`]
  for (const child of children) {
    if (typeof child === 'string') lines.push(...textBlock(child, depth + 1, body))
    else lines.push(...treeLines(child, depth + 1, label, body))
  }
  return lines
}

/**
 * Collapse `lines` to a head/tail preview around one omitted-count marker.
 * The single fold rule for every transcript card, so a card's fold never depends
 * on how its body was rendered: tool cards share it with their tree output and
 * context cards apply it to prose rows.
 * @param lines - Fully rendered body rows.
 * @param limit - Maximum retained rows, excluding the marker.
 * @param omitted - Renders the marker for the omitted row count.
 * @returns `lines` unchanged when within `limit`, else head rows, the marker, and tail rows.
 */
export function preview(lines: readonly string[], limit: number, omitted: (count: number) => string): string[] {
  if (lines.length <= limit) return [...lines]
  const head = Math.ceil(limit / 2)
  const tail = limit - head
  return [...lines.slice(0, head), omitted(lines.length - limit), ...lines.slice(lines.length - tail)]
}

/**
 * Render a complete XML document as an indented tree, or decline without changing partial/mixed text.
 * @param source - Raw model-facing text from an unknown tool result.
 * @param maxChildLines - Collapsed budget independently applied to each top-level child's lines and
 * to the number of top-level children, so many siblings cannot grow the collapsed card without bound.
 * @param expanded - Whether to retain every rendered child line.
 * @param display - Escapes parsed text and attribute values for terminal output; character references
 * can expand to control characters that pre-parse escaping never saw.
 * @param label - Styles element names and attributes.
 * @param body - Styles the text content under those elements; the card's body tone, so tree
 * content matches the surrounding card rows instead of falling back to the default foreground.
 * @param omitted - Renders the omitted-line marker for a collapsed child or child range.
 * @returns Tree rows, or `undefined` when `source` is not one supported complete XML document.
 */
export function renderUnknownXml(
  source: string,
  maxChildLines: number,
  expanded: boolean,
  display: (text: string) => string,
  label: (text: string) => string,
  body: (text: string) => string,
  omitted: (count: number) => string,
): string[] | undefined {
  const root = parseXml(source, display)
  if (root === undefined) return undefined
  const blocks = meaningfulChildren(root).map(child =>
    typeof child === 'string' ? textBlock(child, 1, body) : treeLines(child, 1, label, body))
  const rootLine = label(elementLabel(root))
  if (expanded) return [rootLine, ...blocks.flat()]
  const previewed = blocks.map(block => preview(block, maxChildLines, omitted))
  if (previewed.length <= maxChildLines) return [rootLine, ...previewed.flat()]
  const head = Math.ceil(maxChildLines / 2)
  const tail = maxChildLines - head
  const hidden = blocks.slice(head, blocks.length - tail).reduce((total, block) => total + block.length, 0)
  return [
    rootLine,
    ...previewed.slice(0, head).flat(),
    omitted(hidden),
    ...previewed.slice(previewed.length - tail).flat(),
  ]
}
