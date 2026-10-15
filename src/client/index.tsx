/* Modified from dsh-codex-connect by 0751 for dsh-codex-connect-plus; Copyright 2026 0751; Apache-2.0, see NOTICE. */
/** Browser half: OpenAI Codex account page inside the Plugins settings section. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { OPENAI_CODEX_SETTINGS_NAMESPACE } from '../settings-contract.ts'
import type { OpenAICodexSettingsConfig } from '../settings-contract.ts'
import { OpenAICodexSettings } from './OpenAICodexSettings.tsx'
import { CodexImageToolView } from './CodexImageToolView.tsx'
import { CODEX_IMAGE_EDIT_TOOL_NAME, CODEX_IMAGE_GENERATE_TOOL_NAME } from '../images/contract.ts'
import { en, zh } from './locales.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** OpenAI Codex account page copy. */
    'settings.openai-codex': OpenAICodexSettingsKey
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-codex-connect-plus-client'
/** Client services required by the Plugin configuration contribution. */
export const inject = ['slots', 'locale', 'configForms']

/** Dependencies injected into the Plugins-tab page component. */
export interface OpenAICodexPageInjected {
  /** Live Host form for the llm-openai-codex settings entry. */
  form: ConfigForm<OpenAICodexSettingsConfig>
}

/** Register account copy, the OpenAI Codex Plugins tab, and the image tool views. */
export function apply(ctx: Context): void {
  const namespace = 'settings.openai-codex'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-codex-connect-plus: settings copy')
  const form = ctx.configForms.get<OpenAICodexSettingsConfig>(OPENAI_CODEX_SETTINGS_NAMESPACE)
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: OPENAI_CODEX_SETTINGS_NAMESPACE,
    order: 30,
    label: () => ctx.locale.bind(namespace)('title'),
    locale: namespace,
    inject: (): OpenAICodexPageInjected => ({ form }),
  }, OpenAICodexSettings))
  for (const key of [CODEX_IMAGE_GENERATE_TOOL_NAME, CODEX_IMAGE_EDIT_TOOL_NAME]) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key,
    }, CodexImageToolView))
  }
}
