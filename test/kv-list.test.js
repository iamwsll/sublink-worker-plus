import { describe, it, expect, vi } from 'vitest';
import { CloudflareKVAdapter } from '../src/adapters/kv/cloudflareKv.js';
import { RedisKVAdapter } from '../src/adapters/kv/redisKv.js';
import { UpstashKVAdapter } from '../src/adapters/kv/upstashKv.js';

describe('subscription discovery across KV backends', () => {
    it('preserves Cloudflare pagination even for an empty page', async () => {
        const page = { keys: [], cursor: 'next', list_complete: false };
        const binding = { list: vi.fn().mockResolvedValue(page) };
        const adapter = new CloudflareKVAdapter(binding);
        expect(await adapter.list({ limit: 50, cursor: 'previous' })).toEqual(page);
        expect(binding.list).toHaveBeenCalledWith({ limit: 50, cursor: 'previous' });
    });
    it('uses Redis SCAN with the namespace prefix and carries TTLs and cursor', async () => {
        const client = { scan: vi.fn().mockResolvedValue(['17', ['app*:link']]), ttl: vi.fn().mockResolvedValue(3600) };
        const adapter = new RedisKVAdapter({ client, prefix: 'app*' });
        const page = await adapter.list({ prefix: 'li', cursor: '2', limit: 50 });
        expect(client.scan).toHaveBeenCalledWith('2', 'MATCH', 'app\\*:li*', 'COUNT', 50);
        expect(page.keys[0].name).toBe('link');
        expect(page.keys[0].expiration).toBeGreaterThan(Date.now() / 1000);
        expect(page.cursor).toBe('17');
        expect(page.list_complete).toBe(false);
    });
    it('uses the Upstash REST SCAN and TTL commands without KEYS', async () => {
        const adapter = new UpstashKVAdapter({ url: 'https://kv.example', token: 'test' });
        const execute = vi.spyOn(adapter, 'execute').mockResolvedValueOnce(['0', ['link']]).mockResolvedValueOnce(-1);
        expect(await adapter.list({ cursor: '3', limit: 50 })).toEqual({ keys: [{ name: 'link', expiration: undefined }], cursor: undefined, list_complete: true });
        expect(execute).toHaveBeenNthCalledWith(1, ['SCAN', '3', 'MATCH', '*', 'COUNT', '50']);
        expect(execute).toHaveBeenNthCalledWith(2, ['TTL', 'link']);
    });
});
