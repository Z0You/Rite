import { useCallback, useEffect, useMemo, useState } from 'react'
import { ServerType } from './ServerType'
import DecoratedInput from '@/Components/Input/DecoratedInput'
import Icon from '@/Components/Icon/Icon'
import { useApplication } from '@/Components/ApplicationProvider'
import { isDesktopApplication } from '@/Utils'
import RadioButtonGroup from '@/Components/RadioButtonGroup/RadioButtonGroup'
import { getStorageProviders, providerForHost } from '@/Rite/RiteSync'
import { c } from 'ttag'

type Props = {
  className?: string
}

const ServerPicker = ({ className }: Props) => {
  const application = useApplication()

  const [currentType, setCurrentType] = useState<ServerType>('mega')
  const { server, setServer } = application.accountMenuController
  const [customServer, setCustomServer] = useState(providerForHost(server) ? '' : server)

  const determineServerType = useCallback(async () => {
    const homeServerUrl = await application.homeServer?.getHomeServerUrl()
    if (homeServerUrl && server === homeServerUrl) {
      setCurrentType('home server')
    } else if (providerForHost(server)) {
      setCurrentType(providerForHost(server)?.id as ServerType)
    } else {
      setCurrentType('custom')
    }
  }, [application.homeServer, server])

  const handleSyncServerChange = useCallback(
    (server: string, websocketUrl?: string) => {
      setServer(server)
      void determineServerType()
      application.setCustomHost(server, websocketUrl).catch(console.error)
    },
    [application, setServer, determineServerType],
  )

  useEffect(() => {
    void determineServerType()
  }, [application, server, determineServerType])

  const selectTab = async (type: ServerType) => {
    setCurrentType(type)
    const provider = getStorageProviders().find((candidate) => candidate.id === type)
    if (provider) {
      handleSyncServerChange(provider.host, '')
    } else if (type === 'custom') {
      // Keep the last custom address typed; never fall back to a third party's server.
      if (customServer) {
        handleSyncServerChange(customServer)
      }
    } else if (type === 'home server') {
      if (!application.homeServer) {
        application.alerts
          .alert(
            c('B1.Account.SignIn.Error')
              .t`Home server is not running. Please open the prefences and home server tab to start it.`,
          )
          .catch(console.error)

        return
      }

      const homeServerUrl = await application.homeServer.getHomeServerUrl()
      if (!homeServerUrl) {
        application.alerts
          .alert(
            c('B1.Account.SignIn.Error')
              .t`Home server is not running. Please open the prefences and home server tab to start it.`,
          )
          .catch(console.error)

        return
      }

      handleSyncServerChange(homeServerUrl)
    }
  }

  const options = useMemo(
    () =>
      [
        ...getStorageProviders().map((provider) => ({ label: provider.name, value: provider.id })),
        { label: c('B1.Account.SignIn.Option').t`Custom server`, value: 'custom' },
      ].concat(
        isDesktopApplication() ? [{ label: c('B1.Account.SignIn.Option').t`Home Server`, value: 'home server' }] : [],
      ) as {
        label: string
        value: ServerType
      }[],
    [],
  )

  return (
    <div className={`flex h-full flex-grow flex-col px-3 pb-1.5 ${className}`}>
      <div className="mb-2 flex font-bold">{c('B1.Account.SignIn.Label').t`Sync Server`}</div>
      <RadioButtonGroup value={currentType} items={options} onChange={selectTab} />
      {currentType === 'custom' && (
        <>
          <DecoratedInput
            className={{
              container: 'mt-1',
            }}
            type="text"
            left={[<Icon type="server" className="text-neutral" />]}
            placeholder="https://notes.example.com"
            value={customServer}
            onChange={(value: string) => {
              setCustomServer(value)
              handleSyncServerChange(value)
            }}
          />
          <div className="mt-1 text-xs text-passive-1">
            Any server compatible with the Standard Notes sync protocol, such as one you host yourself.
          </div>
        </>
      )}
    </div>
  )
}

export default ServerPicker
