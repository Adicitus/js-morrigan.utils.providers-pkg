/**
 * Class containing logic for loading providers and adding them to Morrigan.
 */
 class Providers {

    /**
     * Enumerates and loads providers specified by providersList, adding any exported endpoints to
     * the provided router object.
     * 
     * Providers can be specified using a string, and object or a function:
     *   - A string that should be the name of a module that can be resolved using 'require'.
     *   - A complex type (object/function) with a combination of the following keys:
     *     - name: The name under which this provider will be registered.
     *       If this is provided it overrides the 'name' exported by the module.
     *     - moduleName: The name of a provider module that should be loaded.
     *     - module: Either a string indicating the name of a module to load, or a preloaded module object. 
     * 
     * 
     * Provider should export a 'name' key, otherwise they will be dropped. The name should contain
     * only alphanumeric characters, '-', '_' and '.'.
     * 
     * The 'name' key is used to register the provider internally. If 2 or more providers specify
     * the same name, the provider specified last in the list will be used.
     * 
     * If the intended module does not specify a name (or if you want to use a different name), this can
     * be specified by the provider specification.
     * 
     * Providers may export a 'endpoints' key and a 'version' key. If no 'version' key is exported, then
     * the package version will be used. If no package version can be determined (e.g. the module
     * is pre-loaded) the version will be set to 0.0.0 
     * 
     * Endpoints should be exported as an array of objects with the following fields:
     *  - route: A path to be appended to the (providerSpec + route).
     *  - method: A HTTP method.
     *  - handler: A function to be registered as handler fo the endpoint.
     *  - openapi: A OpenAPI specification for the endpoint path (see https://swagger.io/specification/#path-item-object). This can also be attached directly to the handler.
     *  - security: A middleware function to apply to the endpoint. This overrides any default security middleware set by the environment. To strip any security for the endpoint, set this to null.
     * 
     * @param router Express router to register endpoints on.
     * @param providersList Array of module names that should be loaded as providers.
     * @param environment Core environment
     * @param providers Prepopulated providers list, this object will be returned by the function. This parameter can be safely omitted, in which case a new object will be created.
     * @returns An object mapping provider names to loaded provider modules.
     */
    static async setup (router, providersList, environment, providers) {

        const log = environment.log

        log(`Loading providers...`)

        if (!Array.isArray(providersList)) {
            providersList = [providersList]
        }

        if (!providers) {
            providers = {}
        }

        // Inventory the list of providers and generate a list of normalized provider specifications:
        providersList.forEach(providerSpec => {
            try {
                // Resolve provider module:
                switch (typeof providerSpec) {
                    case "string":
                        log(`Loading provider '${providerSpec}'...`)
                        providerSpec = {
                            moduleName: providerSpec,
                            module: require(providerSpec)
                        }
                        break;
                    case "object":
                    case "function":
                        log(`Reading provider specification: ${JSON.stringify(providerSpec)}`)
                        if (providerSpec.module) {
                            log(`Key 'module' is specified as '${typeof providerSpec.module}'`)
                            if (typeof providerSpec.module == 'string') {
                                log(`'module' key is a string, interpreting as moduleName and attempting to load module '${providerSpec.module}'...`)
                                providerSpec = {
                                    moduleName: providerSpec.module,
                                    module: require(providerSpec.module)
                                }
                            }
                        } else if (providerSpec.moduleName) {
                            log(`'moduleName' key specified, loading provider module '${providerSpec.moduleName}'...`)
                            providerSpec.module = require(providerSpec.moduleName)
                        } else {
                            log(`Provider specification '${providerSpec}' neither specifies moduleName or a preloaded module. Skipping.`)
                            return
                        }
                        break;
                    default:
                        log(`Invalid provider type for provider '${providerSpec}' (found ${typeof providerSpec}, expected 'string', 'function' or 'object')`)
                        return
                }

                let provider = providerSpec.module

                // Verify that the provider publishes a name:
                if (!(providerSpec.name || provider.name)) {
                    log('Neither provider specification or provider module specify a name, skipping...')
                    return
                }

                if (!providerSpec.name && provider.name) {
                    log(`Provider publishes a name, specification does not, using module name ('${provider.name}')`)
                    providerSpec.name = provider.name
                }

                // Verify that the provider name is valid:
                if (! (/[a-zA-Z0-9\-_.]+/.test(provider.name)) ) {
                    log(`Provider name '${provider.name}' is invalid (should only contain alphanumeric characters, -, _ and .), skipping...`)
                    return
                }

                // Resolving version information:
                if (providerSpec.module.version) {
                    providerSpec.version = providerSpec.module.version
                } else if(providerSpec.moduleName) {
                    let mainPath = require.resolve(providerSpec.moduleName)
                    let modulesPath = require.resolve.paths(providerSpec.moduleName).find(v => { let rx = new RegExp('^' + v.replaceAll('\\', '\\\\')); return rx.test(mainPath) } )
                    providerSpec.version = provider.version = require(`${modulesPath}/${providerSpec.moduleName}/package.json`).version
                } else {
                    log(`Provider '${providerSpec.name}' appears to be preloaded, but does no publish version number. Setting version '0.0.0'`)
                    providerSpec.version = "0.0.0"
                }

                if (providerSpec.moduleName) {
                    log(`Registering provider module '${providerSpec.moduleName}' v${providerSpec.version} as '${providerSpec.name}'`)
                } else {
                    log(`Registering anonymous provider module v${providerSpec.version} as '${providerSpec.name}'`)
                }
                providers[providerSpec.name] = provider
            } catch (e) {
                log(`Failed to load provider module '${providerSpec}': ${e}`)
            }
        })

        // Perform setup on the providers and wait for them to finish:
        let promises = []
        for (const p in providers) {
            let provider = providers[p]
            if (provider.setup) {
                promises.push(provider.setup(environment, providers))
            }
        }
        await Promise.all(promises)

        // Perform endpoint registration:
        for (var namespace in providers) {
            let endpoints = providers[namespace].endpoints
            if (endpoints && Array.isArray(endpoints)) {

                log (`Registering endpoints for '${namespace}':`)

                for (var i in endpoints) {
                    let endpoint = endpoints[i]

                    if (!endpoint.route || typeof(endpoint.route) !== 'string' || !endpoint.route.match(/\/([^/]+(\/[^/]+)*)?/) ) {
                        log(`Invalid endpoint route specified: ${endpoint.route}`)
                        continue
                    }

                    if (!endpoint.method || typeof(endpoint.method) !== 'string' || !['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace', 'ws'].includes(endpoint.method)) {
                        log(`Invalid endpoint method specified: ${endpoint.method}`)
                        continue
                    }

                    if (!endpoint.handler || typeof(endpoint.handler) !== 'function') {
                        log(`Invalid endpoint handler specified: ${endpoint.handler}`)
                        continue
                    }

                    let route = `/${namespace}${endpoint.route}`

                    log(`${endpoint.method.toUpperCase().padStart(7, ' ')} ${route}`)

                    // Exception for WebSocket connection endpoints, since wrapping the handler does not seem to work.
                    if (endpoint.method === 'ws') {
                        router.ws(route, endpoint.handler)
                        continue
                    }

                    // Create a new anonmyous wrapper for the handler:
                    let handler = (...args) => {
                        try {
                            endpoint.handler(...args)
                        } catch (e) {
                            e._traceId = Math.random().toString(16).split('.')[1].toString()
                            log(`An unexpected error occurred while accessing ${route} from ${req.connection.remoteAddress} (trace ID: ${e._traceId}): ${e.message}`, 'error')
                            log(JSON.stringify(e), 'debug')
                        }
                    }

                    if (endpoint.openapi) {
                        // Attach the openapi declaration to the handler:
                        handler.openapi = endpoint.openapi
                    }

                    let handlers = [handler]

                    // Check if we have default security middleware to apply:
                    let security = environment.security
                    // Check if the endpoint declaration provides it's own security middleware, if so use it:
                    if (endpoint.security || endpoint.security === null) {
                        security = endpoint.security
                    }
                    // Only apply security middleware if declared by either the endpoint or environment:
                    if (security) {
                        handlers.unshift(security)
                    }

                    // Apply the endpoint handler:
                    router[endpoint.method](route, handlers)
                }
            }
        }

        return providers
    }
}

module.exports = Providers