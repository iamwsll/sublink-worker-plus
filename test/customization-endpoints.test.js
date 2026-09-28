import { describe, it, expect, vi, afterEach } from 'vitest';
import yaml from 'js-yaml';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';
import { ADMIN_CONFIG_KEY } from '../src/services/adminConfigService.js';

const SS_NODES = [
    'ss://YWVzLTEyOC1nY206dGVzdA@hk1.example.com:443#HK-Node-1',
    'ss://YWVzLTEyOC1nY206dGVzdA@us1.example.com:444#US-Node-1'
].join('\n');

// vless:// carries its own udp flag, which is what /clash?udp= overrides.
const VLESS_UDP_OFF = 'vless://12345678-1234-1234-1234-1234567890ab@udp.example.com:443?security=tls&udp=false#UDP-Node';

const CUSTOM_GROUPS = [{ name: 'My Group', urls: ['https://g1.test/a.list', 'https://g2.test/b.list'] }];

const MINI_TEMPLATE = {
    id: 'mini',
    name: 'Mini Template',
    enabled: true,
    isDefault: false,
    clashRuleBase: '',
    quanxRuleBase: 'https://mini.test/quanx.conf',
    omittedGroups: [],
    subconverterLines: [
        'ruleset=Proxy,https://mini.test/lists/Google.list',
        'ruleset=Direct,[]GEOIP,CN',
        'ruleset=Final,[]FINAL',
        'custom_proxy_group=Auto`url-test`.*`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=Manual`select`.*',
        'custom_proxy_group=Proxy`select`[]Manual`[]DIRECT',
        'custom_proxy_group=Direct`select`[]DIRECT',
        'custom_proxy_group=Final`select`[]Proxy`[]DIRECT'
    ],
    fallbackClashConfig: { mode: 'rule', 'mixed-port': 7890 }
};

const createTestApp = (overrides = {}) => createApp({
    kv: overrides.kv ?? new MemoryKVAdapter(),
    assetFetcher: overrides.assetFetcher ?? null,
    logger: console,
    config: {
        configTtlSeconds: 60,
        shortLinkTtlSeconds: null,
        ...(overrides.config || {})
    }
});

const seedAdminConfig = async (kv, config) => {
    await kv.put(ADMIN_CONFIG_KEY, JSON.stringify(config));
};

const url = (path, params = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        search.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
    const query = search.toString();
    return `http://localhost${path}${query ? `?${query}` : ''}`;
};

const json = (key, value) => JSON.stringify(value);

const parseClash = (text) => yaml.load(text);

const findGroup = (config, name) => (config['proxy-groups'] || []).find(group => group.name === name);

// Every fetch-based test needs its own URL: the Clash base cache is module-global and keyed
// by URL, so a shared URL would let one test observe another test's cached payload.
let urlCounter = 0;
const uniqueBaseUrl = (label) => {
    urlCounter += 1;
    return `https://${label}-${urlCounter}.test/base.yml`;
};

const stubFetchYaml = (text, { ok = true, status = 200 } = {}) => {
    const fetchMock = vi.fn(async () => ({ ok, status, text: async () => text }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('/singbox customRuleGroups', () => {
    it('turns a query group into rule sets, a rule and a selector outbound', async () => {
        const app = createTestApp();
        const res = await app.request(url('/singbox', {
            config: SS_NODES,
            selectedRules: json('selectedRules', ['My Group']),
            customRuleGroups: json('customRuleGroups', CUSTOM_GROUPS)
        }));

        expect(res.status).toBe(200);
        const config = await res.json();

        const customRuleSets = config.route.rule_set.filter(ruleSet => ruleSet.tag.startsWith('custom-my-group-'));
        expect(customRuleSets).toHaveLength(2);
        expect(customRuleSets.map(ruleSet => ruleSet.url)).toEqual(['https://g1.test/a.list', 'https://g2.test/b.list']);
        expect(customRuleSets.every(ruleSet => ruleSet.format === 'source')).toBe(true);

        const rule = config.route.rules.find(entry => entry.outbound === 'My Group');
        expect(rule.rule_set).toEqual(customRuleSets.map(ruleSet => ruleSet.tag));

        const outbound = config.outbounds.find(entry => entry.tag === 'My Group');
        expect(outbound.type).toBe('selector');
        expect(outbound.outbounds).toContain('DIRECT');
        expect(outbound.outbounds).toContain('HK-Node-1');
    });

    it('keeps admin rule groups and lets a query group with the same name win', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            customRuleSets: [
                { name: 'Shared', urls: ['https://admin.test/shared.list'] },
                { name: 'Admin Only', urls: ['https://admin.test/only.list'] }
            ]
        });
        const app = createTestApp({ kv });

        const res = await app.request(url('/subconverter', {
            selectedRules: json('selectedRules', ['Shared', 'Admin Only']),
            customRuleGroups: json('customRuleGroups', [{ name: 'Shared', urls: ['https://query.test/shared.list'] }])
        }));

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('ruleset=Shared,https://query.test/shared.list');
        expect(text).not.toContain('https://admin.test/shared.list');
        expect(text).toContain('ruleset=Admin Only,https://admin.test/only.list');
    });

    it('applies admin rule groups without any query parameter', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            customRuleSets: [{ name: 'Admin Group', urls: ['https://admin.test/a.list'] }]
        });
        const app = createTestApp({ kv });

        const res = await app.request(url('/singbox', {
            config: SS_NODES,
            selectedRules: json('selectedRules', ['Admin Group'])
        }));

        const config = await res.json();
        expect(config.route.rule_set.some(ruleSet => ruleSet.url === 'https://admin.test/a.list')).toBe(true);
        expect(config.outbounds.some(entry => entry.tag === 'Admin Group')).toBe(true);
    });

    it('degrades malformed customRuleGroups to no custom groups instead of failing', async () => {
        const app = createTestApp();

        for (const raw of ['not json', '{"name":"x"}', '[{"urls":["https://a.test/x.list"]}]', '[{"name":"x","urls":[]}]']) {
            const res = await app.request(url('/singbox', {
                config: SS_NODES,
                selectedRules: json('selectedRules', ['My Group']),
                customRuleGroups: raw
            }));
            expect(res.status).toBe(200);
            const config = await res.json();
            expect(config.route.rule_set.some(ruleSet => ruleSet.tag.startsWith('custom-'))).toBe(false);
            expect(config.outbounds.some(entry => entry.tag === 'My Group')).toBe(false);
        }
    });

    it('accepts the legacy singular url field', async () => {
        const app = createTestApp();
        const res = await app.request(url('/singbox', {
            config: SS_NODES,
            selectedRules: json('selectedRules', ['Legacy']),
            customRuleGroups: json('customRuleGroups', [{ name: 'Legacy', url: 'https://legacy.test/a.list' }])
        }));

        const config = await res.json();
        const ruleSet = config.route.rule_set.find(entry => entry.tag.startsWith('custom-legacy-'));
        expect(ruleSet.url).toBe('https://legacy.test/a.list');
    });
});

describe('/singbox group_defaults', () => {
    const GOOGLE_GROUP = '🔍 谷歌服务';

    it('moves the preferred option to the front of the named selector', async () => {
        const app = createTestApp();
        const res = await app.request(url('/singbox', {
            config: SS_NODES,
            group_defaults: json('group_defaults', { Google: 'DIRECT' })
        }));

        const config = await res.json();
        const group = config.outbounds.find(entry => entry.tag === GOOGLE_GROUP);
        expect(group.outbounds[0]).toBe('DIRECT');
    });

    it('leaves every selector untouched without group_defaults', async () => {
        const app = createTestApp();
        const res = await app.request(url('/singbox', { config: SS_NODES }));

        const config = await res.json();
        const group = config.outbounds.find(entry => entry.tag === GOOGLE_GROUP);
        expect(group.outbounds[0]).toBe('🚀 节点选择');
    });

    it('falls back to the admin group defaults when the query omits them', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { groupDefaults: { Google: 'DIRECT' } });
        const app = createTestApp({ kv });

        const res = await app.request(url('/singbox', { config: SS_NODES }));

        const config = await res.json();
        expect(config.outbounds.find(entry => entry.tag === GOOGLE_GROUP).outbounds[0]).toBe('DIRECT');
    });

    it('lets query group_defaults replace the admin map wholesale', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { groupDefaults: { Google: 'DIRECT' } });
        const app = createTestApp({ kv });

        const res = await app.request(url('/singbox', {
            config: SS_NODES,
            group_defaults: json('group_defaults', { Youtube: 'DIRECT' })
        }));

        const config = await res.json();
        // Query values win for the whole map, so the admin-only Google default is not merged in.
        expect(config.outbounds.find(entry => entry.tag === GOOGLE_GROUP).outbounds[0]).toBe('🚀 节点选择');
        expect(config.outbounds.find(entry => entry.tag === '📹 油管视频').outbounds[0]).toBe('DIRECT');
    });

    it('ignores a preferred option the group does not offer', async () => {
        const app = createTestApp();
        const res = await app.request(url('/singbox', {
            config: SS_NODES,
            group_defaults: json('group_defaults', { Google: 'Not-A-Member' })
        }));

        const config = await res.json();
        expect(config.outbounds.find(entry => entry.tag === GOOGLE_GROUP).outbounds[0]).toBe('🚀 节点选择');
    });

    it('degrades malformed group_defaults to none', async () => {
        const app = createTestApp();

        for (const raw of ['not json', '[]', '[["Google","DIRECT"]]', '{"Google":42}']) {
            const res = await app.request(url('/singbox', { config: SS_NODES, group_defaults: raw }));
            expect(res.status).toBe(200);
            const config = await res.json();
            expect(config.outbounds.find(entry => entry.tag === GOOGLE_GROUP).outbounds[0]).toBe('🚀 节点选择');
        }
    });

    it('defaults a rule outbound to DIRECT without any group_defaults', async () => {
        const app = createTestApp();
        const res = await app.request(url('/singbox', { config: SS_NODES }));

        const config = await res.json();
        // Location:CN is a DIRECT-default rule, so DIRECT leads even with no admin input.
        expect(config.outbounds.find(entry => entry.tag === '🔒 国内服务').outbounds[0]).toBe('DIRECT');
    });
});

describe('/singbox and /surge rule selection from admin config', () => {
    it('uses the admin defaultRulePreset when the query has no selectedRules', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { defaultRulePreset: 'minimal' });
        const app = createTestApp({ kv });

        const config = await (await app.request(url('/singbox', { config: SS_NODES }))).json();

        expect(config.outbounds.some(entry => entry.tag === '📹 油管视频')).toBe(false);
        expect(config.outbounds.some(entry => entry.tag === '🔒 国内服务')).toBe(true);
    });

    it('lets the selectedRules query override the admin preset', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { defaultRulePreset: 'minimal' });
        const app = createTestApp({ kv });

        const config = await (await app.request(url('/singbox', {
            config: SS_NODES,
            selectedRules: 'comprehensive'
        }))).json();

        expect(config.outbounds.some(entry => entry.tag === '📹 油管视频')).toBe(true);
    });

    it('falls back to balanced for an unknown admin preset', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { defaultRulePreset: 'no-such-preset' });
        const app = createTestApp({ kv });

        const config = await (await app.request(url('/singbox', { config: SS_NODES }))).json();

        expect(config.outbounds.some(entry => entry.tag === '📹 油管视频')).toBe(true);
    });
});

describe('/clash udp flag', () => {
    const udpOf = (config) => config.proxies.find(proxy => proxy.name === 'UDP-Node').udp;

    it('forces udp=true over the value carried by the node', async () => {
        const app = createTestApp();
        const res = await app.request(url('/clash', { config: VLESS_UDP_OFF, udp: 'true' }));

        expect(res.status).toBe(200);
        expect(udpOf(parseClash(await res.text()))).toBe(true);
    });

    it('forces udp=false over the value carried by the node', async () => {
        const app = createTestApp();
        const res = await app.request(url('/clash', { config: VLESS_UDP_OFF, udp: 'false' }));

        expect(udpOf(parseClash(await res.text()))).toBe(false);
    });

    it('defaults to udp=true when udp is absent', async () => {
        const app = createTestApp();
        const res = await app.request(url('/clash', { config: VLESS_UDP_OFF }));

        expect(udpOf(parseClash(await res.text()))).toBe(true);
    });

    it('falls back to the udp=true default for an unparseable value', async () => {
        const app = createTestApp();
        const res = await app.request(url('/clash', { config: VLESS_UDP_OFF, udp: 'maybe' }));

        expect(udpOf(parseClash(await res.text()))).toBe(true);
    });
});

describe('/clash clash_rule_base', () => {
    it('fetches the remote YAML with the request user agent and merges it as the base config', async () => {
        const baseUrl = uniqueBaseUrl('fetch');
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 4321\nproxy-groups: []\n');
        const app = createTestApp();

        const res = await app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl, ua: 'subconverter/2.0' }));

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(baseUrl);
        expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe('subconverter/2.0');

        const config = parseClash(await res.text());
        expect(config['mixed-port']).toBe(4321);
        expect(config.mode).toBe('global');
        // The subscription still owns proxies and rules regardless of the remote base.
        expect(config.proxies.map(proxy => proxy.name)).toEqual(['HK-Node-1', 'US-Node-1']);
        expect(config.rules.at(-1)).toBe('MATCH,🐟 漏网之鱼');
    });

    it('accepts the camelCase clashRuleBase alias', async () => {
        const baseUrl = uniqueBaseUrl('camel');
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 5555\n');
        const app = createTestApp();

        const res = await app.request(url('/clash', { config: SS_NODES, clashRuleBase: baseUrl }));

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(parseClash(await res.text())['mixed-port']).toBe(5555);
    });

    it('serves a cached base config on the second request', async () => {
        const baseUrl = uniqueBaseUrl('cached');
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 6001\n');
        const app = createTestApp();
        const request = () => app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl, clash_rule_base_ttl: '600' }));

        const first = await request();
        const second = await request();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(parseClash(await first.text())['mixed-port']).toBe(6001);
        expect(parseClash(await second.text())['mixed-port']).toBe(6001);
    });

    it('disables caching with clash_rule_base_ttl=0', async () => {
        const baseUrl = uniqueBaseUrl('nocache');
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 6002\n');
        const app = createTestApp();
        const request = () => app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl, clash_rule_base_ttl: '0' }));

        await request();
        await request();

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('bypasses the cache with clash_rule_base_refresh=true', async () => {
        const baseUrl = uniqueBaseUrl('refresh');
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 6003\n');
        const app = createTestApp();

        await app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl, clash_rule_base_ttl: '600' }));
        await app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl, clash_rule_base_ttl: '600', clash_rule_base_refresh: 'true' }));

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns 400 when the remote base config cannot be fetched', async () => {
        const baseUrl = uniqueBaseUrl('missing');
        stubFetchYaml('', { ok: false, status: 404 });
        const app = createTestApp();

        const res = await app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl }));

        expect(res.status).toBe(400);
        expect(await res.text()).toContain('404');
    });

    it('returns 400 when the remote base config is not a YAML mapping', async () => {
        const baseUrl = uniqueBaseUrl('notmapping');
        stubFetchYaml('- just\n- a list\n');
        const app = createTestApp();

        const res = await app.request(url('/clash', { config: SS_NODES, clash_rule_base: baseUrl }));

        expect(res.status).toBe(400);
        expect(await res.text()).toContain('clash_rule_base');
    });

    it('rejects a newline-bearing clash_rule_base without fetching', async () => {
        const fetchMock = stubFetchYaml('mode: global\n');
        const app = createTestApp();

        const res = await app.request(url('/clash', { config: SS_NODES, clash_rule_base: 'https://a.test/x.yml\nX-Injected: 1' }));

        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('/clash templates', () => {
    it('applies the default template when the request carries no customization', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true }] });
        const app = createTestApp({ kv });

        const res = await app.request(url('/clash', { config: SS_NODES }));

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/yaml');
        const config = parseClash(await res.text());

        expect(Object.keys(config['rule-providers'])).toEqual(['Google']);
        expect(config['rule-providers'].Google.url).toBe('https://mini.test/lists/Google.list');
        // The template owns the rule section, including the terminal MATCH.
        expect(config.rules).toEqual(['RULE-SET,Google,Proxy', 'GEOIP,CN,Direct', 'MATCH,Final']);
        expect(config['proxy-groups'].map(group => group.name)).toEqual(['Auto', 'Manual', 'Proxy', 'Direct', 'Final']);
        expect(config.proxies.map(proxy => proxy.name)).toEqual(['HK-Node-1', 'US-Node-1']);
    });

    it('applies an explicit template id even when the request is customizing rules', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true }] });
        const app = createTestApp({ kv });

        const res = await app.request(url('/clash', {
            config: SS_NODES,
            selectedRules: 'minimal',
            template: 'mini'
        }));

        const config = parseClash(await res.text());
        expect(config.rules).toEqual(['RULE-SET,Google,Proxy', 'GEOIP,CN,Direct', 'MATCH,Final']);
    });

    it('skips the default template as soon as a customization parameter is present', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true }] });
        const app = createTestApp({ kv });

        const cases = [
            { selectedRules: 'minimal' },
            { customRules: json('customRules', [{ name: 'Custom', domain_suffix: ['x.test'] }]) },
            { customRuleGroups: json('customRuleGroups', CUSTOM_GROUPS) },
            { configId: 'clash_missing' },
            // An explicit base URL is itself a customization: the template's rules must not apply.
            { clash_rule_base: uniqueBaseUrl('blocks-template') }
        ];

        for (const extra of cases) {
            if (extra.clash_rule_base) stubFetchYaml('mode: rule\nmixed-port: 9091\n');
            const res = await app.request(url('/clash', { config: SS_NODES, ...extra }));
            expect(res.status).toBe(200);
            const config = parseClash(await res.text());
            expect(config.rules.at(-1)).toBe('MATCH,🐟 漏网之鱼');
            expect(config['rule-providers'].Google).toBeUndefined();
            vi.unstubAllGlobals();
        }
    });

    it('falls back to the built-in rules for an unknown or disabled template id', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: false, isDefault: false }] });
        const app = createTestApp({ kv });

        for (const template of ['mini', 'nope']) {
            const res = await app.request(url('/clash', { config: SS_NODES, template }));
            expect(res.status).toBe(200);
            const config = parseClash(await res.text());
            expect(config.rules.at(-1)).toBe('MATCH,🐟 漏网之鱼');
            expect(config['rule-providers'].Google).toBeUndefined();
        }
    });

    it('uses the template clashRuleBase as the base config', async () => {
        const baseUrl = uniqueBaseUrl('template-base');
        const fallback = 'mode: rule\nmixed-port: 1111\n';
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 2222\n');
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true, clashRuleBase: baseUrl, fallbackClashConfig: yaml.load(fallback) }]
        });
        const app = createTestApp({ kv });

        const res = await app.request(url('/clash', { config: SS_NODES }));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(baseUrl);
        const config = parseClash(await res.text());
        expect(config['mixed-port']).toBe(2222);
        expect(config.rules.at(-1)).toBe('MATCH,Final');
    });

    it('uses the embedded fallback config when the template has no base URL', async () => {
        const fetchMock = stubFetchYaml('mode: global\n');
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true }] });
        const app = createTestApp({ kv });

        const config = parseClash(await (await app.request(url('/clash', { config: SS_NODES }))).text());

        expect(fetchMock).not.toHaveBeenCalled();
        expect(config['mixed-port']).toBe(7890);
        expect(config.mode).toBe('rule');
    });

    it('lets an explicit clash_rule_base replace the template base while keeping its rules', async () => {
        const queryBase = uniqueBaseUrl('query-wins');
        const fetchMock = stubFetchYaml('mode: global\nmixed-port: 3333\n');
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{ ...MINI_TEMPLATE, enabled: true, clashRuleBase: uniqueBaseUrl('template-loses') }]
        });
        const app = createTestApp({ kv });

        const res = await app.request(url('/clash', { config: SS_NODES, template: 'mini', clash_rule_base: queryBase }));

        expect(fetchMock.mock.calls.map(call => call[0])).toEqual([queryBase]);
        const config = parseClash(await res.text());
        expect(config['mixed-port']).toBe(3333);
        expect(config.rules).toEqual(['RULE-SET,Google,Proxy', 'GEOIP,CN,Direct', 'MATCH,Final']);
    });

    it('dedupes repeated provider file names from the template', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{
                ...MINI_TEMPLATE,
                isDefault: true,
                subconverterLines: [
                    'ruleset=A,https://one.test/lists/Web.list',
                    'ruleset=B,https://two.test/lists/Web.list',
                    'ruleset=Final,[]FINAL',
                    'custom_proxy_group=A`select`.*',
                    'custom_proxy_group=B`select`.*',
                    'custom_proxy_group=Final`select`[]A`[]DIRECT'
                ]
            }]
        });
        const app = createTestApp({ kv });

        const config = parseClash(await (await app.request(url('/clash', { config: SS_NODES }))).text());

        expect(Object.keys(config['rule-providers'])).toEqual(['Web', 'Web-2']);
        expect(config.rules).toEqual(['RULE-SET,Web,A', 'RULE-SET,Web-2,B', 'MATCH,Final']);
    });

    it('keeps the subscription proxies alongside the template rule section', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, isDefault: true }] });
        const app = createTestApp({ kv });

        const config = parseClash(await (await app.request(url('/clash', {
            config: SS_NODES,
            template: 'mini'
        }))).text());

        expect(config.rules.at(-1)).toBe('MATCH,Final');
        expect(config.proxies.map(proxy => proxy.name)).toEqual(['HK-Node-1', 'US-Node-1']);
        expect(config['rule-providers'].Google).toBeDefined();
    });
});

describe('/surge customization', () => {
    it('turns a query rule group into a RULE-SET rule and a group', async () => {
        const app = createTestApp();
        const res = await app.request(url('/surge', {
            config: SS_NODES,
            selectedRules: json('selectedRules', ['My Group']),
            customRuleGroups: json('customRuleGroups', CUSTOM_GROUPS)
        }));

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('My Group = select,');
        // Surge has no per-group rule URLs, so a custom group is reached through the shared
        // geo rule-set base and only its group name appears in the rule.
        expect(text).toContain('RULE-SET,https://gh-proxy.com/https://github.com/NSZA156/surge-geox-rules/raw/refs/heads/release/geo/geosite/custom-my-group-1-1.conf,My Group');
        expect(text).toContain('RULE-SET,https://gh-proxy.com/https://github.com/NSZA156/surge-geox-rules/raw/refs/heads/release/geo/geosite/custom-my-group-1-2.conf,My Group');
        expect(text.split('[Rule]')[1]).not.toContain('g1.test');
        expect(text).toContain('FINAL,🐟 漏网之鱼');
    });

    it('honours group_defaults by leading the group with the preferred option', async () => {
        const app = createTestApp();
        const res = await app.request(url('/surge', {
            config: SS_NODES,
            selectedRules: json('selectedRules', ['My Group']),
            customRuleGroups: json('customRuleGroups', CUSTOM_GROUPS),
            group_defaults: json('group_defaults', { 'My Group': 'DIRECT' })
        }));

        const text = await res.text();
        const groupLine = text.split('\n').find(line => line.startsWith('My Group = select,'));
        expect(groupLine).toContain('select, DIRECT,');
    });

    it('ignores a template id and keeps the built-in rule section', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true }] });
        const app = createTestApp({ kv });

        const res = await app.request(url('/surge', { config: SS_NODES, template: 'mini' }));

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain('mini.test');
        expect(text).toContain('FINAL,🐟 漏网之鱼');
    });
});

describe('/subconverter customization', () => {
    it('emits the template INI when the admin config has a default template', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{
                ...MINI_TEMPLATE,
                enabled: true,
                isDefault: true,
                clashRuleBase: 'https://mini.test/clash.yml'
            }]
        });
        const app = createTestApp({ kv });

        const res = await app.request('http://localhost/subconverter');

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/plain');
        const text = await res.text();
        expect(text).toContain('ruleset=Proxy,https://mini.test/lists/Google.list');
        expect(text).toContain('clash_rule_base=https://mini.test/clash.yml');
        expect(text).toContain('quanx_rule_base=https://mini.test/quanx.conf');
        expect(text).toContain('custom_proxy_group=Manual`select`.*');
        expect(text).toContain(';luck');
        // Template output replaces the preset output entirely.
        expect(text).not.toContain('enable_rule_generator=true');
    });

    it('lets template base URLs be overridden by query parameters', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true, clashRuleBase: 'https://mini.test/clash.yml' }]
        });
        const app = createTestApp({ kv });

        const res = await app.request(url('/subconverter', {
            clash_rule_base: 'https://override.test/clash.yml',
            quanx_rule_base: 'https://override.test/quanx.conf'
        }));

        const text = await res.text();
        expect(text).toContain('clash_rule_base=https://override.test/clash.yml');
        expect(text).toContain('quanx_rule_base=https://override.test/quanx.conf');
        expect(text).not.toContain('mini.test/clash.yml');
    });

    it('emits an explicit template by id', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: false }] });
        const app = createTestApp({ kv });

        const res = await app.request(url('/subconverter', { template: 'mini' }));

        const text = await res.text();
        expect(text).toContain('ruleset=Proxy,https://mini.test/lists/Google.list');
        expect(text).toContain('clash_rule_base=');
    });

    it('blocks the default template when the query customizes rule groups', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true, clashRuleBase: 'https://mini.test/clash.yml' }]
        });
        const app = createTestApp({ kv });

        const res = await app.request(url('/subconverter', {
            customRuleGroups: json('customRuleGroups', CUSTOM_GROUPS)
        }));

        const text = await res.text();
        expect(text).not.toContain('clash_rule_base=');
        expect(text).toContain('enable_rule_generator=true');
        expect(text).toContain('[custom]');
    });

    it('blocks the default template when selectedRules is given', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, {
            templates: [{ ...MINI_TEMPLATE, enabled: true, isDefault: true, clashRuleBase: 'https://mini.test/clash.yml' }]
        });
        const app = createTestApp({ kv });

        const text = await (await app.request('http://localhost/subconverter?selectedRules=minimal')).text();

        expect(text).not.toContain('clash_rule_base=');
        expect(text).toContain('GEOSITE,geolocation-cn');
        expect(text).not.toContain('GEOSITE,google');
    });

    it('uses the admin defaultRulePreset when no template applies', async () => {
        const kv = new MemoryKVAdapter();
        await seedAdminConfig(kv, { defaultRulePreset: 'minimal' });
        const app = createTestApp({ kv });

        const text = await (await app.request('http://localhost/subconverter')).text();

        expect(text).toContain('GEOSITE,geolocation-cn');
        expect(text).not.toContain('GEOSITE,google');
    });

    it('writes query rule groups as ruleset lines referencing their own URLs', async () => {
        const app = createTestApp();
        const res = await app.request(url('/subconverter', {
            selectedRules: json('selectedRules', ['My Group']),
            customRuleGroups: json('customRuleGroups', CUSTOM_GROUPS)
        }));

        const text = await res.text();
        expect(text).toContain('ruleset=My Group,https://g1.test/a.list');
        expect(text).toContain('ruleset=My Group,https://g2.test/b.list');
        expect(text).toContain('custom_proxy_group=My Group`select`');
    });

    it('honours group_defaults in the generated proxy group lines', async () => {
        const app = createTestApp();
        const res = await app.request(url('/subconverter', {
            group_defaults: json('group_defaults', { Google: 'DIRECT' })
        }));

        const text = await res.text();
        const googleLine = text.split('\n').find(line => line.startsWith('custom_proxy_group=🔍 谷歌服务`'));
        expect(googleLine).toContain('[]DIRECT');
        expect(googleLine.indexOf('[]DIRECT')).toBeLessThan(googleLine.indexOf('[]🚀 节点选择'));
    });

    it('keeps the built-in presets reachable without an admin config', async () => {
        const app = createTestApp();

        const balanced = await (await app.request('http://localhost/subconverter')).text();
        const comprehensive = await (await app.request('http://localhost/subconverter?selectedRules=comprehensive')).text();

        expect(balanced).toContain('GEOSITE,google');
        expect(comprehensive).toContain('GEOSITE,bilibili');
    });
});