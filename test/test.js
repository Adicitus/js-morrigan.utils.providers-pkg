const assert = require('assert')
const express = require('express')
const expressws = require('express-ws')
const http = require('http')
const Providers = require('../Providers')
const StateStore = require('@adicitus/morrigan.utils.statestore')

const app = express()
expressws(app)

Providers.enableDefaultLogger = false

let env = {
    log: () => { /* NOOP */ },
    router: express.Router()
}

app.use('/debug', env.router)

let debugOpenapi = { description: "Test handler" }
let debugHandler = ( req, res ) => {}
let debugSecurity = ( req, res, next ) => {}

function debugProviderBasic() {
    this.name = 'debugBasic'

    this.version = '1.0.0'

    this.setup = (environment, providers) => {
        this.environment = environment
        this.providers = providers
    }
}


function debugProviderEndpoints() {

    this.prototype = debugProviderBasic

    this.name = 'debugEndpoints'

    this.version = '1.0.0'

    this.setup = (environment, providers) => {
        this.environment = environment
        this.providers = providers
    }

    this.endpoints = []

    http.METHODS.concat(['ws']).forEach(m => {
        this.endpoints.push({ route: '/', method: m.toLowerCase(), security: debugSecurity,  handler: debugHandler, openapi: { get: debugOpenapi }})
    })


}


describe('morrigan.utils.providers', () => {

    before(async () => {
        let rootStore = await StateStore('./data/state')
        env.state = await rootStore.getStore('test', 'delegate')
    })

    describe('setup', () => {

        describe("Signature", () => {

            describe("Parameters", () => {

                it("Should allow calls without parameters", () => {
                    Providers.setup()
                })

                it("Should allow calls with 'providerSpecs' only", () => {
                    Providers.setup([])
                })

                it("Should allow caller to omit the 'providers' parameter", () => {
                    Providers.setup([], env)
                })

                it("Should allow caller to specify all 3 parameters", () => {
                    Providers.setup([], env, {})
                })
            })

            describe("Return values", () => { 
                it("Should return a Promise.", () => {
                    assert.equal(Providers.setup([], env).toString(), '[object Promise]')
                })

                it("Should resolve to a new empty object if providersList is empty.", async () => {
                    let providers = await Providers.setup([], env)
                    assert.ok(providers.toString(), '[object]')
                    assert.equal(Object.keys(providers).length, 0)
                })

                it("Should return the original 'providers' object if provided.", async () => {
                    let loadedProviders = { debug: new debugProviderBasic() }
                    let providers = await Providers.setup([], env, loadedProviders)
                    assert.equal(loadedProviders, providers)
                })
            })
        })

        describe("Behavior", () => {
            
            describe("Side effects", () => {

                it("Should update the 'providers' with new providers if specs are provided.", async () => {
                    let loadedProviders = {}
                    let specs = [{ module: new debugProviderBasic() }]
                    let providers = await Providers.setup(specs, env, loadedProviders)
                    assert.equal(loadedProviders, providers)
                    assert.equal(loadedProviders.debugBasic, providers.debugBasic)
                    assert.ok(providers.debugBasic)
                })

                describe("environment", () => {

                    describe("Default behavior, if no 'environment' object is provided by the caller", () => {

                        it("Should generate a new default environment object if not provided by the caller.", async () => {
                            let specs = [{ module: new debugProviderBasic() }]
                            let providers = await Providers.setup(specs)
                            assert.ok(providers.debugBasic.environment)
                            assert.equal(providers.debugBasic.environment.toString(), '[object Object]')
                        })

                        it("Should add Providers.defaultLogger as 'log' property on the default environment object.", async() => {
                            let specs = [{ module: new debugProviderBasic() }]
                            let providers = await Providers.setup(specs)
                            assert.ok(providers.debugBasic.environment.log)
                            assert.equal(typeof providers.debugBasic.environment.log, 'function')
                            assert.equal(providers.debugBasic.environment.log, Providers.defaultLogger)
                        })

                        it("Should generate a new Expressjs Router as 'router' property on the default environment object.", async() => {
                            let specs = [{ module: new debugProviderBasic() }]
                            let providers = await Providers.setup(specs)
                            assert.ok(providers.debugBasic.environment.router)
                            assert.equal(typeof providers.debugBasic.environment.router, 'function')
                        })
                    })

                    describe("Custom behavior", () => {

                        it("Should generate a copy of the environment object for each provider, if one is provided by the caller.", async () => {
                            let specs = [{ module: new debugProviderBasic() }]
                            let providers = await Providers.setup(specs, env)
                            assert.notEqual(providers.debugBasic.environment, env)
                            assert.equal(providers.debugBasic.environment.log, env.log)
                        })

                        it("Should generate a new Expressjs Router for each provider", async () => {
                            let specs = [{ module: new debugProviderBasic() }]
                            let providers = await Providers.setup(specs)
                            assert.ok(providers.debugBasic.environment.router)
                            assert.notEqual(providers.debugBasic.environment.router, env.router)
                        })

                        it("If given a 'delegate' StateStore object, Should generate a StateStore object for each provider and pass it as 'environment.state'", async () => {
                            let specs = [
                                { name: 'provider1', module: new debugProviderBasic() }
                            ]
                            let providers = await Providers.setup(specs, env)
                            assert.ok(providers.provider1.environment.state)
                        })

                        it("Should generate 'simple' StateStore objects", async () => {
                            let specs = [
                                { name: 'provider1', module: new debugProviderBasic() }
                            ]
                            let providers = await Providers.setup(specs, env)
                            assert.ok(providers.provider1.environment.state)
                            let state1 = providers.provider1.environment.state
                            assert.ok(state1.set)
                            assert.ok(state1.get)
                            assert.ok(state1.remove)
                            assert.equal(state1.storage, undefined)
                            assert.equal(state1.getStore, undefined)
                        })

                        it("Should generate a unique StateStore object for each provider", async () => {
                            let specs = [
                                { name: 'provider1', module: new debugProviderBasic() },
                                { name: 'provider2', module: new debugProviderBasic() }
                            ]
                            let providers = await Providers.setup(specs, env)
                            assert.ok(providers.provider1.environment.state)
                            assert.ok(providers.provider2.environment.state)

                            assert.notDeepEqual(providers.provider1.environment.state, providers.provider2.environment.state)

                            let v1 = Math.random().toString(16).split('.')[1]
                            await providers.provider1.environment.state.set('v', v1)
                            let v2 = await providers.provider2.environment.state.get('v')
                            assert.notDeepEqual(v1, v2)

                        })
                    })
                })
            })

            describe("ProviderSpecs", () => {

                it("Should add a default version '0.0.0' if the provider is pre-loaded and does not specify a version.", async () => {
                    let provider = new debugProviderBasic()
                    delete provider.version
                    let providers = await Providers.setup([{module: provider}])
                    assert.equal(provider.version, '0.0.0')
                })

                it("Should prefer providerSpec name over provider name", async () => {
                    let specs = [{name: 'debug1', module: new debugProviderBasic()}]
                    let providers = await Providers.setup(specs, env, {})
                    assert.ok(providers)
                    assert.ok(providers.debug1)
                })

                it("Should ignore any provider spec where neither the spec or the provider declares a name.", async () => {
                    let module = new debugProviderBasic()
                    delete(module.name)
                    let specs = [{ module }]
                    let providers = await Providers.setup(specs, env)
                    assert.ok(providers)
                    assert.equal(Object.keys(providers).length, 0)
                })

                it("Should mount any endpoints declared by the provider on its router.", async () => {
                    let specs = [{ module: new debugProviderEndpoints() }]
                    let providers = await Providers.setup(specs, env)
                    assert.ok(providers.debugEndpoints.environment.router)
                    http.METHODS.concat(['ws']).forEach(method => {
                        let endpoint = null
                        switch(method) {
                            case 'ws': 
                                endpoint = providers.debugEndpoints.environment.router.stack.filter(layer => {
                                    if (!layer.route.path.match(/\.websocket$/)){ return false }
                                    return layer.route.methods.get
                                })
                                break
                            default:
                                endpoint = providers.debugEndpoints.environment.router.stack.filter(layer => {
                                    return layer.route.methods[method.toLowerCase()] && !layer.route.path.match(/\.websocket$/)
                                })
                                assert.equal(endpoint.length, 1, `Missing handler for endpoint method '${method}'`)
                        }

                        assert.equal(endpoint.length, 1, `Missing handler for endpoint method '${method}'`)
                    })
                })

                it("Should attach OpenAPI (.openapi) specs to each handler if specified in the endpoint declaration (excluding 'ws', where this is unsupported)", async () => {
                    let specs = [{ module: new debugProviderEndpoints() }]
                    let providers = await Providers.setup(specs, env)
                    assert.ok(providers.debugEndpoints.environment.router)
                    http.METHODS.forEach(method => {
                        let endpoint = providers.debugEndpoints.environment.router.stack.filter(layer => {
                            return layer.route.methods[method.toLowerCase()] && !layer.route.path.match(/\.websocket$/)
                        })

                        let handler = endpoint.map(layer => {
                            return layer.route.stack.filter(handler => {
                                return handler.handle.openapi
                            })
                        })[0]
                        
                        assert.equal(handler.length, 1, `Missing OpenAPI spec for endpoint method '${method}'`)
                    })
                })

                it("Should mount provider endpoints under providerSpec name if one is provided, and provider name otherwise.", async () => {
                    let specs = [
                        { module: new debugProviderEndpoints() },
                        { module: new debugProviderEndpoints(), name: 'providerSpecTest' }
                    ]
                    let providers = await Providers.setup(specs, env)

                    assert.ok(providers.debugEndpoints.environment.router)
                    assert.deepEqual(providers.debugEndpoints.environment.router._morrigan.route, `/debugEndpoints`)         

                    assert.ok(providers.providerSpecTest.environment.router)
                    assert.deepEqual(providers.providerSpecTest.environment.router._morrigan.route, `/providerSpecTest`)
                })
            })
        })

    })
})
