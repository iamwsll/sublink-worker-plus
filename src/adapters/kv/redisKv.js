export class RedisKVAdapter {
    constructor(options = {}) {
        const { prefix, client, manageConnection = false } = options;
        if (!client) {
            throw new Error('Redis KV adapter requires an active Redis client instance');
        }
        this.prefix = prefix ? `${prefix}:` : '';
        this.client = client;
        this.manageConnection = manageConnection;
    }

    formatKey(key) {
        return `${this.prefix}${key}`;
    }

    async get(key) {
        const value = await this.client.get(this.formatKey(key));
        return value ?? null;
    }

    async put(key, value, options = {}) {
        const ttlSeconds = normalizeTtl(options.expirationTtl);
        const formattedKey = this.formatKey(key);
        if (typeof ttlSeconds === 'number') {
            await this.client.set(formattedKey, value, 'EX', ttlSeconds);
        } else {
            await this.client.set(formattedKey, value);
        }
    }

    async delete(key) {
        await this.client.del(this.formatKey(key));
    }

    async list({ prefix = '', cursor = '0', limit = 50 } = {}) {
        const pattern = this.formatKey(prefix).replace(/[\\*?\[\]]/g, '\\$&') + '*';
        const [next, keys] = await this.client.scan(cursor || '0', 'MATCH', pattern, 'COUNT', limit);
        const entries = await Promise.all(keys.map(async key => {
            const ttl = await this.client.ttl(key);
            return { name: key.slice(this.prefix.length), expiration: ttl > 0 ? Math.ceil(Date.now() / 1000) + ttl : undefined };
        }));
        return { keys: entries, cursor: next === '0' ? undefined : next, list_complete: next === '0' };
    }

    async disconnect() {
        if (this.manageConnection && this.client) {
            await this.client.quit();
        }
    }
}

function normalizeTtl(ttl) {
    if (!ttl && ttl !== 0) return null;
    const parsed = Math.floor(Number(ttl));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
