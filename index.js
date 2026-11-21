import { registerHttp } from './http.js'

export const name = 'dsh-gpt-fastmode'
export const inject = ['commands', 'llm', 'sessions']

const WIRE_TIER = { fast: 'priority', ultrafast: 'ultrafast' }
const LABEL = { fast: 'Fast', ultrafast: 'Ultrafast' }
const RESPONSES = 'openai-responses'
const CODEX = 'openai-codex-responses'
const COMPLETIONS = 'openai-completions'
const ERRORS = {
  'not-gpt': '只支持模型 ID 以 gpt- 开头的模型。',
  'unsupported-transport': '此路由无法添加加速参数。插件不会切换模型或路由。',
  'responses-required': 'Ultrafast 需要 Responses 协议，当前路由是 Chat Completions。插件不会自动改路由。',
  'session-unavailable': '当前会话尚未就绪，请稍后重试。',
  'bridge-conflict': '此路由已有其他请求包装器，未开启加速。',
}

function result(text, kind = 'success') {
  return { kind, text }
}

function routeKey(provider, model) {
  return JSON.stringify([provider, model])
}

function returnedTier(event, api) {
  const value = api === COMPLETIONS ? event?.service_tier
    : /^(?:response\.completed|response\.done|response\.incomplete)$/.test(event?.type)
      ? event.response?.service_tier : undefined
  return typeof value === 'string' && /^[a-z][a-z_-]{0,31}$/.test(value) ? value : undefined
}

function adapterFor(llm, provider) {
  const adapter = llm.adapters?.get(provider)?.adapter
  return adapter?.constructor?.name === 'PiAiAdapter' && typeof adapter.current === 'function'
    && typeof adapter.streamWithSnapshot === 'function' ? adapter : undefined
}

function matches(selection, adapter, snapshot) {
  return snapshot !== undefined && selection.adapter.deref() === adapter && selection.snapshot.deref() === snapshot
}

function installBridge(adapter, findSelection) {
  if (Object.hasOwn(adapter, 'streamWithSnapshot')) {
    throw new Error('GPT 加速不能与另一个 pi-ai 请求包装器同时启用。')
  }
  const original = adapter.streamWithSnapshot
  function wrapped(options, snapshot) {
    if (options.sessionId === undefined || options.purpose !== undefined) return original.call(this, options, snapshot)
    const selection = findSelection(options.sessionId, options.provider, options.model, this, snapshot)
    if (!selection) return original.call(this, options, snapshot)
    const models = snapshot.models

    const requestModels = {
      getModel: models.getModel.bind(models),
      streamSimple(model, context, streamOptions) {
        const tier = WIRE_TIER[selection.mode]
        const attempt = { tier }
        const previousPayload = streamOptions.onPayload
        const previousEvent = streamOptions.onProviderStreamEvent
        const headers = new Headers(streamOptions.headers)
        if (model.api === RESPONSES && selection.mode === 'ultrafast') headers.set('OpenAI-Service-Tier', tier)
        else headers.delete('OpenAI-Service-Tier')
        return models.streamSimple(model, context, {
          ...streamOptions,
          headers: Object.fromEntries(headers),
          async onPayload(payload, wireModel) {
            const prepared = (await previousPayload?.(payload, wireModel)) ?? payload
            if (prepared === null || typeof prepared !== 'object' || Array.isArray(prepared)) {
              throw new Error('GPT 加速无法设置：pi-ai 请求体不是 JSON 对象。')
            }
            selection.observe(attempt)
            return { ...prepared, service_tier: tier }
          },
          async onProviderStreamEvent(event, wireModel) {
            await previousEvent?.(event, wireModel)
            const served = returnedTier(event, model.api)
            if (served !== undefined) attempt.served = served
          },
        })
      },
    }
    return original.call(this, options, { ...snapshot, models: requestModels })
  }
  Object.defineProperty(adapter, 'streamWithSnapshot', { value: wrapped, configurable: true, writable: true })
  const target = new WeakRef(adapter)
  return () => {
    const live = target.deref()
    if (live && Object.getOwnPropertyDescriptor(live, 'streamWithSnapshot')?.value === wrapped) {
      Reflect.deleteProperty(live, 'streamWithSnapshot')
    }
  }
}

export function apply(ctx) {
  const selectedBySession = new WeakMap()
  const observedBySession = new WeakMap()
  const allByModel = new Map()
  const bridges = new WeakSet()

  function putSession(map, session, key, value) {
    let rows = map.get(session)
    if (rows === undefined) { rows = new Map(); map.set(session, rows) }
    rows.set(key, value)
  }

  function effective(session, provider, model, adapter, snapshot) {
    const global = allByModel.get(model)
    const local = session && selectedBySession.get(session)?.get(routeKey(provider, model))
    if (local && local.global === global) {
      return local.mode === 'off' || matches(local.route, adapter, snapshot)
        ? { choice: local, scope: 'session', stale: false }
        : { choice: undefined, scope: null, stale: true }
    }
    const approved = global?.routes.get(provider)
    if (approved) {
      return matches(approved, adapter, snapshot)
        ? { choice: global, scope: 'all', stale: false }
        : { choice: undefined, scope: null, stale: true }
    }
    return { choice: undefined, scope: null, stale: false }
  }

  function findSelection(sessionId, provider, model, adapter, snapshot) {
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return undefined
    const { choice } = effective(session, provider, model, adapter, snapshot)
    if (!choice || choice.mode === 'off') return undefined
    return {
      mode: choice.mode,
      observe: attempt => {
        if (effective(session, provider, model, adapter, snapshot).choice === choice) {
          putSession(observedBySession, session, routeKey(provider, model), { choice, attempt })
        }
      },
    }
  }

  function routeOf(provider, model) {
    let adapter, snapshot, api, fastError
    if (!model.startsWith('gpt-')) fastError = 'not-gpt'
    else {
      adapter = adapterFor(ctx.llm, provider)
      snapshot = adapter?.current()
      api = snapshot?.models.getModel(provider, model)?.api
      if (api !== RESPONSES && api !== CODEX && api !== COMPLETIONS) fastError = 'unsupported-transport'
      else if (!bridges.has(adapter) && Object.hasOwn(adapter, 'streamWithSnapshot')) fastError = 'bridge-conflict'
    }
    return { adapter, snapshot, fastError: fastError ?? null,
      ultrafastError: fastError ?? (api === COMPLETIONS ? 'responses-required' : null) }
  }

  function approval({ adapter, snapshot }) {
    if (!bridges.has(adapter)) {
      ctx.effect(() => installBridge(adapter, findSelection))
      bridges.add(adapter)
    }
    return { adapter: new WeakRef(adapter), snapshot: new WeakRef(snapshot) }
  }

  function viewOf(session, { provider, model }) {
    const { adapter, snapshot, fastError, ultrafastError } = routeOf(provider, model)
    const { choice, scope, stale } = effective(session, provider, model, adapter, snapshot)
    const seen = session && observedBySession.get(session)?.get(routeKey(provider, model))
    const last = seen?.choice === choice ? seen?.attempt : undefined
    return { mode: choice?.mode ?? 'off', scope,
      globalMode: allByModel.get(model)?.mode ?? 'off',
      fastError, ultrafastError,
      last: last ? { tier: last.tier, served: last.served ?? null } : null,
      stale }
  }

  const control = {
    read: viewOf,
    set(session, active, mode, scope = 'session') {
      if (!session) return { error: 'session-unavailable' }
      const { provider, model } = active
      if (!model.startsWith('gpt-')) return { error: 'not-gpt' }
      const route = routeOf(provider, model)
      const errorFor = row => mode === 'fast' ? row.fastError : row.ultrafastError
      const error = mode === 'off' ? null : errorFor(route)
      if (error) return { error }
      if (scope === 'all') {
        const routes = new Map()
        if (mode !== 'off') {
          for (const name of ctx.llm.adapters.keys()) {
            const candidate = name === provider ? route : routeOf(name, model)
            if (!errorFor(candidate)) routes.set(name, approval(candidate))
          }
        }
        allByModel.set(model, { mode, routes })
      } else {
        const key = routeKey(provider, model)
        const global = allByModel.get(model)
        const prior = selectedBySession.get(session)?.get(key)
        if (prior?.mode !== mode || prior.global !== global || (mode !== 'off' && !matches(prior.route, route.adapter, route.snapshot))) {
          putSession(selectedBySession, session, key, { mode, global, route: mode === 'off' ? null : approval(route) })
        }
      }
      return { view: viewOf(session, active) }
    },
  }

  ctx.inject(['connection', 'agents', 'sessionController'], child => {
    child.effect(() => registerHttp(child, control), 'gpt-speed: composer controls')
  })

  function run(mode, { agent, rawInput }) {
    const action = rawInput.trim() || 'on'
    if (action !== 'on' && action !== 'off' && action !== 'status') {
      return result(`用法：/${mode} [on|off|status]`, 'error')
    }
    const active = agent.model.current()
    if (!active) return result('当前会话未选择模型，请先在模型选择器中选一个 GPT 模型。', 'error')
    const session = ctx.sessions.get(agent.session.id)
    if (!session) return result(ERRORS['session-unavailable'], 'error')
    const label = `${active.provider}/${active.model}`
    if (action === 'status') {
      const { mode: selected, scope, last, stale, fastError } = control.read(session, active)
      if (stale) return result(`${label}：路由已变更，旧加速设置不再应用。请重新选择速度。`)
      if (fastError) return result(ERRORS[fastError], 'error')
      if (selected === 'off') return result(`${label}：未请求 GPT 加速。`)
      const sameTier = last?.served === last?.tier || (last?.tier === 'priority' && last.served === 'fast')
      const observed = last?.served
        ? `最近一条可观察请求：请求 ${last.tier}；服务端返回 ${last.served}${last.served === 'default' ? '（未使用加速档位）' : sameTier ? '' : '（与请求档位不同）'}。`
        : last ? `最近已构造 ${last.tier} 请求，尚未收到服务端档位。` : '尚未构造加速请求。'
      return result(`${label}：已选 ${LABEL[selected]}（${scope === 'all' ? '所有会话' : '仅当前会话'}）。${observed}`)
    }
    const { error } = control.set(session, active, action === 'off' ? 'off' : mode)
    if (error) return result(ERRORS[error], 'error')
    if (action === 'off') return result(`已关闭 ${label} 的 GPT 加速请求。接下来由供应商或网关的默认设置决定档位。`)
    return result(`${label} 接下来的聊天请求将请求 ${LABEL[mode]}（service_tier: ${WIRE_TIER[mode]}）。实际档位以服务端为准，可能增加费用；发送消息后用 /${mode} status 查看，或用 /${mode} off 关闭。`)
  }

  for (const mode of Object.keys(WIRE_TIER)) {
    ctx.effect(() => ctx.commands.register({
      name: mode,
      description: `不带参数启用 ${LABEL[mode]}（可能增费）；用 status 查看，用 off 关闭`,
      input: { hint: '[on|off|status]' },
      handler: invocation => run(mode, invocation),
    }))
  }
}
