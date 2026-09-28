import { describe, it, expect } from 'vitest';
import { buildTemplateSingboxSections, buildTemplateSurgeSections } from '../src/config/ruleTemplateBackends.js';
import { convertClassicalListToSingboxSource } from '../src/services/singboxRuleset.js';

const PROXY_NAMES = ['🇭🇰 香港01', 'US-Relay'];

const TEMPLATE = {
    subconverterLines: [
        'ruleset=Proxy,https://t.test/lists/Google.list',
        'ruleset=Proxy,https://t.test/lists/GeoIP-CN.srs',
        'ruleset=Direct,[]GEOIP,CN',
        'ruleset=Ads,[]DOMAIN-SUFFIX,ads.example.com',
        'ruleset=Final,[]FINAL',
        'custom_proxy_group=Auto`url-test`(HK|US)`http://www.gstatic.com/generate_204`300,,50',
        'custom_proxy_group=Proxy`select`[]Auto`[]DIRECT',
        'custom_proxy_group=Direct`select`[]DIRECT',
        'custom_proxy_group=Ads`select`REJECT`[]DIRECT',
        'custom_proxy_group=Final`select`[]Proxy`[]DIRECT'
    ]
};

describe('buildTemplateSingboxSections', () => {
    it('compiles groups into selector/urltest outbounds', () => {
        const { outbounds } = buildTemplateSingboxSections(TEMPLATE, { proxyNames: PROXY_NAMES });

        const auto = outbounds.find(o => o.tag === 'Auto');
        expect(auto).toEqual({
            type: 'urltest',
            tag: 'Auto',
            outbounds: ['US-Relay'],
            url: 'http://www.gstatic.com/generate_204',
            interval: '300s',
            tolerance: 50
        });
        const proxy = outbounds.find(o => o.tag === 'Proxy');
        expect(proxy).toEqual({ type: 'selector', tag: 'Proxy', outbounds: ['Auto', 'DIRECT'] });
    });

    it('rewrites classical list URLs and passes .srs through as binary', () => {
        const rewritten = [];
        const { ruleSets, rules } = buildTemplateSingboxSections(TEMPLATE, {
            proxyNames: PROXY_NAMES,
            rewriteRuleSetUrl: (url) => { rewritten.push(url); return `https://worker.test/ruleset/singbox?url=${encodeURIComponent(url)}`; }
        });

        const google = ruleSets.find(r => r.tag === 'Google');
        expect(google.format).toBe('source');
        expect(google.url).toBe('https://worker.test/ruleset/singbox?url=' + encodeURIComponent('https://t.test/lists/Google.list'));
        expect(rewritten).toEqual(['https://t.test/lists/Google.list']);

        const srs = ruleSets.find(r => r.url === 'https://t.test/lists/GeoIP-CN.srs');
        expect(srs).toMatchObject({ type: 'remote', format: 'binary' });
        expect(rules).toContainEqual({ rule_set: ['Google'], outbound: 'Proxy' });
    });

    it('maps inline rules onto route rules and route final', () => {
        const { ruleSets, rules, final } = buildTemplateSingboxSections(TEMPLATE, { proxyNames: PROXY_NAMES });

        // GEOIP becomes a binary geo rule-set reference; FINAL becomes route.final.
        expect(ruleSets).toContainEqual({
            tag: 'geoip-cn',
            type: 'remote',
            format: 'binary',
            url: expect.stringContaining('geoip/cn.srs')
        });
        expect(rules).toContainEqual({ rule_set: ['geoip-cn'], outbound: 'Direct' });
        expect(rules).toContainEqual({ domain_suffix: ['ads.example.com'], outbound: 'Ads' });
        expect(final).toBe('Final');
    });

    it('emits reject actions for REJECT targets and drops dangling rules', () => {
        const { rules } = buildTemplateSingboxSections({
            subconverterLines: [
                'ruleset=REJECT,[]DOMAIN-SUFFIX,ads.example.com',
                'ruleset=Ghost,[]DOMAIN-SUFFIX,ghost.example.com',
                'custom_proxy_group=Proxy`select`[]DIRECT'
            ]
        }, { proxyNames: PROXY_NAMES });

        expect(rules).toContainEqual({ domain_suffix: ['ads.example.com'], action: 'reject' });
        // Ghost has no group and no built-in target, so its rule is dropped.
        expect(rules.find(r => JSON.stringify(r).includes('ghost'))).toBeUndefined();
    });
});

describe('buildTemplateSurgeSections', () => {
    it('compiles groups and rules into Surge lines', () => {
        const { proxyGroups, rules } = buildTemplateSurgeSections(TEMPLATE, { proxyNames: PROXY_NAMES });

        expect(proxyGroups).toContain('Auto = url-test, US-Relay, url=http://www.gstatic.com/generate_204, interval=300');
        expect(proxyGroups).toContain('Proxy = select, Auto, DIRECT');
        expect(rules).toEqual([
            'RULE-SET,https://t.test/lists/Google.list,Proxy',
            'RULE-SET,https://t.test/lists/GeoIP-CN.srs,Proxy',
            'GEOIP,CN,Direct',
            'DOMAIN-SUFFIX,ads.example.com,Ads',
            'FINAL,Final'
        ]);
    });

    it('drops groups that match nothing instead of stuffing them with proxies', () => {
        const { proxyGroups } = buildTemplateSurgeSections(TEMPLATE, { proxyNames: ['random-node'] });

        expect(proxyGroups.some(line => line.startsWith('Auto ='))).toBe(false);
        // Auto is gone, so the Proxy group must not reference it anymore.
        expect(proxyGroups).toContain('Proxy = select, DIRECT');
    });
});

describe('convertClassicalListToSingboxSource', () => {
    it('converts payload-style and plain lists, grouping by field', () => {
        const source = convertClassicalListToSingboxSource([
            'payload:',
            '  - DOMAIN-SUFFIX,google.com',
            '  - DOMAIN-KEYWORD,ads',
            '# comment',
            'IP-CIDR,1.2.3.0/24,no-resolve',
            'IP-CIDR,1.2.3.0/24,no-resolve',
            'DOMAIN,exact.example.com',
            'GEOIP,CN',
            'NOT-A-TYPE,skipped'
        ].join('\n'));

        expect(source).toEqual({
            version: 1,
            rules: [
                { domain: ['exact.example.com'] },
                { domain_suffix: ['google.com'] },
                { domain_keyword: ['ads'] },
                { geoip: ['CN'] },
                { ip_cidr: ['1.2.3.0/24'] }
            ]
        });
    });

    it('returns an empty ruleset for empty input', () => {
        expect(convertClassicalListToSingboxSource('')).toEqual({ version: 1, rules: [] });
        expect(convertClassicalListToSingboxSource(null)).toEqual({ version: 1, rules: [] });
    });
});
