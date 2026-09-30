import { describe, it, expect, vi } from 'vitest';
import {
    ADMIN_CONFIG_KEY,
    ADMIN_CONFIG_VERSION,
    DEFAULT_ADMIN_CONFIG,
    AdminConfigService,
    normalizeAdminConfig
} from '../src/services/adminConfigService.js';
import { InvalidConfigError } from '../src/services/errors.js';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

// The no-KV fallback store is module-global, so tests that exercise it start from a reset.
const freshMemoryService = async () => {
    const service = new AdminConfigService();
    await service.resetConfig();
    return service;
};

describe('DEFAULT_ADMIN_CONFIG', () => {
    it('has the documented shape', () => {
        expect(DEFAULT_ADMIN_CONFIG).toEqual({
            version: ADMIN_CONFIG_VERSION,
            defaultRulePreset: 'balanced',
            profileUpdateIntervalHours: 24,
            customRuleSets: [],
            groupDefaults: {},
            templates: []
        });
    });

    it('is deeply frozen so callers cannot mutate the shared default', () => {
        expect(Object.isFrozen(DEFAULT_ADMIN_CONFIG)).toBe(true);
        expect(Object.isFrozen(DEFAULT_ADMIN_CONFIG.templates)).toBe(true);
    });

    it('is returned as an independent copy', async () => {
        const service = await freshMemoryService();
        const first = await service.getConfig();
        first.templates.push({ id: 'mutated' });
        first.groupDefaults.Google = 'DIRECT';

        const second = await service.getConfig();
        expect(second.templates).toEqual([]);
        expect(second.groupDefaults).toEqual({});
    });
});

describe('normalizeAdminConfig', () => {
    it('degrades garbage input to defaults without throwing', () => {
        for (const garbage of [undefined, null, 42, 'garbage', [], true, () => {}, new Date()]) {
            expect(normalizeAdminConfig(garbage)).toEqual(DEFAULT_ADMIN_CONFIG);
        }
    });

    it('always stamps the code-owned version', () => {
        expect(normalizeAdminConfig({ version: 99 }).version).toBe(ADMIN_CONFIG_VERSION);
        expect(normalizeAdminConfig({ version: 'nope' }).version).toBe(ADMIN_CONFIG_VERSION);
    });

    it('trims defaultRulePreset and falls back when blank or non-string', () => {
        expect(normalizeAdminConfig({ defaultRulePreset: '  minimal  ' }).defaultRulePreset).toBe('minimal');
        expect(normalizeAdminConfig({ defaultRulePreset: '   ' }).defaultRulePreset).toBe('balanced');
        expect(normalizeAdminConfig({ defaultRulePreset: 42 }).defaultRulePreset).toBe('balanced');
    });

    it('normalizes the client profile update interval in hours', () => {
        expect(normalizeAdminConfig({ profileUpdateIntervalHours: 12 }).profileUpdateIntervalHours).toBe(12);
        expect(normalizeAdminConfig({ profileUpdateIntervalHours: '48' }).profileUpdateIntervalHours).toBe(48);
        expect(normalizeAdminConfig({ profileUpdateIntervalHours: 12.9 }).profileUpdateIntervalHours).toBe(12);

        expect(normalizeAdminConfig({ profileUpdateIntervalHours: 720 }).profileUpdateIntervalHours).toBe(720);

        for (const bad of [undefined, null, 0, -1, Infinity, 'nope']) {
            expect(normalizeAdminConfig({ profileUpdateIntervalHours: bad }).profileUpdateIntervalHours).toBe(24);
        }
    });

    describe('customRuleSets', () => {
        it('keeps the first entry of a duplicated name and drops the rest', () => {
            const config = normalizeAdminConfig({
                customRuleSets: [
                    { name: 'Group A', urls: ['https://a.test/1.list'], defaultOption: ' DIRECT ' },
                    { name: 'Group A', urls: ['https://dup.test/2.list'], defaultOption: 'PROXY' },
                    { name: 'Group B', url: 'https://b.test/3.list' }
                ]
            });

            expect(config.customRuleSets).toEqual([
                { name: 'Group A', urls: ['https://a.test/1.list'], defaultOption: 'DIRECT' },
                { name: 'Group B', urls: ['https://b.test/3.list'], defaultOption: '' }
            ]);
        });

        it('pairs defaultOption with the original array index, not the filtered one', () => {
            const config = normalizeAdminConfig({
                customRuleSets: [
                    { name: '', urls: ['https://skipped.test/x.list'], defaultOption: 'NOPE' },
                    { name: 'Kept', urls: ['https://kept.test/x.list'], defaultOption: ' PROXY ' }
                ]
            });

            expect(config.customRuleSets).toEqual([
                { name: 'Kept', urls: ['https://kept.test/x.list'], defaultOption: 'PROXY' }
            ]);
        });

        it('drops entries without a usable name or URLs, and non-arrays', () => {
            const config = normalizeAdminConfig({
                customRuleSets: [
                    null,
                    'nope',
                    { name: 'NoUrls', urls: [] },
                    { name: '  ', urls: ['https://a.test/x.list'] },
                    { name: 'BlankUrls', urls: ['   '] },
                    { name: 'Good', urls: ['https://good.test/x.list'] }
                ]
            });

            expect(config.customRuleSets).toEqual([
                { name: 'Good', urls: ['https://good.test/x.list'], defaultOption: '' }
            ]);
            expect(normalizeAdminConfig({ customRuleSets: 'nope' }).customRuleSets).toEqual([]);
        });
    });

    describe('groupDefaults', () => {
        it('keeps only trimmed string pairs', () => {
            const config = normalizeAdminConfig({
                groupDefaults: {
                    '  Group A  ': '  DIRECT  ',
                    'Group B': 7,
                    'Group C': null,
                    '   ': 'DIRECT',
                    'Group D': '   '
                }
            });

            expect(config.groupDefaults).toEqual({ 'Group A': 'DIRECT' });
        });

        it('returns an empty object for non-objects', () => {
            expect(normalizeAdminConfig({ groupDefaults: [] }).groupDefaults).toEqual({});
            expect(normalizeAdminConfig({ groupDefaults: 'x' }).groupDefaults).toEqual({});
        });
    });

    describe('templates', () => {
        it('skips ids that are unsafe for URLs and duplicated ids', () => {
            const config = normalizeAdminConfig({
                templates: [
                    { id: 'good-1' },
                    { id: 'good-1' },
                    { id: 'UPPER' },
                    { id: 'has space' },
                    { id: 'has_underscore' },
                    { id: '-leading' },
                    { id: '' },
                    { id: 'a'.repeat(42) },
                    { id: 42 },
                    'not-an-object',
                    null,
                    { id: 'good-2' }
                ]
            });

            expect(config.templates.map(t => t.id)).toEqual(['good-1', 'good-2']);
        });

        it('keeps at most one default template, first one wins', () => {
            const config = normalizeAdminConfig({
                templates: [
                    { id: 'first', isDefault: false },
                    { id: 'second', isDefault: true },
                    { id: 'third', isDefault: true },
                    { id: 'fourth', isDefault: 'yes' }
                ]
            });

            expect(config.templates.map(t => [t.id, t.isDefault])).toEqual([
                ['first', false],
                ['second', true],
                ['third', false],
                ['fourth', false]
            ]);
        });

        it('normalizes each template field defensively', () => {
            const config = normalizeAdminConfig({
                templates: [{
                    id: 'tpl-1',
                    name: '  My Template  ',
                    enabled: 'yes',
                    isDefault: true,
                    clashRuleBase: 'https://clash.test/base.yml',
                    subconverterLines: ['ruleset=A,https://a.test/x.list', '  ', 42, '', 'a\nb', 'ruleset=B,https://b.test/y.list']
                }]
            });

            expect(config.templates[0]).toEqual({
                id: 'tpl-1',
                name: 'My Template',
                enabled: true,
                isDefault: true,
                clashRuleBase: 'https://clash.test/base.yml',
                subconverterLines: ['ruleset=A,https://a.test/x.list', 'ruleset=B,https://b.test/y.list']
            });
        });

        it('defaults enabled to true and honours an explicit false', () => {
            const config = normalizeAdminConfig({
                templates: [{ id: 'on', enabled: 'nope' }, { id: 'off', enabled: false }]
            });

            expect(config.templates.map(t => [t.id, t.enabled])).toEqual([['on', true], ['off', false]]);
        });

        it('drops subconverter lines containing newlines to block directive injection', () => {
            const config = normalizeAdminConfig({
                templates: [{
                    id: 'inject',
                    subconverterLines: [
                        'ruleset=A,https://a.test/x.list',
                        'ruleset=B,https://b.test/y.list\nruleset=Evil,[]FINAL',
                        'ruleset=C,https://c.test/z.list\r\nruleset=Evil2,[]FINAL'
                    ]
                }]
            });

            expect(config.templates[0].subconverterLines).toEqual(['ruleset=A,https://a.test/x.list']);
            expect(config.templates[0].subconverterLines.join('\n')).not.toContain('Evil');
        });

        it('returns an empty list for non-arrays', () => {
            expect(normalizeAdminConfig({ templates: 'nope' }).templates).toEqual([]);
            expect(normalizeAdminConfig({ templates: {} }).templates).toEqual([]);
        });
    });
});

describe('AdminConfigService.saveConfig', () => {
    it('rejects a non-object payload with InvalidConfigError', async () => {
        const service = new AdminConfigService(new MemoryKVAdapter());

        for (const bad of [null, undefined, 42, 'config', [], true]) {
            const error = await service.saveConfig(bad).catch(err => err);
            expect(error).toBeInstanceOf(InvalidConfigError);
            expect(error.status).toBe(400);
            expect(error.message).toContain('JSON object');
        }
    });

    it('rejects present container fields of the wrong type but allows them to be absent', async () => {
        const service = new AdminConfigService(new MemoryKVAdapter());

        const rejected = [
            { customRuleSets: {} },
            { customRuleSets: 'x' },
            { templates: 'x' },
            { templates: {} },
            { groupDefaults: [] },
            { groupDefaults: 'x' }
        ];

        for (const bad of rejected) {
            const error = await service.saveConfig(bad).catch(err => err);
            expect(error).toBeInstanceOf(InvalidConfigError);
            expect(error.status).toBe(400);
        }

        // A partial update is legitimate: absent container fields must not throw.
        await expect(service.saveConfig({ defaultRulePreset: 'minimal' })).resolves.toBeTruthy();
        await expect(service.saveConfig({ customRuleSets: [] })).resolves.toBeTruthy();
    });

    it('returns the normalized config', async () => {
        const service = new AdminConfigService(new MemoryKVAdapter());
        const saved = await service.saveConfig({
            defaultRulePreset: '  minimal  ',
            profileUpdateIntervalHours: 6,
            groupDefaults: { Google: 'DIRECT' }
        });

        expect(saved.version).toBe(ADMIN_CONFIG_VERSION);
        expect(saved.defaultRulePreset).toBe('minimal');
        expect(saved.profileUpdateIntervalHours).toBe(6);
        expect(saved.groupDefaults).toEqual({ Google: 'DIRECT' });
    });
});

describe('AdminConfigService KV round trip', () => {
    it('persists under the documented key and reads the value back', async () => {
        const kv = new MemoryKVAdapter();
        const service = new AdminConfigService(kv);

        await service.saveConfig({ defaultRulePreset: 'comprehensive', groupDefaults: { A: 'DIRECT' } });

        const payload = await kv.get(ADMIN_CONFIG_KEY);
        expect(JSON.parse(payload)).toMatchObject({
            version: ADMIN_CONFIG_VERSION,
            defaultRulePreset: 'comprehensive',
            groupDefaults: { A: 'DIRECT' }
        });

        // A separate service instance must see the stored config.
        const reloaded = await new AdminConfigService(kv).getConfig();
        expect(reloaded.defaultRulePreset).toBe('comprehensive');
        expect(reloaded.groupDefaults).toEqual({ A: 'DIRECT' });
    });

    it('deep-merges a partially stored config with the defaults', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, JSON.stringify({ groupDefaults: { A: 'DIRECT' } }));

        const config = await new AdminConfigService(kv).getConfig();

        expect(config).toEqual({
            ...DEFAULT_ADMIN_CONFIG,
            groupDefaults: { A: 'DIRECT' }
        });
        expect(config.templates).toEqual([]);
        expect(config.customRuleSets).toEqual([]);
    });

    it('falls back to defaults for a corrupt stored blob', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, '{{ definitely not json');

        expect(await new AdminConfigService(kv).getConfig()).toEqual(DEFAULT_ADMIN_CONFIG);
    });

    it('resetConfig clears both KV and the memory fallback', async () => {
        const kv = new MemoryKVAdapter();
        const service = new AdminConfigService(kv);
        await service.saveConfig({ defaultRulePreset: 'minimal' });

        const reset = await service.resetConfig();

        expect(reset).toEqual(DEFAULT_ADMIN_CONFIG);
        expect(await kv.get(ADMIN_CONFIG_KEY)).toBeNull();
        expect(await new AdminConfigService(kv).getConfig()).toEqual(DEFAULT_ADMIN_CONFIG);
    });

    it('falls back to the last in-memory value when KV reads fail', async () => {
        const flakyKv = {
            put: vi.fn(async () => {}),
            get: vi.fn(async () => { throw new Error('kv read down'); }),
            delete: vi.fn(async () => {})
        };
        const service = new AdminConfigService(flakyKv);
        await service.saveConfig({ defaultRulePreset: 'minimal' });

        const config = await service.getConfig();
        expect(config.defaultRulePreset).toBe('minimal');
        expect(flakyKv.get).toHaveBeenCalledWith(ADMIN_CONFIG_KEY);
    });

    it('surfaces a failing KV write instead of reporting success', async () => {
        const failingKv = {
            put: async () => { throw new Error('kv write down'); },
            get: async () => null,
            delete: async () => {}
        };

        await expect(new AdminConfigService(failingKv).saveConfig({ defaultRulePreset: 'minimal' }))
            .rejects.toThrow(/kv write down/);
    });
});

describe('AdminConfigService without KV', () => {
    it('round-trips through the in-memory fallback', async () => {
        const service = await freshMemoryService();
        expect(await service.getConfig()).toEqual(DEFAULT_ADMIN_CONFIG);

        await service.saveConfig({ defaultRulePreset: 'minimal', groupDefaults: { A: 'DIRECT' } });
        const config = await service.getConfig();

        expect(config.defaultRulePreset).toBe('minimal');
        expect(config.groupDefaults).toEqual({ A: 'DIRECT' });
        expect(config.templates).toEqual([]);
    });

    it('shares the in-memory fallback across instances', async () => {
        const service = await freshMemoryService();
        await service.saveConfig({ defaultRulePreset: 'comprehensive' });

        expect((await new AdminConfigService().getConfig()).defaultRulePreset).toBe('comprehensive');
    });

    it('resetConfig clears the in-memory fallback', async () => {
        const service = await freshMemoryService();
        await service.saveConfig({ defaultRulePreset: 'minimal' });

        expect(await service.resetConfig()).toEqual(DEFAULT_ADMIN_CONFIG);
        expect(await service.getConfig()).toEqual(DEFAULT_ADMIN_CONFIG);
    });

    it('returns an isolated copy of the defaults when nothing is stored', async () => {
        const service = await freshMemoryService();
        const first = await service.getConfig();
        first.templates.push({ id: 'mutated' });

        expect((await service.getConfig()).templates).toEqual([]);
    });
});