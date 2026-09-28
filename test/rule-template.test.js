import { describe, it, expect } from 'vitest';
import { buildTemplateClashSections, generateTemplateSubconverterConfig, validateTemplateLines } from '../src/config/ruleTemplate.js';

const PROXY_NAMES = ['🇭🇰 香港01', '🇯🇵 日本01', '🇺🇲 美国01', 'HK-Edge', 'US-Relay'];
const PROVIDER_NAMES = ['provider-a', 'provider-b'];

const MINI_TEMPLATE = {
    id: 'mini',
    name: 'Mini',
    clashRuleBase: 'https://mini.test/clash.yml',
    quanxRuleBase: 'https://mini.test/quanx.conf',
    omittedGroups: ['Gone'],
    subconverterLines: [
        'ruleset=Proxy,https://mini.test/lists/Google.list',
        'ruleset=Proxy,https://mini.test/lists/OpenAi.list',
        'ruleset=Direct,https://mini.test/lists/China.list',
        'ruleset=Direct,[]GEOIP,CN',
        'ruleset=Final,[]FINAL',
        'custom_proxy_group=Auto`url-test`(HK|US)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=Manual`select`.*',
        'custom_proxy_group=Pick`select`[]Manual`[]DIRECT',
        'custom_proxy_group=Proxy`select`[]Manual`[]DIRECT',
        'custom_proxy_group=Direct`select`[]DIRECT',
        'custom_proxy_group=Final`select`[]Proxy`[]DIRECT',
        'custom_proxy_group=Gone`select`.*',
        'custom_proxy_group=Empty`select`'
    ]
};

// A fuller template exercising mixed rulesets, group references, omitted groups and
// url-test country patterns — the shape a real subconverter INI export has.
const COMPLEX_TEMPLATE = {
    id: 'complex',
    name: 'Complex',
    omittedGroups: ['🇭🇰 香港节点', '🎥 奈飞节点'],
    subconverterLines: [
        '[custom]',
        'ruleset=🎯 全球直连,https://fixture.test/lists/Lan.list',
        'ruleset=🎯 全球直连,https://fixture.test/lists/ChinaDomain.list',
        'ruleset=📲 电报消息,https://fixture.test/lists/Telegram.list',
        'ruleset=🎯 全球直连,[]GEOIP,CN',
        'ruleset=🐟 漏网之鱼,[]FINAL',
        'custom_proxy_group=🚀 节点选择`select`[]🚀 手动切换`[]🇭🇰 香港节点`[]♻️ 自动选择`[]DIRECT',
        'custom_proxy_group=🚀 手动切换`select`.*',
        'custom_proxy_group=♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=🇭🇰 香港节点`url-test`(港|HK|Hong Kong)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=🇯🇵 日本节点`url-test`(日本|东京|JP|Japan)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=🇺🇲 美国节点`url-test`(美|US|United States)`http://www.gstatic.com/generate_204`300,,150',
        'custom_proxy_group=🇰🇷 韩国节点`url-test`(KR|Korea|首尔)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=🇨🇳 台湾节点`url-test`(台|TW|Taiwan)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=🇸🇬 狮城节点`url-test`(新加坡|狮城|SG|Singapore)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=🎥 奈飞节点`select`(NF|奈飞|Netflix)',
        'custom_proxy_group=📲 电报消息`select`[]🚀 节点选择`[]♻️ 自动选择`[]DIRECT',
        'custom_proxy_group=🎯 全球直连`select`[]DIRECT`[]🚀 节点选择',
        'custom_proxy_group=🐟 漏网之鱼`select`[]🚀 节点选择`[]♻️ 自动选择`[]DIRECT'
    ]
};

describe('buildTemplateClashSections', () => {
    it('returns empty sections for missing or malformed templates', () => {
        const emptySections = { ruleProviders: {}, proxyGroups: [], rules: [] };

        expect(buildTemplateClashSections(null, {})).toEqual(emptySections);
        expect(buildTemplateClashSections(undefined)).toEqual(emptySections);
        expect(buildTemplateClashSections({})).toEqual(emptySections);
        expect(buildTemplateClashSections({ subconverterLines: 'nope' })).toEqual(emptySections);
        expect(buildTemplateClashSections({ subconverterLines: [1, null, {}, undefined] })).toEqual(emptySections);
        expect(buildTemplateClashSections({ subconverterLines: [''] })).toEqual(emptySections);
    });

    it('tolerates a missing or malformed options argument', () => {
        expect(buildTemplateClashSections(MINI_TEMPLATE)).toMatchObject({ rules: expect.any(Array) });
        expect(buildTemplateClashSections(MINI_TEMPLATE, undefined)).toMatchObject({ rules: expect.any(Array) });
        expect(buildTemplateClashSections(MINI_TEMPLATE, null)).toMatchObject({ rules: expect.any(Array) });
    });

    describe('mini template', () => {
        const sections = buildTemplateClashSections(MINI_TEMPLATE, {
            proxyNames: PROXY_NAMES,
            providerNames: PROVIDER_NAMES
        });

        it('turns ruleset lines into rule providers and rules', () => {
            expect(Object.keys(sections.ruleProviders)).toEqual(['Google', 'OpenAi', 'China']);
            expect(sections.ruleProviders.Google).toEqual({
                type: 'http',
                format: 'text',
                behavior: 'classical',
                url: 'https://mini.test/lists/Google.list',
                path: './ruleset/Google.list',
                interval: 86400
            });
            expect(sections.rules).toEqual([
                'RULE-SET,Google,Proxy',
                'RULE-SET,OpenAi,Proxy',
                'RULE-SET,China,Direct',
                'GEOIP,CN,Direct',
                'MATCH,Final'
            ]);
        });

        it('keeps MATCH as the last rule', () => {
            expect(sections.rules.at(-1)).toBe('MATCH,Final');
            expect(sections.rules.filter(rule => rule.startsWith('MATCH,')).length).toBe(1);
            expect(sections.rules.some(rule => rule.includes('FINAL'))).toBe(false);
        });

        it('emits url-test groups only for proxies matching the regex', () => {
            const auto = buildTemplateClashSections({
                subconverterLines: ['custom_proxy_group=Auto`url-test`(HK|US)`http://www.gstatic.com/generate_204`300,,50']
            }, { proxyNames: PROXY_NAMES, providerNames: PROVIDER_NAMES }).proxyGroups[0];

            expect(auto).toEqual({
                name: 'Auto',
                type: 'url-test',
                proxies: ['HK-Edge', 'US-Relay'],
                url: 'http://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50
            });

            const withCountryPrefix = buildTemplateClashSections({
                subconverterLines: ['custom_proxy_group=Auto`url-test`(香港|HK)']
            }, { proxyNames: PROXY_NAMES }).proxyGroups[0];
            expect(withCountryPrefix.proxies).toEqual(['🇭🇰 香港01', 'HK-Edge']);
        });

        it('gives url-test groups all proxies when the pattern is .*', () => {
            const auto = sections.proxyGroups.find(group => group.name === 'Auto');

            // The fixture pattern is (HK|US), so only the ASCII aliases match there.
            expect(auto.proxies).toEqual(['HK-Edge', 'US-Relay']);

            const catchAll = buildTemplateClashSections({
                subconverterLines: ['custom_proxy_group=All`url-test`.*`http://x`60']
            }, { proxyNames: PROXY_NAMES }).proxyGroups[0];

            expect(catchAll.proxies).toEqual(PROXY_NAMES);
            expect(catchAll.interval).toBe(60);
        });

        it('adds provider names to .*-matched groups', () => {
            const manual = sections.proxyGroups.find(group => group.name === 'Manual');

            expect(manual.proxies).toEqual(PROXY_NAMES);
            expect(manual.use).toEqual(PROVIDER_NAMES);

            const auto = sections.proxyGroups.find(group => group.name === 'Auto');
            expect(auto.use).toBeUndefined();
        });

        it('drops omitted groups and the references pointing at them', () => {
            expect(sections.proxyGroups.map(group => group.name))
                .toEqual(['Auto', 'Manual', 'Pick', 'Proxy', 'Direct', 'Final']);

            const pick = sections.proxyGroups.find(group => group.name === 'Pick');
            expect(pick.proxies).toEqual(['Manual', 'DIRECT']);
            // 'Gone' is not referenced anywhere as a member.
            expect(sections.proxyGroups.flatMap(group => group.proxies)).not.toContain('Gone');
        });

        it('drops a select group that has neither members nor providers', () => {
            // 'Empty' from MINI_TEMPLATE is absent from the shared sections entirely.
            expect(sections.proxyGroups.some(group => group.name === 'Empty')).toBe(false);

            const withoutProviders = buildTemplateClashSections({
                subconverterLines: ['custom_proxy_group=Empty`select`']
            }, { proxyNames: PROXY_NAMES }).proxyGroups;

            expect(withoutProviders).toEqual([]);
        });

        it('drops the group when the matcher regex is invalid', () => {
            const broken = buildTemplateClashSections({
                subconverterLines: ['custom_proxy_group=Auto`url-test`(?i)(HK`http://x`300']
            }, { proxyNames: PROXY_NAMES });

            expect(broken.proxyGroups).toEqual([]);
        });

        it('uses the default url-test url and interval when the line omits them', () => {
            const defaults = buildTemplateClashSections({
                subconverterLines: ['custom_proxy_group=Auto`url-test`.*']
            }, { proxyNames: PROXY_NAMES });

            expect(defaults.proxyGroups[0]).toEqual({
                name: 'Auto',
                type: 'url-test',
                proxies: PROXY_NAMES,
                url: 'http://www.gstatic.com/generate_204',
                interval: 300
            });
        });

        it('skips group lines without both a name and a type', () => {
            const sectionsWithBadLines = buildTemplateClashSections({
                subconverterLines: [
                    'custom_proxy_group=NoType',
                    'custom_proxy_group=',
                    'custom_proxy_group=`select`.*'
                ]
            }, { proxyNames: PROXY_NAMES });

            expect(sectionsWithBadLines.proxyGroups).toEqual([]);
        });

        it('dedupes provider names when different urls share a file name', () => {
            const deduped = buildTemplateClashSections({
                subconverterLines: [
                    'ruleset=A,https://one.test/lists/Google.list',
                    'ruleset=A,https://two.test/other/Google.list',
                    'custom_proxy_group=A`select`[]DIRECT'
                ]
            });

            expect(Object.keys(deduped.ruleProviders)).toEqual(['Google', 'Google-2']);
            expect(deduped.ruleProviders['Google-2'].path).toBe('./ruleset/Google-2.list');
            expect(deduped.rules).toEqual(['RULE-SET,Google,A', 'RULE-SET,Google-2,A']);
        });

        it('returns arrays and objects that are safe to mutate per call', () => {
            const first = buildTemplateClashSections(MINI_TEMPLATE, { proxyNames: ['HK-01'] });
            first.rules.push('BOGUS');
            first.ruleProviders.Google.url = 'https://mutated.test/x.list';

            const second = buildTemplateClashSections(MINI_TEMPLATE, { proxyNames: ['HK-01'] });
            expect(second.rules).not.toContain('BOGUS');
            expect(second.ruleProviders.Google.url).toBe('https://mini.test/lists/Google.list');
        });
    });

    describe('complex template', () => {
        const sections = buildTemplateClashSections(COMPLEX_TEMPLATE, {
            proxyNames: PROXY_NAMES,
            providerNames: PROVIDER_NAMES
        });

        it('produces non-empty sections', () => {
            expect(Object.keys(sections.ruleProviders).length).toBeGreaterThan(0);
            expect(sections.proxyGroups.length).toBeGreaterThan(0);
            expect(sections.rules.length).toBeGreaterThan(0);
        });

        it('ends the rules with MATCH', () => {
            expect(sections.rules.at(-1)).toMatch(/^MATCH,/);
            expect(sections.rules.filter(rule => rule.startsWith('MATCH,'))).toHaveLength(1);
        });

        it('strips every omitted group from the proxy groups', () => {
            const groupNames = sections.proxyGroups.map(group => group.name);

            for (const omitted of COMPLEX_TEMPLATE.omittedGroups) {
                expect(groupNames).not.toContain(omitted);
            }
        });

        it('strips references to omitted groups from remaining members', () => {
            const nodeSelect = sections.proxyGroups.find(group => group.name === '🚀 节点选择');

            expect(nodeSelect).toBeDefined();
            expect(nodeSelect.proxies).toEqual(['🚀 手动切换', '♻️ 自动选择', 'DIRECT']);
            for (const omitted of COMPLEX_TEMPLATE.omittedGroups) {
                expect(nodeSelect.proxies).not.toContain(omitted);
            }
            expect(sections.proxyGroups.flatMap(group => group.proxies)).not.toContain('🇭🇰 香港节点');
        });

        it('keeps every rule pointing at an existing proxy group or provider', () => {
            const groupNames = new Set(sections.proxyGroups.map(group => group.name));
            const providerNames = new Set(Object.keys(sections.ruleProviders));

            for (const rule of sections.rules) {
                if (rule.startsWith('MATCH,')) {
                    expect(groupNames.has(rule.split(',')[1])).toBe(true);
                    continue;
                }
                if (rule.startsWith('RULE-SET,')) {
                    const [, providerName, groupName] = rule.split(',');
                    expect(providerNames.has(providerName)).toBe(true);
                    expect(groupNames.has(groupName)).toBe(true);
                    continue;
                }
                // Inline rules such as GEOIP,CN,<group>
                expect(groupNames.has(rule.split(',').at(-1))).toBe(true);
            }
        });

        it('registers every provider with an http rule-provider shape', () => {
            for (const provider of Object.values(sections.ruleProviders)) {
                expect(provider.type).toBe('http');
                expect(provider.format).toBe('text');
                expect(provider.behavior).toBe('classical');
                expect(provider.url).toMatch(/^https?:\/\//);
                expect(provider.path).toMatch(/^\.\/ruleset\/.+\.list$/);
                expect(provider.interval).toBe(86400);
            }
        });

        it('maps the country url-test patterns onto the supplied proxy names', () => {
            const built = buildTemplateClashSections({
                subconverterLines: COMPLEX_TEMPLATE.subconverterLines
            }, { proxyNames: ['香港 IEPL 01', '日本 东京 02', '韩国 首尔 03', 'US Node 04'] });

            const hk = built.proxyGroups.find(group => group.name === '🇭🇰 香港节点');
            expect(hk).toEqual({
                name: '🇭🇰 香港节点',
                type: 'url-test',
                proxies: ['香港 IEPL 01'],
                url: 'http://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50
            });

            expect(built.proxyGroups.find(group => group.name === '🇯🇵 日本节点').proxies).toEqual(['日本 东京 02']);
            expect(built.proxyGroups.find(group => group.name === '🇺🇲 美国节点').proxies).toEqual(['US Node 04']);
            expect(built.proxyGroups.find(group => group.name === '🇰🇷 韩国节点').proxies).toEqual(['韩国 首尔 03']);
        });

        it('drops a url-test group whose pattern matches nothing', () => {
            const built = buildTemplateClashSections({
                subconverterLines: COMPLEX_TEMPLATE.subconverterLines
            }, { proxyNames: ['香港 IEPL 01', 'US Node 04'] });

            // 台湾/狮城 patterns match nothing, so those groups are dropped instead of
            // being stuffed with every proxy.
            const groupNames = built.proxyGroups.map(group => group.name);
            expect(groupNames).not.toContain('🇨🇳 台湾节点');
            expect(groupNames).not.toContain('🇸🇬 狮城节点');
        });

        it('strips rules and providers left dangling by dropped groups', () => {
            const built = buildTemplateClashSections({
                subconverterLines: [
                    'ruleset=📲 电报消息,https://fixture.test/lists/Telegram.list',
                    'ruleset=🎯 全球直连,[]GEOIP,CN',
                    'ruleset=🐟 漏网之鱼,[]FINAL',
                    'custom_proxy_group=📲 电报消息`select`(TG|Telegram)',
                    'custom_proxy_group=🎯 全球直连`select`[]DIRECT',
                    'custom_proxy_group=🐟 漏网之鱼`select`[]📲 电报消息`[]🎯 全球直连`[]DIRECT'
                ]
            }, { proxyNames: ['random-node-01'] });

            // 电报消息 matches nothing and is dropped; the ruleset, its provider and the
            // reference inside 漏网之鱼 all go with it.
            expect(built.proxyGroups.map(group => group.name)).toEqual(['🎯 全球直连', '🐟 漏网之鱼']);
            expect(built.rules).toEqual(['GEOIP,CN,🎯 全球直连', 'MATCH,🐟 漏网之鱼']);
            expect(Object.keys(built.ruleProviders)).toEqual([]);
            expect(built.proxyGroups.find(group => group.name === '🐟 漏网之鱼').proxies)
                .toEqual(['🎯 全球直连', 'DIRECT']);
        });

        it('drops the omitted country groups from the output', () => {
            const groupNames = buildTemplateClashSections(COMPLEX_TEMPLATE, { proxyNames: ['Hong Kong 01'] })
                .proxyGroups.map(group => group.name);

            expect(groupNames).not.toContain('🇭🇰 香港节点');
            expect(groupNames).not.toContain('🎥 奈飞节点');
        });

        it('passes provider names into .*-matched group use lists', () => {
            const manual = sections.proxyGroups.find(group => group.name === '🚀 手动切换');
            expect(manual.use).toEqual(PROVIDER_NAMES);

            const auto = sections.proxyGroups.find(group => group.name === '♻️ 自动选择');
            expect(auto.use).toEqual(PROVIDER_NAMES);
        });
    });
});

describe('generateTemplateSubconverterConfig', () => {
    it('emits the template lines plus both rule base keys', () => {
        const ini = generateTemplateSubconverterConfig(MINI_TEMPLATE, {});
        const lines = ini.split('\n');

        expect(lines.slice(0, MINI_TEMPLATE.subconverterLines.length)).toEqual(MINI_TEMPLATE.subconverterLines);
        expect(lines).toContain('clash_rule_base=https://mini.test/clash.yml');
        expect(lines).toContain('quanx_rule_base=https://mini.test/quanx.conf');
        expect(lines.at(-1)).toBe(';luck');
    });

    it('lets explicit arguments override the template values', () => {
        const ini = generateTemplateSubconverterConfig(MINI_TEMPLATE, {
            clashRuleBase: 'https://override.test/clash.yml',
            quanxRuleBase: 'https://override.test/quanx.conf'
        });

        expect(ini).toContain('clash_rule_base=https://override.test/clash.yml');
        expect(ini).toContain('quanx_rule_base=https://override.test/quanx.conf');
        expect(ini).not.toContain('https://mini.test/clash.yml');
        expect(ini).not.toContain('https://mini.test/quanx.conf');
    });

    it('falls back to the template value for blank or non-string overrides', () => {
        for (const override of ['', '   ', undefined, null, 42, 'https://a.test/x.yml\nX-Injected: 1']) {
            const ini = generateTemplateSubconverterConfig(MINI_TEMPLATE, { clashRuleBase: override });

            expect(ini).toContain('clash_rule_base=https://mini.test/clash.yml');
            expect(ini.split('\n').filter(line => line.startsWith('clash_rule_base='))).toHaveLength(1);
        }
    });

    it('rejects newline-bearing overrides so they cannot inject INI keys', () => {
        const ini = generateTemplateSubconverterConfig(MINI_TEMPLATE, {
            clashRuleBase: 'https://a.test/x.yml\nX-Injected: 1',
            quanxRuleBase: 'https://a.test/x.conf\r\nX-Injected2: 1'
        });

        expect(ini).not.toContain('X-Injected');
        expect(ini).toContain('clash_rule_base=https://mini.test/clash.yml');
        expect(ini).toContain('quanx_rule_base=https://mini.test/quanx.conf');
    });

    it('keeps both keys present but empty when no base URL exists anywhere', () => {
        const ini = generateTemplateSubconverterConfig({ subconverterLines: ['ruleset=A,https://a.test/x.list'] }, {});
        const lines = ini.split('\n');

        expect(lines).toEqual([
            'ruleset=A,https://a.test/x.list',
            'clash_rule_base=',
            'quanx_rule_base=',
            ';luck'
        ]);
    });

    it('returns just the base keys for a missing or malformed template', () => {
        const expected = 'clash_rule_base=\nquanx_rule_base=\n;luck';

        expect(generateTemplateSubconverterConfig(null, {})).toBe(expected);
        expect(generateTemplateSubconverterConfig(undefined)).toBe(expected);
        expect(generateTemplateSubconverterConfig({}, {})).toBe(expected);
        expect(generateTemplateSubconverterConfig({ subconverterLines: 'nope' }, {})).toBe(expected);
        expect(generateTemplateSubconverterConfig({ subconverterLines: [1, null] }, {})).toBe(expected);
    });

    it('drops non-string lines from the emitted INI', () => {
        const ini = generateTemplateSubconverterConfig({
            subconverterLines: ['ruleset=A,https://a.test/x.list', null, 42, {}, 'enable_rule_generator=true']
        }, {});

        expect(ini.split('\n')).toEqual([
            'ruleset=A,https://a.test/x.list',
            'enable_rule_generator=true',
            'clash_rule_base=',
            'quanx_rule_base=',
            ';luck'
        ]);
    });

    it('generates a usable INI for the complex template', () => {
        const ini = generateTemplateSubconverterConfig(COMPLEX_TEMPLATE, {});
        const lines = ini.split('\n');

        expect(lines[0]).toBe('[custom]');
        expect(ini).toContain('ruleset=🎯 全球直连,https://fixture.test/lists/Lan.list');
        expect(lines.filter(line => line.startsWith('clash_rule_base='))).toHaveLength(1);
        expect(lines.filter(line => line.startsWith('quanx_rule_base='))).toHaveLength(1);
        expect(lines.at(-1)).toBe(';luck');
    });
});
describe('validateTemplateLines', () => {
    it('accepts a self-consistent template', () => {
        expect(validateTemplateLines(COMPLEX_TEMPLATE.subconverterLines, COMPLEX_TEMPLATE.omittedGroups)).toEqual([]);
    });

    it('flags a ruleset target with no matching group definition', () => {
        const issues = validateTemplateLines([
            'ruleset=Proxy,https://a.test/x.list',
            'custom_proxy_group=Final`select`[]DIRECT'
        ]);

        expect(issues).toEqual(['ruleset target "Proxy" has no matching custom_proxy_group']);
    });

    it('flags a [] reference to an undefined group', () => {
        const issues = validateTemplateLines([
            'custom_proxy_group=Pick`select`[]Missing`[]DIRECT'
        ]);

        expect(issues).toEqual(['group reference []Missing has no matching custom_proxy_group']);
    });

    it('flags malformed group lines and empty ruleset targets', () => {
        const issues = validateTemplateLines([
            'custom_proxy_group=OnlyName',
            'ruleset=,https://a.test/x.list'
        ]);

        expect(issues).toHaveLength(2);
        expect(issues[0]).toContain('missing a name or type');
        expect(issues[1]).toContain('empty target group');
    });

    it('allows built-in targets and omitted groups', () => {
        const issues = validateTemplateLines([
            'ruleset=DIRECT,[]GEOIP,CN',
            'ruleset=REJECT,https://a.test/ads.list',
            'ruleset=Gone,https://a.test/g.list',
            'custom_proxy_group=Final`select`[]DIRECT`[]Gone'
        ], ['Gone']);

        expect(issues).toEqual([]);
    });

    it('ignores unknown directives and tolerates garbage input', () => {
        expect(validateTemplateLines(['enable_rule_generator=true', '[custom]', '', null, 42])).toEqual([]);
        expect(validateTemplateLines(null)).toEqual([]);
        expect(validateTemplateLines('nope')).toEqual([]);
    });
});
