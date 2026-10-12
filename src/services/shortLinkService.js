import { generateWebPath } from '../utils.js';
import { InvalidPayloadError, MissingDependencyError, ServiceError } from './errors.js';

const KIND = 'subscription-link-v1';
const MANAGED_PREFIX = 'subscription:';
const ACCESS_PREFIX = 'subscription-access:';
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_QUERY_BYTES = 256 * 1024;
const encoder = new TextEncoder();

function validateCode(code) {
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
        throw new InvalidPayloadError('链接标识只能包含 1–64 位字母、数字、下划线或短横线');
    }
}

function normalizeQuery(queryString) {
    if (typeof queryString !== 'string' || (queryString && !queryString.startsWith('?')) || queryString.includes('#')) {
        throw new InvalidPayloadError('订阅参数必须是以 ? 开头的查询字符串');
    }
    const query = new URLSearchParams(queryString).toString();
    if (encoder.encode(query).length > MAX_QUERY_BYTES) throw new InvalidPayloadError('订阅参数过长');
    return query ? `?${query}` : '';
}

function decodeRecord(code, raw, expiration) {
    if (raw === null || raw === undefined) return null;
    if (raw === '' || raw.startsWith('?')) {
        return { code, queryString: raw, name: '', note: '', enabled: true, createdAt: null, updatedAt: null,
            expiresAt: expiration ? expiration * 1000 : null, legacy: true };
    }
    try {
        const item = JSON.parse(raw);
        if (item.kind !== KIND || item.deleted) return null;
        if (item.expiresAt && item.expiresAt <= Date.now()) return null;
        return { ...item, code, legacy: false };
    } catch {
        return null;
    }
}

function textField(value, max, field) {
    if (typeof value !== 'string' || value.length > max) throw new InvalidPayloadError(`${field}格式无效或过长`);
    return value.trim();
}

export class ShortLinkService {
    constructor(kv, options = {}) {
        this.kv = kv;
        this.options = options;
    }

    ensureKv() {
        if (!this.kv) throw new MissingDependencyError('Short link service requires a KV store');
        return this.kv;
    }

    async generateCode() {
        // Retry collisions without overwriting existing subscriptions or reusing revoked codes.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const code = generateWebPath();
            if (await this.readRaw(code) == null) return code;
        }
        throw new ServiceError('暂时无法生成可用的短链接标识，请重试', 503);
    }

    async createShortLink(queryString, providedCode) {
        this.ensureKv();
        const query = normalizeQuery(queryString);
        const code = providedCode || await this.generateCode();
        validateCode(code);
        const existing = await this.readRaw(code);
        if (existing !== null && existing !== undefined) {
            const record = decodeRecord(code, existing);
            // The form reuses a code for multiple output formats with identical parameters.
            if (record?.enabled && normalizeQuery(record.queryString) === query) return code;
            throw new ServiceError('链接标识已存在，请使用其他标识；修改已有订阅需要登录管理后台', 409);
        }
        const now = Date.now();
        await this.write({ kind: KIND, code, queryString: query, name: '', note: '', enabled: true,
            createdAt: now, updatedAt: now,
            expiresAt: this.options.shortLinkTtlSeconds ? now + this.options.shortLinkTtlSeconds * 1000 : null });
        return code;
    }

    async getRecord(code) {
        validateCode(code);
        const kv = this.ensureKv();
        const raw = await this.readRaw(code);
        const record = decodeRecord(code, raw);
        // Legacy values contain no expiration field; recover it before an administrator edits them.
        if (record?.legacy && kv.list) {
            let cursor;
            do {
                const page = await kv.list({ prefix: code, cursor, limit: 100 });
                const key = page.keys.find(key => key.name === code);
                if (key) return this.withAccess(decodeRecord(code, raw, key.expiration));
                cursor = page.list_complete ? undefined : page.cursor;
            } while (cursor);
        }
        return this.withAccess(record);
    }

    async resolveShortCode(code) {
        validateCode(code);
        const record = decodeRecord(code, await this.readRaw(code));
        if (record && !record.enabled) throw new ServiceError('Subscription disabled', 410);
        return record?.queryString ?? null;
    }

    async list({ cursor, limit = 50 } = {}) {
        const kv = this.ensureKv();
        if (!kv.list) throw new MissingDependencyError('当前存储适配器不支持订阅列表');
        const page = await kv.list({ cursor, limit });
        const codes = new Map();
        for (const key of page.keys) {
            const code = key.name.startsWith(MANAGED_PREFIX) ? key.name.slice(MANAGED_PREFIX.length) : key.name;
            if (CODE_PATTERN.test(code)) codes.set(code, key.expiration);
        }
        const records = await Promise.all([...codes].map(async ([code, expiration]) =>
            this.withAccess(decodeRecord(code, await this.readRaw(code), expiration))));
        return { items: records.filter(Boolean), cursor: page.list_complete ? null : page.cursor };
    }

    async getLastFetchedAt(code) {
        try {
            const value = Number(await this.ensureKv().get(ACCESS_PREFIX + code));
            return Number.isSafeInteger(value) && value > 0 ? value : null;
        } catch {
            // Telemetry must not prevent administrators from managing the subscription.
            return null;
        }
    }

    async withAccess(record) {
        return record ? { ...record, lastFetchedAt: await this.getLastFetchedAt(record.code) } : null;
    }

    async recordSuccessfulFetch(code, timestamp = Date.now()) {
        validateCode(code);
        const previous = await this.getLastFetchedAt(code);
        // KV permits one write per key per second; coalesce rapid pulls and avoid known older timestamps.
        if (previous !== null && timestamp - previous < 1000) return;
        // Store telemetry separately so a fetch can never overwrite an admin edit or revive a deleted link.
        await this.ensureKv().put(ACCESS_PREFIX + code, String(timestamp));
    }

    async prepare(code, payload, create = false) {
        this.ensureKv();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new InvalidPayloadError('订阅内容必须是对象');
        code = code || await this.generateCode();
        validateCode(code);
        const existing = create ? null : await this.getRecord(code);
        if (create && (await this.readRaw(code)) != null) throw new ServiceError('链接标识已存在', 409);
        if (!create && !existing) throw new ServiceError('Subscription not found', 404);
        const now = Date.now();
        const expiresAt = Object.hasOwn(payload, 'expiresAt') ? payload.expiresAt : existing?.expiresAt ?? null;
        if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt < now + 60000)) {
            throw new InvalidPayloadError('到期时间必须至少晚于当前时间 1 分钟');
        }
        if (typeof payload.enabled !== 'boolean') throw new InvalidPayloadError('订阅状态必须是布尔值');
        const record = { kind: KIND, managed: true, code, queryString: normalizeQuery(payload.queryString),
            name: textField(payload.name ?? '', 120, '名称'), note: textField(payload.note ?? '', 2000, '备注'),
            enabled: payload.enabled, createdAt: existing?.createdAt ?? now, updatedAt: now, expiresAt };
        return record;
    }

    async save(code, payload, create = false) {
        const record = await this.prepare(code, payload, create);
        await this.write(record);
        return record;
    }

    async readRaw(code) {
        const kv = this.ensureKv();
        // Public shortener writes cannot overwrite the administrator-owned namespace.
        const managed = await kv.get(MANAGED_PREFIX + code);
        return managed ?? kv.get(code);
    }

    async write(record) {
        const ttl = record.expiresAt ? Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000)) : null;
        const kv = this.ensureKv();
        if (record.managed) {
            // Keep the deadline in the record: an expired override must never reveal an older public value.
            await kv.put(MANAGED_PREFIX + record.code, JSON.stringify(record));
            await kv.delete(record.code);
        } else {
            await kv.put(record.code, JSON.stringify(record), ttl ? { expirationTtl: ttl } : undefined);
        }
    }

    async delete(code) {
        if (!await this.getRecord(code)) throw new ServiceError('Subscription not found', 404);
        // Retain a tombstone so a public custom-code request cannot resurrect a revoked URL.
        await this.ensureKv().put(MANAGED_PREFIX + code, JSON.stringify({ kind: KIND, deleted: true }));
        await this.ensureKv().delete(code);
    }
}
