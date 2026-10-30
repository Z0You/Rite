import { FunctionComponent, useCallback, useState } from 'react'
import { useApplication } from '@/Components/ApplicationProvider'
import { copyTextToClipboard } from '@/Utils/copyTextToClipboard'
import { StorageProvider } from '../RiteSync'
import { DeviceAccount, diagnoseStorage } from '../Diagnostics'

/**
 * "Check connection": reads the storage the way syncing does and shows what Rite finds there,
 * with a button to copy the report. Contains no passwords, tokens or note contents.
 */
const CheckConnection: FunctionComponent<{ provider: StorageProvider }> = ({ provider }) => {
  const application = useApplication()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string>()
  const [copied, setCopied] = useState(false)

  const run = useCallback(async () => {
    setBusy(true)
    setCopied(false)
    try {
      const user = application.sessions.getUser()
      const session = application.legacyApi.getSession() as { accessToken?: { value?: string } } | null
      const device: DeviceAccount = {
        email: user?.email,
        userUuid: user?.uuid,
        accessToken: session?.accessToken?.value,
      }
      const lines = await diagnoseStorage(provider, device)
      setReport(lines.join('\n'))
    } catch (error) {
      setReport(`Check failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [application, provider])

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs text-info hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Checking…' : 'Check connection'}
      </button>
      {report && (
        <div className="mt-1">
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border bg-default p-2 text-xs">
            {report}
          </pre>
          <button
            type="button"
            className="mt-1 rounded bg-info px-3 py-1 text-xs font-semibold text-info-contrast"
            onClick={() => {
              copyTextToClipboard(report)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy report'}
          </button>
        </div>
      )}
    </div>
  )
}

export default CheckConnection
