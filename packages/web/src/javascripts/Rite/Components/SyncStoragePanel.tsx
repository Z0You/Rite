import { observer } from 'mobx-react-lite'
import { FunctionComponent, useCallback, useEffect, useState } from 'react'
import Icon from '@/Components/Icon/Icon'
import { useApplication } from '@/Components/ApplicationProvider'
import StorageConnectForm from './StorageConnectForm'
import CheckConnection from './CheckConnection'
import { getStorageProviders, providerForHost, StorageProvider } from '../RiteSync'

/** Re-renders when the provider's account connects or disconnects. */
export function useStorageConnection(provider: StorageProvider | undefined) {
  const [email, setEmail] = useState(provider?.account.connectedEmail)
  useEffect(() => {
    setEmail(provider?.account.connectedEmail)
    return provider?.account.onChange(() => setEmail(provider.account.connectedEmail))
  }, [provider])
  return { email, isConnected: !!email }
}

type Props = {
  /** Shown under the panel, e.g. a reminder that the Rite password is separate. */
  hint?: string
}

/**
 * Shown above the sign-in / create-account forms: which storage keeps this account's encrypted
 * notes (MEGA or Filen), and whether that storage account is connected.
 */
const SyncStoragePanel: FunctionComponent<Props> = ({ hint }) => {
  const application = useApplication()
  const { server, setServer } = application.accountMenuController
  const provider = providerForHost(server)
  const { email, isConnected } = useStorageConnection(provider)
  const [showForm, setShowForm] = useState(false)

  const choose = useCallback(
    (next: StorageProvider) => {
      setShowForm(false)
      setServer(next.host)
      application.setCustomHost(next.host, '').catch(console.error)
    },
    [application, setServer],
  )

  const disconnect = useCallback(() => {
    provider?.account.disconnect().catch(console.error)
  }, [provider])

  if (!provider) {
    return (
      <div className="mx-3 mb-3 rounded border border-border bg-contrast px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Icon type="server" className="text-neutral" />
          Custom sync server
        </div>
        <div className="mt-1 break-all text-passive-1">{server}</div>
        <div className="mt-1 text-xs text-passive-1">Change this under Advanced options.</div>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-3 rounded border border-border bg-contrast px-3 py-2 text-sm">
      <div className="mb-2 flex rounded border border-border bg-default p-0.5" role="radiogroup" aria-label="Sync storage">
        {getStorageProviders().map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="radio"
            aria-checked={candidate.id === provider.id}
            className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${
              candidate.id === provider.id ? 'bg-info text-info-contrast' : 'text-passive-1 hover:bg-contrast'
            }`}
            onClick={() => choose(candidate)}
          >
            {candidate.name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Icon type="cloud-off" className={isConnected ? 'hidden' : 'text-warning'} />
          <Icon type="check-circle" className={isConnected ? 'text-success' : 'hidden'} />
          Sync with {provider.name}
        </div>
        {isConnected && (
          <button className="text-xs text-info hover:underline" onClick={disconnect} type="button">
            Disconnect
          </button>
        )}
      </div>

      {isConnected ? (
        <div className="mt-1 text-passive-1">
          Connected as <span className="font-medium text-text">{email}</span>. Your encrypted notes are kept in the
          “Rite” folder of this {provider.name} account.
          <CheckConnection provider={provider} />
        </div>
      ) : showForm ? (
        <StorageConnectForm
          key={provider.id}
          provider={provider}
          onConnected={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <div className="mt-1">
          <div className="text-passive-1">
            Connect a {provider.name} account to store and sync your encrypted notes. No account yet? Create a free
            one at {provider.website}.
          </div>
          <button
            type="button"
            className="mt-2 rounded bg-info px-3 py-1 text-xs font-semibold text-info-contrast"
            onClick={() => setShowForm(true)}
          >
            Connect {provider.name}
          </button>
        </div>
      )}

      {hint && <div className="mt-2 text-xs text-passive-1">{hint}</div>}
    </div>
  )
}

export default observer(SyncStoragePanel)
