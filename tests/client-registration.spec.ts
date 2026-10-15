import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('OpenAI Codex browser contribution', () => {
  it('registers a Plugins settings tab page instead of a section of its own', async () => {
    const client = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    expect(client).toContain("ctx.slots.inject('settings.plugins.tab'")
    expect(client).toContain("name: 'settings.plugins.tab'")
    expect(client).toContain('id: OPENAI_CODEX_SETTINGS_NAMESPACE')
    expect(client).toContain('order: 30')
    expect(client).toContain('ctx.configForms.get')
    expect(client).not.toContain("ctx.slots.inject('settings.section'")
    expect(client).not.toContain('dsh-client-runtime')
    expect(client).toContain("ctx.slots.inject('tool.call.toolview'")
  })

  it('keeps the committed browser bundle free of Host-only runtime imports', async () => {
    const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    const requires = [...bundle.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1])
    expect(requires).toEqual(['react', 'react/jsx-runtime'])
    expect(bundle).not.toContain('@deepseek-ai/dsh-attachment')
    expect(bundle).not.toContain('@deepseek-ai/dsh-tools')
    expect(bundle).not.toMatch(/node:(?:fs|path|http)/u)
  })

  it('renders the Plugins-tab page copy and uses OpenAI Codex as the provider route', async () => {
    const [settingsPage, locales, adapter] = await Promise.all([
      readFile(new URL('../src/client/OpenAICodexSettings.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/client/locales.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/adapter.ts', import.meta.url), 'utf8'),
    ])
    expect(settingsPage).toContain('id="openai-codex-settings-title"')
    expect(locales.match(/title: 'Codex Connect Plus'/gu)).toHaveLength(2)
    expect(adapter).toContain("displayName: 'OpenAI Codex'")
  })
})
