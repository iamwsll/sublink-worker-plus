import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';
import { ADMIN_CONFIG_KEY } from '../src/services/adminConfigService.js';

const ADMIN_PASSWORD = 'test-pw';
const COOKIE_NAME = 'sublink_admin';

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

const createAdminApp = (overrides = {}) => createTestApp({
    ...overrides,
    config: { adminPassword: ADMIN_PASSWORD, ...(overrides.config || {}) }
});

// The session cookie is only ever read back as `<name>=<token>`, so drop every attribute.
const cookieFrom = (response) => {
    const header = response.headers.get('set-cookie');
    expect(header).toBeTruthy();
    return header.split(';')[0];
};

const login = async (app) => {
    const res = await app.request('http://localhost/admin/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    expect(res.status).toBe(200);
    return cookieFrom(res);
};

const jsonHeaders = (cookie) => ({ Cookie: cookie, 'Content-Type': 'application/json' });

describe('GET /admin', () => {
    it('renders the disabled notice when no admin password is configured', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/admin');

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const html = await res.text();
        expect(html).toContain('ADMIN_PASSWORD');
        // The disabled page never injects the runtime auth flag: there is no session to report.
        expect(html).not.toContain('ADMIN_AUTHED');
        expect(html).not.toContain('id="adminPassword"');
    });

    it('renders the login page for an anonymous visitor when a password is configured', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin');

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('id="adminPassword"');
        expect(html).toContain('管理员登录');
        expect(html).toContain('ADMIN_AUTHED = false');
    });

    it('renders the panel when the session cookie is valid', async () => {
        const app = createAdminApp();
        const cookie = await login(app);

        const res = await app.request('http://localhost/admin', { headers: { Cookie: cookie } });

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('ADMIN_AUTHED = true');
        // The save/reset action bar only exists in the authenticated panel.
        expect(html).toContain('resetConfig()');
        expect(html).not.toContain('id="adminPassword"');
    });

    it('treats a forged session cookie as anonymous instead of failing', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin', {
            headers: { Cookie: `${COOKIE_NAME}=1791190992557.deadbeef` }
        });

        expect(res.status).toBe(200);
        expect(await res.text()).toContain('ADMIN_AUTHED = false');
    });

    it('honours the lang query parameter for the admin chrome', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin?lang=en-US');

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Admin Login');
        expect(html).not.toContain('管理员登录');
    });
});

describe('POST /admin/api/login', () => {
    it('rejects a wrong password with 401 and no session cookie', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'not-the-password' })
        });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ ok: false });
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('rejects a body that is not JSON at all', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json'
        });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ ok: false });
    });

    it('rejects a body without a password field', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        expect(res.status).toBe(401);
    });

    it('is an exact-match comparison, not a prefix one', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'test-p' })
        });

        expect(res.status).toBe(401);
    });

    it('issues an HttpOnly session cookie for the correct password', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: ADMIN_PASSWORD })
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toContain(`${COOKIE_NAME}=`);
        expect(setCookie.toLowerCase()).toContain('httponly');
        expect(setCookie).toContain('SameSite=Strict');
        expect(setCookie).toContain('Path=/');
        expect(setCookie).toContain('Max-Age=604800');
        // Plain HTTP must not mark the cookie Secure, or the browser would drop it.
        expect(setCookie).not.toContain('Secure');

        const token = cookieFrom(res).slice(`${COOKIE_NAME}=`.length);
        expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    });

    it('marks the cookie Secure when the request itself arrived over https', async () => {
        const app = createAdminApp();
        const res = await app.request('https://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: ADMIN_PASSWORD })
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toContain('Secure');
    });

    it('returns 403 when the admin surface is disabled', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: '' })
        });

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ ok: false });
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('issues a token that authenticates subsequent API calls', async () => {
        const app = createAdminApp();
        const cookie = await login(app);
        const res = await app.request('http://localhost/admin/api/config', { headers: { Cookie: cookie } });

        expect(res.status).toBe(200);
    });
});

describe('POST /admin/api/logout', () => {
    it('clears the session cookie', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/logout', { method: 'POST' });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toContain(`${COOKIE_NAME}=;`);
        expect(setCookie).toContain('Max-Age=0');
    });

    it('lets a logged-out client through only as anonymous', async () => {
        const app = createAdminApp();
        await login(app);
        const cleared = cookieFrom(await app.request('http://localhost/admin/api/logout', { method: 'POST' }));

        const res = await app.request('http://localhost/admin/api/config', { headers: { Cookie: cleared } });
        expect(res.status).toBe(401);
    });
});

describe('admin JSON API authorization', () => {
    const endpoints = [
        ['GET', '/admin/api/config'],
        ['PUT', '/admin/api/config'],
        ['POST', '/admin/api/reset']
    ];

    it.each(endpoints)('%s %s requires a session', async (method, path) => {
        const app = createAdminApp();
        const res = await app.request(`http://localhost${path}`, { method });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'unauthorized' });
    });

    it('rejects a forged cookie', async () => {
        const app = createAdminApp();
        const res = await app.request('http://localhost/admin/api/config', {
            headers: { Cookie: `${COOKIE_NAME}=1791190992557.${'0'.repeat(64)}` }
        });

        expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
        const app = createAdminApp();
        const expired = `${Date.now() - 60_000}.${'a'.repeat(64)}`;
        const res = await app.request('http://localhost/admin/api/config', {
            headers: { Cookie: `${COOKIE_NAME}=${expired}` }
        });

        expect(res.status).toBe(401);
    });

    it('rejects a token that is not two dot-separated parts', async () => {
        const app = createAdminApp();
        for (const token of ['', 'garbage', '.', 'abc.def', '1791190992557.', '.abcdef']) {
            const res = await app.request('http://localhost/admin/api/config', {
                headers: { Cookie: `${COOKIE_NAME}=${token}` }
            });
            expect(res.status).toBe(401);
        }
    });

    it.each(endpoints)('%s %s rejects every unauthenticated request even when disabled', async (method, path) => {
        const app = createTestApp();
        const res = await app.request(`http://localhost${path}`, { method });

        expect(res.status).toBe(401);
    });
});

describe('GET /admin/api/config', () => {
    it('returns the default config shape for a fresh store', async () => {
        const app = createAdminApp();
        const cookie = await login(app);
        const res = await app.request('http://localhost/admin/api/config', { headers: { Cookie: cookie } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            version: 1,
            defaultRulePreset: 'balanced',
            customRuleSets: [],
            groupDefaults: {},
            templates: []
        });
    });

    it('reads back a config that was written straight to KV', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, JSON.stringify({ defaultRulePreset: 'comprehensive' }));
        const app = createAdminApp({ kv });
        const cookie = await login(app);

        const res = await app.request('http://localhost/admin/api/config', { headers: { Cookie: cookie } });
        const config = await res.json();

        expect(config.defaultRulePreset).toBe('comprehensive');
        expect(config.templates).toEqual([]);
    });
});

describe('PUT /admin/api/config', () => {
    it('rejects a non-object body with 400', async () => {
        const app = createAdminApp();
        const cookie = await login(app);

        for (const body of ['null', '[]', '"config"', '42', 'not json']) {
            const res = await app.request('http://localhost/admin/api/config', {
                method: 'PUT',
                headers: jsonHeaders(cookie),
                body
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBeTruthy();
        }
    });

    it('rejects a container field of the wrong type with 400 and names the field', async () => {
        const app = createAdminApp();
        const cookie = await login(app);

        const rejected = [
            [{ customRuleSets: {} }, 'customRuleSets'],
            [{ customRuleSets: 'x' }, 'customRuleSets'],
            [{ templates: {} }, 'templates'],
            [{ groupDefaults: [] }, 'groupDefaults']
        ];

        for (const [payload, field] of rejected) {
            const res = await app.request('http://localhost/admin/api/config', {
                method: 'PUT',
                headers: jsonHeaders(cookie),
                body: JSON.stringify(payload)
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain(field);
        }
    });

    it('rejects a template whose ruleset target has no group definition', async () => {
        const kv = new MemoryKVAdapter();
        const app = createAdminApp({ kv });
        const cookie = await login(app);

        const res = await app.request('http://localhost/admin/api/config', {
            method: 'PUT',
            headers: jsonHeaders(cookie),
            body: JSON.stringify({
                templates: [{
                    id: 'broken',
                    name: 'Broken Template',
                    subconverterLines: ['ruleset=Proxy,https://a.test/x.list']
                }]
            })
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Broken Template');
        expect(body.error).toContain('Proxy');
        // The rejected config must not be persisted.
        expect(await kv.get(ADMIN_CONFIG_KEY)).toBeNull();
    });

    it('saves a valid config, normalizes it and persists it under the documented key', async () => {
        const kv = new MemoryKVAdapter();
        const app = createAdminApp({ kv });
        const cookie = await login(app);

        const res = await app.request('http://localhost/admin/api/config', {
            method: 'PUT',
            headers: jsonHeaders(cookie),
            body: JSON.stringify({
                defaultRulePreset: '  minimal  ',
                customRuleSets: [{ name: '  Admin Group  ', urls: ['  https://admin.test/a.list  '] }],
                groupDefaults: { 'Google': 'DIRECT', 'Broken': 42 },
                templates: [{ id: 'admin-tpl', name: 'Admin Template' }]
            })
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.config.defaultRulePreset).toBe('minimal');
        expect(body.config.customRuleSets).toEqual([
            { name: 'Admin Group', urls: ['https://admin.test/a.list'], defaultOption: '' }
        ]);
        expect(body.config.groupDefaults).toEqual({ Google: 'DIRECT' });
        expect(body.config.templates.map(t => t.id)).toEqual(['admin-tpl']);

        const stored = JSON.parse(await kv.get(ADMIN_CONFIG_KEY));
        expect(stored.defaultRulePreset).toBe('minimal');
        expect(stored.customRuleSets[0].name).toBe('Admin Group');
    });

    it('merges a partial update into the stored config instead of resetting it', async () => {
        const kv = new MemoryKVAdapter();
        const app = createAdminApp({ kv });
        const cookie = await login(app);
        const put = (payload) => app.request('http://localhost/admin/api/config', {
            method: 'PUT',
            headers: jsonHeaders(cookie),
            body: JSON.stringify(payload)
        });

        await put({ customRuleSets: [{ name: 'Keep', urls: ['https://keep.test/a.list'] }], groupDefaults: { Keep: 'DIRECT' } });
        const res = await put({ defaultRulePreset: 'minimal' });

        const config = (await res.json()).config;
        expect(config.defaultRulePreset).toBe('minimal');
        expect(config.customRuleSets).toEqual([
            { name: 'Keep', urls: ['https://keep.test/a.list'], defaultOption: '' }
        ]);
        expect(config.groupDefaults).toEqual({ Keep: 'DIRECT' });
    });

    it('drops unusable entries instead of failing the whole save', async () => {
        const app = createAdminApp();
        const cookie = await login(app);

        const res = await app.request('http://localhost/admin/api/config', {
            method: 'PUT',
            headers: jsonHeaders(cookie),
            body: JSON.stringify({
                customRuleSets: [{ name: '', urls: ['https://skip.test/a.list'] }, { name: 'Valid', urls: ['https://valid.test/a.list'] }],
                templates: [
                    { id: 'UPPER' },
                    {
                        id: 'good',
                        clashRuleBase: 'ftp://bad.test/x.yml',
                        subconverterLines: [
                            'ruleset=A,https://a.test/x.list',
                            'ruleset=B,https://b.test/y.list\nruleset=Evil,[]FINAL',
                            '   ',
                            'custom_proxy_group=A`select`[]DIRECT',
                            'custom_proxy_group=B`select`[]DIRECT'
                        ]
                    }
                ]
            })
        });

        expect(res.status).toBe(200);
        const config = (await res.json()).config;
        expect(config.customRuleSets.map(g => g.name)).toEqual(['Valid']);
        expect(config.templates).toHaveLength(1);
        expect(config.templates[0].id).toBe('good');
        expect(config.templates[0].clashRuleBase).toBe('');
        // Only newline-free, non-blank lines survive: a newline would inject extra directives.
        expect(config.templates[0].subconverterLines).toEqual([
            'ruleset=A,https://a.test/x.list',
            'custom_proxy_group=A`select`[]DIRECT',
            'custom_proxy_group=B`select`[]DIRECT'
        ]);
    });
});

describe('POST /admin/api/reset', () => {
    it('restores the defaults and clears the stored blob', async () => {
        const kv = new MemoryKVAdapter();
        const app = createAdminApp({ kv });
        const cookie = await login(app);
        await app.request('http://localhost/admin/api/config', {
            method: 'PUT',
            headers: jsonHeaders(cookie),
            body: JSON.stringify({ defaultRulePreset: 'minimal', groupDefaults: { A: 'DIRECT' } })
        });

        const res = await app.request('http://localhost/admin/api/reset', { method: 'POST', headers: { Cookie: cookie } });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(await kv.get(ADMIN_CONFIG_KEY)).toBeNull();

        const after = await app.request('http://localhost/admin/api/config', { headers: { Cookie: cookie } });
        expect((await after.json()).defaultRulePreset).toBe('balanced');
    });
});

describe('GET / landing page with admin config', () => {
    it('injects admin custom rule sets into the page', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, JSON.stringify({
            customRuleSets: [{ name: 'My Rule Group', urls: ['https://admin.test/a.list'], defaultOption: 'DIRECT' }],
            groupDefaults: { Google: 'DIRECT' }
        }));
        const app = createTestApp({ kv });

        const res = await app.request('http://localhost/');

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('ADMIN_RULE_SETS');
        expect(html).toContain('My Rule Group');
        expect(html).toContain('https://admin.test/a.list');
        expect(html).toContain('ADMIN_GROUP_DEFAULTS');
    });

    it('escapes "<" so an admin rule name cannot close the inline script', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, JSON.stringify({
            customRuleSets: [{ name: '</script><script>alert(1)</script>', urls: ['https://xss.test/a.list'] }]
        }));
        const app = createTestApp({ kv });

        const html = await (await app.request('http://localhost/')).text();

        expect(html).not.toContain('</script><script>alert(1)');
        expect(html).toContain('\\u003c/script>');
    });

    it('renders without admin rule sets when nothing is stored', async () => {
        const app = createTestApp();
        const html = await (await app.request('http://localhost/')).text();

        expect(html).toContain('ADMIN_RULE_SETS = []');
    });

    it('shows the template notice and hides rule pickers when a default template exists', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, JSON.stringify({
            templates: [{
                id: 'mine',
                name: 'My Template',
                enabled: true,
                isDefault: true,
                subconverterLines: [
                    'ruleset=Proxy,https://t.test/MyList.list',
                    'custom_proxy_group=Proxy`select`[]DIRECT'
                ]
            }]
        }));
        const app = createTestApp({ kv });

        const html = await (await app.request('http://localhost/')).text();

        expect(html).toContain('ADMIN_DEFAULT_TEMPLATE = "My Template"');
        expect(html).toContain('My Template');
        // The rule picker section is server-rendered, so its change handlers must be absent.
        expect(html).not.toContain(`x-on:change="selectedPredefinedRule`);
        // Instead the template's parsed groups render, and its rules are selectable
        // checkboxes whose unchecked ids ship as template_excluded_rules.
        expect(html).toContain('>Proxy<span');
        expect(html).toContain('>select</span>');
        expect(html).toContain('MyList');
        expect(html).toContain('→ Proxy');
        expect(html).toContain('x-model="templateIncludedRules"');
        expect(html).toContain('value="Proxy::MyList"');
        expect(html).toContain('ADMIN_TEMPLATE_RULES = [{"target":"Proxy","label":"MyList","id":"Proxy::MyList"}]');
    });

    it('keeps the rule pickers when the default template is disabled', async () => {
        const kv = new MemoryKVAdapter();
        await kv.put(ADMIN_CONFIG_KEY, JSON.stringify({
            templates: [{
                id: 'mine',
                name: 'My Template',
                enabled: false,
                isDefault: true,
                subconverterLines: ['ruleset=Proxy,https://t.test/a.list']
            }]
        }));
        const app = createTestApp({ kv });

        const html = await (await app.request('http://localhost/')).text();

        expect(html).toContain('ADMIN_DEFAULT_TEMPLATE = ""');
        expect(html).toContain('applyPredefinedRule()');
    });
});