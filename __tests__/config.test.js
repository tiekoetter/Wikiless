describe('Proxy configuration', () => {
  const originalTrustProxy = process.env.TRUST_PROXY

  afterEach(() => {
    if(originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY
    } else {
      process.env.TRUST_PROXY = originalTrustProxy
    }
    jest.resetModules()
  })

  test('trusts the configured inbound reverse proxy by default', () => {
    delete process.env.TRUST_PROXY
    jest.resetModules()

    const config = require('../wikiless.config')

    expect(config.trust_proxy).toBe(true)
    expect(config.trust_proxy_address).toBe(process.env.TRUST_PROXY_ADDRESS || '127.0.0.1')
  })

  test('allows inbound reverse-proxy trust to be disabled', () => {
    process.env.TRUST_PROXY = 'false'
    jest.resetModules()

    expect(require('../wikiless.config').trust_proxy).toBe(false)
  })
})
