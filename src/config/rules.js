/**
 * Rule Definitions
 * Contains unified rule structure and predefined rule sets
 */

import { normalizeCustomRuleGroups } from '../utils/customRuleGroups.js';

export const CUSTOM_RULES = [];

// Rule entries may carry an optional `rule_set_overrides` map keyed by the rule-set tag
// (site tag, or `<ip>-ip`) so custom groups can point at arbitrary upstream URLs.

export const UNIFIED_RULES = [
	{
		name: 'Ad Block',
		site_rules: ['category-ads-all'],
		ip_rules: []
	},
	{
		name: 'AI Services',
		site_rules: ['category-ai-!cn',],
		ip_rules: []
	},
	{
		name: 'Bilibili',
		site_rules: ['bilibili'],
		ip_rules: []
	},
	{
		name: 'Youtube',
		site_rules: ['youtube'],
		ip_rules: []
	},
	{
		name: 'Google',
		site_rules: ['google'],
		ip_rules: ['google']
	},
	{
		name: 'Private',
		site_rules: [],
		ip_rules: ['private']
	},
	{
		name: 'Location:CN',
		site_rules: ['geolocation-cn', 'cn'],
		ip_rules: ['cn']
	},
	{
		name: 'Telegram',
		site_rules: [],
		ip_rules: ['telegram']
	},
	{
		name: 'Github',
		site_rules: ['github', 'gitlab'],
		ip_rules: []
	},
	{
		name: 'Microsoft',
		site_rules: ['microsoft'],
		ip_rules: []
	},
	{
		name: 'Apple',
		site_rules: ['apple'],
		ip_rules: []
	},
	{
		name: 'Social Media',
		site_rules: ['facebook', 'instagram', 'twitter', 'tiktok', 'linkedin'],
		ip_rules: []
	},
	{
		name: 'Streaming',
		site_rules: ['netflix', 'hulu', 'disney', 'hbo', 'amazon', 'bahamut'],
		ip_rules: []
	},
	{
		name: 'Gaming',
		site_rules: ['steam', 'epicgames', 'ea', 'ubisoft', 'blizzard'],
		ip_rules: []
	},
	{
		name: 'Education',
		site_rules: ['coursera', 'edx', 'udemy', 'khanacademy', 'category-scholar-!cn'],
		ip_rules: []
	},
	{
		name: 'Financial',
		site_rules: ['paypal', 'visa', 'mastercard', 'stripe', 'wise'],
		ip_rules: []
	},
	{
		name: 'Cloud Services',
		site_rules: ['aws', 'azure', 'digitalocean', 'heroku', 'dropbox'],
		ip_rules: []
	},
	{
		name: 'Non-China',
		site_rules: ['geolocation-!cn'],
		ip_rules: []
	}
];

// Rule names that should default to DIRECT instead of Node Select
export const DIRECT_DEFAULT_RULES = new Set(['Private', 'Location:CN']);
export const REJECT_ACTION_RULES = new Set(['Ad Block']);

export const PREDEFINED_RULE_SETS = {
	minimal: ['Location:CN', 'Private', 'Non-China'],
	balanced: ['Location:CN', 'Private', 'Non-China', 'Github', 'Google', 'Youtube', 'AI Services', 'Telegram'],
	comprehensive: UNIFIED_RULES.map(rule => rule.name)
};

// Runtime group defaults are injected from persisted backend config, never hardcoded here.
export const PREDEFINED_RULE_GROUP_DEFAULTS = {};

// Generate SITE_RULE_SETS and IP_RULE_SETS from UNIFIED_RULES
export const SITE_RULE_SETS = UNIFIED_RULES.reduce((acc, rule) => {
	rule.site_rules.forEach(site_rule => {
		acc[site_rule] = `${site_rule}.srs`;
	});
	return acc;
}, {});

export const IP_RULE_SETS = UNIFIED_RULES.reduce((acc, rule) => {
	rule.ip_rules.forEach(ip_rule => {
		acc[ip_rule] = `${ip_rule}.srs`;
	});
	return acc;
}, {});

// Generate CLASH_SITE_RULE_SETS and CLASH_IP_RULE_SETS for .mrs format
export const CLASH_SITE_RULE_SETS = UNIFIED_RULES.reduce((acc, rule) => {
	rule.site_rules.forEach(site_rule => {
		acc[site_rule] = `${site_rule}.mrs`;
	});
	return acc;
}, {});

export const CLASH_IP_RULE_SETS = UNIFIED_RULES.reduce((acc, rule) => {
	rule.ip_rules.forEach(ip_rule => {
		acc[ip_rule] = `${ip_rule}.mrs`;
	});
	return acc;
}, {});

export const RULE_SET_OVERRIDES = UNIFIED_RULES.reduce((acc, rule) => {
	if (!rule.rule_set_overrides) {
		return acc;
	}
	Object.entries(rule.rule_set_overrides).forEach(([ruleName, overrides]) => {
		if (acc[ruleName]) {
			throw new Error(`Duplicate rule_set_overrides found for "${ruleName}"`);
		}
		acc[ruleName] = overrides;
	});
	return acc;
}, {});

function generateRuleTagSlug(value = '') {
	return String(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'custom';
}

function buildRuleFromCustomGroup(group) {
	const overrides = {};
	const siteRules = group.urls.map((url, idx) => {
		const tag = `custom-${generateRuleTagSlug(group.name)}-${group.index + 1}-${idx + 1}`;
		overrides[tag] = {
			singbox_format: 'source',
			clash_format: 'text',
			clash_behavior: 'classical',
			url
		};
		return tag;
	});
	return {
		name: group.name,
		site_rules: siteRules,
		ip_rules: [],
		rule_set_overrides: overrides
	};
}

export function buildRuleContext(customRuleGroups = []) {
	const normalizedGroups = normalizeCustomRuleGroups(customRuleGroups);
	if (normalizedGroups.length === 0) {
		return {
			rules: UNIFIED_RULES,
			ruleSetOverrides: RULE_SET_OVERRIDES
		};
	}

	const customizedByName = new Map();
	normalizedGroups.forEach(group => {
		customizedByName.set(group.name, buildRuleFromCustomGroup(group));
	});

	const rules = UNIFIED_RULES.map(rule => customizedByName.get(rule.name) || rule);
	customizedByName.forEach((rule, name) => {
		if (!UNIFIED_RULES.some(item => item.name === name)) {
			rules.push(rule);
		}
	});

	const ruleSetOverrides = {};
	rules.forEach(rule => {
		if (!rule.rule_set_overrides) return;
		Object.entries(rule.rule_set_overrides).forEach(([ruleName, overrides]) => {
			ruleSetOverrides[ruleName] = overrides;
		});
	});

	return {
		rules,
		ruleSetOverrides
	};
}
