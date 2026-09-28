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
// Clash built-in policy targets that never need a custom_proxy_group definition.
const BUILTIN_RULE_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']);

/**
 * Static sanity check for template INI lines. Returns human-readable issues; an empty
 * list means the template compiles to a self-consistent Clash rule section. Unknown
 * directives are ignored on purpose: /subconverter passes them through verbatim.
 */
export function validateTemplateLines(subconverterLines, omittedGroups = []) {
	const lines = (Array.isArray(subconverterLines) ? subconverterLines : [])
		.filter(line => typeof line === 'string' && line.trim());
	const omitted = new Set(Array.isArray(omittedGroups) ? omittedGroups : []);
	const issues = [];

	const definedGroups = new Set();
	for (const line of lines) {
		if (!line.startsWith(PROXY_GROUP_PREFIX)) continue;
		const [name, type] = line.slice(PROXY_GROUP_PREFIX.length).split('`');
		if (!name || !type) {
			issues.push(`custom_proxy_group line is missing a name or type: "${line}"`);
			continue;
		}
		definedGroups.add(name);
	}

	// Omitted groups are intentionally dropped at compile time, so referencing one is
	// the author's choice rather than a dangling reference.
	const knownTargets = new Set([...definedGroups, ...omitted, ...BUILTIN_RULE_TARGETS]);

	for (const line of lines) {
		if (line.startsWith(RULESET_PREFIX)) {
			const target = line.slice(RULESET_PREFIX.length).split(',')[0].trim();
			if (!target) {
				issues.push(`ruleset line has an empty target group: "${line}"`);
			} else if (!knownTargets.has(target)) {
				issues.push(`ruleset target "${target}" has no matching custom_proxy_group`);
			}
			continue;
		}
		if (!line.startsWith(PROXY_GROUP_PREFIX)) continue;
		const [, , ...parts] = line.slice(PROXY_GROUP_PREFIX.length).split('`');
		for (const member of parts) {
			if (!member.startsWith('[]')) continue;
			const ref = member.slice(2);
			if (ref && !knownTargets.has(ref)) {
				issues.push(`group reference []${ref} has no matching custom_proxy_group`);
			}
		}
	}

	return issues;
}

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

function isEmptyGroup(group) {
	const hasProxies = Array.isArray(group.proxies) && group.proxies.length > 0;
	const hasProviders = Array.isArray(group.use) && group.use.length > 0;
	return !hasProxies && !hasProviders;
}

// A group whose regex matched nothing must not be stuffed with every proxy: it is dropped,
// and references to it are stripped from the survivors. Stripping can empty another group
// (a select group built only from references to dropped ones), so iterate until stable.
function dropEmptyGroups(groups) {
	let current = groups;
	while (true) {
		const dropped = new Set(current.filter(isEmptyGroup).map(group => group.name));
		if (dropped.size === 0) return current;
		current = current
			.filter(group => !dropped.has(group.name))
			.map(group => ({
				...group,
				proxies: (group.proxies || []).filter(name => !dropped.has(name))
			}));
	}
}

// Every compiled rule ends with its target group: RULE-SET,<provider>,<group>,
// GEOIP,CN,<group>, MATCH,<group>.
function getRuleTargetGroup(rule) {
	return rule.split(',').at(-1);
}

function buildProxyGroups(template, { proxyNames = [], providerNames = [] } = {}) {
	const omittedGroups = getOmittedGroups(template);

	const groups = getProxyGroupLines(template).map(line => {
		const payload = line.slice(PROXY_GROUP_PREFIX.length);
		const [name, type, ...parts] = payload.split('`');
		if (!name || !type) return null;
		if (omittedGroups.has(name)) return null;

		if (type === 'url-test') {
			const [pattern = '.*', url = 'http://www.gstatic.com/generate_204', timing = '300'] = parts;
			const group = {
				name,
				type,
				proxies: getMatchedProxyNames(pattern, proxyNames),
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
		return dedupeMembers(group);
	}).filter(Boolean);

	return dropEmptyGroups(groups);
}

export function buildTemplateClashSections(template, options) {
	// Callers may pass null explicitly; destructuring defaults only cover undefined.
	const { proxyNames = [], providerNames = [] } = options || {};
	const { ruleProviders, rules } = buildRuleSections(template);
	const proxyGroups = buildProxyGroups(template, { proxyNames, providerNames });

	// Dropped groups must not leave dangling rule targets or unused providers behind,
	// or Clash rejects the config for referencing groups that do not exist.
	const groupNames = new Set(proxyGroups.map(group => group.name));
	const keptRules = rules.filter(rule => groupNames.has(getRuleTargetGroup(rule)));
	const usedProviders = new Set(
		keptRules.filter(rule => rule.startsWith('RULE-SET,')).map(rule => rule.split(',')[1])
	);
	const keptProviders = Object.fromEntries(
		Object.entries(ruleProviders).filter(([name]) => usedProviders.has(name))
	);

	return {
		ruleProviders: keptProviders,
		proxyGroups,
		rules: keptRules
	};
}

// Node-independent view of a template for UI display: the groups and rules it
// defines before any proxy names are matched, so the homepage can show what a
// fixed template contains instead of a bare "template applied" notice.
export function summarizeTemplate(template) {
	const omittedGroups = getOmittedGroups(template);

	const groups = getProxyGroupLines(template).map(line => {
		const payload = line.slice(PROXY_GROUP_PREFIX.length);
		const [name, type, ...parts] = payload.split('`');
		if (!name || !type) return null;
		if (omittedGroups.has(name)) return null;
		return {
			name,
			type,
			// url-test groups match by pattern; other groups list members explicitly.
			filter: type === 'url-test' ? (parts[0] || '.*') : ''
		};
	}).filter(Boolean);

	const usedNames = new Set();
	const rules = [];
	getRulesetLines(template).forEach((line, index) => {
		const parsed = parseRulesetLine(line, usedNames, index);
		if (parsed) rules.push(parsed);
	});

	return { groups, rules };
}

// A rule's stable identity for per-request selection: target disambiguates inline
// rules that repeat the same payload, and provider names are already deduped by
// createRuleProviderName within one template.
function makeRuleId(target, label) {
	return `${target}::${label}`;
}

function parseRulesetLine(line, usedNames, index) {
	const payload = line.slice(RULESET_PREFIX.length);
	const commaIndex = payload.indexOf(',');
	if (commaIndex === -1) return null;
	const target = payload.slice(0, commaIndex);
	const source = payload.slice(commaIndex + 1);
	if (!source) return null;
	// Inline rulesets read better without the [] marker; remote ones as their
	// provider name so the row stays short regardless of URL length.
	const label = source.startsWith('[]')
		? source.slice(2)
		: createRuleProviderName(source, usedNames, index);
	return { target, label, id: makeRuleId(target, label) };
}

// Returns a copy of the template without the excluded rules, so every downstream
// consumer (Clash compiler, subconverter INI pass-through) stays consistent.
// Groups are untouched: a group with no rules left is still valid structure.
export function excludeTemplateRules(template, excludedIds = []) {
	const excluded = new Set(Array.isArray(excludedIds) ? excludedIds : []);
	if (excluded.size === 0) return template;
	const usedNames = new Set();
	let index = 0;
	const subconverterLines = getTemplateLines(template).filter(line => {
		if (!line.startsWith(RULESET_PREFIX)) return true;
		const parsed = parseRulesetLine(line, usedNames, index);
		index += 1;
		return !parsed || !excluded.has(parsed.id);
	});
	return { ...template, subconverterLines };
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