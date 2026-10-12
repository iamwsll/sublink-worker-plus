import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';
import { ShortLinkService } from '../src/services/shortLinkService.js';

const node = name => `vless://00000000-0000-0000-0000-000000000001@example.com:443?security=tls#${name}`;
const query = name => '?' + new URLSearchParams({ config: node(name), selectedRules: 'minimal' });
const payload = name => ({ name, note: 'test recipient', enabled: true, queryString: query(name) });
async function setup() {
    const kv = new MemoryKVAdapter();
    const app = createApp({ kv, config: { adminPassword: 'test-secret' } });
    const login = await app.request('/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-secret' }) });
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    const api = (path = '', method = 'GET', body) => app.request('/admin/api/subscriptions' + path, {
        method, headers, ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { app, kv, headers, api };
}

describe('admin subscription lifecycle', () => {
    it('requires login for listing, reading, creating, editing and deleting', async () => {
        const { app } = await setup();
        for (const [path, method] of [['', 'GET'], ['/secret', 'GET'], ['', 'POST'], ['/secret', 'PUT'], ['/secret', 'DELETE']]) {
            const res = await app.request('/admin/api/subscriptions' + path, { method });
            expect(res.status).toBe(401);
            expect(res.headers.get('cache-control')).toBe('no-store');
        }
    });

    it('updates content at the same URL, disables and deletes without allowing resurrection', async () => {
        const { app, api } = await setup();
        let res = await api('', 'POST', { ...payload('Before'), code: 'distributed' });
        expect(res.status).toBe(201);
        const first = await app.request('/c/distributed');
        expect(first.status).toBe(200);
        expect(first.headers.get('location')).toBeNull();
        expect(first.headers.get('cache-control')).toBe('no-store');
        expect(await first.text()).toContain('Before');
        expect((await api('/distributed', 'PUT', payload('After'))).status).toBe(200);
        const changed = await app.request('/c/distributed?config=ignored');
        const content = await changed.text();
        expect(changed.status).toBe(200);
        expect(content).toContain('After');
        expect(content).not.toContain('Before');
        for (const prefix of ['b', 's', 'x']) expect((await app.request('/' + prefix + '/distributed')).status).toBe(200);
        expect((await api('/distributed', 'PUT', { ...payload('After'), enabled: false })).status).toBe(200);
        expect((await app.request('/c/distributed')).status).toBe(410);
        expect((await api('/distributed', 'PUT', payload('After'))).status).toBe(200);
        expect((await api('/distributed', 'DELETE')).status).toBe(204);
        expect((await app.request('/c/distributed')).status).toBe(404);
        expect((await api('/distributed')).status).toBe(404);
        expect((await api()).status).toBe(200);
        expect((await (await api()).json()).items).toHaveLength(0);
        const attempt = await app.request('/shorten-v2?' + new URLSearchParams({ url: 'https://example.com/clash' + query('Hijack'), shortCode: 'distributed' }));
        expect(attempt.status).toBe(409);
    });

    it('includes legacy URLs and excludes unrelated KV values, preserving expiration on edits', async () => {
        const { app, kv, api } = await setup();
        await kv.put('old-code', query('Legacy'), { expirationTtl: 3600 });
        await kv.put('admin:config', '{}');
        await kv.put('clash_config', '{"proxies":[]}');
        const list = await (await api()).json();
        expect(list.items.map(item => item.code)).toEqual(['old-code']);
        const detail = await (await api('/old-code')).json();
        expect(detail.legacy).toBe(false);
        expect(detail.expiresAt).toBeGreaterThan(Date.now());
        const saved = await (await api('/old-code', 'PUT', payload('Migrated'))).json();
        expect(saved.expiresAt).toBe(detail.expiresAt);
        expect(await (await app.request('/c/old-code')).text()).toContain('Migrated');
        await kv.delete('old-code');
        await kv.delete('subscription:old-code');
        await kv.delete('subscription:public:old-code');
    });

    it('prevents unauthenticated overwrites and reserved KV key collisions', async () => {
        const { app, kv, api } = await setup();
        await api('', 'POST', { ...payload('Original'), code: 'private-code' });
        await kv.put('clash_secret', '{"secret":"original"}');
        for (const code of ['private-code', 'clash_secret', 'admin:config']) {
            const res = await app.request('/shorten-v2?' + new URLSearchParams({ url: 'https://example.com/clash' + query('Attacker'), shortCode: code }));
            expect([400, 409]).toContain(res.status);
        }
        expect(await kv.get('clash_secret')).toBe('{"secret":"original"}');
        const identical = await app.request('/shorten-v2?' + new URLSearchParams({ url: 'https://example.com/clash' + query('Original'), shortCode: 'private-code' }));
        expect(identical.status).toBe(200);
        expect(await (await app.request('/c/private-code')).text()).toContain('Original');
    });

    it('saves and exposes an editable persistent base config', async () => {
        const { kv, api } = await setup();
        const response = await api('', 'POST', { ...payload('Configured'), code: 'base', configType: 'clash', baseConfig: { port: 7891 } });
        expect(response.status).toBe(201);
        const detail = await (await api('/base')).json();
        expect(detail.baseConfig).toEqual({ port: 7891 });
        const configId = new URLSearchParams(detail.queryString).get('configId');
        expect(kv.expirations.has(configId)).toBe(false);
        expect((await api('/base', 'PUT', { ...payload('Configured'), configType: 'clash', baseConfig: { port: 7892 } })).status).toBe(200);
        expect((await (await api('/base')).json()).baseConfig.port).toBe(7892);
    });

    it('validates changes before creating config records and supports pagination', async () => {
        const { kv, api } = await setup();
        const bad = await api('', 'POST', { ...payload('Bad'), code: '../admin', baseConfig: {}, configType: 'clash' });
        expect(bad.status).toBe(400);
        expect(kv.store.size).toBe(0);
        const service = new ShortLinkService(kv);
        for (let i = 0; i < 5; i++) await service.save('page-' + i, payload('Node'), true);
        const first = await service.list({ limit: 2 });
        const second = await service.list({ limit: 2, cursor: first.cursor });
        const third = await service.list({ limit: 2, cursor: second.cursor });
        expect([...first.items, ...second.items, ...third.items].map(item => item.code)).toEqual(['page-0','page-1','page-2','page-3','page-4']);
        expect(third.cursor).toBeNull();
    });

    it('renders subscription controls only for an authenticated administrator', async () => {
        const { app, headers } = await setup();
        const html = await (await app.request('/admin', { headers })).text();
        expect(html).toContain('订阅链接管理');
        expect(html).toContain('x-on:submit.prevent="saveSubscription()"');
        expect(html).toContain('subscriptionData()');
        const anonymous = await (await app.request('/admin')).text();
        expect(anonymous).not.toContain('aria-label="订阅链接管理"');
    });
});

// A URL can remain in a client's cache after KV expiry; the stored deadline is also enforced.
it('rejects expired managed records even if the KV replica still returns the value', async () => {
    const kv = new MemoryKVAdapter();
    await kv.put('expired', JSON.stringify({ kind: 'subscription-link-v1', queryString: query('Old'), enabled: true, expiresAt: Date.now() - 1 }));
    const service = new ShortLinkService(kv);
    expect(await service.resolveShortCode('expired')).toBeNull();
    expect((await service.list()).items).toHaveLength(0);
});

it('admin overrides and revocations survive late writes to the public legacy key', async () => {
    const { kv, app, api } = await setup();
    await kv.put('stable', query('Legacy'));
    await api('/stable', 'PUT', payload('Admin'));
    await kv.put('stable', query('LatePublicWrite'));
    const content = await (await app.request('/c/stable')).text();
    expect(content).toContain('Admin');
    expect(content).not.toContain('LatePublicWrite');
    await api('/stable', 'DELETE');
    await kv.put('stable', query('LatePublicWrite'));
    expect((await app.request('/c/stable')).status).toBe(404);
});

it('shows successful pull time in list/detail and preserves it when changing the alias', async () => {
    const { app, api } = await setup();
    await api('', 'POST', { ...payload('Initial'), code: 'tracked' });
    expect((await (await api('/tracked')).json()).lastFetchedAt).toBeNull();
    const started = Date.now();
    expect((await app.request('/c/tracked')).status).toBe(200);
    const detail = await (await api('/tracked')).json();
    expect(detail.lastFetchedAt).toBeGreaterThanOrEqual(started);
    const renamed = await (await api('/tracked', 'PUT', { ...payload('Initial'), name: '我的手机' })).json();
    expect(renamed.name).toBe('我的手机');
    expect(renamed.code).toBe('tracked');
    expect(renamed.lastFetchedAt).toBe(detail.lastFetchedAt);
    const list = await (await api()).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe('我的手机');
    expect(list.items[0].lastFetchedAt).toBe(detail.lastFetchedAt);
});

it('does not record management reads, resolves, HEAD requests, errors or disabled subscriptions as pulls', async () => {
    const { app, api } = await setup();
    await api('', 'POST', { ...payload('Node'), code: 'unread' });
    await api('/unread');
    await api();
    await app.request('/resolve?url=' + encodeURIComponent('http://localhost/c/unread'));
    await app.request('/c/unread', { method: 'HEAD' });
    expect((await (await api('/unread')).json()).lastFetchedAt).toBeNull();
    await api('/unread', 'PUT', { ...payload('Node'), queryString: '' });
    expect((await app.request('/c/unread')).status).toBe(400);
    expect((await (await api('/unread')).json()).lastFetchedAt).toBeNull();
    await api('/unread', 'PUT', { ...payload('Node'), enabled: false });
    expect((await app.request('/c/unread')).status).toBe(410);
    expect((await (await api('/unread')).json()).lastFetchedAt).toBeNull();
});

it('preserves legacy records and continues serving when telemetry writes fail', async () => {
    const { app, kv, api } = await setup();
    const original = query('Legacy');
    await kv.put('legacy-track', original);
    expect((await app.request('/x/legacy-track')).status).toBe(200);
    expect(await kv.get('legacy-track')).toBe(original);
    expect((await (await api('/legacy-track')).json()).lastFetchedAt).toBeGreaterThan(0);
    const put = kv.put.bind(kv);
    kv.put = async (key, ...args) => {
        if (key.startsWith('subscription-access:')) throw new Error('KV rate limit');
        return put(key, ...args);
    };
    await kv.put('failing-track', original);
    expect((await app.request('/c/failing-track')).status).toBe(200);
    expect((await (await api('/failing-track')).json()).lastFetchedAt).toBeNull();
});

it('coalesces rapid pulls and cannot overwrite edits or revive revoked subscriptions', async () => {
    const { app, api, kv } = await setup();
    await api('', 'POST', { ...payload('Node'), code: 'isolated' });
    const service = new ShortLinkService(kv);
    await service.recordSuccessfulFetch('isolated', 100000);
    await service.recordSuccessfulFetch('isolated', 100500);
    expect(await service.getLastFetchedAt('isolated')).toBe(100000);
    await service.recordSuccessfulFetch('isolated', 102000);
    expect(await service.getLastFetchedAt('isolated')).toBe(102000);
    await api('/isolated', 'PUT', { ...payload('Node'), name: 'Custom alias' });
    await service.recordSuccessfulFetch('isolated', 104000);
    expect((await (await api('/isolated')).json()).name).toBe('Custom alias');
    await api('/isolated', 'DELETE');
    await service.recordSuccessfulFetch('isolated', 106000);
    expect((await app.request('/c/isolated')).status).toBe(404);
    expect((await (await api()).json()).items).toHaveLength(0);
});

it('renders authenticated previews without counting pulls, while public flags cannot suppress tracking', async () => {
    const { app, api, kv } = await setup();
    await api('', 'POST', { ...payload('Preview'), code: 'previewed' });
    expect((await app.request('/admin/api/subscriptions/previewed/preview/c')).status).toBe(401);
    for (const format of ['c', 'b', 's', 'x']) {
        const res = await api('/previewed/preview/' + format);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect((await (await api('/previewed')).json()).lastFetchedAt).toBeNull();
    }
    expect((await api('/previewed/preview/unknown')).status).toBe(400);
    await app.request('/c/previewed?preview=1');
    const pulled = (await (await api('/previewed')).json()).lastFetchedAt;
    expect(pulled).toBeGreaterThan(0);
    await api('/previewed/preview/c');
    expect(await new ShortLinkService(kv).getLastFetchedAt('previewed')).toBe(pulled);
});
