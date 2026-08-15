/**
 * Theme-agnostic ANSI palette and derived pi-tui themes for the terminal front
 * door. The palette is built from the standard 16-color ANSI set plus SGR
 * attributes so every terminal remaps it to its active color scheme.
 * @module @deepseek-ai/dsh-tui/components/theme
 */

import type {
  MarkdownTheme,
  RgbColor,
  SelectListTheme,
  TerminalColorScheme,
} from '@earendil-works/pi-tui'

/**
 * Text carrying exactly one palette color. Branded so the compiler rejects
 * wrapping it in a second color: SGR has no color stack, so an inner span's
 * close reverts to the default foreground rather than the outer color, which
 * silently drops the outer color for the remainder of the line.
 */
type Colored = string & { readonly __coloredBy: unique symbol }

/**
 * Text a color may still be applied to: a bare string, or one already carrying
 * SGR attributes. Attributes (bold, italic, underline, strike, reverse) occupy
 * independent SGR groups from the foreground color, so they compose in either
 * order without either side clobbering the other.
 */
type Colorable = string & { readonly __coloredBy?: undefined }

/** Applies one color role; rejects input that already carries a color. */
type ColorRole = (text: Colorable) => Colored

/** Applies one SGR attribute; accepts colored or uncolored text and preserves its color. */
type AttributeRole = <T extends string>(text: T) => T

/**
 * Theme-agnostic role colors and SGR attribute wrappers.
 *
 * One role per visual meaning: `dim` is the single recessed tone, `accent` the
 * single emphasis color, and `success`/`error` double as a diff's added/removed
 * pair. Roles that resolved to the same escape were merged rather than kept as
 * aliases, so a reader cannot pick a name that silently renders as another.
 *
 * Colors and attributes are separately typed: `bold(accent(x))` and
 * `accent(bold(x))` both compile, while `accent(error(x))` does not.
 */
export interface Palette {
  accent: ColorRole
  /** DeepSeek brand ink; exact gradient callers may override it on truecolor terminals. */
  brand: ColorRole
  /** The terminal's own default foreground; still a color, so it does not stack. */
  text: ColorRole
  /** The one recessed tone, below `text`: tool-card bodies, chrome, reasoning, footers. */
  dim: ColorRole
  success: ColorRole
  warning: ColorRole
  error: ColorRole
  code: ColorRole
  bold: AttributeRole
  italic: AttributeRole
  underline: AttributeRole
  strike: AttributeRole
  /** Reverse video for the active selection; swaps the theme's own fg/bg so it reads on any scheme. */
  selected: AttributeRole
}

/** Names of the palette's color roles, in the order `/palette` prints them. */
export const COLOR_ROLES = ['text', 'dim', 'accent', 'brand', 'code', 'success', 'warning', 'error'] as const

/** Names of the palette's attribute roles, in the order `/palette` prints them. */
export const ATTRIBUTE_ROLES = ['bold', 'italic', 'underline', 'strike', 'selected'] as const

/**
 * Accent hues the interactive chrome and startup banner can take. Each entry
 * pairs a truecolor 24-bit ink for brand surfaces and the banner gradient with
 * ANSI 16-color role codes that remain theme-adaptive in every terminal.
 */
export const ACCENT_IDS = ['deepseek', 'cosmic-orange', 'mist-blue', 'sage', 'lavender', 'deep-blue'] as const

/** One selectable accent hue. */
export type AccentId = typeof ACCENT_IDS[number]

/** The shipped default accent, unchanged from the original DeepSeek-blue chrome. */
export const DEFAULT_ACCENT: AccentId = 'deepseek'

/** Per-background accent selection; each scheme remembers its own hue. */
export interface AccentSelection {
  readonly light: AccentId
  readonly dark: AccentId
}

/** The default selection: DeepSeek blue on both backgrounds. */
export const DEFAULT_ACCENT_SELECTION: AccentSelection = { light: DEFAULT_ACCENT, dark: DEFAULT_ACCENT }

/** Truecolor ink and banner gradient for one terminal background. */
interface AccentInk {
  /** 24-bit foreground ink for brand surfaces. */
  readonly rgb: readonly [number, number, number]
  /** Banner gradient stops; the first is the accent ink. */
  readonly gradient: readonly (readonly [number, number, number])[]
}

/**
 * A named accent hue with per-background ink. ANSI role codes stay
 * theme-adaptive (terminals remap the 16-color set), while the truecolor ink
 * needs one variant per background: a bright stop for dark terminals and a
 * deep stop for light terminals.
 */
export interface AccentHue {
  readonly id: AccentId
  readonly label: string
  /** ANSI open code for the theme-adaptive `accent` role. */
  readonly ansi: string
  /** ANSI open code for the `brand` role when truecolor is unavailable. */
  readonly brandAnsi: string
  /** Truecolor ink and gradient for a dark terminal background. */
  readonly dark: AccentInk
  /** Truecolor ink and gradient for a light terminal background. */
  readonly light: AccentInk
}

/** Narrow an unknown value to a shipped accent id. */
export function isAccentId(value: unknown): value is AccentId {
  return ACCENT_IDS.some(id => id === value)
}

/** Resolve one shipped accent hue, defaulting unknown ids to {@link DEFAULT_ACCENT}. */
export function accentHue(id: AccentId): AccentHue {
  return ACCENT_HUES.find(hue => hue.id === id) ?? ACCENT_HUES[0] as AccentHue
}

/** Resolve one accent hue's ink for the given terminal background. */
function accentInk(id: AccentId, scheme: TerminalColorScheme): AccentInk {
  return accentHue(id)[scheme]
}

/** One role's SGR parameters and the reason it carries them. */
export interface RoleSpec {
  /** SGR parameters that open the span, without the `ESC [` prefix or `m` suffix. */
  readonly open: string
  /** SGR parameters that close it; MUST reset every group `open` sets. */
  readonly close: string
  /** What the role means, shown by `/palette`. */
  readonly purpose: string
}

/**
 * Every SGR code the TUI is allowed to emit, keyed by role. This table is the
 * single source: {@link createPalette} derives the wrappers from it and
 * `/palette` prints it, so a role cannot exist in one and not the other, and no
 * component hand-writes an escape.
 *
 * Only the standard 16-color set and SGR attributes appear here. Terminals remap
 * those to the user's active theme, so the TUI stays legible on any background;
 * a fixed 24-bit color would not. The startup gradient and exact official mark
 * color are the two deliberate brand exceptions ({@link gradientText},
 * {@link brandText}).
 *
 * @param scheme - Active terminal color scheme; only `code` differs between them.
 * @param accent - Active accent hue; selects the `accent` and `brand` ANSI codes.
 * @returns The SGR spec for every color and attribute role.
 */
export function paletteSpec(scheme: TerminalColorScheme, accent: AccentId = DEFAULT_ACCENT): {
  readonly colors: Readonly<Record<typeof COLOR_ROLES[number], RoleSpec>>
  readonly attributes: Readonly<Record<typeof ATTRIBUTE_ROLES[number], RoleSpec>>
} {
  const hue = accentHue(accent)
  return {
    colors: {
      // The terminal's own foreground, emitted as no escape at all: ordinary body
      // text must inherit whatever the user's theme uses.
      text: { open: '', close: '', purpose: 'Body text, the terminal default foreground' },
      // SGR 2 over an explicit default foreground, closing both groups it sets.
      // The attribute fades relative to whatever the terminal's own foreground is,
      // which is the only way to land *below* `text` on both schemes: ANSI 90
      // (bright black) is a fixed hue that many light themes render heavier than
      // their default foreground, which made every "dim" surface the most
      // prominent text on screen.
      dim: { open: '2;39', close: '22;39', purpose: 'The one recessed tone: tool bodies, chrome, footers' },
      // The accent hue's ANSI code keeps interactive chrome theme-adaptive; its
      // exact 24-bit ink reaches the banner gradient through `gradientText`.
      accent: { open: hue.ansi, close: '39', purpose: 'Accent emphasis: role headers, prompt, borders' },
      brand: { open: hue.brandAnsi, close: '39', purpose: 'Accent brand art when truecolor is unavailable' },
      // ANSI 36 (cyan) is difficult to read on a light background — use ANSI 34
      // (blue) which is legible on both light and dark schemes.
      code: scheme === 'light'
        ? { open: '34', close: '39', purpose: 'Inline code and code blocks in prose' }
        : { open: '36', close: '39', purpose: 'Inline code and code blocks in prose' },
      success: { open: '32', close: '39', purpose: 'Succeeded calls, and a diff\'s added lines' },
      warning: { open: '33', close: '39', purpose: 'Pending calls and warnings' },
      error: { open: '31', close: '39', purpose: 'Failures, signals, and a diff\'s removed lines' },
    },
    attributes: {
      bold: { open: '1', close: '22', purpose: 'Emphasis; composes with any color' },
      italic: { open: '3', close: '23', purpose: 'Reasoning text' },
      underline: { open: '4', close: '24', purpose: 'Role-header banding' },
      strike: { open: '9', close: '29', purpose: 'Struck-through Markdown' },
      selected: { open: '7', close: '27', purpose: 'Reverse video for the active selection' },
    },
  }
}

/**
 * Wrap text in an SGR pair, or pass it through when color is disabled.
 * An empty `open` emits nothing, so the `text` role costs no escape.
 */
function ansi(spec: RoleSpec, enabled: boolean): (text: string) => string {
  if (!enabled || spec.open === '') return text => text
  return text => `\x1b[${spec.open}m${text}\x1b[${spec.close}m`
}

/**
 * Theme-agnostic palette derived from {@link paletteSpec}. Body `text` stays the
 * terminal's default foreground so it reads on light and dark backgrounds alike;
 * grouping uses foreground-only bold, underlined role headers and reverse video
 * rather than fixed background fills or per-line prefixes, so a transcript
 * drag-select copies message text without stray glyphs.
 *
 * @param enabled - Whether ANSI is emitted at all.
 * @param scheme - Active terminal color scheme; adjusts the code role.
 * @param accent - Active accent hue; selects the accent and brand ANSI codes.
 * @returns The role palette for the given scheme and accent.
 */
export function createPalette(enabled: boolean, scheme: TerminalColorScheme = 'dark', accent: AccentId = DEFAULT_ACCENT): Palette {
  const spec = paletteSpec(scheme, accent)
  const roles = {} as Record<string, unknown>
  for (const name of COLOR_ROLES) roles[name] = ansi(spec.colors[name], enabled)
  for (const name of ATTRIBUTE_ROLES) roles[name] = ansi(spec.attributes[name], enabled)
  return roles as unknown as Palette
}

/**
 * Build the composer and user-card background from the selected theme. The
 * DeepSeek default keeps the Web user-bubble tokens; other accents tint that
 * same surface so the card and interactive chrome change as one theme.
 * @param enabled - Whether ANSI color output is enabled.
 * @param truecolor - Whether the terminal accepts 24-bit background colors.
 * @param scheme - Resolved terminal appearance.
 * @param accent - Active accent hue for this appearance.
 * @returns Background wrapper that resets only the background color group.
 */
export function composerBackground(
  enabled: boolean,
  truecolor: boolean,
  scheme: TerminalColorScheme,
  accent: AccentId = DEFAULT_ACCENT,
): (text: string) => string {
  if (!enabled) return text => text
  const color = accentSurface(accent, scheme)
  const open = truecolor
    ? `\x1b[48;2;${color.r};${color.g};${color.b}m`
    : `\x1b[48;5;${String(nearestXtermColor(color))}m`
  return text => `${open}${text}\x1b[49m`
}

/** Find the closest color in the standard xterm 256-color cube and grayscale ramp. */
function nearestXtermColor(color: RgbColor): number {
  let bestCode = 16
  let bestDistance = Number.POSITIVE_INFINITY
  const consider = (code: number, r: number, g: number, b: number): void => {
    const distance = (color.r - r) ** 2 + (color.g - g) ** 2 + (color.b - b) ** 2
    if (distance >= bestDistance) return
    bestCode = code
    bestDistance = distance
  }
  const levels = [0, 95, 135, 175, 215, 255] as const
  for (let r = 0; r < levels.length; r += 1) {
    for (let g = 0; g < levels.length; g += 1) {
      for (let b = 0; b < levels.length; b += 1) {
        consider(16 + 36 * r + 6 * g + b, levels[r] as number, levels[g] as number, levels[b] as number)
      }
    }
  }
  for (let index = 0; index < 24; index += 1) {
    const level = 8 + index * 10
    consider(232 + index, level, level, level)
  }
  return bestCode
}

/** Derive a quiet card fill from one accent while preserving the DeepSeek Web defaults. */
function accentSurface(accent: AccentId, scheme: TerminalColorScheme): RgbColor {
  if (accent === DEFAULT_ACCENT) {
    return scheme === 'light'
      ? { r: 237, g: 243, b: 254 }
      : { r: 44, g: 44, b: 46 }
  }
  const [r, g, b] = accentInk(accent, scheme).rgb
  const base = scheme === 'light' ? [255, 255, 255] as const : [44, 44, 46] as const
  const amount = scheme === 'light' ? 0.14 : 0.18
  return {
    r: Math.round(base[0] + (r - base[0]) * amount),
    g: Math.round(base[1] + (g - base[1]) * amount),
    b: Math.round(base[2] + (b - base[2]) * amount),
  }
}

/**
 * DeepSeek brand gradient stops (indigo → light blue) taken from the
 * deepseek.com logo, painted across the startup banner's product name on
 * truecolor terminals. Fixed brand identity, deliberately outside the
 * theme-adaptive {@link Palette}.
 */
const BRAND_GRADIENT = [
  [77, 107, 254], // #4D6BFE
  [57, 130, 255], // #3982FF
  [36, 152, 255], // #2498FF
] as const

/** Mix an RGB ink toward white by `amount`, lightening the banner gradient. */
function tint(rgb: readonly [number, number, number], amount: number): readonly [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * amount),
    Math.round(rgb[1] + (255 - rgb[1]) * amount),
    Math.round(rgb[2] + (255 - rgb[2]) * amount),
  ]
}

/** Banner gradient for a non-default accent: ink, then two lightened stops. */
function lightenGradient(rgb: readonly [number, number, number]): readonly (readonly [number, number, number])[] {
  return [rgb, tint(rgb, 0.35), tint(rgb, 0.7)]
}

/**
 * Shipped accent hues. Each carries a dark-background ink (the Apple finish's
 * bright tone) and a light-background ink (a deepened tone that stays legible
 * on white), while the ANSI codes stay theme-adaptive.
 */
export const ACCENT_HUES: readonly AccentHue[] = [
  {
    id: 'deepseek', label: 'DeepSeek', ansi: '94', brandAnsi: '34',
    dark: { rgb: [77, 107, 254], gradient: BRAND_GRADIENT },
    light: { rgb: [61, 90, 214], gradient: lightenGradient([61, 90, 214]) },
  },
  {
    id: 'cosmic-orange', label: 'Cosmic Orange', ansi: '91', brandAnsi: '31',
    dark: { rgb: [247, 126, 45], gradient: lightenGradient([247, 126, 45]) },
    light: { rgb: [190, 86, 20], gradient: lightenGradient([190, 86, 20]) },
  },
  {
    id: 'mist-blue', label: 'Mist Blue', ansi: '96', brandAnsi: '36',
    dark: { rgb: [162, 185, 220], gradient: lightenGradient([162, 185, 220]) },
    light: { rgb: [96, 124, 168], gradient: lightenGradient([96, 124, 168]) },
  },
  {
    id: 'sage', label: 'Sage', ansi: '92', brandAnsi: '32',
    dark: { rgb: [180, 194, 148], gradient: lightenGradient([180, 194, 148]) },
    light: { rgb: [110, 128, 80], gradient: lightenGradient([110, 128, 80]) },
  },
  {
    id: 'lavender', label: 'Lavender', ansi: '95', brandAnsi: '35',
    dark: { rgb: [230, 213, 241], gradient: lightenGradient([230, 213, 241]) },
    light: { rgb: [152, 122, 190], gradient: lightenGradient([152, 122, 190]) },
  },
  {
    id: 'deep-blue', label: 'Deep Blue', ansi: '34', brandAnsi: '34',
    dark: { rgb: [120, 140, 200], gradient: lightenGradient([120, 140, 200]) },
    light: { rgb: [40, 48, 90], gradient: lightenGradient([40, 48, 90]) },
  },
]

/**
 * Paint trusted static brand art with the active accent's ink for the given
 * terminal background.
 * @param text - Static brand text or raster cells.
 * @param accent - Active accent hue; defaults to the DeepSeek blue.
 * @param scheme - Terminal background; selects the bright or deep ink.
 * @returns text wrapped in the accent's truecolor foreground and a foreground reset.
 */
export function brandText(text: string, accent: AccentId = DEFAULT_ACCENT, scheme: TerminalColorScheme = 'dark'): string {
  const [r, g, b] = accentInk(accent, scheme).rgb
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`
}

/**
 * Sample one accent's gradient at fraction `t` via piecewise-linear
 * interpolation across its stops.
 *
 * @param gradient - The accent's gradient stops.
 * @param t - Position along the gradient; clamped to [0, 1].
 * @returns The interpolated `[r, g, b]` channels, each rounded to 0–255.
 */
function brandColorAt(gradient: readonly (readonly [number, number, number])[], t: number): readonly [number, number, number] {
  const span = Math.min(Math.max(t, 0), 1) * (gradient.length - 1)
  const index = Math.min(Math.floor(span), gradient.length - 2)
  const local = span - index
  // `index` is clamped to a valid adjacent pair, so both lookups are in-bounds.
  const from = gradient[index] as readonly [number, number, number]
  const to = gradient[index + 1] as readonly [number, number, number]
  return [
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local),
  ]
}

/**
 * Paint `text` left-to-right in the active accent's gradient with per-character
 * 24-bit foreground codes, resetting to the default foreground at the end.
 * Foreground-only, so it stays legible on any terminal background; the caller
 * gates it on truecolor support and wraps it in bold.
 *
 * @param text - Text to colorize; sampled once per character.
 * @param accent - Active accent hue; defaults to the DeepSeek blue.
 * @param scheme - Terminal background; selects the bright or deep gradient.
 * @returns `text` wrapped in truecolor SGR foreground codes.
 */
export function gradientText(text: string, accent: AccentId = DEFAULT_ACCENT, scheme: TerminalColorScheme = 'dark'): string {
  const glyphs = Array.from(text)
  const last = Math.max(1, glyphs.length - 1)
  const gradient = accentInk(accent, scheme).gradient
  let painted = ''
  for (let index = 0; index < glyphs.length; index += 1) {
    const [r, g, b] = brandColorAt(gradient, index / last)
    painted += `\x1b[38;2;${r};${g};${b}m${glyphs[index]}`
  }
  return `${painted}\x1b[39m`
}

/**
 * Derive the pi-tui Markdown theme from a role palette.
 * @param palette - Active role palette.
 * @returns The Markdown theme wired to palette roles.
 */
export function markdownTheme(palette: Palette): MarkdownTheme {
  return {
    heading: text => palette.accent(text),
    link: text => palette.accent(text),
    // pi-tui requires this URL slot but its current Markdown renderer does not invoke it.
    /* v8 ignore next */
    linkUrl: text => palette.dim(text),
    code: text => palette.code(text),
    codeBlock: text => palette.code(text),
    // pi-tui presents both fence rows through this callback. Keep the opening
    // language label, but hide Markdown syntax and the otherwise-empty close.
    codeBlockBorder: text => palette.dim(text.slice(3)),
    quote: text => palette.dim(text),
    quoteBorder: text => palette.accent(text),
    hr: text => palette.dim(text),
    listBullet: text => palette.accent(text),
    bold: text => palette.bold(text),
    italic: text => palette.italic(text),
    strikethrough: text => palette.strike(text),
    underline: text => palette.underline(text),
    highlightCode: (code, lang) => highlightMarkdownCode(code, lang, palette),
  }
}

/**
 * Highlight fenced Markdown code. Diff fences carry their line semantics in
 * their prefixes, so they use the same success/error/accent roles as tool diff
 * cards; every other language keeps the terminal's theme-adaptive code tone.
 * @param code - Fenced code body after Markdown parsing.
 * @param lang - Fence info string, when present.
 * @param palette - Active role palette.
 * @returns One styled terminal row per source row.
 */
export function highlightMarkdownCode(
  code: string,
  lang: string | undefined,
  palette: Palette,
): string[] {
  const language = lang?.trim().split(/\s+/u, 1)[0]?.toLowerCase()
  const isDiff = language === 'diff' || language === 'patch'
  return code.split('\n').map((line) => {
    if (line === '') return ''
    if (!isDiff) return palette.code(line)
    if (line.startsWith('@@')) return palette.accent(line)
    if (line.startsWith('+') && !line.startsWith('+++')) return palette.success(line)
    if (line.startsWith('-') && !line.startsWith('---')) return palette.error(line)
    if (
      line.startsWith('diff ')
      || line.startsWith('index ')
      || line.startsWith('---')
      || line.startsWith('+++')
    ) return palette.dim(line)
    return palette.code(line)
  })
}

/**
 * Derive the pi-tui select-list theme from a role palette.
 * @param palette - Active role palette.
 * @returns The select-list theme wired to palette roles.
 */
export function selectTheme(palette: Palette): SelectListTheme {
  return {
    selectedPrefix: palette.accent,
    selectedText: palette.accent,
    description: palette.dim,
    scrollInfo: palette.dim,
    noMatch: palette.warning,
  }
}

/**
 * Derive the reverse-video dialog select-list theme from a role palette.
 * @param palette - Active role palette.
 * @returns The dialog select-list theme with a reverse-video selection.
 */
export function dialogSelectTheme(palette: Palette): SelectListTheme {
  return {
    ...selectTheme(palette),
    selectedText: text => palette.selected(palette.accent(text)),
  }
}

/** Sample text every `/palette` row renders, long enough to judge a tone against its neighbours. */
const PALETTE_SAMPLE = 'The quick brown fox 0123'

/**
 * Render every palette role as a labelled sample row, each painted by the role
 * it names, so a reader compares the actual tones their terminal produces rather
 * than reading SGR numbers. Colors print first and attributes second because the
 * two groups compose in that order; every row shows its SGR pair so a mismatch
 * between the table and the screen is visible.
 *
 * @param palette - Active role palette, used to paint each sample.
 * @param scheme - Active color scheme, reported in the heading and selecting the spec.
 * @param colorEnabled - Whether ANSI is emitted; reported so an unstyled listing is not confusing.
 * @param accent - Active accent hue, so the printed SGR pairs match the live palette.
 * @returns The rendered rows, without a trailing blank.
 */
export function renderPalette(
  palette: Palette,
  scheme: TerminalColorScheme,
  colorEnabled: boolean,
  accent: AccentId = DEFAULT_ACCENT,
): string[] {
  const spec = paletteSpec(scheme, accent)
  const width = Math.max(...[...COLOR_ROLES, ...ATTRIBUTE_ROLES].map(name => name.length))
  // Two rows per role: the painted sample beside its name and SGR pair, then the
  // purpose indented under it. Splitting the purpose onto its own row keeps every
  // sample on one visual line at the narrow widths a side-by-side pane gives.
  const head = (name: string, role: RoleSpec, sample: string): string => {
    const pair = role.open === '' ? 'no escape' : `ESC[${role.open}m ESC[${role.close}m`
    return `  ${sample}  ${palette.dim(`${name.padEnd(width)} ${pair}`)}`
  }
  const purpose = (role: RoleSpec): string => `  ${palette.dim(`    ${role.purpose}`)}`
  const rows = [
    palette.bold(palette.accent('Palette')),
    palette.dim(`${scheme} scheme · color ${colorEnabled ? 'on' : 'off'}`),
    '',
    palette.dim('Colors — exactly one per span; they never nest inside each other.'),
  ]
  for (const name of COLOR_ROLES) {
    rows.push(head(name, spec.colors[name], palette[name](PALETTE_SAMPLE)), purpose(spec.colors[name]))
  }
  rows.push('', palette.dim('Attributes — compose with any color, in either order.'))
  for (const name of ATTRIBUTE_ROLES) {
    rows.push(head(name, spec.attributes[name], palette[name](PALETTE_SAMPLE)), purpose(spec.attributes[name]))
  }
  return rows
}
