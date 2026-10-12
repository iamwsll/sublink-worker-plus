import { describe, it, expect, vi } from 'vitest';
import { ConfigStorageService } from '../src/services/configStorageService.js';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

describe('persistent configuration deduplication', () => {
    it('reuses equivalent content without writing and preserves shared older versions', async () => {
        const kv = new MemoryKVAdapter();
        const put = vi.spyOn(kv, 'put');
        const service = new ConfigStorageService(kv);
        const first = await service.saveConfig('clash', { port: 7890, dns: { enable: true, nameserver: ['a', 'b'] } }, { persistent: true });
        const duplicate = await service.saveConfig('clash', { dns: { nameserver: ['a', 'b'], enable: true }, port: 7890 }, { persistent: true });
        expect(duplicate).toBe(first);
        expect(put).toHaveBeenCalledTimes(1);
        expect(kv.expirations.size).toBe(0);
        const changed = await service.saveConfig('clash', { port: 7891 }, { persistent: true });
        expect(changed).not.toBe(first);
        expect((await service.getConfigById(first)).port).toBe(7890);
        expect((await service.getConfigById(changed)).port).toBe(7891);
        const otherType = await service.saveConfig('singbox', { port: 7891 }, { persistent: true });
        expect(otherType).not.toBe(changed);
    });
});
