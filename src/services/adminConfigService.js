import { normalizeCustomRuleGroups } from '../utils/customRuleGroups.js';
import { validateTemplateLines } from '../config/ruleTemplate.js';
import { InvalidConfigError } from './errors.js';

export const ADMIN_CONFIG_KEY = 'admin:config';
export const ADMIN_CONFIG_VERSION = 1;

export const DEFAULT_ADMIN_CONFIG = deepFreeze({
    version: ADMIN_CONFIG_VERSION,
    // Preset name used when a subscription does not carry its own selectedRules.
    defaultRulePreset: 'balanced',
    customRuleSets: [],
    groupDefaults: {},
    templates: []
});

// Mirrors the in-memory fallback of clashRuleBaseCache: a deployment without KV (or with a
// failing KV) must still serve a coherent admin config instead of exploding.
const memoryConfigStore = new Map();

// Template ids end up in URLs and generated config names, so keep them URL/CLI safe.
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

// Fields whose container type must match; a wrong type means the caller sent garbage, not a partial update.
const CONTAINER_FIELDS = [
    ['customRuleSets', 'array'],
    ['templates', 'array'],
    ['groupDefaults', 'object']
];

/**
 * Sanitize an arbitrary value into a complete admin config.
 * This never throws: a broken stored payload or a half-filled admin form should degrade to
 * defaults for the broken parts instead of blocking subscription rendering.
 */
export function normalizeAdminConfig(raw) {
    const source = isPlainObject(raw) ? raw : {};

    return {
        // The schema version is owned by the code, never by the stored payload, so old blobs
        // are transparently upgraded on read.
        version: ADMIN_CONFIG_VERSION,
        defaultRulePreset: normalizeDefaultRulePreset(source.defaultRulePreset),
        customRuleSets: normalizeCustomRuleSets(source.customRuleSets),
        groupDefaults: normalizeGroupDefaults(source.groupDefaults),
        templates: normalizeTemplates(source.templates)
    };
}

export class AdminConfigService {
    constructor(kv = null) {
        this.kv = kv;
    }

    async getConfig() {
        const stored = await this.readStoredValue();
        if (!stored) return cloneJson(DEFAULT_ADMIN_CONFIG);

        try {
            return normalizeAdminConfig(JSON.parse(stored));
        } catch {
            // A corrupt blob must not take the admin UI (or the subscription path) down; the
            // operator can always re-save to overwrite it.
            return cloneJson(DEFAULT_ADMIN_CONFIG);
        }
    }

    async saveConfig(raw) {
        assertSavableConfig(raw);
        // Partial updates merge over the stored config; otherwise a section-scoped PUT
        // would silently reset every other section to defaults.
        const existing = await this.getConfig();
        const config = normalizeAdminConfig({ ...existing, ...raw });

        // Compile-time structural check: a dangling ruleset target or group reference is
        // silently dropped when generating configs, so reject it at save time instead.
        const issues = config.templates.flatMap(template =>
            validateTemplateLines(template.subconverterLines, template.omittedGroups)
                .map(issue => `Template "${template.name || template.id}": ${issue}`)
        );
        if (issues.length > 0) {
            throw new InvalidConfigError(issues.slice(0, 10).join('; '));
        }

        let payload;
        try {
            payload = JSON.stringify(config);
        } catch {
            throw new InvalidConfigError('Admin config must be JSON-serializable');
        }

        // A failed write must surface to the operator: silently keeping the value in memory
        // would report success for a change that disappears on restart.
        if (this.kv) {
            await this.kv.put(ADMIN_CONFIG_KEY, payload);
        }
        memoryConfigStore.set(ADMIN_CONFIG_KEY, payload);
        return config;
    }

    async resetConfig() {
        memoryConfigStore.delete(ADMIN_CONFIG_KEY);
        if (this.kv) {
            await this.kv.delete(ADMIN_CONFIG_KEY);
        }
        return cloneJson(DEFAULT_ADMIN_CONFIG);
    }

    async readStoredValue() {
        if (!this.kv) return memoryConfigStore.get(ADMIN_CONFIG_KEY) ?? null;
        try {
            return await this.kv.get(ADMIN_CONFIG_KEY);
        } catch {
            // Reads are on the hot path, so a KV outage falls back to whatever this isolate last saw.
            return memoryConfigStore.get(ADMIN_CONFIG_KEY) ?? null;
        }
    }
}

function normalizeDefaultRulePreset(value) {
    const preset = typeof value === 'string' ? value.trim() : '';
    return preset || DEFAULT_ADMIN_CONFIG.defaultRulePreset;
}

function normalizeCustomRuleSets(value) {
    // Reuse the shared group normalizer so links and admin config agree on what a rule group is.
    const groups = normalizeCustomRuleGroups(Array.isArray(value) ? value : []);
    const seenNames = new Set();
    const result = [];

    for (const group of groups) {
        // Duplicate names would collide in the generated config (last write wins downstream),
        // so keep the first occurrence and drop later ones deterministically.
        if (seenNames.has(group.name)) continue;
        seenNames.add(group.name);

        const source = Array.isArray(value) ? value[group.index] : null;
        result.push({
            name: group.name,
            urls: group.urls,
            defaultOption: normalizeOptionalString(source?.defaultOption)
        });
    }

    return result;
}

function normalizeGroupDefaults(value) {
    if (!isPlainObject(value)) return {};

    const result = {};
    for (const [rawName, rawOption] of Object.entries(value)) {
        // Only string -> string pairs are meaningful; anything else cannot be a group/option name.
        if (typeof rawOption !== 'string') continue;
        const name = rawName.trim();
        const option = rawOption.trim();
        if (!name || !option) continue;
        result[name] = option;
    }
    return result;
}

function normalizeTemplates(value) {
    if (!Array.isArray(value)) return [];

    const seenIds = new Set();
    let defaultClaimed = false;
    const result = [];

    for (const item of value) {
        if (!isPlainObject(item)) continue;

        const id = typeof item.id === 'string' ? item.id.trim() : '';
        // Ids are referenced by stored links, so a bad or duplicated id makes the template
        // unreachable; skipping it keeps the rest of the list usable.
        if (!TEMPLATE_ID_PATTERN.test(id) || seenIds.has(id)) continue;
        seenIds.add(id);

        const wantsDefault = item.isDefault === true;
        // At most one default template, otherwise selection would depend on list order.
        const isDefault = wantsDefault && !defaultClaimed;
        if (isDefault) defaultClaimed = true;

        result.push({
            id,
            name: normalizeOptionalString(item.name),
            enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
            isDefault,
            clashRuleBase: normalizeOptionalHttpUrl(item.clashRuleBase),
            quanxRuleBase: normalizeOptionalHttpUrl(item.quanxRuleBase),
            omittedGroups: normalizeStringList(item.omittedGroups),
            subconverterLines: normalizeSubconverterLines(item.subconverterLines),
            fallbackClashConfig: cloneFallbackClashConfig(item.fallbackClashConfig)
        });
    }

    return result;
}

function normalizeSubconverterLines(value) {
    if (!Array.isArray(value)) return [];
    return value
        // A newline inside a line would inject extra subconverter directives, so drop such lines.
        .filter(line => typeof line === 'string' && !/[\r\n]/.test(line))
        .map(line => line.trim())
        .filter(Boolean);
}

function normalizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeOptionalHttpUrl(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    // Newlines would let a stored value smuggle extra headers into outbound requests.
    if (!trimmed || /[\r\n]/.test(trimmed)) return '';

    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : '';
    } catch {
        return '';
    }
}

function normalizeOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cloneFallbackClashConfig(value) {
    if (!isPlainObject(value)) return null;
    try {
        // Deep copy keeps the stored config isolated from later caller mutations.
        return cloneJson(value);
    } catch {
        // Unserializable values (e.g. cyclic objects) cannot be persisted anyway.
        return null;
    }
}

function assertSavableConfig(raw) {
    // A non-object payload cannot be interpreted at all, so failing loud beats persisting an
    // empty config that silently wipes the operator's settings.
    if (!isPlainObject(raw)) {
        throw new InvalidConfigError('Admin config must be a JSON object');
    }

    for (const [field, kind] of CONTAINER_FIELDS) {
        const value = raw[field];
        // Absent fields are legitimate partial updates; only a present wrong type is an error.
        if (value === undefined) continue;

        const valid = kind === 'array' ? Array.isArray(value) : isPlainObject(value);
        if (!valid) {
            throw new InvalidConfigError(`Admin config field "${field}" must be ${kind === 'array' ? 'an array' : 'an object'}`);
        }
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object') return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}