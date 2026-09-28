/**
 * Converts remote classical rule lists (Clash/Surge text format: DOMAIN-SUFFIX,x,
 * IP-CIDR,x,no-resolve, one per line, optionally wrapped in a `payload:` block) into
 * the sing-box rule-set source JSON format, so a template's rule-list URLs work for
 * sing-box output too. Results are cached in KV like the clash base config cache.
 */

const SINGBOX_RULESET_CACHE_PREFIX = 'singbox-ruleset:';

// Classical list types that map onto sing-box headless rule fields; anything else
// (AND/NOT logic, SRC-PORT, ...) has no equivalent and is skipped.
const FIELD_BY_TYPE = {
	DOMAIN: 'domain',
	'DOMAIN-SUFFIX': 'domain_suffix',
	'DOMAIN-KEYWORD': 'domain_keyword',
	GEOIP: 'geoip',
	'IP-CIDR': 'ip_cidr',
	'IP-CIDR6': 'ip_cidr',
	'SRC-IP-CIDR': 'source_ip_cidr'
};

export function convertClassicalListToSingboxSource(text) {
	const values = new Map();
	for (const rawLine of String(text || '').split('\n')) {
		let line = rawLine.trim();
		if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;
		if (line === 'payload:') continue;
		if (line.startsWith('- ')) line = line.slice(2).trim();
		const commaIndex = line.indexOf(',');
		if (commaIndex === -1) continue;
		const type = line.slice(0, commaIndex).trim().toUpperCase();
		const field = FIELD_BY_TYPE[type];
		if (!field) continue;
		// Clash-only modifiers (no-resolve) have no sing-box counterpart.
		const value = line.slice(commaIndex + 1).split(',').map(part => part.trim())
			.filter(part => part && part !== 'no-resolve')
			.join(',');
		if (!value) continue;
		if (!values.has(field)) values.set(field, []);
		values.get(field).push(value);
	}

	// Domain rules before IP rules, matching the ordering both clients recommend.
	const fieldOrder = ['domain', 'domain_suffix', 'domain_keyword', 'geoip', 'source_ip_cidr', 'ip_cidr'];
	const rules = fieldOrder
		.filter(field => values.has(field))
		.map(field => ({ [field]: [...new Set(values.get(field))] }));
	return { version: 1, rules };
}

async function sha256Hex(text) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetches a remote classical list and returns its sing-box source JSON string.
 * Cached in KV under a URL hash; cache failures degrade to a plain refetch.
 */
export async function fetchSingboxRuleSet({ url, userAgent, kv, cacheTtlSeconds = 600, logger } = {}) {
	const cacheKey = SINGBOX_RULESET_CACHE_PREFIX + (await sha256Hex(url));
	if (kv && cacheTtlSeconds > 0) {
		try {
			const cached = await kv.get(cacheKey);
			if (cached) return cached;
		} catch (error) {
			logger?.warn?.(`Failed to read sing-box ruleset cache. ${error?.message || error}`);
		}
	}

	const response = await fetch(url, { headers: { 'User-Agent': userAgent || 'sublink-worker-plus' } });
	if (!response.ok) {
		throw new Error(`Failed to fetch rule list ${url}: HTTP ${response.status}`);
	}
	const json = JSON.stringify(convertClassicalListToSingboxSource(await response.text()));

	if (kv && cacheTtlSeconds > 0) {
		try {
			await kv.put(cacheKey, json, { expirationTtl: cacheTtlSeconds });
		} catch (error) {
			logger?.warn?.(`Failed to write sing-box ruleset cache. ${error?.message || error}`);
		}
	}
	return json;
}
