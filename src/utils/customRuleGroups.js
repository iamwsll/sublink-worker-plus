export function normalizeCustomRuleGroup(raw, index = 0) {
	if (!raw || typeof raw !== 'object') return null;
	const name = typeof raw.name === 'string' ? raw.name.trim() : '';
	if (!name) return null;
	// Backward compatibility: older links used singular `url`, new format uses `urls`.
	const urls = Array.isArray(raw.urls)
		? raw.urls
		: (typeof raw.url === 'string' ? [raw.url] : []);
	const normalizedUrls = urls
		.filter(url => typeof url === 'string')
		.map(url => url.trim())
		.filter(Boolean);
	if (normalizedUrls.length === 0) return null;
	return { name, urls: normalizedUrls, index };
}

export function normalizeCustomRuleGroups(rawGroups = []) {
	if (!Array.isArray(rawGroups)) return [];
	return rawGroups
		.map((group, idx) => normalizeCustomRuleGroup(group, idx))
		.filter(Boolean);
}