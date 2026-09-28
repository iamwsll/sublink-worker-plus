/**
 * Template compilers for the sing-box and Surge backends.
 * Both consume the same subconverter INI template as the Clash compiler and share
 * its front half (group matching, empty-group dropping, provider name dedup), so a
 * single admin-defined template governs every backend that has a rule model.
 */
import { IP_RULE_SET_BASE_URL } from './ruleUrls.js';
import {
	BUILTIN_RULE_TARGETS,
	compileTemplateGroups,
	parseTemplateRules
} from './ruleTemplate.js';

// Rules whose target group no longer exists must not be emitted, or the client
// rejects the config for dangling references (same invariant as the Clash compiler).
function filterDanglingRules(rules, groups) {
	const groupNames = new Set(groups.map(group => group.name));
	return rules.filter(rule => groupNames.has(rule.target) || BUILTIN_RULE_TARGETS.has(rule.target));
}

// sing-box 1.12 removed the legacy geoip/geosite matchers, so an inline GEOIP rule
// becomes a reference to the binary rule-set this project already ships for geo data.
function geoipRuleSet(code) {
	const lower = code.toLowerCase();
	return {
		tag: `geoip-${lower}`,
		type: 'remote',
		format: 'binary',
		url: `${IP_RULE_SET_BASE_URL}${lower}.srs`
	};
}

// Inline headless matchers that map 1:1 onto sing-box route rule fields. Types not
// listed here (e.g. GEOSITE) have no sing-box equivalent and are skipped.
const SINGBOX_INLINE_FIELDS = {
	DOMAIN: 'domain',
	'DOMAIN-SUFFIX': 'domain_suffix',
	'DOMAIN-KEYWORD': 'domain_keyword',
	'IP-CIDR': 'ip_cidr',
	'IP-CIDR6': 'ip_cidr',
	'SRC-IP-CIDR': 'source_ip_cidr'
};

function singboxTarget(target) {
	if (target === 'REJECT' || target === 'REJECT-DROP') return { action: 'reject' };
	return { outbound: target };
}

/**
 * Compiles a template into sing-box route/outbound sections.
 * `rewriteRuleSetUrl(url)` converts a remote classical list URL into one sing-box
 * can consume (the /ruleset/singbox endpoint); .srs/.json URLs pass through as-is.
 */
export function buildTemplateSingboxSections(template, { proxyNames = [], providerNames = [], rewriteRuleSetUrl } = {}) {
	const groups = compileTemplateGroups(template, { proxyNames, providerNames });
	const rules = filterDanglingRules(parseTemplateRules(template), groups);

	const ruleSets = [];
	const routeRules = [];
	let final = null;

	for (const rule of rules) {
		const target = singboxTarget(rule.target);
		if (rule.inline) {
			const [type, ...parts] = rule.source.slice(2).split(',');
			if (!type) continue;
			if (type === 'FINAL' || type === 'MATCH') {
				// sing-box has one final outbound; the last FINAL wins, mirroring Clash.
				final = rule.target;
				continue;
			}
			if (type === 'GEOIP') {
				const code = parts[0];
				if (!code) continue;
				const ruleSet = geoipRuleSet(code);
				ruleSets.push(ruleSet);
				routeRules.push({ rule_set: [ruleSet.tag], ...target });
				continue;
			}
			const field = SINGBOX_INLINE_FIELDS[type];
			// parts may carry clash-only modifiers (no-resolve), which sing-box lacks.
			const value = parts.filter(part => part !== 'no-resolve').join(',');
			if (!field || !value) continue;
			routeRules.push({ [field]: [value], ...target });
			continue;
		}

		const source = rule.source;
		const isBinary = /\.srs($|\?)/i.test(source);
		const isSource = /\.json($|\?)/i.test(source);
		const ruleSet = {
			tag: rule.providerName,
			type: 'remote',
			format: isBinary ? 'binary' : 'source',
			url: isBinary || isSource || typeof rewriteRuleSetUrl !== 'function'
				? source
				: rewriteRuleSetUrl(source)
		};
		ruleSets.push(ruleSet);
		routeRules.push({ rule_set: [ruleSet.tag], ...target });
	}

	const outbounds = groups.map(group => {
		if (group.type === 'url-test') {
			return {
				type: 'urltest',
				tag: group.name,
				outbounds: group.proxies,
				...(group.url ? { url: group.url } : {}),
				...(group.interval ? { interval: `${group.interval}s` } : {}),
				...(group.tolerance ? { tolerance: group.tolerance } : {}),
				...(group.use ? { providers: group.use } : {})
			};
		}
		return {
			type: 'selector',
			tag: group.name,
			outbounds: group.proxies,
			...(group.use ? { providers: group.use } : {})
		};
	});

	return { ruleSets, outbounds, rules: routeRules, final };
}

/**
 * Compiles a template into Surge [Proxy Group] / [Rule] lines. Surge has no
 * provider indirection: remote rule lists are referenced by URL directly, and
 * group `use` lists (proxy providers) are dropped because Surge cannot consume them.
 */
export function buildTemplateSurgeSections(template, { proxyNames = [] } = {}) {
	const groups = compileTemplateGroups(template, { proxyNames, providerNames: [] });
	const rules = filterDanglingRules(parseTemplateRules(template), groups);

	const groupStrings = groups.map(group => {
		const type = group.type === 'url-test' ? 'url-test' : 'select';
		const members = group.proxies.length > 0 ? `, ${group.proxies.join(', ')}` : '';
		if (type !== 'url-test') return `${group.name} = ${type}${members}`;
		const url = group.url || 'http://www.gstatic.com/generate_204';
		const interval = group.interval || 300;
		return `${group.name} = ${type}${members}, url=${url}, interval=${interval}`;
	});

	const ruleStrings = [];
	for (const rule of rules) {
		if (rule.inline) {
			const [type, ...parts] = rule.source.slice(2).split(',');
			if (!type) continue;
			// Surge's terminal rule is FINAL; MATCH is the Clash spelling of the same idea.
			if (type === 'FINAL' || type === 'MATCH') {
				ruleStrings.push(`FINAL,${rule.target}`);
				continue;
			}
			ruleStrings.push(`${type},${parts.join(',')},${rule.target}`);
			continue;
		}
		ruleStrings.push(`RULE-SET,${rule.source},${rule.target}`);
	}

	return { proxyGroups: groupStrings, rules: ruleStrings };
}
