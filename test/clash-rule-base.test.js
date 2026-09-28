import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    DEFAULT_CLASH_RULE_BASE_CACHE_TTL_SECONDS,
    normalizeClashRuleBaseCacheTtl,
    resolveClashRuleBaseConfig,
    fetchClashRuleBaseConfig
} from '../src/services/clashRuleBaseCache.js';
import { InvalidConfigError } from '../src/services/errors.js';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

// Each test uses its own URL: the in-memory cache is module-global and keyed by URL,
// so reusing one URL across tests would leak cached entries between them.
const stubFetchText = (text, { ok = true, status = 200 } = {}) => {
    const fetchMock = vi.fn(async () => ({ ok, status, text: async () => text }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('normalizeClashRuleBaseCacheTtl', () => {
    it('falls back to 600 for non-numeric and negative values', () => {
        expect(normalizeClashRuleBaseCacheTtl(undefined)).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl(null)).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl('abc')).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl('')).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl({})).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl(-1)).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl(-1e9)).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl(NaN)).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl(Infinity)).toBe(600);
    });

    it('keeps 0 so callers can disable caching', () => {
        expect(normalizeClashRuleBaseCacheTtl(0)).toBe(0);
        expect(normalizeClashRuleBaseCacheTtl('0')).toBe(0);
    });

    it('parses numeric strings and truncates fractions', () => {
        expect(normalizeClashRuleBaseCacheTtl('120')).toBe(120);
        expect(normalizeClashRuleBaseCacheTtl('120s')).toBe(120);
        expect(normalizeClashRuleBaseCacheTtl(30.9)).toBe(30);
    });

    it('clamps at 86400 and honours a custom fallback', () => {
        expect(normalizeClashRuleBaseCacheTtl(86400)).toBe(86400);
        expect(normalizeClashRuleBaseCacheTtl(86401)).toBe(86400);
        expect(normalizeClashRuleBaseCacheTtl(1e9)).toBe(86400);
        expect(normalizeClashRuleBaseCacheTtl('99999')).toBe(86400);

        expect(normalizeClashRuleBaseCacheTtl(undefined, 30)).toBe(30);
        expect(normalizeClashRuleBaseCacheTtl('junk', 30)).toBe(600);
        expect(normalizeClashRuleBaseCacheTtl(0, 30)).toBe(0);
    });

    it('exposes the documented default constant', () => {
        expect(DEFAULT_CLASH_RULE_BASE_CACHE_TTL_SECONDS).toBe(600);
    });
});

describe('fetchClashRuleBaseConfig', () => {
    it('returns the parsed YAML object', async () => {
        const fetchMock = stubFetchText('mode: rule\nproxy-groups: []\n');
        const result = await fetchClashRuleBaseConfig('https://rules.test/a.yml', 'subconverter/1.0');

        expect(result).toEqual({ mode: 'rule', 'proxy-groups': [] });
        expect(fetchMock).toHaveBeenCalledWith('https://rules.test/a.yml', {
            headers: { 'User-Agent': 'subconverter/1.0' }
        });
    });

    it('falls back to the curl user agent when none is given', async () => {
        const fetchMock = stubFetchText('mode: rule');
        await fetchClashRuleBaseConfig('https://rules.test/no-ua.yml');

        expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe('curl/7.74.0');
    });

    it('trims the URL before fetching', async () => {
        const fetchMock = stubFetchText('mode: rule');
        await fetchClashRuleBaseConfig('  https://rules.test/trimmed.yml  ');

        expect(fetchMock.mock.calls[0][0]).toBe('https://rules.test/trimmed.yml');
    });

    it('rejects non-string, empty, blank and newline-bearing URLs', async () => {
        const fetchMock = stubFetchText('mode: rule');

        for (const bad of [undefined, null, 42, {}, [], '', '   ', '\n', 'https://a.test/x.yml\nX-Injected: 1']) {
            await expect(fetchClashRuleBaseConfig(bad)).rejects.toBeInstanceOf(InvalidConfigError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('only rejects newlines that survive trimming', async () => {
        const fetchMock = stubFetchText('mode: rule');

        // Surrounding whitespace is stripped, so a leading newline is not an injection.
        await fetchClashRuleBaseConfig('  \n https://rules.test/wrapped.yml  ');
        expect(fetchMock.mock.calls[0][0]).toBe('https://rules.test/wrapped.yml');

        // An interior newline survives trimming and must be rejected.
        await expect(fetchClashRuleBaseConfig('  https://rules.test/x.yml\nX-Injected: 1'))
            .rejects.toBeInstanceOf(InvalidConfigError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws InvalidConfigError on a non-2xx response', async () => {
        stubFetchText('', { ok: false, status: 404 });
        const error = await fetchClashRuleBaseConfig('https://rules.test/missing.yml').catch(err => err);

        expect(error).toBeInstanceOf(InvalidConfigError);
        expect(error.status).toBe(400);
        expect(error.message).toContain('404');
    });

    it('throws when the YAML payload is not a mapping', async () => {
        stubFetchText('just a scalar');
        await expect(fetchClashRuleBaseConfig('https://rules.test/scalar.yml')).rejects.toThrow(/must be a Clash YAML object/);

        stubFetchText('- a\n- b');
        await expect(fetchClashRuleBaseConfig('https://rules.test/array.yml')).rejects.toThrow(/must be a Clash YAML object/);

        stubFetchText('');
        await expect(fetchClashRuleBaseConfig('https://rules.test/empty.yml')).rejects.toThrow(/must be a Clash YAML object/);
    });
});

describe('resolveClashRuleBaseConfig', () => {
    it('fetches once and serves the second call from KV', async () => {
        const fetchMock = stubFetchText('mode: rule');
        const kv = new MemoryKVAdapter();
        const getSpy = vi.spyOn(kv, 'get');
        const putSpy = vi.spyOn(kv, 'put');

        const first = await resolveClashRuleBaseConfig({ url: 'https://kv-hit.test/a.yml', kv, cacheTtlSeconds: 600 });
        const second = await resolveClashRuleBaseConfig({ url: 'https://kv-hit.test/a.yml', kv, cacheTtlSeconds: 600 });

        expect(first).toEqual({ mode: 'rule' });
        expect(second).toEqual({ mode: 'rule' });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const cacheKey = putSpy.mock.calls[0][0];
        expect(cacheKey).toMatch(/^clash-rule-base:/);
        expect(putSpy).toHaveBeenCalledWith(cacheKey, JSON.stringify({ config: { mode: 'rule' } }), { expirationTtl: 600 });
        // The second call must consult the cache key written by the first one.
        expect(getSpy).toHaveBeenLastCalledWith(cacheKey);
    });

    it('bypasses the cache when refresh is true and rewrites it', async () => {
        const fetchMock = stubFetchText('mode: rule');
        const kv = new MemoryKVAdapter();
        const putSpy = vi.spyOn(kv, 'put');
        const getSpy = vi.spyOn(kv, 'get');

        await resolveClashRuleBaseConfig({ url: 'https://kv-refresh.test/a.yml', kv });
        await resolveClashRuleBaseConfig({ url: 'https://kv-refresh.test/a.yml', kv, refresh: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(putSpy).toHaveBeenCalledTimes(2);
        // refresh skips the read entirely.
        expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('disables both cache read and write when the TTL is 0', async () => {
        const fetchMock = stubFetchText('mode: rule');
        const kv = new MemoryKVAdapter();
        const getSpy = vi.spyOn(kv, 'get');
        const putSpy = vi.spyOn(kv, 'put');

        await resolveClashRuleBaseConfig({ url: 'https://kv-ttl0.test/a.yml', kv, cacheTtlSeconds: 0 });
        await resolveClashRuleBaseConfig({ url: 'https://kv-ttl0.test/a.yml', kv, cacheTtlSeconds: 0 });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getSpy).not.toHaveBeenCalled();
        expect(putSpy).not.toHaveBeenCalled();
    });

    it('ignores a cached payload that is not a config object', async () => {
        const fetchMock = stubFetchText('mode: rule');
        const kv = new MemoryKVAdapter();
        const url = 'https://kv-corrupt.test/a.yml';

        // Warm the cache to learn the key, then poison it.
        await resolveClashRuleBaseConfig({ url, kv });
        const cacheKey = [...kv.store.keys()][0];
        await kv.put(cacheKey, '{{not json');
        expect(await resolveClashRuleBaseConfig({ url, kv })).toEqual({ mode: 'rule' });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await kv.put(cacheKey, JSON.stringify({ config: ['not', 'an', 'object'] }));
        await resolveClashRuleBaseConfig({ url, kv });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('returns fallbackConfig and warns when the fetch fails', async () => {
        stubFetchText('', { ok: false, status: 500 });
        const kv = new MemoryKVAdapter();
        const logger = { warn: vi.fn() };
        const fallbackConfig = { mode: 'fallback' };

        const result = await resolveClashRuleBaseConfig({
            url: 'https://kv-fallback.test/a.yml',
            kv,
            fallbackConfig,
            logger
        });

        expect(result).toBe(fallbackConfig);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toContain('embedded fallback');
        // A failed fetch must not poison the cache.
        expect(kv.store.size).toBe(0);
    });

    it('rethrows when the fetch fails and no fallback is configured', async () => {
        stubFetchText('', { ok: false, status: 503 });
        await expect(resolveClashRuleBaseConfig({ url: 'https://kv-nofallback.test/a.yml', kv: new MemoryKVAdapter() }))
            .rejects.toBeInstanceOf(InvalidConfigError);
    });

    it('still returns the fallback when KV reads and writes explode', async () => {
        stubFetchText('', { ok: false, status: 500 });
        const explodingKv = {
            get: async () => { throw new Error('kv read down'); },
            put: async () => { throw new Error('kv write down'); }
        };
        const logger = { warn: vi.fn() };

        const result = await resolveClashRuleBaseConfig({
            url: 'https://kv-broken.test/a.yml',
            kv: explodingKv,
            fallbackConfig: { mode: 'fallback' },
            logger
        });

        expect(result).toEqual({ mode: 'fallback' });
        // One warn for the read failure, one for the fallback message.
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('uses the in-memory cache when no KV is provided', async () => {
        const fetchMock = stubFetchText('mode: memory');
        const url = 'https://memory-hit.test/a.yml';

        expect(await resolveClashRuleBaseConfig({ url, cacheTtlSeconds: 600 })).toEqual({ mode: 'memory' });
        expect(await resolveClashRuleBaseConfig({ url, cacheTtlSeconds: 600 })).toEqual({ mode: 'memory' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('re-fetches once the in-memory TTL has expired', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchText('mode: memory-ttl');
        const url = 'https://memory-ttl.test/a.yml';

        await resolveClashRuleBaseConfig({ url, cacheTtlSeconds: 60 });
        await resolveClashRuleBaseConfig({ url, cacheTtlSeconds: 60 });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date(Date.now() + 61_000));
        await resolveClashRuleBaseConfig({ url, cacheTtlSeconds: 60 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects an invalid URL before touching the cache or the network', async () => {
        const fetchMock = stubFetchText('mode: rule');
        const kv = new MemoryKVAdapter();
        const getSpy = vi.spyOn(kv, 'get');

        await expect(resolveClashRuleBaseConfig({ url: '  ', kv })).rejects.toBeInstanceOf(InvalidConfigError);
        await expect(resolveClashRuleBaseConfig({ url: 'https://a.test/x.yml\nX: 1', kv })).rejects.toBeInstanceOf(InvalidConfigError);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(getSpy).not.toHaveBeenCalled();
    });
});