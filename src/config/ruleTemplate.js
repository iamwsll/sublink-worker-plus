/**
 * Rule Template Compiler
 * Compiles a data-driven rule template (subconverter INI lines) into Clash
 * rule-providers/proxy-groups/rules sections, and into a subconverter INI blob.
 *
 * Template shape:
 * {
 *   id, name, enabled, isDefault,
 *   clashRuleBase, quanxRuleBase,
 *   omittedGroups: string[],
 *   subconverterLines: string[],
 *   fallbackClashConfig: object|null
 * }
 */

const RULESET_PREFIX = 'ruleset=';
const PROXY_GROUP_PREFIX = 'custom_proxy_group=';

/**
 * Templates may come from stored data, so keep every read defensive: a partial
 * template must degrade to empty sections instead of throwing at build time.
 */
function getTemplateLines(template) {
	if (!template || !Array.isArray(template.subconverterLines)) return [];
	return template.subconverterLines.filter(line => typeof line === 'string');
}

function getRulesetLines(template) {
	return getTemplateLines(template).filter(line => line.startsWith(RULESET_PREFIX));
}

function getProxyGroupLines(template) {
	return getTemplateLines(template).filter(line => line.startsWith(PROXY_GROUP_PREFIX));
}

function getOmittedGroups(template) {
	return new Set(Array.isArray(template?.omittedGroups) ? template.omittedGroups : []);
}

function createRuleProviderName(url, usedNames, index) {
	const fileName = url.split('/').pop() || `ruleset-${index + 1}`;
	const base = fileName
		.replace(/\.(list|yaml|yml|mrs)$/i, '')
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '') || `ruleset-${index + 1}`;
	let name = base;
	let suffix = 2;
	while (usedNames.has(name)) {
		name = `${base}-${suffix}`;
		suffix += 1;
	}
	usedNames.add(name);
	return name;
}

function buildRuleSections(template) {
	const ruleProviders = {};
	const rules = [];
	const finalRules = [];
	const usedProviderNames = new Set();

	getRulesetLines(template).forEach((line, index) => {
		const payload = line.slice(RULESET_PREFIX.length);
		const commaIndex = payload.indexOf(',');
		if (commaIndex === -1) return;
		const groupName = payload.slice(0, commaIndex);
		const ruleSource = payload.slice(commaIndex + 1);
		// An empty source would emit a rule-provider with no URL, which Clash rejects.
		if (!ruleSource) return;

		// Inline rulesets ([]TYPE,...) are emitted directly instead of as providers.
		if (ruleSource.startsWith('[]')) {
			const [type, ...parts] = ruleSource.slice(2).split(',');
			if (!type) return;
			if (type === 'FINAL') {
				// MATCH is terminal, so FINAL rules always emit last regardless of
				// where the template author placed the line.
				finalRules.push(`MATCH,${groupName}`);
			} else if (type === 'GEOIP') {
				rules.push(`GEOIP,${parts.join(',')},${groupName}`);
			} else {
				rules.push(`${type},${parts.join(',')},${groupName}`);
			}
			return;
		}

		const providerName = createRuleProviderName(ruleSource, usedProviderNames, index);
		ruleProviders[providerName] = {
			type: 'http',
			format: 'text',
			behavior: 'classical',
			url: ruleSource,
			path: `./ruleset/${providerName}.list`,
			interval: 86400
		};
		rules.push(`RULE-SET,${providerName},${groupName}`);
	});

	return { ruleProviders, rules: [...rules, ...finalRules] };
}

function compileGroupMatcher(pattern) {
	if (!pattern || pattern === '.*') {
		return () => true;
	}
	try {
		const regex = new RegExp(pattern, 'i');
		return name => regex.test(name);
	} catch {
		return () => false;
	}
}

function getMatchedProxyNames(pattern, proxyNames) {
	const matcher = compileGroupMatcher(pattern);
	return proxyNames.filter(name => matcher(name));
}

function parseUrlTestTiming(value = '') {
	const [interval, , tolerance] = String(value).split(',');
	const parsedInterval = Number.parseInt(interval, 10);
	const parsedTolerance = Number.parseInt(tolerance, 10);
	return {
		interval: Number.isFinite(parsedInterval) ? parsedInterval : 300,
		...(Number.isFinite(parsedTolerance) ? { tolerance: parsedTolerance } : {})
	};
}

function appendGroupMembers(target, members = [], proxyNames = [], omittedGroups = new Set()) {
	members.forEach(member => {
		if (!member) return;
		if (member.startsWith('[]')) {
			const groupOrProxyName = member.slice(2);
			if (!omittedGroups.has(groupOrProxyName)) {
				target.proxies.push(groupOrProxyName);
			}
			return;
		}
		const matches = getMatchedProxyNames(member, proxyNames);
		target.proxies.push(...matches);
	});
}

function dedupeMembers(group) {
	if (Array.isArray(group.proxies)) {
		group.proxies = [...new Set(group.proxies.filter(Boolean))];
	}
	if (Array.isArray(group.use)) {
		group.use = [...new Set(group.use.filter(Boolean))];
		if (group.use.length === 0) delete group.use;
	}
	return group;
}

function ensureSelectGroupHasMembers(group, proxyNames = [], providerNames = []) {
	const hasProxies = Array.isArray(group.proxies) && group.proxies.length > 0;
	const hasProviders = Array.isArray(group.use) && group.use.length > 0;
	if (hasProxies || hasProviders || group.type !== 'select') {
		return group;
	}
	// An empty select group is invalid in Clash, so fall back to proxies/providers.
	if (providerNames.length > 0) {
		group.use = providerNames;
		return group;
	}
	group.proxies = proxyNames.length > 0 ? proxyNames : ['DIRECT'];
	return group;
}

function buildProxyGroups(template, { proxyNames = [], providerNames = [] } = {}) {
	const omittedGroups = getOmittedGroups(template);

	return getProxyGroupLines(template).map(line => {
		const payload = line.slice(PROXY_GROUP_PREFIX.length);
		const [name, type, ...parts] = payload.split('`');
		if (!name || !type) return null;
		if (omittedGroups.has(name)) return null;

		if (type === 'url-test') {
			const [pattern = '.*', url = 'http://www.gstatic.com/generate_204', timing = '300'] = parts;
			const matchedProxies = getMatchedProxyNames(pattern, proxyNames);
			const group = {
				name,
				type,
				proxies: matchedProxies.length > 0 ? matchedProxies : proxyNames,
				url,
				...parseUrlTestTiming(timing)
			};
			if (providerNames.length > 0 && pattern === '.*') {
				group.use = providerNames;
			}
			return dedupeMembers(group);
		}

		const group = {
			name,
			type,
			proxies: []
		};
		appendGroupMembers(group, parts, proxyNames, omittedGroups);
		if (providerNames.length > 0 && parts.includes('.*')) {
			group.use = providerNames;
		}
		return ensureSelectGroupHasMembers(dedupeMembers(group), proxyNames, providerNames);
	}).filter(Boolean);
}

export function buildTemplateClashSections(template, options) {
	// Callers may pass null explicitly; destructuring defaults only cover undefined.
	const { proxyNames = [], providerNames = [] } = options || {};
	const { ruleProviders, rules } = buildRuleSections(template);
	const proxyGroups = buildProxyGroups(template, { proxyNames, providerNames });
	return {
		ruleProviders,
		proxyGroups,
		rules
	};
}

function normalizeConfigUrl(value, fallback) {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	// A base URL flows into a generated INI, so newlines would inject extra keys.
	if (!trimmed || /[\r\n]/.test(trimmed)) return fallback;
	return trimmed;
}

export function generateTemplateSubconverterConfig(template, options) {
	const { clashRuleBase, quanxRuleBase } = options || {};
	const lines = getTemplateLines(template);
	const resolvedClashRuleBase = normalizeConfigUrl(clashRuleBase, template?.clashRuleBase);
	const resolvedQuanxRuleBase = normalizeConfigUrl(quanxRuleBase, template?.quanxRuleBase);
	// A template without its own base URL keeps both keys present but empty,
	// so consumers can still parse the file instead of reading "undefined".
	const asBaseLine = (key, value) => `${key}=${typeof value === 'string' ? value : ''}`;

	// Backup emitted a trailing ';luck' marker; upstream payloads may still
	// match on it, so the generated text stays byte-compatible.
	return [
		...lines,
		asBaseLine('clash_rule_base', resolvedClashRuleBase),
		asBaseLine('quanx_rule_base', resolvedQuanxRuleBase),
		';luck'
	].join('\n');
}