import { describe, it, expect } from 'vitest';
import { subscriptionLogicFn } from '../src/components/admin/subscriptionLogic.js';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

// Exercise the injected browser state against the actual routes, without a browser-only test dependency.
describe('subscription editor interaction', () => {
    it('creates, reopens, edits and deletes a subscription through the browser state', async () => {
        const app = createApp({ kv: new MemoryKVAdapter(), config: { adminPassword: 'ui-test' } });
        const login = await app.request('/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'ui-test' }) });
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const browserFetch = (path, options = {}) => app.request(path, { ...options, headers: { ...options.headers, Cookie: cookie } });
        const window = { APP_LANG: 'zh-CN', location: { origin: 'https://example.com' }, confirm: () => true };
        const bootstrap = new Function('window', 'fetch', `(${subscriptionLogicFn.toString()})(); return window.subscriptionData();`);
        const data = bootstrap(window, browserFetch);
        await data.init();
        expect(data.items).toEqual([]);
        data.startNew();
        data.importUrl = 'https://example.com/clash?' + new URLSearchParams({ config: 'vless://id@example.com:443#First', selectedRules: 'minimal' });
        data.importParameters();
        expect(data.source).toContain('#First');
        data.editor.name = 'My client';
        await data.saveSubscription();
        expect(data.error).toBe('');
        expect(data.items).toHaveLength(1);
        const code = data.editor.code;
        expect(data.link('c')).toBe('https://example.com/c/' + code);
        await data.edit(code);
        expect(data.error).toBe('');
        data.source = data.source.replace('First', 'Second');
        data.optionsText = '{"selectedRules":"balanced","group_defaults":{"Private":"DIRECT"}}';
        await data.saveSubscription();
        expect(data.error).toBe('');
        await data.edit(code);
        expect(data.source).toContain('#Second');
        expect(JSON.parse(JSON.parse(data.optionsText).group_defaults)).toEqual({ Private: 'DIRECT' });
        await data.removeSubscription();
        expect(data.editor).toBeNull();
        expect(data.items).toEqual([]);
        expect((await app.request('/c/' + code)).status).toBe(404);
    });
});
