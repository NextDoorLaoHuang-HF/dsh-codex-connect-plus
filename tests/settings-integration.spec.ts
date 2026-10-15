import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as OpenAICodex from '../src/index.ts'
import { DEFAULT_OPENAI_CODEX_SETTINGS } from '../src/settings-contract.ts'
import type { OpenAICodexSettingsConfig } from '../src/settings-contract.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

/** Hand-rolled volatile references reading one mutable settings object. */
function volatileConfig(): { config: OpenAICodex.VolatileConfig; live: OpenAICodexSettingsConfig } {
  const live: OpenAICodexSettingsConfig = { ...DEFAULT_OPENAI_CODEX_SETTINGS }
  const ref = <Key extends keyof OpenAICodexSettingsConfig>(key: Key) => ({ get: () => live[key] })
  return {
    live,
    config: {
      modelMaxRetries: ref('modelMaxRetries'),
      enableSearch: ref('enableSearch'),
      enableImageTool: ref('enableImageTool'),
      enableImageGeneration: ref('enableImageGeneration'),
      searchModel: ref('searchModel'),
      searchMode: ref('searchMode'),
      searchContextSize: ref('searchContextSize'),
      searchMaxOutputTokens: ref('searchMaxOutputTokens'),
    },
  }
}

describe('OpenAI Codex Host settings integration', () => {
  it('exposes OpenAI Codex and applies optional capabilities without changing routes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-codex-connect-settings-'))
    vi.stubEnv('DSH_HOME', root)
    const workspace = join(root, 'workspace')
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(WebRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    const { config, live } = volatileConfig()
    // The loader normally parses the raw config into volatile references; the
    // test hands apply() the already-parsed reference shape directly.
    // The loader normally parses raw config into volatile references; without
    // it, drop the schema so the already-parsed references reach apply() as-is.
    const runtime = { ...OpenAICodex } as typeof OpenAICodex & { Config?: unknown }
    delete runtime.Config
    type LoosePlugin = (plugin: object, config?: unknown) => Promise<Fiber>
    const plugin = await (ctx.plugin as unknown as LoosePlugin)(runtime, config)

    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'openai-codex',
      displayName: 'OpenAI Codex',
      settingsNs: 'llm-openai-codex',
      settingsPath: [],
      declared: false,
    }])
    expect(ctx.llm.providerRetryPolicy('openai-codex')).toMatchObject({ mode: 'normal', maxRetries: 0 })
    expect(ctx.tools.get(OpenAICodex.VIEW_IMAGE_TOOL_NAME)).toBeUndefined()
    await vi.waitFor(() => {
      expect(ctx.tools.get(OpenAICodex.CODEX_IMAGE_GENERATE_TOOL_NAME)).toBeDefined()
      expect(ctx.tools.get(OpenAICodex.CODEX_IMAGE_EDIT_TOOL_NAME)).toBeDefined()
    })
    await expect(ctx.web.search({ query: 'disabled' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })

    live.modelMaxRetries = 1
    live.enableSearch = true
    live.enableImageTool = true
    live.searchModel = 'gpt-search-settings-test'
    live.searchMode = 'live'
    live.searchContextSize = 'high'
    live.searchMaxOutputTokens = 2048
    plugin.ctx.emit('loader/volatile-update', [])
    await vi.waitFor(() => {
      expect(ctx.tools.get(OpenAICodex.VIEW_IMAGE_TOOL_NAME)).toBeDefined()
    })
    expect(ctx.llm.providerRetryPolicy('openai-codex')).toMatchObject({ mode: 'normal', maxRetries: 1 })
    await expect(ctx.web.search({ query: 'enabled' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })

    live.enableSearch = false
    live.enableImageTool = false
    live.enableImageGeneration = false
    plugin.ctx.emit('loader/volatile-update', [])
    await vi.waitFor(() => {
      expect(ctx.tools.get(OpenAICodex.VIEW_IMAGE_TOOL_NAME)).toBeUndefined()
      expect(ctx.tools.get(OpenAICodex.CODEX_IMAGE_GENERATE_TOOL_NAME)).toBeUndefined()
      expect(ctx.tools.get(OpenAICodex.CODEX_IMAGE_EDIT_TOOL_NAME)).toBeUndefined()
    })
    await expect(ctx.web.search({ query: 'disabled again' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })

    await plugin.dispose()
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('coexists with the built-in catalog directory entry for openai-codex', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-codex-connect-catalog-'))
    vi.stubEnv('DSH_HOME', root)
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    // Harness 0.2's built-in llm-pi-ai declares every catalog provider id in
    // the configurable-provider directory; reproduce that pre-declaration.
    await ctx.plugin({
      name: 'catalog-stub',
      inject: ['llm'],
      apply(stubCtx: Context) {
        stubCtx.llm.registerConfigurableProviders([{
          provider: 'openai-codex',
          displayName: 'OpenAI Codex',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'openai-codex'],
          declared: false,
        }])
      },
    })
    const { config } = volatileConfig()
    const runtime = { ...OpenAICodex } as typeof OpenAICodex & { Config?: unknown }
    delete runtime.Config
    type LoosePlugin = (plugin: object, config?: unknown) => Promise<Fiber>
    const plugin = await (ctx.plugin as unknown as LoosePlugin)(runtime, config)

    // The built-in entry stays, the OAuth adapter still owns the route, and
    // activation did not throw on the duplicate declaration.
    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)
    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('openai-codex')
    expect(ctx.llm.providerRetryPolicy('openai-codex')).toMatchObject({ mode: 'normal', maxRetries: 0 })
    await plugin.dispose()
  })
})
