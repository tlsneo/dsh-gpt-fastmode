window.__ModuleLoader__.load({
  id: '@tlsneo/dsh-gpt-fastmode',
  factory(require) {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } = React
    const NS = 'dsh-gpt-fastmode'
    const MODES = ['off', 'fast', 'ultrafast']
    const MODE_LABEL = { off: 'default', fast: 'fast', ultrafast: 'ultrafast' }
    const dictionaries = {
      en: {
        speed: 'Speed', default: 'Default', fast: 'Fast', ultrafast: 'Ultrafast',
        cost: 'May cost more', loading: 'Checking speed settings…', saving: 'Applying speed…',
        standard: 'Use the provider’s default tier', scope: 'Applies to this model in this conversation.',
        scopeLabel: 'Apply to', scopeCurrent: 'This conversation', scopeAll: 'All conversations',
        scopeAllHint: 'Applies to existing and new conversations using this model on supported routes. Replaces individual settings. Faster tiers may cost more.',
        globalTier: 'All-conversations setting:', localOverride: 'This conversation has its own setting.',
        routeNotCovered: 'This route does not use that setting.', applyAllDefault: 'Turn off speed requests for this model in all conversations',
        pending: 'Selected for subsequent requests. No tier reported yet.', statusUnavailable: 'Speed status unavailable',
        served: 'Last reported tier:', downgraded: 'Default (not accelerated)',
        mismatch: 'Different from the requested tier.', stale: 'Route changed. Select a speed again.',
        'responses-required': 'Requires Responses', 'unsupported-transport': 'This route cannot request a speed tier',
        'bridge-conflict': 'Another plugin is handling requests for this route',
        'model-changed': 'The selected model changed. Open Speed again.',
        'session-unavailable': 'This conversation is not ready. Try again.',
        'transport-error': 'Could not reach the speed controls. Try again.',
      },
      zh: {
        speed: '速度', default: '默认', fast: 'Fast', ultrafast: 'Ultrafast',
        cost: '可能额外计费', loading: '正在查询速度设置…', saving: '正在应用速度设置…',
        standard: '沿用服务端默认档位', scope: '仅用于当前会话的这个模型。',
        scopeLabel: '生效范围', scopeCurrent: '仅当前会话', scopeAll: '所有会话',
        scopeAllHint: '在支持该档位的已配置路由上，使用同一模型的现有和新会话都会应用，并覆盖单独设置。加速可能额外计费。',
        globalTier: '所有会话设置：', localOverride: '当前会话已单独设置。',
        routeNotCovered: '当前路由没有应用这项设置。', applyAllDefault: '停止所有会话对此模型请求加速',
        pending: '将用于后续请求。服务端还未报告档位。', statusUnavailable: '暂时无法确认速度设置',
        served: '最近返回的档位：', downgraded: '默认（未加速）',
        mismatch: '与请求的档位不同。', stale: '路由已变化，请重新选择速度。',
        'responses-required': '需要 Responses 协议', 'unsupported-transport': '当前路由无法请求加速档位',
        'bridge-conflict': '另一个插件正在处理此路由的请求',
        'model-changed': '模型已切换，请重新打开速度菜单。',
        'session-unavailable': '当前会话未就绪，请重试。',
        'transport-error': '无法连接速度设置，请重试。',
      },
    }
    const styles = `
      .gs-speed { display: inline-flex; flex: none; }
      .gs-speed-trigger { display: inline-flex; align-items: center; gap: 4px; box-sizing: border-box;
        min-height: 32px; padding: 4px 7px; border: 1px solid transparent; border-radius: 7px;
        background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: .8125rem;
        white-space: nowrap; cursor: pointer; }
      .gs-speed-trigger[data-tier='on'] { color: var(--dsw-alias-state-business-primary); }
      .gs-speed-trigger:hover, .gs-speed-trigger[aria-expanded='true'], .gs-speed-option:hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--dsw-alias-interactive-bg-hover); }
      .gs-speed-trigger:focus-visible, .gs-speed-option:focus-visible, .gs-speed-scope-button:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
      .gs-speed-panel { position: fixed; inset: auto; bottom: var(--gs-speed-bottom, 64px);
        left: var(--gs-speed-left, 12px); margin: 0; overflow: auto; box-sizing: border-box;
        width: min(262px, calc(100vw - 24px)); max-height: calc(100dvh - 24px);
        padding: 9px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
        font: inherit; font-size: .8125rem; line-height: 1.4; }
      @supports (left: anchor(left)) {
        .gs-speed-panel { left: clamp(12px, anchor(left), calc(100vw - 274px));
          bottom: max(12px, calc(anchor(top) + 8px)); top: 12px; height: fit-content; align-self: end; }
      }
      .gs-speed-heading { margin: 0 7px 6px; font-size: inherit; font-weight: 600; }
      .gs-speed-option { display: grid; grid-template-columns: 1fr 14px; align-items: center; gap: 0 6px;
        width: 100%; min-height: 36px; padding: 5px 7px; border: none; border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-primary); text-align: start;
        font: inherit; cursor: pointer; }
      .gs-speed-option:disabled { cursor: default; color: var(--dsw-alias-label-secondary); }
      .gs-speed-option small { grid-column: 1; color: var(--dsw-alias-label-secondary); font-size: .75rem; }
      .gs-speed-check { grid-column: 2; grid-row: 1 / 3; color: var(--dsw-alias-state-business-primary); }
      .gs-speed-footer { margin: 5px 4px 0; padding: 8px 3px 2px; border-top: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .gs-speed-footer p { margin: 0 0 4px; }
      .gs-speed-scope { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 3px 0 6px; }
      .gs-speed-scope-button { display: flex; justify-content: center; align-items: center; gap: 4px;
        min-height: 30px; padding: 3px; font: inherit; font-size: .75rem; cursor: pointer;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-primary); }
      .gs-speed-scope-button[aria-pressed='true'], .gs-speed-scope-button:hover {
        background: var(--dsw-alias-interactive-bg-hover); }
      .gs-speed-error { color: var(--dsw-alias-state-error-primary); }
      @media (pointer: coarse) { .gs-speed-trigger, .gs-speed-option, .gs-speed-scope-button { min-height: 44px; } }
    `

    function Bolt() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none' },
        h('path', { d: 'M9 1.6 3.8 8.7h4l-.7 5.7 5.2-7.1h-4l.7-5.7z', stroke: 'currentColor', strokeWidth: 1.25, strokeLinejoin: 'round' }))
    }

    async function exchange(route, mode, scope, signal) {
      const body = mode === undefined ? { action: 'read', ...route } : { action: 'set', ...route, mode, scope }
      const url = new URL('api/dsh-gpt-fastmode/mode', document.baseURI)
      const carrier = globalThis.__DSH_TRANSPORT__?.fetch
      const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
      const response = await (carrier ? carrier(url.href, init) : globalThis.fetch(url.href, init))
      const value = await response.json()
      if (!response.ok) return { error: typeof value?.error === 'string' ? value.error : 'transport-error' }
      if (!MODES.includes(value?.mode)) return { error: 'transport-error' }
      return { view: value }
    }

    function SpeedMenu({ sessionId, provider, model, t, subscribe, notifyAll }) {
      const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '_')
      const panelId = `gs-speed-${uid}`
      const anchorName = `--gs-speed-${uid}`
      const trigger = useRef(null)
      const panel = useRef(null)
      const task = useRef(null)
      const openRef = useRef(false)
      const [open, setOpen] = useState(false)
      const [scope, setScope] = useState('session')
      const [saving, setSaving] = useState(false)
      const [view, setView] = useState(null)
      const [ready, setReady] = useState(false)
      const [error, setError] = useState(null)

      const refresh = useCallback(async (mode, targetScope = 'session') => {
        if (task.current?.write) return
        task.current?.controller.abort()
        const call = { controller: new AbortController(), write: mode !== undefined }
        task.current = call
        if (call.write) setSaving(true)
        setError(null)
        try {
          const response = await exchange({ sessionId, provider, model }, mode, targetScope, call.controller.signal)
          if (task.current !== call || call.controller.signal.aborted) return
          if (response.error) {
            setError(response.error)
            setReady(false)
            if (response.error === 'model-changed') setView(null)
            return
          }
          setView(response.view)
          setReady(true)
          if (call.write && targetScope === 'all') notifyAll()
          if (call.write && panel.current?.matches(':popover-open')) {
            panel.current.hidePopover()
            trigger.current?.focus({ preventScroll: true })
          }
        } catch {
          if (task.current === call && !call.controller.signal.aborted) {
            setError('transport-error')
            setReady(false)
          }
        } finally {
          if (task.current === call) {
            task.current = null
            if (call.write) setSaving(false)
          }
        }
      }, [sessionId, provider, model, notifyAll])

      useEffect(() => {
        void refresh()
        const dispose = subscribe(sessionId, reason => {
          if (reason !== 'turn-end' || openRef.current) void refresh()
        })
        return () => { task.current?.controller.abort(); task.current = null; dispose() }
      }, [refresh, sessionId, subscribe])

      useEffect(() => {
        const element = panel.current
        function toggle(event) {
          const shown = event.newState === 'open'
          openRef.current = shown
          setOpen(shown)
          if (shown) {
            setScope('session')
            void refresh()
            const selected = element.querySelector('.gs-speed-option[aria-pressed=true]:not(:disabled)')
            const focus = selected ?? element
            focus.focus({ preventScroll: true })
          }
        }
        element.addEventListener('toggle', toggle)
        return () => element.removeEventListener('toggle', toggle)
      }, [refresh])

      function navigate(event) {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const choices = [...event.currentTarget.querySelectorAll('button:not(:disabled):not([aria-disabled=true])')]
        if (!choices.length) return
        event.preventDefault()
        const at = choices.indexOf(event.target)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : at < 0 ? (step > 0 ? 0 : choices.length - 1) : (at + step + choices.length) % choices.length
        choices[next].focus()
      }

      function positionFallback() {
        if (globalThis.CSS?.supports('left: anchor(left)') || !panel.current || !trigger.current) return
        const bounds = trigger.current.getBoundingClientRect()
        panel.current.style.setProperty('--gs-speed-bottom', `${Math.max(12, innerHeight - bounds.top + 8)}px`)
        panel.current.style.setProperty('--gs-speed-left', `${Math.max(12, Math.min(bounds.left, innerWidth - 274))}px`)
      }

      const mode = view?.mode ?? 'off'
      const globalMode = view?.globalMode ?? 'off'
      const menuMode = scope === 'all' ? globalMode : mode
      const title = mode === 'off' ? t('speed') : t(MODE_LABEL[mode])
      const activeScope = mode !== 'off' && view?.scope === 'all' ? t('scopeAll') : null
      const globalNote = globalMode === 'off' ? null : `${t('globalTier')} ${t(MODE_LABEL[globalMode])}${view?.scope === 'all' ? ''
        : ` · ${t(view?.scope === 'session' ? 'localOverride' : 'routeNotCovered')}`}`
      const errorKey = error && Object.hasOwn(dictionaries.en, error) ? error : 'transport-error'
      const last = view?.last
      const serveMatch = last?.served === last?.tier || (last?.tier === 'priority' && last.served === 'fast')
      const note = saving ? t('saving') : !view && !error ? t('loading') : view?.stale ? t('stale')
        : mode === 'off' ? '' : !last?.served ? t('pending')
          : `${t('served')} ${last.served === 'default' ? t('downgraded') : last.served}${!serveMatch && last.served !== 'default' ? ` · ${t('mismatch')}` : ''}`
      return h('div', { className: 'gs-speed' },
        h('style', null, styles),
        h('button', { ref: trigger, type: 'button', className: 'gs-speed-trigger', style: { anchorName },
          popovertarget: panelId, onClick: () => {
            if (!openRef.current) setScope('session')
            positionFallback()
          }, 'aria-expanded': open, 'aria-controls': panelId,
          title: activeScope ? `${title} · ${activeScope}` : undefined,
          'aria-label': [mode === 'off' ? t('speed') : `${t('speed')}: ${title}`, activeScope,
            !ready && error ? t('statusUnavailable') : null].filter(Boolean).join(' · '),
          'data-tier': mode === 'off' ? 'off' : 'on',
        }, h(Bolt), title, h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
          h('path', { d: 'm3 4.8 3 3 3-3', stroke: 'currentColor', fill: 'none', strokeLinecap: 'round' }))),
        h('div', { ref: panel, id: panelId, className: 'gs-speed-panel', popover: 'auto', tabIndex: -1,
          style: { positionAnchor: anchorName }, onKeyDown: navigate, role: 'group', 'aria-label': t('speed'),
        }, h('h3', { className: 'gs-speed-heading' }, t('speed')),
        ...MODES.map(choice => {
          const blocked = choice === 'fast' ? view?.fastError : choice === 'ultrafast' ? view?.ultrafastError : null
          const description = blocked ? t(blocked) : t(choice === 'off' ? (scope === 'all' ? 'applyAllDefault' : 'standard') : 'cost')
          const selected = Boolean(view && menuMode === choice)
          return h('button', { key: choice, type: 'button', className: 'gs-speed-option',
            disabled: Boolean(blocked), 'aria-disabled': !ready || saving || undefined, 'aria-pressed': selected,
            'aria-describedby': scope === 'all' ? `${panelId}-scope-hint` : undefined,
            onClick: () => { if (ready && !saving && !blocked) void refresh(choice, scope) },
          }, h('span', null, t(MODE_LABEL[choice])), h('small', null, description),
          selected ? h('span', { className: 'gs-speed-check', 'aria-hidden': true }, '✓') : null)
        }),
        h('div', { className: 'gs-speed-footer' },
          h('p', { id: `${panelId}-scope` }, t('scopeLabel')),
          h('div', { className: 'gs-speed-scope', role: 'group', 'aria-labelledby': `${panelId}-scope` },
            ...[['session', 'scopeCurrent'], ['all', 'scopeAll']].map(([value, label]) => h('button', {
              key: value, type: 'button', className: 'gs-speed-scope-button', 'aria-pressed': scope === value,
              'aria-disabled': saving || undefined,
              onClick: () => { if (!saving) setScope(value) },
            }, scope === value ? h('span', { 'aria-hidden': true }, '✓') : null, t(label)))),
          h('div', { 'aria-live': 'polite' },
            h('p', { id: `${panelId}-scope-hint` }, t(scope === 'all' ? 'scopeAllHint' : 'scope')),
            globalNote ? h('p', null, globalNote) : null,
            error ? h('p', { className: 'gs-speed-error' }, t(errorKey)) : null,
            note ? h('p', null, note) : null))))
    }

    function Toolbar({ sessionId, directory, subscribe, notifyAll, t }) {
      const current = useSyncExternalStore(directory.subscribe, directory.current)
      if (!current?.model.startsWith('gpt-')) return null
      return h(SpeedMenu, {
        key: JSON.stringify([current.provider, current.model]), sessionId,
        provider: current.provider, model: current.model, t, subscribe, notifyAll,
      })
    }

    return {
      inject: ['slots', 'locale', 'modelDirectories', 'remote'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'gpt-speed: toolbar locale')
        const listeners = new Map()
        const signal = (sessionId, reason) => {
          for (const listener of listeners.get(sessionId) ?? []) listener(reason)
        }
        const signalAll = () => { for (const id of listeners.keys()) signal(id, 'config') }
        let channel
        if (typeof globalThis.BroadcastChannel === 'function') {
          ctx.effect(() => {
            const connected = new globalThis.BroadcastChannel(`${NS}-scope`)
            channel = connected
            connected.onmessage = event => { if (event.data === 'changed') signalAll() }
            return () => { channel = undefined; connected.close() }
          }, 'gpt-speed: status invalidation across tabs')
        }
        const notifyAll = () => { signalAll(); channel?.postMessage('changed') }
        ctx.remote.$on('api-session/status', (id, running) => { if (!running) signal(id, 'turn-end') })
        ctx.remote.$on('llm/adapters-updated', signalAll)
        ctx.remote.$on('settings/document-updated', signalAll)
        ctx.on('connection/reset', signalAll)
        ctx.on('command/executed', (id, name) => {
          if (name === 'fast' || name === 'ultrafast') signal(id, 'command')
        })
        const subscribe = (id, listener) => {
          let group = listeners.get(id)
          if (!group) { group = new Set(); listeners.set(id, group) }
          group.add(listener)
          return () => { group.delete(listener); if (!group.size) listeners.delete(id) }
        }
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: NS, order: 100, locale: NS,
          inject(sessionId) {
            const store = ctx.modelDirectories.directoryFor(sessionId).store
            return { directory: { subscribe: listener => store.subscribe(listener), current: () => store.getSnapshot().current }, subscribe, notifyAll }
          },
        }, Toolbar))
      },
    }
  },
})
