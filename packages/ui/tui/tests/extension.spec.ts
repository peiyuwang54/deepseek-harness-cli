import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  Component,
  OverlayHandle,
} from '@earendil-works/pi-tui'
import type {
  TuiComponent,
  TuiOverlayHost,
  TuiOverlayOptions,
  TuiOverlaySession,
  TuiTheme,
} from '../src/extension/types.ts'
import {
  TuiExtensionServiceImpl,
  TuiOverlayManager,
  type TuiOverlayDriver,
} from '../src/extension/overlay-manager.ts'

const theme: TuiTheme = Object.freeze({
  text: (value: string) => `text:${value}`,
  brand: (value: string) => `brand:${value}`,
  muted: (value: string) => `muted:${value}`,
  dim: (value: string) => `dim:${value}`,
  accent: (value: string) => `accent:${value}`,
  success: (value: string) => `success:${value}`,
  warning: (value: string) => `warning:${value}`,
  error: (value: string) => `error:${value}`,
  bold: (value: string) => `bold:${value}`,
})

interface ShownOverlay {
  component: Component
  options: TuiOverlayOptions | undefined
  hidden: boolean
  focused: boolean
}

interface DriverFixture {
  driver: TuiOverlayDriver
  shown: ShownOverlay[]
  errors: unknown[]
  invalidations: number
  showError?: unknown
  onShow?: (component: Component) => void
}

function driverFixture(): DriverFixture {
  const fixture: DriverFixture = {
    shown: [],
    errors: [],
    invalidations: 0,
    driver: undefined as never,
  }
  fixture.driver = {
    viewport: () => ({ columns: 96, rows: 32 }),
    theme: () => theme,
    display: value => `safe:${value}`,
    show(component, options) {
      if (fixture.showError !== undefined) throw fixture.showError
      const shown: ShownOverlay = {
        component,
        options,
        hidden: false,
        focused: true,
      }
      fixture.shown.push(shown)
      const handle: OverlayHandle = {
        hide() {
          shown.hidden = true
          shown.focused = false
        },
        setHidden(hidden) {
          shown.hidden = hidden
        },
        isHidden: () => shown.hidden,
        focus() {
          shown.focused = true
        },
        unfocus() {
          shown.focused = false
        },
        isFocused: () => shown.focused,
      }
      fixture.onShow?.(component)
      return handle
    },
    invalidate() {
      fixture.invalidations += 1
    },
    reportError(error) {
      fixture.errors.push(error)
    },
  }
  return fixture
}

function component(lines = ['overlay']): TuiComponent {
  return {
    render: () => lines,
    invalidate() {},
  }
}

async function microtask(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('TuiOverlayManager', () => {
  it('serializes overlays, exposes the constrained host, and settles normal close once', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    let firstHost: TuiOverlayHost | undefined
    const firstComponent = {
      focused: false,
      wantsKeyRelease: true,
      inputs: [] as string[],
      invalidated: 0,
      render: (width: number) => [`first:${String(width)}`],
      handleInput(data: string) {
        this.inputs.push(data)
      },
      invalidate() {
        this.invalidated += 1
      },
    }
    const first = manager.open({
      create(host) {
        firstHost = host
        return firstComponent
      },
      options: { width: '75%', minWidth: 24, maxHeight: 20, anchor: 'center', margin: { bottom: 1 } },
    })
    const secondOptions: TuiOverlayOptions = { width: 40, margin: { bottom: 2 } }
    const second = manager.open({
      create: () => component(['second']),
      options: secondOptions,
    })
    ;(secondOptions as { width: number }).width = 80
    ;(secondOptions.margin as { bottom: number }).bottom = 4

    expect(manager.hasActiveOverlay()).toBe(true)
    expect(first.state).toBe('active')
    expect(second.state).toBe('queued')
    expect(fixture.shown).toHaveLength(1)
    expect(fixture.shown[0]?.options).toEqual({
      width: '75%',
      minWidth: 24,
      maxHeight: 20,
      anchor: 'center',
      margin: { bottom: 1 },
    })
    expect(firstHost?.viewport).toEqual({ columns: 96, rows: 32 })
    expect(Object.isFrozen(firstHost?.viewport)).toBe(true)
    expect(firstHost?.theme.accent('x')).toBe('accent:x')
    expect(firstHost?.display('\u001b')).toBe('safe:\u001b')
    firstHost?.invalidate()
    expect(firstComponent.invalidated).toBe(1)
    expect(fixture.shown[0]?.component.render(40)).toEqual(['first:40'])
    fixture.shown[0]!.component.handleInput?.('x')
    fixture.shown[0]!.component.invalidate()
    expect(firstComponent.inputs).toEqual(['x'])
    expect(firstComponent.invalidated).toBe(2)
    expect(fixture.shown[0]?.component.wantsKeyRelease).toBe(true)
    ;(fixture.shown[0]?.component as Component & { focused: boolean }).focused = true
    expect(firstComponent.focused).toBe(true)
    expect((fixture.shown[0]?.component as Component & { focused: boolean }).focused).toBe(true)

    const firstOutcome = await first.close()
    expect(firstOutcome).toEqual({ reason: 'closed' })
    expect(await first.close()).toBe(firstOutcome)
    expect(firstHost?.signal.aborted).toBe(true)
    const beforeClosedInvalidation = fixture.invalidations
    firstHost?.invalidate()
    expect(fixture.invalidations).toBe(beforeClosedInvalidation)
    await microtask()

    expect(first.state).toBe('closed')
    expect(second.state).toBe('active')
    expect(fixture.shown[0]?.hidden).toBe(true)
    expect(fixture.shown[1]?.options).toEqual({ width: 40, margin: { bottom: 2 } })
    expect(Object.isFrozen(fixture.shown[1]?.options)).toBe(true)
    expect(Object.isFrozen(fixture.shown[1]?.options?.margin)).toBe(true)
    expect(fixture.shown[1]?.component.wantsKeyRelease).toBe(false)
    expect((fixture.shown[1]?.component as Component & { focused: boolean }).focused).toBe(false)
    ;(fixture.shown[1]?.component as Component & { focused: boolean }).focused = true
    fixture.shown[1]!.component.handleInput?.('ignored')
    await second.close()
    await microtask()

    const numericMargin = manager.open({
      create: () => component(['numeric margin']),
      options: { margin: 1 },
    })
    expect(fixture.shown[2]?.options).toEqual({ margin: 1 })
    await numericMargin.close()
    await microtask()

    const emptyOptions = manager.open({
      create: () => component(['empty options']),
      options: {},
    })
    expect(fixture.shown[3]?.options).toEqual({})
    await emptyOptions.close()
    await microtask()

    expect(manager.hasActiveOverlay()).toBe(false)
    await manager.dispose()
    await manager.dispose()
  })

  it('removes pre-aborted, active, and queued requests without activating cancelled work', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const preAborted = new AbortController()
    preAborted.abort()
    const pre = manager.open({
      signal: preAborted.signal,
      create: () => component(['never']),
    })
    expect(await pre.closed).toEqual({ reason: 'aborted' })
    expect(fixture.shown).toHaveLength(0)

    const activeAbort = new AbortController()
    let activeHost: TuiOverlayHost | undefined
    const active = manager.open({
      signal: activeAbort.signal,
      create(host) {
        activeHost = host
        return component(['active'])
      },
    })
    const queuedAbort = new AbortController()
    const queued = manager.open({
      signal: queuedAbort.signal,
      create: () => component(['queued']),
    })
    queuedAbort.abort()
    expect(await queued.closed).toEqual({ reason: 'aborted' })
    expect(queued.state).toBe('closed')
    activeAbort.abort()
    expect(await active.closed).toEqual({ reason: 'aborted' })
    expect(activeHost?.signal.aborted).toBe(true)
    await microtask()
    expect(fixture.shown).toHaveLength(1)
    expect(manager.hasActiveOverlay()).toBe(false)
  })

  it('does not mount entries closed or aborted during component construction', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const closed = manager.open({
      create(host) {
        host.invalidate()
        host.close()
        return component(['closed during construction'])
      },
    })
    await expect(closed.closed).resolves.toEqual({ reason: 'closed' })

    const controller = new AbortController()
    const aborted = manager.open({
      signal: controller.signal,
      create() {
        controller.abort()
        return component(['aborted during construction'])
      },
    })
    await expect(aborted.closed).resolves.toEqual({ reason: 'aborted' })

    const after = manager.open({ create: () => component(['after construction closes']) })
    expect(fixture.shown).toHaveLength(1)
    expect(fixture.shown[0]?.component.render(40)).toEqual(['after construction closes'])
    await after.close()
  })

  it('hides a handle returned after reentrant closure during mounting', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    fixture.onShow = (shown) => {
      ;(shown as Component & { focused: boolean }).focused = true
    }
    const closed = manager.open({
      create(host) {
        return {
          get focused(): boolean {
            return false
          },
          set focused(_value: boolean) {
            host.close()
          },
          render: () => ['closed during mount'],
          invalidate() {},
        }
      },
    })
    await expect(closed.closed).resolves.toEqual({ reason: 'closed' })
    expect(fixture.shown[0]?.hidden).toBe(true)
    expect(manager.hasActiveOverlay()).toBe(false)

    delete fixture.onShow
    const after = manager.open({ create: () => component(['after mount close']) })
    expect(fixture.shown[1]?.hidden).toBe(false)
    expect(fixture.shown[1]?.component.render(40)).toEqual(['after mount close'])
    await after.close()
  })

  it('stops admission and disposes active and queued overlays with the TUI', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const active = manager.open({ create: () => component(['active']) })
    const queued = manager.open({ create: () => component(['queued']) })
    manager.beginShutdown()
    expect(() => manager.open({ create: () => component() })).toThrow('TUI is shutting down')
    await manager.dispose()
    expect(await active.closed).toEqual({ reason: 'tui-disposed' })
    expect(await queued.closed).toEqual({ reason: 'tui-disposed' })
    expect(fixture.shown).toHaveLength(1)
    expect(fixture.shown[0]?.hidden).toBe(true)
    await manager.dispose()
  })

  it('contains factory, mount, render, input, and invalidation failures', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const factoryError = new Error('factory failed')
    const factory = manager.open({
      create() {
        throw factoryError
      },
    })
    const afterFactory = manager.open({ create: () => component(['after factory']) })
    expect(await factory.closed).toEqual({ reason: 'error', error: factoryError })
    await microtask()
    expect(afterFactory.state).toBe('active')
    await afterFactory.close()
    await microtask()

    const showError = new Error('show failed')
    fixture.showError = showError
    const show = manager.open({ create: () => component(['show']) })
    expect(await show.closed).toEqual({ reason: 'error', error: showError })
    delete fixture.showError
    await microtask()

    const renderError = new Error('render failed')
    const rendering = manager.open({
      create: () => ({
        render() {
          throw renderError
        },
        invalidate() {
          throw new Error('must be suppressed after the first failure')
        },
      }),
    })
    const renderComponent = fixture.shown.at(-1)!.component
    expect(renderComponent.render(20)).toEqual([])
    renderComponent.invalidate()
    expect(fixture.errors.filter(error => error === renderError)).toHaveLength(1)
    expect(await rendering.closed).toEqual({ reason: 'error', error: renderError })
    await microtask()

    const inputError = new Error('input failed')
    const input = manager.open({
      create: () => ({
        render: () => ['input'],
        handleInput() {
          throw inputError
        },
        invalidate() {},
      }),
    })
    fixture.shown.at(-1)!.component.handleInput?.('x')
    expect(await input.closed).toEqual({ reason: 'error', error: inputError })
    await microtask()

    const invalidateError = new Error('invalidate failed')
    let invalidatingHost: TuiOverlayHost | undefined
    const invalidating = manager.open({
      create(host) {
        invalidatingHost = host
        return {
          render: () => ['invalidate'],
          invalidate() {
            throw invalidateError
          },
        }
      },
    })
    const invalidationsBeforeFailure = fixture.invalidations
    invalidatingHost?.invalidate()
    invalidatingHost?.invalidate()
    expect(fixture.invalidations).toBe(invalidationsBeforeFailure)
    expect(await invalidating.closed).toEqual({ reason: 'error', error: invalidateError })
    await microtask()

    const focusError = new Error('focus failed')
    const focus = manager.open({
      create: () => ({
        get focused(): boolean {
          throw focusError
        },
        set focused(_value: boolean) {
          throw new Error('focus assignment failed')
        },
        get wantsKeyRelease(): boolean {
          throw new Error('key-release query failed')
        },
        render: () => ['focus'],
        invalidate() {},
      }),
    })
    const guarded = fixture.shown.at(-1)!.component as Component & { focused: boolean }
    expect(guarded.focused).toBe(false)
    guarded.focused = true
    expect(guarded.wantsKeyRelease).toBe(false)
    expect(await focus.closed).toEqual({ reason: 'error', error: focusError })
    expect(fixture.errors).toEqual([
      factoryError,
      showError,
      renderError,
      inputError,
      invalidateError,
      focusError,
    ])
  })

  it('contains host redraw, overlay removal, and error-reporter failures', async () => {
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    let host: TuiOverlayHost | undefined
    const invalidationError = new Error('redraw failed')
    let redrawFails = false
    fixture.driver.invalidate = () => {
      if (redrawFails) throw invalidationError
    }
    fixture.driver.reportError = () => { throw new Error('report failed') }
    const invalidating = manager.open({
      create(value) {
        host = value
        return component()
      },
    })
    redrawFails = true
    host?.invalidate()
    expect(await invalidating.closed).toEqual({ reason: 'error', error: invalidationError })
    await microtask()

    redrawFails = false
    fixture.driver.invalidate = () => {}
    const hideError = new Error('hide failed')
    fixture.driver.show = () => ({
      hide() { throw hideError },
      setHidden() {},
      isHidden: () => false,
      focus() {},
      unfocus() {},
      isFocused: () => true,
    })
    const hiding = manager.open({
      create(value) {
        host = value
        return component()
      },
    })
    host?.close()
    expect(await hiding.closed).toEqual({ reason: 'closed' })
  })
})

describe('TuiExtensionService', () => {
  it('binds an open overlay to the calling plugin fiber', async () => {
    const ctx = new Context()
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const agent = {} as Agent
    const provider = ctx.plugin((providerCtx) => {
      new TuiExtensionServiceImpl(providerCtx, agent, manager)
    })
    await provider
    let session: TuiOverlaySession | undefined
    let host: TuiOverlayHost | undefined
    const consumer = ctx.inject(['tui'], (consumerCtx) => {
      expect(consumerCtx.tui.agent).toBe(agent)
      session = consumerCtx.tui.openOverlay({
        create(value) {
          host = value
          return component(['plugin'])
        },
      })
    })
    await consumer
    expect(session?.state).toBe('active')

    await consumer.dispose()
    expect(await session?.closed).toEqual({ reason: 'owner-disposed' })
    expect(host?.signal.aborted).toBe(true)
    await provider.dispose()
    await manager.dispose()
    await ctx.fiber.dispose()
  })

  it('unloads and reloads dependent plugins with the mounted TUI service', async () => {
    const ctx = new Context()
    const agent = {} as Agent
    const sessions: TuiOverlaySession[] = []
    let starts = 0
    const consumer = ctx.inject(['tui'], (consumerCtx) => {
      starts += 1
      sessions.push(consumerCtx.tui.openOverlay({ create: () => component([`start:${String(starts)}`]) }))
    })

    const firstFixture = driverFixture()
    const firstManager = new TuiOverlayManager(firstFixture.driver)
    const firstProvider = ctx.plugin((providerCtx) => {
      new TuiExtensionServiceImpl(providerCtx, agent, firstManager)
    })
    await firstProvider
    await consumer
    expect(starts).toBe(1)
    await firstProvider.dispose()
    expect(await sessions[0]?.closed).toEqual({ reason: 'owner-disposed' })

    const secondFixture = driverFixture()
    const secondManager = new TuiOverlayManager(secondFixture.driver)
    const secondProvider = ctx.plugin((providerCtx) => {
      new TuiExtensionServiceImpl(providerCtx, agent, secondManager)
    })
    await secondProvider
    await vi.waitFor(() => { expect(starts).toBe(2) })
    await sessions[1]?.close()
    await consumer.dispose()
    await secondProvider.dispose()
    await firstManager.dispose()
    await secondManager.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects new service work after terminal shutdown begins', async () => {
    const ctx = new Context()
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const provider = ctx.plugin((providerCtx) => {
      new TuiExtensionServiceImpl(providerCtx, {} as Agent, manager)
    })
    await provider
    manager.beginShutdown()
    const consumer = ctx.inject(['tui'], (consumerCtx) => {
      expect(() => consumerCtx.tui.openOverlay({ create: () => component() }))
        .toThrow('TUI is shutting down')
    })
    await consumer
    await consumer.dispose()
    await provider.dispose()
    await manager.dispose()
    await ctx.fiber.dispose()
  })

  it('does not admit an overlay when called from an unloading plugin', async () => {
    const ctx = new Context()
    const fixture = driverFixture()
    const manager = new TuiOverlayManager(fixture.driver)
    const provider = ctx.plugin((providerCtx) => {
      new TuiExtensionServiceImpl(providerCtx, {} as Agent, manager)
    })
    await provider
    let error: unknown
    const consumer = ctx.inject(['tui'], (consumerCtx) => {
      consumerCtx.effect(() => () => {
        try {
          consumerCtx.tui.openOverlay({ create: () => component() })
        } catch (value) {
          error = value
        }
      })
    })
    await consumer
    await consumer.dispose()
    expect(error).toMatchObject({ code: 'INACTIVE_EFFECT' })
    expect(fixture.shown).toHaveLength(0)
    await provider.dispose()
    await manager.dispose()
    await ctx.fiber.dispose()
  })
})
