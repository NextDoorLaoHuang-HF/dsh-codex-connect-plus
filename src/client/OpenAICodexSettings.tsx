/* Modified from dsh-codex-connect by 0751 for dsh-codex-connect-plus; Copyright 2026 0751; Apache-2.0, see NOTICE. */
/** Plugin-owned OpenAI Codex account page inside the Plugins settings section. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { OpenAICodexUsage } from '../usage.ts'
import type { OpenAICodexSettingsConfig } from '../settings-contract.ts'
import {
  OPENAI_CODEX_AUTH_LOGIN_PATH,
  OPENAI_CODEX_AUTH_LOGOUT_PATH,
  OPENAI_CODEX_AUTH_STATUS_PATH,
} from '../auth-paths.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'
import { OpenAICodexConfiguration } from './OpenAICodexConfiguration.tsx'
import type { OpenAICodexPageInjected } from './index.tsx'

const POLL_INTERVAL_MS = 1_000
const USAGE_POLL_INTERVAL_MS = 60_000

type AccountStatus =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; usage: OpenAICodexUsage; quotaError?: string }
  | { status: 'error'; message: string }

interface LoginChallenge {
  url: string
}

/** Localized copy delivered by the framework locale seat. */
export type OpenAICodexSettingsT = (key: OpenAICodexSettingsKey, params?: Record<string, unknown>) => string

/** Props delivered by the Plugins-tab slot renderer. */
export type OpenAICodexSettingsProps = Partial<OpenAICodexPageInjected> & {
  /** Framework-synthesized translate of the settings.openai-codex namespace. */
  t?: OpenAICodexSettingsT
}

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }
const titleStyle: CSSProperties = { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const bodyStyle: CSSProperties = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' }
const cardStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }
const statusStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const buttonStyle: CSSProperties = { boxSizing: 'border-box', minHeight: 34, padding: '6px 14px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 18, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 14, cursor: 'pointer' }
const primaryButtonStyle: CSSProperties = { ...buttonStyle, borderColor: 'var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'white' }
const errorStyle: CSSProperties = { ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }
const quotaListStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 2 }
const quotaGroupStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const quotaTitleStyle: CSSProperties = { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const quotaLabelStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }
const progressTrackStyle: CSSProperties = { height: 8, overflow: 'hidden', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))' }

function progressFillStyle(percent: number): CSSProperties {
  return {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    height: '100%',
    borderRadius: 'inherit',
    background: 'var(--dsw-alias-brand-primary, #1677ff)',
  }
}

function windowLabel(seconds: number, t: OpenAICodexSettingsT): string {
  if (seconds === 5 * 60 * 60) return t('fiveHourLimit')
  if (seconds === 7 * 24 * 60 * 60) return t('weeklyLimit')
  const hours = seconds / (60 * 60)
  return Number.isInteger(hours) ? t('hourLimit', { count: hours }) : t('usageWindow')
}

function formatPercent(percent: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(percent)
}

function QuotaBar({
  label,
  percent,
  detail,
  t,
}: {
  label: string
  percent: number
  detail?: string
  t: OpenAICodexSettingsT
}) {
  const display = formatPercent(percent)
  return (
    <div style={quotaGroupStyle}>
      <div style={quotaLabelStyle}>
        <span>{label}</span>
        <span>{t('percentRemaining', { percent: display })}</span>
      </div>
      <div
        style={progressTrackStyle}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t('percentRemaining', { percent: display })}
      >
        <div style={progressFillStyle(percent)} />
      </div>
      {detail === undefined ? null : <p style={bodyStyle}>{detail}</p>}
    </div>
  )
}

function UsageLimits({ usage, quotaError, t }: {
  usage: OpenAICodexUsage
  quotaError?: string
  t: OpenAICodexSettingsT
}) {
  const hasData = usage.rateLimits.length > 0 || usage.credits !== undefined || usage.individualLimit !== undefined
  return (
    <div style={quotaListStyle}>
      <h3 style={quotaTitleStyle}>{t('usageLimits')}</h3>
      {usage.rateLimits.map(limit => (
        <div key={limit.id} style={quotaGroupStyle}>
          <h4 style={quotaTitleStyle}>{limit.name ?? limit.id}</h4>
          {limit.windows.map(window => (
            <QuotaBar
              key={window.windowSeconds}
              label={windowLabel(window.windowSeconds, t)}
              percent={window.remainingPercent}
              t={t}
            />
          ))}
        </div>
      ))}
      {usage.individualLimit === undefined ? null : (
        <QuotaBar
          label={t('monthlyLimit')}
          percent={usage.individualLimit.remainingPercent}
          detail={t('exactRemaining', {
            remaining: usage.individualLimit.remaining,
            limit: usage.individualLimit.limit,
          })}
          t={t}
        />
      )}
      {usage.credits === undefined ? null : (
        <div style={quotaLabelStyle}>
          <span>{t('credits')}</span>
          <span>{usage.credits.unlimited
            ? t('unlimited')
            : usage.credits.balance === undefined ? t('available') : usage.credits.balance}</span>
        </div>
      )}
      {!hasData && quotaError === undefined ? <p style={bodyStyle}>{t('quotaUnavailable')}</p> : null}
      {quotaError === undefined ? null : <p style={errorStyle}>{t('quotaUnavailable')}</p>}
    </div>
  )
}

function dotStyle(status: AccountStatus['status']): CSSProperties {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : status === 'signing-in' || status === 'loading'
        ? 'var(--dsw-alias-brand-primary, #1677ff)'
        : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: color }
}

async function jsonRequest<T>(path: string, method = 'GET', signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    ...signal === undefined ? {} : { signal },
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return value as T
}

/** OpenAI Codex account status and OAuth actions. */
export function OpenAICodexSettings({ t, form }: OpenAICodexSettingsProps) {
  if (t === undefined) throw new Error('OpenAI Codex settings requires its translation function')
  const [status, setStatus] = useState<AccountStatus>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [manualUrl, setManualUrl] = useState<string>()
  const [copied, setCopied] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextStatus = await jsonRequest<AccountStatus>(OPENAI_CODEX_AUTH_STATUS_PATH, 'GET', signal)
      if (mounted.current && signal?.aborted !== true) setStatus(nextStatus)
    } catch (error: unknown) {
      if (mounted.current && signal?.aborted !== true) {
        setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
      }
    }
  }, [t])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => { controller.abort() }
  }, [refresh])
  useEffect(() => {
    const interval = status.status === 'signing-in'
      ? POLL_INTERVAL_MS
      : status.status === 'signed-in' ? USAGE_POLL_INTERVAL_MS : undefined
    if (interval === undefined) return
    const controller = new AbortController()
    const timer = window.setInterval(() => { void refresh(controller.signal) }, interval)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [refresh, status.status])

  const signIn = async (): Promise<void> => {
    // Open synchronously inside the click gesture: popup blockers (and the
    // Electron shell) refuse window.open after the first await.
    const popup = window.open('about:blank', '_blank')
    if (popup !== null) popup.opener = null
    setManualUrl(undefined)
    setBusy(true)
    setStatus({ status: 'signing-in' })
    try {
      const challenge = await jsonRequest<LoginChallenge>(OPENAI_CODEX_AUTH_LOGIN_PATH, 'POST')
      if (!mounted.current) {
        popup?.close()
        return
      }
      if (popup !== null) {
        popup.location.replace(challenge.url)
        return
      }
      // Popups were refused (the desktop shell, or a strict blocker): the
      // callback lives on this Harness's own loopback webserver, so finishing
      // the login in any browser on this machine works equally well.
      setManualUrl(challenge.url)
    } catch (error: unknown) {
      popup?.close()
      if (mounted.current) {
        setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const copyManualUrl = async (): Promise<void> => {
    if (manualUrl === undefined) return
    try {
      await navigator.clipboard.writeText(manualUrl)
      setCopied(true)
      window.setTimeout(() => { if (mounted.current) setCopied(false) }, 2_000)
    } catch {
      /* Clipboard permission is optional; the link itself stays selectable. */
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await jsonRequest<{ ok: true }>(OPENAI_CODEX_AUTH_LOGOUT_PATH, 'POST')
      if (mounted.current) setStatus({ status: 'signed-out' })
    } catch (error: unknown) {
      if (mounted.current) {
        setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const label = status.status === 'signed-in'
    ? t('signedIn')
    : status.status === 'loading'
      ? t('loadingAccount')
      : status.status === 'signing-in'
      ? t('signingIn')
      : status.status === 'error'
        ? t('requestFailed')
        : t('signedOut')

  return (
    <section style={pageStyle} aria-labelledby="openai-codex-settings-title">
      <div>
        <h2 id="openai-codex-settings-title" style={titleStyle}>{t('title')}</h2>
        <p style={{ ...bodyStyle, marginTop: 6 }}>{t('intro')}</p>
      </div>
      <div style={cardStyle}>
        <h3 style={quotaTitleStyle}>{t('accountHeading')}</h3>
        <div style={rowStyle}>
          <div style={statusStyle} role="status">
            <span aria-hidden="true" style={dotStyle(status.status)} />
            <span>{label}</span>
          </div>
          {status.status === 'loading'
            ? null
            : status.status === 'signed-in'
            ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void signOut() }}>{busy ? t('working') : t('logout')}</button>
            : <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => { void signIn() }}>{busy ? t('working') : status.status === 'error' ? t('loginAgain') : t('login')}</button>}
        </div>
        {status.status === 'error' ? <p style={errorStyle}>{status.message}</p> : null}
        {manualUrl === undefined ? null : (
          <div style={quotaGroupStyle} role="group" aria-label={t('manualLoginHeading')}>
            <h4 style={quotaTitleStyle}>{t('manualLoginHeading')}</h4>
            <p style={bodyStyle}>{t('manualLoginHint')}</p>
            <div style={rowStyle}>
              <a
                href={manualUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...buttonStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                {t('openLoginPage')}
              </a>
              <button type="button" style={buttonStyle} onClick={() => { void copyManualUrl() }}>
                {copied ? t('linkCopied') : t('copyLoginLink')}
              </button>
            </div>
          </div>
        )}
        {status.status === 'signed-in'
          ? <UsageLimits
              usage={status.usage}
              {...status.quotaError === undefined ? {} : { quotaError: status.quotaError }}
              t={t}
            />
          : null}
        <OpenAICodexConfiguration
          t={t}
          {...form === undefined ? {} : { form }}
        />
      </div>
    </section>
  )
}
