import { observer } from 'mobx-react-lite'
import { FunctionComponent, useCallback, useEffect, useState } from 'react'
import Icon from '@/Components/Icon/Icon'
import { useApplication } from '@/Components/ApplicationProvider'
import MegaConnectForm from './MegaConnectForm'
import { getMegaAccount, isMegaHost } from '../RiteSync'

/** Re-renders when the MEGA connection changes. */
export function useMegaConnection() {
  const account = getMegaAccount()
  const [email, setEmail] = useState(account.connectedEmail)
  useEffect(() => account.onChange(() => setEmail(account.connectedEmail)), [account])
  return { email, isConnected: !!email, account }
}

type Props = {
  /** Shown under the panel, e.g. a reminder that the Rite password is separate. */
  hint?: string
}

/**
 * Shown above the sign-in / create-account forms: where this account's encrypted notes are
 * stored, and — for MEGA — whether a MEGA account is connected.
 */
const SyncStoragePanel: FunctionComponent<Props> = ({ hint }) => {
  const application = useApplication()
  const { server } = application.accountMenuController
  const { email, isConnected, account } = useMegaConnection()
  const [showForm, setShowForm] = useState(false)

  const onMega = isMegaHost(server)

  const disconnect = useCallback(() => {
    account.disconnect().catch(console.error)
  }, [account])

  if (!onMega) {
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Icon type="cloud-off" className={isConnected ? 'hidden' : 'text-warning'} />
          <Icon type="check-circle" className={isConnected ? 'text-success' : 'hidden'} />
          Sync with MEGA
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
          “Rite” folder of this MEGA account.
        </div>
      ) : showForm ? (
        <MegaConnectForm onConnected={() => setShowForm(false)} onCancel={() => setShowForm(false)} />
      ) : (
        <div className="mt-1">
          <div className="text-passive-1">Connect a MEGA account to store and sync your encrypted notes.</div>
          <button
            type="button"
            className="mt-2 rounded bg-info px-3 py-1 text-xs font-semibold text-info-contrast"
            onClick={() => setShowForm(true)}
          >
            Connect MEGA
          </button>
        </div>
      )}

      {hint && <div className="mt-2 text-xs text-passive-1">{hint}</div>}
    </div>
  )
}

export default observer(SyncStoragePanel)
