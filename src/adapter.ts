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
 *
 * The optional implicit-effort resolver covers one Codex-specific gap: core
 * requests such as context compaction carry no explicit reasoning effort, so
 * pi-ai falls back to the model catalog's implicit level. A configured value
 * is injected into exactly those effort-less requests; requests that already
 * carry an effort (normal agent traffic) are never rewritten, and a model that
 * rejects the configured effort keeps its catalog default instead of failing.
 */
export function createOpenAICodexAdapter(
  auth: OpenAICodexAuthRuntime,
  credentials: OpenAICodexCredentialStore,
  resolveAttachments: () => AttachmentStore | undefined,
  resolveModelMaxRetries: () => number = () => 0,
  resolveImplicitReasoningEffort: () => string = () => '',
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
  return new ImplicitEffortPiAiAdapter(
    {
      profiles,
      auth: {
        credentials,
        authContext: CODEX_AUTH_CONTEXT,
      },
      resolveApiKey: async () => auth.accessToken(),
      resolveAttachments,
    },
    resolveImplicitReasoningEffort,
  )
}

type PiAiStreamOptions = Parameters<PiAiAdapter['stream']>[0]
type PiAiStreamResult = ReturnType<PiAiAdapter['stream']>
type PiAiPreparedCall = Awaited<ReturnType<PiAiAdapter['prepareCall']>>

/** pi-ai adapter that adds a configurable effort to effort-less requests. */
class ImplicitEffortPiAiAdapter extends PiAiAdapter {
  private readonly resolveImplicitReasoningEffort: () => string

  constructor(options: ConstructorParameters<typeof PiAiAdapter>[0], resolveImplicitReasoningEffort: () => string) {
    super(options)
    this.resolveImplicitReasoningEffort = resolveImplicitReasoningEffort
  }

  /** The llm service dispatches through this frozen-snapshot seam. */
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PiAiPreparedCall> {
    const prepared = await super.prepareCall(provider, model, signal)
    return {
      ...prepared,
      stream: options => this.injectImplicitEffort(options, prepared.stream),
    }
  }

  override stream(options: PiAiStreamOptions): PiAiStreamResult {
    return this.injectImplicitEffort(options, candidate => super.stream(candidate))
  }

  private injectImplicitEffort(
    options: PiAiStreamOptions,
    dispatch: (candidate: PiAiStreamOptions) => PiAiStreamResult,
  ): PiAiStreamResult {
    const effort = this.resolveImplicitReasoningEffort().trim()
    if (effort.length === 0 || options.reasoningEffort !== undefined) return dispatch(options)
    const injected = dispatch({ ...options, reasoningEffort: effort } as PiAiStreamOptions)
    const fallback = () => dispatch(options)
    return withEffortFallback(injected, fallback)
  }
}

/**
 * Drain the injected attempt; when the model rejects the configured effort
 * with pi-ai's pre-flight `UNSUPPORTED_REASONING_EFFORT` (raised before any
 * network request), retry once with the untouched options so the catalog's
 * implicit default still applies.
 */
async function* withEffortFallback(
  injected: PiAiStreamResult,
  fallback: () => PiAiStreamResult,
): PiAiStreamResult {
  let delivered = false
  const iterator = injected[Symbol.asyncIterator]()
  try {
    while (true) {
      const step = await iterator.next()
      if (step.done) return undefined
      delivered = true
      yield step.value
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (delivered || code !== 'UNSUPPORTED_REASONING_EFFORT') throw error
  }
  yield* fallback()
}
