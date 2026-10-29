import { Result } from '@standardnotes/domain-core'

import { GetHost } from '../..'
import { IsApplicationUsingThirdPartyHost } from './IsApplicationUsingThirdPartyHost'

describe('IsApplicationUsingThirdPartyHost', () => {
  let getHostUseCase: GetHost

  const createUseCase = () => new IsApplicationUsingThirdPartyHost(getHostUseCase)

  beforeEach(() => {
    getHostUseCase = {} as jest.Mocked<GetHost>
    getHostUseCase.execute = jest.fn().mockReturnValue(Result.ok('https://api.standardnotes.com'))
  })

  it('returns true if host is localhost', () => {
    getHostUseCase.execute = jest.fn().mockReturnValue(Result.ok('http://localhost:3000'))

    const useCase = createUseCase()
    const result = useCase.execute()

    expect(result.getValue()).toBe(true)
  })

  it('returns true (third party) for api.standardnotes.com: Rite has no hosted first-party service', () => {
    getHostUseCase.execute = jest.fn().mockReturnValue(Result.ok('https://api.standardnotes.com'))

    const useCase = createUseCase()
    const result = useCase.execute()

    expect(result.getValue()).toBe(true)
  })

  it('returns true (third party) for sync.standardnotes.org: Rite has no hosted first-party service', () => {
    getHostUseCase.execute = jest.fn().mockReturnValue(Result.ok('https://sync.standardnotes.org'))

    const useCase = createUseCase()
    const result = useCase.execute()

    expect(result.getValue()).toBe(true)
  })

  it('returns true (third party) for files.standardnotes.com: Rite has no hosted first-party service', () => {
    getHostUseCase.execute = jest.fn().mockReturnValue(Result.ok('https://files.standardnotes.com'))

    const useCase = createUseCase()
    const result = useCase.execute()

    expect(result.getValue()).toBe(true)
  })

  it('returns true if host is not first party', () => {
    getHostUseCase.execute = jest.fn().mockReturnValue(Result.ok('https://example.com'))

    const useCase = createUseCase()
    const result = useCase.execute()

    expect(result.getValue()).toBe(true)
  })
})
