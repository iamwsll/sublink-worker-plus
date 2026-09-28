/**
 * @typedef {Object} KeyValueStore
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * @typedef {(request: Request) => Promise<Response>} AssetFetcher
 */

/**
 * @typedef {Object} RuntimeConfig
 * @property {number} [configTtlSeconds]
 * @property {number} [shortLinkTtlSeconds]
 * @property {number} [clashRuleBaseCacheTtlSeconds]
 * @property {string | null} [adminPassword]
 */

/**
 * @typedef {Object} RuntimeBindings
 * @property {KeyValueStore | null} [kv]
 * @property {AssetFetcher | null} [assetFetcher]
 * @property {Console} [logger]
 * @property {RuntimeConfig} [config]
 */

const DEFAULTS = {
    configTtlSeconds: 60 * 60 * 24 * 30,
    // Remote Clash base configs change rarely, but operators need a refresh path.
    clashRuleBaseCacheTtlSeconds: 600
};

/**
 * Normalize optional runtime bindings and provide safe defaults.
 *
 * @param {RuntimeBindings | undefined} runtime
 * @returns {{ kv: KeyValueStore | null, assetFetcher: AssetFetcher | null, logger: Console, config: RuntimeConfig & { configTtlSeconds: number, shortLinkTtlSeconds: number | null } }}
 */
export function normalizeRuntime(runtime = {}) {
    return {
        kv: runtime.kv ?? null,
        assetFetcher: runtime.assetFetcher ?? null,
        logger: runtime.logger ?? console,
        config: {
            configTtlSeconds: runtime.config?.configTtlSeconds ?? DEFAULTS.configTtlSeconds,
            shortLinkTtlSeconds: runtime.config?.shortLinkTtlSeconds ?? null,
            clashRuleBaseCacheTtlSeconds: runtime.config?.clashRuleBaseCacheTtlSeconds ?? DEFAULTS.clashRuleBaseCacheTtlSeconds,
            adminPassword: runtime.config?.adminPassword ?? null
        }
    };
}
