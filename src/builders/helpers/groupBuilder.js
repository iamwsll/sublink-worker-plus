const normalize = (value) => typeof value === 'string' ? value.trim() : value;
const UNTRANSLATED_OUTBOUNDS = new Set(['DIRECT', 'REJECT']);
const MISSING_TRANSLATION_PREFIX = 'outboundNames.';

export function uniqueNames(names = []) {
    const seen = new Set();
    const result = [];
    names.forEach(name => {
        if (typeof name !== 'string') return;
        const normalized = normalize(name);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
}

export function withDirectReject(options = [], { includeReject = true } = {}) {
    return uniqueNames([
        ...options,
        'DIRECT',
        ...(includeReject ? ['REJECT'] : [])
    ]);
}

export function buildNodeSelectMembers({ proxyList = [], translator, groupByCountry = false, manualGroupName, countryGroupNames = [], includeAutoSelect = true, includeReject = true }) {
    if (!translator) {
        throw new Error('buildNodeSelectMembers requires a translator function');
    }
    const autoName = translator('outboundNames.Auto Select');
    const base = groupByCountry
        ? [
            ...(includeAutoSelect ? [autoName] : []),
            ...(manualGroupName ? [manualGroupName] : []),
            ...countryGroupNames
        ]
        : [
            ...(includeAutoSelect ? [autoName] : []),
            ...proxyList
        ];
    return withDirectReject(base, { includeReject });
}

export function buildSelectorMembers({ proxyList = [], translator, groupByCountry = false, manualGroupName, countryGroupNames = [], includeAutoSelect = true, includeReject = true }) {
    if (!translator) {
        throw new Error('buildSelectorMembers requires a translator function');
    }
    const base = groupByCountry
        ? [
            translator('outboundNames.Node Select'),
            ...(includeAutoSelect ? [translator('outboundNames.Auto Select')] : []),
            ...(manualGroupName ? [manualGroupName] : []),
            ...countryGroupNames
        ]
        : [
            translator('outboundNames.Node Select'),
            ...proxyList
        ];
    return withDirectReject(base, { includeReject });
}

export function buildCustomRuleMembers({ proxyList = [], translator, manualGroupName, includeAutoSelect = true, includeReject = true }) {
    if (!translator) {
        throw new Error('buildCustomRuleMembers requires a translator function');
    }
    return withDirectReject([
        translator('outboundNames.Node Select'),
        ...(includeAutoSelect ? [translator('outboundNames.Auto Select')] : []),
        ...(manualGroupName ? [manualGroupName] : []),
        ...proxyList
    ], { includeReject });
}

export function applyGroupPreferredDefault(members = [], preferredOption, translator) {
    if (!Array.isArray(members) || !preferredOption) return members;
    if (typeof preferredOption !== 'string') return members;

    const trimmed = preferredOption.trim();
    if (!trimmed) return members;

    // Callers pass the raw outbound key, which is translated for the UI, but
    // DIRECT/REJECT are literal and must never go through the translator.
    let resolved = trimmed;
    if (translator && !UNTRANSLATED_OUTBOUNDS.has(trimmed)) {
        const translated = translator(`outboundNames.${trimmed}`);
        if (translated && !String(translated).startsWith(MISSING_TRANSLATION_PREFIX)) {
            resolved = translated;
        }
    }

    if (!members.includes(resolved)) return members;
    return [resolved, ...members.filter(m => m !== resolved)];
}
