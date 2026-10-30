import { FormEvent, FunctionComponent, useCallback, useState } from 'react'
import Button from '@/Components/Button/Button'
import DecoratedInput from '@/Components/Input/DecoratedInput'
import DecoratedPasswordInput from '@/Components/Input/DecoratedPasswordInput'
import Icon from '@/Components/Icon/Icon'
import { StorageProvider } from '../RiteSync'

type Props = {
  provider: StorageProvider
  onConnected?: () => void
  onCancel?: () => void
}

/**
 * Connects the user's MEGA or Filen account. Its password is used once to open a session and
 * is never stored; only the service's session stays on this device.
 */
const StorageConnectForm: FunctionComponent<Props> = ({ provider, onConnected, onCancel }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()
      if (!email || !password) {
        setError(`Enter your ${provider.name} email and password.`)
        return
      }
      setBusy(true)
      setError(undefined)
      try {
        await provider.account.connect(email, password, needsCode ? code : undefined)
        setPassword('')
        onConnected?.()
      } catch (connectError) {
        const message = connectError instanceof Error ? connectError.message : String(connectError)
        if (message.includes('two-factor')) {
          setNeedsCode(true)
        }
        setError(message)
      } finally {
        setBusy(false)
      }
    },
    [email, password, code, needsCode, onConnected, provider],
  )

  return (
    <form onSubmit={submit} className="mt-2">
      <DecoratedInput
        className={{ container: 'mb-2' }}
        left={[<Icon type="email" className="text-neutral" />]}
        type="email"
        placeholder={`${provider.name} email`}
        value={email}
        onChange={setEmail}
        disabled={busy}
        spellcheck={false}
      />
      <DecoratedPasswordInput
        className={{ container: 'mb-2' }}
        left={[<Icon type="password" className="text-neutral" />]}
        placeholder={`${provider.name} password`}
        value={password}
        onChange={setPassword}
        disabled={busy}
      />
      {needsCode && (
        <DecoratedInput
          className={{ container: 'mb-2' }}
          left={[<Icon type="security" className="text-neutral" />]}
          type="text"
          placeholder={`6-digit ${provider.name} 2FA code`}
          value={code}
          onChange={setCode}
          disabled={busy}
          autocomplete={false}
        />
      )}
      {error && <div className="mb-2 text-sm text-danger">{error}</div>}
      <div className="flex gap-2">
        <Button
          primary
          small
          label={busy ? 'Connecting…' : `Connect ${provider.name}`}
          onClick={submit}
          disabled={busy}
        />
        {onCancel && <Button small label="Cancel" onClick={onCancel} disabled={busy} />}
      </div>
      <p className="mt-2 text-xs text-passive-1">
        Your {provider.name} password is only used to sign in to {provider.name} and is not saved. Notes are encrypted on
        this device before they are uploaded.
      </p>
    </form>
  )
}

export default StorageConnectForm
