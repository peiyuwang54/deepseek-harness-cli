import { describe, expect, it } from 'vitest'
import { renderUnknownXml } from '../src/components/xml-tool-output.ts'

const render = (source: string, limit = 4, expanded = false): string[] | undefined => renderUnknownXml(
  source,
  limit,
  expanded,
  text => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu, control =>
    `\\x${control.charCodeAt(0).toString(16).padStart(2, '0')}`),
  text => `[label]${text}[/label]`,
  text => `[body]${text}[/body]`,
  count => `  … +${count} lines`,
)

describe('unknown-tool XML rendering', () => {
  it('renders nested elements and attributes as an indented tree', () => {
    expect(render(`<result>
  <path>/tmp/a.txt</path>
  <type>file</type>
  <content>
    <line number="1">hello</line>
    <line number="2">world</line>
  </content>
</result>`)).toEqual([
      '[label]result[/label]',
      '  [label]path:[/label] [body]/tmp/a.txt[/body]',
      '  [label]type:[/label] [body]file[/body]',
      '  [label]content[/label]',
      '    [label]line (number="1"):[/label] [body]hello[/body]',
      '    [label]line (number="2"):[/label] [body]world[/body]',
    ])
  })

  it('renders root text, CDATA, empty elements, and multiline nested text', () => {
    expect(render('  <result>\nfirst\nsecond\n</result>  ')).toEqual([
      '[label]result[/label]',
      '  [body]first[/body]',
      '  [body]second[/body]',
    ])
    expect(render('<result>\nfirst\nsecond\n</result>', 1, true)).toEqual([
      '[label]result[/label]',
      '  [body]first[/body]',
      '  [body]second[/body]',
    ])
    expect(render('<result><value><![CDATA[literal <xml>]]></value><empty /></result>')).toEqual([
      '[label]result[/label]',
      '  [label]value:[/label] [body]literal <xml>[/body]',
      '  [label]empty[/label]',
    ])
    // An interior blank line stays the empty string: styling it would emit an
    // escape-only row, which reads as a stray indented blank rather than a gap.
    expect(render('<result>\nfirst\n\nsecond\n</result>', 4, true)).toEqual([
      '[label]result[/label]',
      '  [body]first[/body]',
      '',
      '  [body]second[/body]',
    ])
  })

  it('previews each top-level child independently and expands all rows', () => {
    const xml = '<result><first>\na\nb\nc\nd\ne\nf\n</first><second>\ng\nh\ni\nj\nk\nl\n</second></result>'
    expect(render(xml, 3)).toEqual([
      '[label]result[/label]',
      '  [label]first[/label]',
      '    [body]a[/body]',
      '  … +4 lines',
      '    [body]f[/body]',
      '  [label]second[/label]',
      '    [body]g[/body]',
      '  … +4 lines',
      '    [body]l[/body]',
    ])
    expect(render(xml, 3, true)).toHaveLength(15)
  })

  it('bounds the collapsed child count and counts the hidden lines', () => {
    const xml = `<result>${Array.from({ length: 8 }, (_, index) => `<item>${index}</item>`).join('')}</result>`
    expect(render(xml, 3)).toEqual([
      '[label]result[/label]',
      '  [label]item:[/label] [body]0[/body]',
      '  [label]item:[/label] [body]1[/body]',
      '  … +5 lines',
      '  [label]item:[/label] [body]7[/body]',
    ])
    expect(render(xml, 3, true)).toHaveLength(9)
  })

  it('escapes control characters expanded from character references', () => {
    expect(render('<result attr="a&#155;b">tab&#9;csi&#155;</result>')).toEqual([
      '[label]result (attr="a\\\\x9bb")[/label]',
      '  [body]tab\\x09csi\\x9b[/body]',
    ])
    expect(render('<result><value><![CDATA[del\u007f]]></value></result>')).toEqual([
      '[label]result[/label]',
      '  [label]value:[/label] [body]del\\x7f[/body]',
    ])
  })

  it.each([
    '<result><path>missing close</result>',
    '<first /><second />',
    '<result />  <![CDATA[trailing]]>',
    'prefix <result><path>/tmp/a</path></result>',
    '<result><path>/tmp/a</path></result> suffix',
    '<?xml version="1.0"?><result />',
    '<result><?target value?></result>',
    '<!DOCTYPE result><result />',
    '<result><!-- comment --></result>',
    '',
    '   \n  ',
  ])('declines malformed or mixed text: %s', (source) => {
    expect(render(source)).toBeUndefined()
  })
})
