/* Modified from dsh-codex-connect by 0751 for dsh-codex-connect-plus; Copyright 2026 0751; Apache-2.0, see NOTICE. */
/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */

import type { AuthContext, Provider } from '@earendil-works/pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { OpenAICodexAuthRuntime } from './auth-runtime.ts'
import type { OpenAICodexCredentialStore } from './store.ts'
import { OPENAI_CODEX_PROVIDER } from './store.ts'

/** Provider idle ceiling used by the composite route. */
export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000

/*
 * Request-image limits mirroring dsh-llm-pi-ai's internal defaults (not
 * exported by the package): one raw request image at most 20 MiB, a total
 * pixel budget of 2048x2048, and a raw request-version byte target of 1 MiB.
 */
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/**
 * Give the generic dsh adapter a request-scoped bearer-token entry without
 * changing the provider's user-facing OAuth flow. The resolver accepts only
 * the explicit override supplied by this plugin; it never discovers an API
 * key from the environment or persistent api-key credentials.
 */
function requestProvider(provider: Provider): Provider {
  return {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        name: 'OpenAI Codex OAuth bearer token',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'OAuth' }
        },
      },
    },
  }
}

/**
 * Codex OAuth is never ambient: the provider resolves exclusively from the
 * credential this plugin owns, so the shared auth context answers every
 * ambient question with "absent".
 */
const CODEX_AUTH_CONTEXT: AuthContext = {
  async env() { return undefined },
  async fileExists() { return false },
}

/**
 * Create the Codex subscription adapter without requiring a dsh fork. The
 * public pi-ai adapter owns Harness message conversion, image attachment
 * resolution, streaming, reasoning metadata, and compaction behavior; this
 * plugin supplies its provider-native OAuth token for each request.
 */
export function createOpenAICodexAdapter(
  auth: OpenAICodexAuthRuntime,
  credentials: OpenAICodexCredentialStore,
  resolveAttachments: () => AttachmentStore | undefined,
  resolveModelMaxRetries: () => number = () => 0,
): PiAiAdapter {
  const provider = auth.provider
  let cachedMaxRetries: number | undefined
  let cachedProfiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const maxRetries = resolveModelMaxRetries()
    if (cachedProfiles !== undefined && cachedMaxRetries === maxRetries) return cachedProfiles
    cachedMaxRetries = maxRetries
    cachedProfiles = new Map<string, ResolvedPiAiProviderProfile>([[OPENAI_CODEX_PROVIDER, {
      provider: OPENAI_CODEX_PROVIDER,
      displayName: 'OpenAI Codex',
      streamIdleTimeoutMs: OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS,
      retryPolicy: resolveRetryPolicy(
        { mode: 'normal', maxRetries },
        'dsh-codex-connect-plus retryPolicy',
      ),
      maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
      requestImagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
      requestImageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
      modelErrors: new Map<string, string>(),
      configuredMaxTokens: new Map(),
      piProvider: requestProvider(provider),
    }]])
    return cachedProfiles
  }
  return new PiAiAdapter({
    profiles,
    auth: {
      credentials,
      authContext: CODEX_AUTH_CONTEXT,
    },
    resolveApiKey: async () => auth.accessToken(),
    resolveAttachments,
  })
}
