/* dsh-codex-connect-plus original modifications; Copyright 2026 0751; Apache-2.0, see NOTICE. */
/** Shared provider-native OAuth runtime for models and optional Codex capabilities. */

import { createModels } from '@earendil-works/pi-ai'
import type { Api, Model, MutableModels, Provider } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { OpenAICodexCredentialStore } from './store.ts'
import { OPENAI_CODEX_PROVIDER } from './store.ts'

/** Refreshed authorization material required by fixed Codex application endpoints. */
export interface OpenAICodexAuthorizedAccount {
  accessToken: string
  accountId: string
}

/** Model id of the GPT 6.1 Sol route contributed by this plugin. */
export const CODEX_GPT_61_SOL_MODEL_ID = 'gpt-6.1-sol'

/** Display name of the GPT 6.1 Sol route contributed by this plugin. */
export const CODEX_GPT_61_SOL_MODEL_NAME = 'GPT-6.1 Sol'

/**
 * GPT 6.1 Sol catalog entry. The 6.1 release keeps the Sol family's
 * context window, output ceiling, thinking levels, attachment limits, and
 * subscription pricing; only the model id and display name move.
 */
const GPT_61_SOL_MODEL: Model<'openai-codex-responses'> = {
  id: CODEX_GPT_61_SOL_MODEL_ID,
  name: CODEX_GPT_61_SOL_MODEL_NAME,
  api: 'openai-codex-responses',
  provider: OPENAI_CODEX_PROVIDER,
  baseUrl: 'https://chatgpt.com/backend-api',
  reasoning: true,
  input: ['text', 'image'],
  cost: {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    tiers: [
      {
        inputTokensAbove: 272000,
        input: 4,
        output: 15,
        cacheRead: 0.4,
        cacheWrite: 5,
      },
    ],
  },
  contextWindow: 272000,
  maxTokens: 128000,
  thinkingLevelMap: {
    // gpt-6.1-sol rejects the wire value "none" with HTTP 400 ("Unsupported
    // value: 'none' is not supported with the 'gpt-6.1-sol' model"), which
    // broke every compaction request: compaction sends no explicit effort, so
    // pi-ai falls back to thinkingLevelMap.off. Map the implicit off level to
    // the cheapest supported effort instead, mirroring the verified mapping in
    // dsh-risk-first-approval.
    off: 'low',
    minimal: 'low',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  compat: {
    supportsOpenAIGrammarTools: true,
    supportsAdditionalTools: true,
    supportsToolSearch: true,
    supportsMidConvoSystemMessages: true,
  },
  inputLimits: {
    images: {
      resize: {
        maxWidth: 2000,
        maxHeight: 2000,
        maxBytes: 4718592,
        jpegQuality: 80,
      },
    },
  },
}

/**
 * Append plugin-owned models to a factory-built provider. `createProvider`
 * returns a plain object, so the spread keeps every other member (auth,
 * streaming, refresh) while the wrapped `getModels` merges by id — an
 * upstream catalog that later ships the same id wins over this override.
 */
function withAdditionalModels(provider: Provider, extra: readonly Model<Api>[]): Provider {
  return {
    ...provider,
    getModels: () => {
      const models = [...provider.getModels()]
      for (const model of extra) {
        const index = models.findIndex(entry => entry.id === model.id && entry.provider === model.provider)
        if (index >= 0) models[index] = model
        else models.push(model)
      }
      return models
    },
  }
}

/**
 * Own one pi-ai provider instance and its locked OAuth refresh lifecycle.
 * Callers never parse the credential file or invoke a token endpoint directly.
 */
export class OpenAICodexAuthRuntime {
  readonly provider: Provider
  private readonly models: MutableModels

  constructor(private readonly credentials: OpenAICodexCredentialStore) {
    this.provider = withAdditionalModels(openaiCodexProvider(), [GPT_61_SOL_MODEL])
    this.models = createModels({ credentials })
    this.models.setProvider(this.provider)
  }

  /** Resolve a refreshed bearer token for the standard Codex model adapter. */
  async accessToken(): Promise<string | undefined> {
    return (await this.models.getAuth(OPENAI_CODEX_PROVIDER))?.auth.apiKey
  }

  /** Resolve a refreshed bearer and its account id without exposing stored refresh state. */
  async authorizedAccount(): Promise<OpenAICodexAuthorizedAccount> {
    const accessToken = await this.accessToken()
    const credential = await this.credentials.read(OPENAI_CODEX_PROVIDER)
    const accountId = credential?.type === 'oauth' ? credential.accountId : undefined
    if (typeof accessToken !== 'string' || accessToken.length === 0
      || typeof accountId !== 'string' || accountId.length === 0) {
      throw new Error('Codex Connect Plus is signed out. Sign in under Settings → Plugins → Codex Connect Plus.')
    }
    return { accessToken, accountId }
  }
}
