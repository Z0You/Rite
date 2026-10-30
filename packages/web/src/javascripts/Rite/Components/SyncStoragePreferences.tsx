import { observer } from 'mobx-react-lite'
import { FunctionComponent, useCallback, useState } from 'react'
import { SyncQueueStrategy } from '@standardnotes/snjs'
import { Subtitle, Text, Title } from '@/Components/Preferences/PreferencesComponents/Content'
import PreferencesGroup from '@/Components/Preferences/PreferencesComponents/PreferencesGroup'
import PreferencesSegment from '@/Components/Preferences/PreferencesComponents/PreferencesSegment'
import HorizontalSeparator from '@/Components/Shared/HorizontalSeparator'
import Button from '@/Components/Button/Button'
import { WebApplication } from '@/Application/WebApplication'
import StorageConnectForm from './StorageConnectForm'
import { useStorageConnection } from './SyncStoragePanel'
import { getStorageProviders, providerForHost, StorageProvider } from '../RiteSync'
import { moveVault } from '../MoveVault'

type Props = {
  application: WebApplication
}

/**
 * Preferences → Account → Sync storage: shows where this account's notes are kept, and moves
 * them to another storage service (MEGA ⇄ Filen) without losing anything.
 */
const SyncStoragePreferences: FunctionComponent<Props> = ({ application }) => {
  const [host, setHost] = useState(() => application.getHost.execute().getValue())
  const [lastMove, setLastMove] = useState<string>()
  const current = providerForHost(host)
  const { email, isConnected } = useStorageConnection(current)

  if (!current) {
    return null
  }

  return (
    <PreferencesGroup>
      <PreferencesSegment>
        <Title>Sync storage</Title>
        <Text>
          Your encrypted notes are kept in the “Rite” folder of your <strong>{current.name}</strong> account
          {isConnected ? (
            <>
              {' '}
              (<span className="font-medium">{email}</span>).
            </>
          ) : (
            '. It is not connected on this device, so syncing is paused.'
          )}
        </Text>
        {!isConnected && (
          <div className="mt-2">
            <StorageConnectForm provider={current} />
          </div>
        )}
        {lastMove && <div className="mt-2 text-sm text-success">{lastMove}</div>}
      </PreferencesSegment>

      {getStorageProviders()
        .filter((provider) => provider.id !== current.id)
        .map((target) => (
          <div key={target.id}>
            <HorizontalSeparator classes="my-4" />
            <MoveSection
              application={application}
              from={current}
              to={target}
              canMove={isConnected}
              onMoved={(text) => {
                setLastMove(text)
                setHost(target.host)
              }}
            />
          </div>
        ))}
    </PreferencesGroup>
  )
}

const MoveSection: FunctionComponent<{
  application: WebApplication
  from: StorageProvider
  to: StorageProvider
  canMove: boolean
  onMoved: (message: string) => void
}> = observer(({ application, from, to, canMove, onMoved }) => {
  const { isConnected } = useStorageConnection(to)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()

  const move = useCallback(async () => {
    const confirmed = await application.alerts.confirm(
      `All your notes will be copied to ${to.name} and this device will sync with ${to.name} from now on. ` +
        `The copy in ${from.name} is kept as a backup. Other devices will be asked to switch too.`,
      `Move to ${to.name}?`,
      `Move to ${to.name}`,
    )
    if (!confirmed) {
      return
    }

    setBusy(true)
    setMessage(undefined)
    try {
      // Send any pending edits to the current storage first, so the copy is complete.
      await application.sync.sync({ queueStrategy: SyncQueueStrategy.ForceSpawnNew, awaitAll: true })

      const result = await moveVault({ from: from.createStorage(), to: to.createStorage(), toHost: to.host })

      application.accountMenuController.setServer(to.host)
      await application.setCustomHost(to.host, '')
      await application.sync.sync({ queueStrategy: SyncQueueStrategy.ForceSpawnNew, awaitAll: true })

      const count = result.movedNotes
      onMoved(
        `Done. ${count} note${count === 1 ? '' : 's'} moved from ${from.name}; this device now syncs with ${to.name}.` +
          (result.merged ? ` Notes already in ${to.name} were combined with them.` : ''),
      )
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [application, from, to])

  return (
    <PreferencesSegment>
      <Subtitle>Move to {to.name}</Subtitle>
      <Text>
        Copies all your notes to your {to.name} account and switches this device to it. Nothing is deleted from{' '}
        {from.name}. If you already moved from another device, this switches this device over too.
      </Text>

      {!isConnected ? (
        <div className="mt-2">
          <Text>First connect your {to.name} account:</Text>
          <StorageConnectForm provider={to} />
        </div>
      ) : (
        <Button
          className="mt-3"
          primary
          label={busy ? 'Moving…' : `Move to ${to.name}`}
          disabled={busy || !canMove}
          onClick={() => void move()}
        />
      )}

      {message && <div className={`mt-2 text-sm ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</div>}
    </PreferencesSegment>
  )
})

export default observer(SyncStoragePreferences)
