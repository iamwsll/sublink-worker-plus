import yaml from 'js-yaml';
import { InvalidConfigError } from './errors.js';

export const DEFAULT_CLASH_RULE_BASE_CACHE_TTL_SECONDS = 600;
const MAX_CLASH_RULE_BASE_CACHE_TTL_SECONDS = 86400;
const memoryCache = new Map();

export function normalizeClashRuleBaseCacheTtl(value, fallback = DEFAULT_CLASH_RULE_BASE_CACHE_TTL_SECONDS) {
    const raw = value ?? fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_CLASH_RULE_BASE_CACHE_TTL_SECONDS;
    }
    return Math.min(parsed, MAX_CLASH_RULE_BASE_CACHE_TTL_SECONDS);
}

export async function resolveClashRuleBaseConfig({
    url,
    userAgent,
    kv,
    cacheTtlSeconds = DEFAULT_CLASH_RULE_BASE_CACHE_TTL_SECONDS,
    refresh = false,
    logger
} = {}) {
    const normalizedUrl = normalizeExternalConfigUrl(url);
    const ttlSeconds = normalizeClashRuleBaseCacheTtl(cacheTtlSeconds);
    const cacheKey = createCacheKey(normalizedUrl);

    if (ttlSeconds > 0 && !refresh) {
        const cached = await readCachedConfig(cacheKey, kv, logger);
        if (cached) return cached;
    }

    const fetchedConfig = await fetchClashRuleBaseConfig(normalizedUrl, userAgent);
    if (ttlSeconds > 0) {
        await writeCachedConfig(cacheKey, fetchedConfig, ttlSeconds, kv, logger);
    }
    return fetchedConfig;
}

export async function fetchClashRuleBaseConfig(rawUrl, userAgent) {
    const url = normalizeExternalConfigUrl(rawUrl);
    let response;
    try {
        response = await fetch(url, {
            headers: {
                'User-Agent': userAgent || 'curl/7.74.0'
            }
        });
    } catch (error) {
        // Network failures are caller-facing input problems too: an unreachable
        // clash_rule_base should be a clean 400, not an unhandled 500.
        throw new InvalidConfigError(`Failed to fetch clash_rule_base: ${error?.message || error}`);
    }
    if (!response.ok) {
        throw new InvalidConfigError(`Failed to fetch clash_rule_base: HTTP ${response.status}`);
    }
    const text = await response.text();
    const parsed = yaml.load(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new InvalidConfigError('clash_rule_base must be a Clash YAML object');
    }
    return parsed;
}

function normalizeExternalConfigUrl(raw) {
    if (typeof raw !== 'string') {
        throw new InvalidConfigError('Invalid clash_rule_base URL');
    }
    const trimmed = raw.trim();
    if (!trimmed || /[\r\n]/.test(trimmed)) {
        throw new InvalidConfigError('Invalid clash_rule_base URL');
    }
    return trimmed;
}

function createCacheKey(url) {
    let hash = 2166136261;
    for (let i = 0; i < url.length; i += 1) {
        hash ^= url.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `clash-rule-base:${(hash >>> 0).toString(36)}`;
}

async function readCachedConfig(cacheKey, kv, logger) {
    if (!kv) return readMemoryCache(cacheKey);

    try {
        return parseCachedPayload(await kv.get(cacheKey));
    } catch (error) {
        logger?.warn?.(`Failed to read Clash rule base cache ${cacheKey}. ${formatError(error)}`);
        return null;
    }
}

async function writeCachedConfig(cacheKey, config, ttlSeconds, kv, logger) {
    if (!kv) {
        memoryCache.set(cacheKey, {
            config,
            expiresAt: Date.now() + ttlSeconds * 1000
        });
        return;
    }

    try {
        await kv.put(cacheKey, JSON.stringify({ config }), { expirationTtl: ttlSeconds });
    } catch (error) {
        logger?.warn?.(`Failed to write Clash rule base cache ${cacheKey}. ${formatError(error)}`);
    }
}

function readMemoryCache(cacheKey) {
    const memoryItem = memoryCache.get(cacheKey);
    if (!memoryItem) return null;
    if (memoryItem.expiresAt > Date.now()) {
        return memoryItem.config;
    }
    memoryCache.delete(cacheKey);
    return null;
}

function parseCachedPayload(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        if (parsed?.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)) {
            return parsed.config;
        }
    } catch (_) {
        return null;
    }
    return null;
}

function formatError(error) {
    return error?.message || String(error);
}
