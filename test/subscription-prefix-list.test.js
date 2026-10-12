import { describe, it, expect, vi } from 'vitest';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';
import { ShortLinkService } from '../src/services/shortLinkService.js';

describe('subscription prefix discovery', () => {
    it('imports older links across pages, then excludes unrelated keys from scans', async () => {
        const kv = new MemoryKVAdapter();
        const service = new ShortLinkService(kv);
        await kv.put('old', '?config=original');
        await kv.put('clash_data', '{"port":7890}');
        await kv.put('singbox-ruleset:cache', '{}');
        const scan = vi.spyOn(kv, 'list');
        let cursor;
        do { ({ cursor } = await service.list({ cursor, limit: 1 })); } while (cursor);
        expect(await kv.get('old')).toBe('?config=original');
        expect(await service.resolveShortCode('old')).toBe('?config=original');
        scan.mockClear();
        expect((await service.list()).items.map(item => item.code)).toEqual(['old']);
        expect(scan).toHaveBeenCalledTimes(1);
        expect(scan.mock.calls[0][0].prefix).toBe('subscription:');
        await service.createShortLink('?config=new', 'new');
        expect((await service.list()).items.map(item => item.code)).toEqual(['new', 'old']);
        expect(await kv.get('clash_data')).toBe('{"port":7890}');
    });

    it('preserves legacy expiry and managed deletion despite retained public copies', async () => {
        const kv = new MemoryKVAdapter();
        const service = new ShortLinkService(kv);
        await kv.put('old', '?config=original', { expirationTtl: 3600 });
        const before = await service.getRecord('old');
        await service.list();
        expect((await service.getRecord('old')).expiresAt).toBe(before.expiresAt);
        await service.save('old', { queryString: '?config=edited', enabled: true });
        expect(await service.resolveShortCode('old')).toBe('?config=edited');
        await service.delete('old');
        expect(await service.resolveShortCode('old')).toBeNull();
        expect((await service.list()).items).toEqual([]);
        await expect(service.createShortLink('?config=revive', 'old')).rejects.toThrow();
        await kv.delete('subscription:public:old');
    });

    it('does not mark discovery complete after a failed import', async () => {
        const kv = new MemoryKVAdapter();
        const service = new ShortLinkService(kv);
        await kv.put('old', '?config=original');
        const put = vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('quota exhausted'));
        await expect(service.list()).rejects.toThrow('quota exhausted');
        expect(await kv.get('admin:subscription-prefix-migration-v1')).toBeNull();
        put.mockRestore();
        expect((await service.list()).items.map(item => item.code)).toEqual(['old']);
    });
});
