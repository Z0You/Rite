import { FunctionComponent, useEffect, useState } from 'react'
import { ApplicationEvent, onRiteStorageProblem, RiteStorageProblem } from '@standardnotes/snjs'
import Icon from '@/Components/Icon/Icon'
import { useApplication } from '@/Components/ApplicationProvider'

/** How long a dismissed notice stays hidden if the same problem keeps happening. */
const SnoozeMs = 10 * 60 * 1000

/**
 * A banner shown when MEGA or Filen needs to be connected again (session ended, wrong account…),
 * with a button to the place where that is fixed. Syncing simply pauses meanwhile; notes stay
 * on the device.
 */
const StorageProblemNotice: FunctionComponent = () => {
  const application = useApplication()
  const [problem, setProblem] = useState<RiteStorageProblem>()
  const [snoozedUntil, setSnoozedUntil] = useState(0)

  useEffect(() => onRiteStorageProblem(setProblem), [])

  useEffect(() => {
    if (!problem) {
      return
    }
    // Clear the banner once syncing works again.
    return application.addEventObserver(async (event) => {
      if (event === ApplicationEvent.CompletedFullSync) {
        setProblem(undefined)
      }
    })
  }, [application, problem])

  if (!problem || Date.now() < snoozedUntil) {
    return null
  }

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-3 z-modal flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-warning bg-default px-4 py-3 text-sm shadow-lg"
    >
      <Icon type="cloud-off" className="mt-0.5 flex-shrink-0 text-warning" />
      <div className="flex-grow">
        <div className="font-semibold">Syncing with {problem.displayName} is paused</div>
        <div className="mt-0.5 text-passive-0">{problem.message} Your notes are safe on this device.</div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded bg-info px-3 py-1 text-xs font-semibold text-info-contrast"
            onClick={() => {
              setProblem(undefined)
              application.preferencesController.openPreferences('account')
            }}
          >
            Reconnect {problem.displayName}
          </button>
          <button
            type="button"
            className="rounded border border-border px-3 py-1 text-xs"
            onClick={() => setSnoozedUntil(Date.now() + SnoozeMs)}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}

export default StorageProblemNotice
