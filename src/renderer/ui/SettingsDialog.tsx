import { useEffect, useRef, useState } from 'react'
import { PROVIDERS, type AgentProvider, type AgentProviderStatus, type AgentTestResult } from '../../shared/agent'
import { setCanvasAppearance, useCanvasAppearance, type CanvasAppearance } from '../canvas/canvas-theme'
import { Segmented } from './controls/Segmented'
import { closeSettings, refreshStatus, setProvider, showSettingsPage, useSettings, type SettingsPage } from './settings-state'

const PAGES: { id: SettingsPage; label: string; description: string }[] = [
  { id: 'agents', label: 'Agents', description: 'Connect the coding agents that design for you. Each one uses its own sign-in.' },
  { id: 'integrations', label: 'Integrations', description: 'Let agents in your terminal or IDE read and edit the open document.' },
  { id: 'appearance', label: 'Appearance', description: 'Choose how suikopen looks while you work.' },
]

const CANVAS_OPTIONS: { value: CanvasAppearance; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

const MCP_URL = 'http://127.0.0.1:29980/mcp'

const MCP_CLIENTS: { id: string; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini CLI' },
]

function IntegrationRow({ id, name }: { id: string; name: string }): React.ReactElement {
  const [status, setStatus] = useState<{ installed: boolean; path: string } | null>(null)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    void window.suikopen.mcpStatus(id).then(setStatus)
  }, [id])

  async function connect(): Promise<void> {
    setWorking(true)
    const outcome = await window.suikopen.mcpInstall(id)
    setResult(outcome.ok ? { ok: true, message: `Connected. Restart ${name} to pick it up.${id === 'gemini' ? '' : ' The /design-handoff skill was added too.'}` } : outcome)
    setStatus(await window.suikopen.mcpStatus(id))
    setWorking(false)
  }

  const tone = !status ? 'busy' : status.installed ? 'ok' : 'off'
  return (
    <li className="agent-row" aria-labelledby={`mcp-${id}`}>
      <div className="agent-row-head">
        <h3 id={`mcp-${id}`}>{name}</h3>
        <span className={`status status-${tone}`}>
          <span className="status-dot" aria-hidden="true" />
          {!status ? 'Checking…' : status.installed ? 'Connected' : 'Not connected'}
        </span>
      </div>
      {status ? <p className="agent-row-meta">{status.path.replace(/^\/Users\/[^/]+/, '~')}</p> : null}
      <p className={`agent-row-result${result && !result.ok ? ' error' : ''}`} aria-live="polite">
        {result?.message ?? ''}
      </p>
      {status && !status.installed ? (
        <div className="agent-row-actions">
          <button className="settings-button primary" onClick={() => void connect()} disabled={working}>
            {working ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      ) : null}
    </li>
  )
}

function IntegrationsPage(): React.ReactElement {
  return (
    <>
      <ul className="agent-rows">
        {MCP_CLIENTS.map((client) => (
          <IntegrationRow key={client.id} id={client.id} name={client.name} />
        ))}
      </ul>
      <div className="settings-note">
        <p>
          Keep suikopen open while an agent works. Then ask it something like <q>Use suikopen to add a pricing section.</q>
        </p>
        <p>Other MCP clients can connect to this address:</p>
        <CopyCommand command={MCP_URL} />
      </div>
    </>
  )
}

function AppearancePage(): React.ReactElement {
  const appearance = useCanvasAppearance()
  return (
    <div className="settings-field">
      <span id="canvas-appearance">
        Canvas
        <small>Background behind your designs. System follows macOS.</small>
      </span>
      <div className="settings-segmented">
        <Segmented label="Canvas background" value={appearance} options={CANVAS_OPTIONS} onChange={setCanvasAppearance} />
      </div>
    </div>
  )
}

type Tone = 'ok' | 'warn' | 'off' | 'busy'

function describe(status: AgentProviderStatus | undefined, checking: boolean): { label: string; tone: Tone } {
  if (!status || (checking && !status.executable)) return { label: 'Checking…', tone: 'busy' }
  if (!status.executable) return { label: 'Not installed', tone: 'off' }
  if (status.signedIn === false) return { label: 'Sign in needed', tone: 'warn' }
  return { label: status.signedIn ? 'Connected' : 'Installed', tone: 'ok' }
}

function CopyCommand({ command }: { command: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  return (
    <div className="settings-command">
      <code>{command}</code>
      <button
        className="settings-button"
        onClick={() => {
          void navigator.clipboard.writeText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function AgentRow({ provider }: { provider: AgentProvider }): React.ReactElement {
  const { statuses, checking } = useSettings()
  const status = statuses[provider.id]
  const busy = Boolean(checking[provider.id])
  const { label, tone } = describe(status, busy)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<AgentTestResult | null>(null)
  const meta = [status?.account, status?.version ? `v${status.version}` : null].filter(Boolean).join(' · ')

  async function test(): Promise<void> {
    setTesting(true)
    setResult(null)
    setResult(await window.suikopen.agentTest(provider.id))
    setTesting(false)
  }

  function checkAgain(): void {
    setResult(null)
    void refreshStatus(provider.id)
  }

  return (
    <li className="agent-row" aria-labelledby={`agent-${provider.id}`}>
      <div className="agent-row-head">
        <h3 id={`agent-${provider.id}`}>{provider.name}</h3>
        <span className={`status status-${tone}`}>
          <span className="status-dot" aria-hidden="true" />
          {label}
        </span>
      </div>
      {meta ? (
        <p className="agent-row-meta" title={status?.executable ?? undefined}>
          {meta}
        </p>
      ) : null}
      {status && !status.executable ? (
        <>
          <p className="agent-row-meta">Install it in Terminal, then check again.</p>
          <CopyCommand command={provider.install} />
        </>
      ) : null}
      {status?.signedIn === false ? <p className="agent-row-meta">Sign in with your {provider.name} plan to let it edit designs.</p> : null}
      <p className={`agent-row-result${result && !result.ok ? ' error' : ''}`} aria-live="polite">
        {testing ? 'Sending a test message…' : (result?.message ?? '')}
      </p>
      <div className="agent-row-actions">
        {!status || !status.executable ? (
          <button className="settings-button" onClick={checkAgain} disabled={busy}>
            Check again
          </button>
        ) : status.signedIn === false ? (
          <>
            <button className="settings-button" onClick={checkAgain} disabled={busy}>
              Check again
            </button>
            <button className="settings-button primary" onClick={() => void window.suikopen.agentSignIn(provider.id)}>
              Sign in
            </button>
          </>
        ) : (
          <>
            <button className="settings-button" onClick={() => void test()} disabled={testing}>
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button className="settings-button" onClick={() => void window.suikopen.agentSignIn(provider.id, true)}>
              Reconnect
            </button>
          </>
        )}
      </div>
    </li>
  )
}

export function SettingsDialog(): React.ReactElement {
  const { open, provider, page } = useSettings()
  const current = PAGES.find((entry) => entry.id === page) ?? PAGES[0]!
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="settings-title"
      onClose={closeSettings}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.target === event.currentTarget && closeSettings()}
    >
      <nav className="settings-nav" aria-label="Settings sections">
        <p className="settings-nav-title">Settings</p>
        {PAGES.map((entry) => (
          <button
            key={entry.id}
            className={`settings-nav-item${page === entry.id ? ' active' : ''}`}
            aria-current={page === entry.id ? 'page' : undefined}
            onClick={() => showSettingsPage(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <section className="settings-page">
        <header className="settings-head">
          <div>
            <h2 id="settings-title">{current.label}</h2>
            <p>{current.description}</p>
          </div>
          <button className="icon-button" aria-label="Close settings" onClick={closeSettings}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {page === 'agents' ? (
          <>
            <ul className="agent-rows">
              {PROVIDERS.map((entry) => (
                <AgentRow key={entry.id} provider={entry} />
              ))}
            </ul>
            <label className="settings-field">
              <span>
                Default agent
                <small>Used for new chats.</small>
              </span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as AgentProvider['id'])}>
                {PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : page === 'integrations' ? (
          <IntegrationsPage />
        ) : (
          <AppearancePage />
        )}
      </section>
    </dialog>
  )
}
