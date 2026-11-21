const PATH = '/api/dsh-gpt-fastmode/mode'
const MAX_BYTES = 4_096
const MODES = new Set(['off', 'fast', 'ultrafast'])

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function requestArgs(request) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' || !request.body) return
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) {
        void reader.cancel().catch(() => {})
        return
      }
      text += decoder.decode(value, { stream: true })
    }
    const data = JSON.parse(text + decoder.decode())
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return
    const { action, sessionId, provider, model, mode, scope = 'session' } = data
    const explicitScope = Object.hasOwn(data, 'scope')
    if ((action !== 'read' && action !== 'set') || Object.keys(data).length !== (action === 'read' ? 4 : explicitScope ? 6 : 5)
      || ![sessionId, provider, model].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1024)
      || (action === 'set' ? !MODES.has(mode) || (scope !== 'session' && scope !== 'all') : Object.hasOwn(data, 'mode') || explicitScope)) return
    return { action, sessionId, provider, model, mode, scope }
  } catch {
    return undefined
  } finally {
    reader.releaseLock()
  }
}

export function registerHttp(ctx, control) {
  return ctx.connection.fetch.register({
    path: PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    async fetch(request) {
      const args = await requestArgs(request)
      if (args === undefined) return json({ error: 'invalid-request' }, 400)
      const { action, sessionId, provider, model, mode, scope } = args
      if (!model.startsWith('gpt-')) return json({ error: 'not-gpt' }, 422)
      const expected = { provider, model }
      let agent = ctx.agents.get(sessionId)
      if (agent === undefined && action === 'set') {
        try { agent = (await ctx.sessionController.resolveAgent(sessionId)).agent }
        catch { return json({ error: 'session-unavailable' }, 409) }
        if (!agent || ctx.agents.get(sessionId) !== agent) return json({ error: 'session-unavailable' }, 409)
      }
      if (request.signal.aborted) return json({ error: 'cancelled' }, 409)
      const active = agent?.model.current()
      if (agent && (active?.provider !== provider || active?.model !== model)) {
        return json({ error: 'model-changed' }, 409)
      }
      const session = agent ? ctx.sessions.get(sessionId) : undefined
      if (agent && (!session || session !== agent.session)) return json({ error: 'session-unavailable' }, 409)
      if (action === 'read') return json(control.read(session, expected))
      const change = control.set(session, expected, mode, scope)
      return change.error ? json(change, 422) : json(change.view)
    },
  })
}
