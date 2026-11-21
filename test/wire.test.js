import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import * as speed from '../index.js'

const install = process.env.DSH_INSTALL_DIR
assert.ok(install, 'Set DSH_INSTALL_DIR to this DSH installation directory')
const req = createRequire(join(install, 'package.json'))
const load = name => import(pathToFileURL(req.resolve(`@deepseek-ai/${name}`)).href)
const { Context, Service } = await load('cordis')
const { HostConnectionService } = await load('dsh-client-connection')
const bridgeSource = await readFile(req.resolve('@deepseek-ai/dsh-client-connection/src/http-bridge.ts'), 'utf8')
const { bridge } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(bridgeSource)).toString('base64')}`)
const { default: CommandRuntime } = await load('dsh-commands')
const { default: SessionStore } = await load('dsh-session')
const { default: LlmRuntime, createUserMessage } = await load('dsh-llm')
const pi = await load('dsh-llm-pi-ai')

function responses(res, tier) {
  const message = { id: 'msg_local', type: 'message', role: 'assistant', status: 'completed', content: [
    { type: 'output_text', text: 'OK', annotations: [] },
  ] }
  const events = [
    { type: 'response.output_item.added', item: { ...message, content: [] } },
    { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'OK' },
    { type: 'response.output_item.done', item: message },
    { type: 'response.completed', response: {
      id: 'resp_local', status: 'completed', output: [message], service_tier: tier,
      usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
    } },
  ]
  res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
}

function completions(res) {
  res.end(`data: ${JSON.stringify({ id: 'chat_local', object: 'chat.completion.chunk', service_tier: 'priority', choices: [
    { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
  ], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`)
}

test('DSH toolbar and commands share state and pi-ai emits selected tiers without changing model or effort', { timeout: 20000 }, async t => {
  const seen = []
  let webHandler
  let webPeer
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/api/dsh-gpt-fastmode/mode') {
        const caller = request.headers['x-fixture-peer'] === 'guest' ? { principal: { kind: 'fixture-guest' } } : webPeer
        await bridge(request, response, webHandler, caller)
        return
      }
      const parts = []
      for await (const chunk of request) parts.push(chunk)
      const wire = Buffer.concat(parts)
      const body = JSON.parse(request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(wire) : wire)
      seen.push({ path: request.url, body, headers: request.headers })
      response.setHeader('Content-Type', 'text/event-stream')
      if (request.url.endsWith('/chat/completions')) completions(response)
      else responses(response, body.service_tier === 'ultrafast' ? 'ultrafast' : 'default')
    } catch {
      response.writeHead(400).end('Bad test request')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const baseURL = `http://127.0.0.1:${server.address().port}`
  const model = 'gpt-6.2-sol'
  const otherModel = 'gpt-5.4'
  const modelEntry = id => ({ id, contextWindow: 128000, maxTokens: 1000, reasoningEfforts: { high: 'high' } })
  const root = new Context()
  const agents = new Map()
  const suspended = new Map()
  let resumes = 0
  class AgentFixture extends Service {
    constructor(ctx) { super(ctx, 'agents') }
    get(id) { return agents.get(id) }
  }
  class SessionControllerFixture extends Service {
    constructor(ctx) { super(ctx, 'sessionController') }
    async resolveAgent(id) {
      resumes++
      const agent = suspended.get(id)
      if (agent) agents.set(id, agent)
      return { agent }
    }
  }
  await root.plugin(CommandRuntime)
  await root.plugin(SessionStore)
  await root.plugin(LlmRuntime)
  await root.plugin(AgentFixture)
  await root.plugin(SessionControllerFixture)
  await root.plugin({ apply(ctx) { new HostConnectionService(ctx, [], {}) } })
  const testJwt = `mock.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'local' } }))}.mock`
  process.env.DSH_GPT_SPEED_TEST_KEY = 'fixture-only-key'
  process.env.DSH_GPT_SPEED_CODEX_TEST_KEY = testJwt
  t.after(() => {
    delete process.env.DSH_GPT_SPEED_TEST_KEY
    delete process.env.DSH_GPT_SPEED_CODEX_TEST_KEY
  })
  const providerConfig = (api, prefix) => ({
    api, baseURL: `${baseURL}/${prefix}/v1`, apiKeyEnv: 'DSH_GPT_SPEED_TEST_KEY',
    models: [modelEntry(model), modelEntry(otherModel), modelEntry('gpt-oss-test'), modelEntry('not-gpt-test')],
    headers: { 'x-fixture': 'preserved' },
  })
  const providers = {
    responses: providerConfig('openai-responses', 'responses'),
    completions: providerConfig('openai-completions', 'completions'),
    'openai-codex': { baseURL: `${baseURL}/backend-api`, transport: 'sse', models: [{ id: model }], apiKeyEnv: 'DSH_GPT_SPEED_CODEX_TEST_KEY' },
  }
  providers.completions.headers['OpenAI-Service-Tier'] = 'ultrafast'
  const piFiber = root.plugin(pi, { providers })
  await piFiber
  const fiber = root.plugin(speed)
  await fiber

  const first = root.sessions.create()
  const second = root.sessions.create()
  let active = { provider: 'responses', model }
  const agent = { session: first, model: { current: () => active } }
  agents.set(first.id, agent)
  suspended.set(second.id, { session: second, model: { current: () => active } })
  webHandler = root.connection.createSharedFetchHandler('/api')
  webPeer = root.connection.browserPeer
  function api(action, overrides = {}, peer = webPeer) {
    return fetch(`${baseURL}/api/dsh-gpt-fastmode/mode`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', ...(peer.principal.kind === 'fixture-guest' ? { 'x-fixture-peer': 'guest' } : {}),
      },
      body: JSON.stringify({ action, sessionId: first.id, ...active, ...overrides }),
    })
  }
  const signal = new AbortController().signal
  const command = line => root.commands.execute(agent, line, [], signal).then(outcome => outcome.result)
  assert.deepEqual(root.commands.list(agent).map(row => row.name), ['fast', 'ultrafast'])
  let sequence = 0
  async function request({ sessionId = first.id, provider = 'responses', model: id = model, purpose } = {}) {
    const tag = `fixture-request-${++sequence}-end`
    const chunks = await Array.fromAsync(root.llm.stream({
      provider, model: id, sessionId, purpose, reasoningEffort: 'high', signal,
      messages: [createUserMessage({ content: [{ type: 'text', text: `Reply OK ${tag}` }] })],
    }))
    assert.deepEqual(chunks.at(-1)?.reason, { kind: 'stop' }, JSON.stringify(chunks.at(-1)))
    const matches = seen.filter(entry => JSON.stringify(entry.body).includes(tag))
    assert.equal(matches.length, 1)
    return matches[0]
  }

  assert.equal((await request()).body.service_tier, undefined)
  const beforeClick = first.seq
  assert.deepEqual(await (await api('read')).json(), {
    mode: 'off', scope: null, globalMode: 'off', fastError: null, ultrafastError: null, last: null, stale: false,
  })
  assert.equal((await api('set', { mode: 'fast' }, { principal: { kind: 'fixture-guest' } })).status, 403)
  assert.equal((await api('set', { mode: 'fast', model: otherModel })).status, 409)
  assert.equal((await api('set', { mode: 'fast', extra: true })).status, 400)
  assert.equal((await request()).body.service_tier, undefined)
  assert.equal((await (await api('read', { sessionId: second.id })).json()).mode, 'off')
  assert.equal(resumes, 0, 'status must not activate a suspended session')
  assert.equal((await (await api('set', { mode: 'fast' })).json()).mode, 'fast')
  assert.equal(first.seq, beforeClick, 'toolbar status and changes leave no command/history entries')
  assert.match((await command('/fast status')).text, /尚未构造/)
  const [fast, isolated] = await Promise.all([request(), request({ sessionId: second.id })])
  assert.equal(fast.body.service_tier, 'priority')
  assert.equal(fast.body.model, model)
  assert.equal(fast.path, '/responses/v1/responses')
  assert.equal(fast.body.reasoning.effort, 'high')
  assert.equal(fast.headers['openai-service-tier'], undefined)
  assert.equal(fast.headers['x-fixture'], 'preserved')
  assert.equal(isolated.body.service_tier, undefined)
  assert.deepEqual((await (await api('read')).json()).last, { tier: 'priority', served: 'default' })
  assert.match((await command('/fast status')).text, /请求 priority；服务端返回 default/)
  assert.equal((await request({ model: otherModel })).body.service_tier, undefined)
  assert.equal((await request({ purpose: 'session-title' })).body.service_tier, undefined)
  assert.equal((await command('/ultrafast')).kind, 'success')
  assert.equal((await (await api('read')).json()).mode, 'ultrafast', 'commands and toolbar share Host state')
  const ultra = await request()
  assert.equal(ultra.body.service_tier, 'ultrafast')
  assert.equal(ultra.headers['openai-service-tier'], 'ultrafast')
  assert.equal(ultra.headers['x-fixture'], 'preserved')
  assert.match((await command('/fast status')).text, /服务端返回 ultrafast/)
  assert.equal((await command('/fast off')).kind, 'success')
  const off = await request()
  assert.equal(off.body.service_tier, undefined)
  assert.equal(off.headers['openai-service-tier'], undefined)

  active = { provider: 'completions', model }
  assert.equal((await (await api('read')).json()).ultrafastError, 'responses-required')
  assert.equal((await api('set', { mode: 'ultrafast' })).status, 422)
  assert.match((await command('/ultrafast')).text, /需要 Responses/)
  assert.equal((await command('/fast on')).kind, 'success')
  const chat = await request({ provider: 'completions' })
  assert.equal(chat.body.service_tier, 'priority')
  assert.equal(chat.path, '/completions/v1/chat/completions')
  assert.equal(chat.headers['openai-service-tier'], undefined)
  assert.match((await command('/fast status')).text, /服务端返回 priority/)

  await piFiber.update({ providers: {
    ...providers, completions: { ...providers.completions, baseURL: `${baseURL}/changed/v1` },
  } })
  await piFiber.update({ providers })
  assert.match((await command('/fast status')).text, /路由已变更/)
  const restored = await request({ provider: 'completions' })
  assert.equal(restored.body.service_tier, undefined)
  assert.equal(restored.headers['openai-service-tier'], 'ultrafast')
  assert.equal((await command('/fast')).kind, 'success')

  active = { provider: 'responses', model: 'not-gpt-test' }
  assert.equal((await command('/fast')).kind, 'error')
  assert.equal((await api('set', { mode: 'fast' })).status, 422)
  active = { provider: 'responses', model: 'gpt-oss-test' }
  assert.equal((await (await api('set', { mode: 'fast', sessionId: second.id })).json()).mode, 'fast')
  assert.equal(resumes, 1)
  assert.equal((await request({ sessionId: second.id, model: active.model })).body.service_tier, 'priority')
  assert.equal((await request({ model: active.model })).body.service_tier, undefined)
  active = { provider: 'openai-codex', model }
  const codexBaseline = await request({ provider: 'openai-codex' })
  assert.equal(codexBaseline.body.service_tier, undefined)
  assert.equal((await command('/fast')).kind, 'success')
  const codex = await request({ provider: 'openai-codex' })
  assert.equal(codex.body.service_tier, 'priority')
  assert.match(codex.path, /\/codex\/responses$/)
  assert.deepEqual(codex.body.reasoning, codexBaseline.body.reasoning)
  assert.equal((await command('/ultrafast')).kind, 'success')
  const codexUltra = await request({ provider: 'openai-codex' })
  assert.equal(codexUltra.body.service_tier, 'ultrafast')
  assert.equal(codexUltra.headers['openai-service-tier'], undefined)
  assert.equal((await command('/fast maybe')).kind, 'error')

  active = { provider: 'responses', model }
  assert.equal((await api('set', { mode: 'fast', scope: 'invalid' })).status, 400)
  assert.equal((await api('set', { mode: 'fast', scope: 'all' }, { principal: { kind: 'fixture-guest' } })).status, 403)
  assert.equal((await api('set', { mode: 'fast', scope: 'all', model: otherModel })).status, 409)
  assert.equal((await api('set', { mode: 'off', sessionId: second.id })).status, 200)
  const beforeGlobal = first.seq
  const applied = await (await api('set', { mode: 'fast', scope: 'all' })).json()
  assert.equal(applied.scope, 'all')
  assert.equal(applied.globalMode, 'fast')
  assert.equal(first.seq, beforeGlobal, 'global preferences do not append conversation events')
  const third = root.sessions.create()
  assert.equal((await (await api('read', { sessionId: third.id })).json()).scope, 'all')
  assert.equal((await request()).body.service_tier, 'priority')
  assert.deepEqual((await (await api('read')).json()).last, { tier: 'priority', served: 'default' })
  assert.equal((await (await api('read', { sessionId: second.id })).json()).last, null, 'other sessions cannot see a different session’s observed tier')
  assert.equal((await request({ sessionId: second.id })).body.service_tier, 'priority', 'explicit global change supersedes prior local settings')
  assert.equal((await request({ sessionId: third.id, provider: 'completions' })).body.service_tier, 'priority', 'matching ID inherits across providers')
  assert.equal((await request({ sessionId: third.id, model: otherModel })).body.service_tier, undefined)
  assert.equal((await request({ sessionId: third.id, purpose: 'session-title' })).body.service_tier, undefined)

  const localOverride = await (await api('set', { mode: 'off', scope: 'session', sessionId: second.id })).json()
  assert.equal(localOverride.mode, 'off')
  assert.equal(localOverride.scope, 'session')
  assert.equal(localOverride.globalMode, 'fast')
  assert.equal((await request({ sessionId: second.id })).body.service_tier, undefined)
  assert.equal((await request({ sessionId: third.id })).body.service_tier, 'priority')
  assert.equal((await (await api('set', { mode: 'ultrafast', scope: 'all' })).json()).globalMode, 'ultrafast')
  assert.equal((await request({ sessionId: second.id })).body.service_tier, 'ultrafast')
  assert.equal((await request({ sessionId: third.id, provider: 'completions' })).body.service_tier, undefined, 'ultrafast never falls back to fast')

  await piFiber.update({ providers: { ...providers, responses: { ...providers.responses, baseURL: `${baseURL}/changed/v1` } } })
  await piFiber.update({ providers })
  const stale = await (await api('read')).json()
  assert.equal(stale.globalMode, 'ultrafast')
  assert.equal(stale.stale, true)
  assert.equal((await request({ sessionId: second.id })).body.service_tier, undefined)
  assert.equal((await (await api('set', { mode: 'fast', scope: 'session', sessionId: second.id })).json()).mode, 'fast')
  const cleared = await (await api('set', { mode: 'off', scope: 'all' })).json()
  assert.equal(cleared.globalMode, 'off')
  assert.equal((await request({ sessionId: second.id })).body.service_tier, undefined, 'global Default resets local overrides for the model as well')
  assert.equal((await request({ sessionId: third.id })).body.service_tier, undefined)

  await fiber.dispose()
  assert.equal((await api('read')).status, 404)
  assert.equal(root.commands.list(agent).length, 0)
  assert.equal((await request({ provider: 'completions' })).body.service_tier, undefined)
})
