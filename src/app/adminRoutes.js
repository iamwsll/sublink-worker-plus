import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { Layout } from '../components/Layout.jsx';
import { AdminPage } from '../components/admin/AdminPage.jsx';
import { ServiceError, MissingDependencyError, InvalidPayloadError } from '../services/errors.js';
import { resolveLanguage } from '../i18n/index.js';

// Matches the token lifetime in adminAuth so the cookie and the signature expire together.
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Mount the admin page and its JSON API on an existing Hono app.
 *
 * @param {import('hono').Hono} app
 * @param {{ runtime: object, services: object, auth: { cookieName: string, isEnabled: boolean, issueToken: () => Promise<string>, verifyToken: (token?: string | null) => Promise<boolean> } }} deps
 */
export function registerAdminRoutes(app, { runtime, services, auth, previewSubscription }) {
    const logger = runtime.logger;
    const adminConfig = services.adminConfig;

    const isAuthenticated = async (c) => auth.isEnabled && await auth.verifyToken(getCookie(c, auth.cookieName));

    // A cookie-only check: the page itself decides between the login form and the panel,
    // so an anonymous visitor must still get HTML instead of a 401.
    const requireAuth = async (c, next) => {
        if (!await isAuthenticated(c)) {
            return c.json({ error: 'unauthorized' }, 401);
        }
        await next();
    };

    app.use('/admin/api/*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        await next();
    });

    app.get('/admin', async (c) => {
        const t = c.get('t');
        const lang = resolveLanguage(c.get('lang'));
        const adminDisabled = !auth.isEnabled;
        const authed = adminDisabled ? false : await isAuthenticated(c);

        return c.html(renderPage({ t, lang, authed, adminDisabled }));
    });

    app.post('/admin/api/login', async (c) => {
        if (!auth.isEnabled) {
            return c.json({ ok: false }, 403);
        }

        const body = await readJsonBody(c);
        // A malformed body cannot contain a valid password, so it is just a failed login.
        if (!constantTimeEqual(String(body?.password ?? ''), String(runtime.config.adminPassword ?? ''))) {
            return c.json({ ok: false }, 401);
        }

        setCookie(c, auth.cookieName, await auth.issueToken(), {
            httpOnly: true,
            sameSite: 'Strict',
            path: '/',
            maxAge: SESSION_MAX_AGE_SECONDS,
            // Cookies marked Secure are dropped on plain HTTP, so only set it when the
            // request itself arrived over TLS.
            secure: new URL(c.req.url).protocol === 'https:'
        });
        return c.json({ ok: true });
    });

    app.post('/admin/api/logout', (c) => {
        deleteCookie(c, auth.cookieName, { path: '/' });
        return c.json({ ok: true });
    });

    const subscriptions = () => {
        if (!services.shortLinks) throw new MissingDependencyError('订阅管理需要持久化 KV 存储');
        return services.shortLinks;
    };

    app.get('/admin/api/subscriptions', requireAuth, async (c) => {
        try {
            return c.json(await subscriptions().list({ cursor: c.req.query('cursor') || undefined }));
        } catch (error) { return handleAdminError(c, error, logger); }
    });

    app.get('/admin/api/subscriptions/:code/preview/:format', requireAuth, async (c) => {
        const formats = { c: 'clash', b: 'singbox', s: 'surge', x: 'xray' };
        const format = c.req.param('format');
        if (!Object.hasOwn(formats, format)) return c.json({ error: 'Unsupported subscription format' }, 400);
        // Preview has its own authenticated route so public query flags cannot suppress pull tracking.
        return previewSubscription(c, formats[format]);
    });

    app.get('/admin/api/subscriptions/:code', requireAuth, async (c) => {
        try {
            const record = await subscriptions().getRecord(c.req.param('code'));
            if (!record) return c.json({ error: 'Subscription not found' }, 404);
            const configId = new URLSearchParams(record.queryString).get('configId');
            const configType = ['clash', 'singbox', 'surge'].find(type => configId?.startsWith(type + '_'));
            const baseConfig = configType ? await services.configStorage.getConfigById(configId) : null;
            return c.json({ ...record, configType: configType || '', baseConfig });
        } catch (error) { return handleAdminError(c, error, logger); }
    });

    const saveSubscription = (create) => async (c) => {
        try {
            const payload = await readJsonBody(c);
            const service = subscriptions();
            // Validate the record before writing optional uploaded configuration data.
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new InvalidPayloadError('订阅内容必须是对象');
            const record = await service.prepare(create ? payload.code : c.req.param('code'), payload, create);
            if (payload.baseConfig !== undefined && payload.baseConfig !== null) {
                if (!['clash', 'singbox', 'surge'].includes(payload.configType)) throw new InvalidPayloadError('请选择基础配置类型');
                if (typeof payload.baseConfig !== 'object' || Array.isArray(payload.baseConfig)) throw new InvalidPayloadError('基础配置必须是 JSON 对象');
                const configId = await services.configStorage.saveConfig(payload.configType, payload.baseConfig, { persistent: true });
                const params = new URLSearchParams(record.queryString);
                params.set('configId', configId);
                record.queryString = '?' + params.toString();
            }
            await service.write(record);
            return c.json(await service.withAccess(record), create ? 201 : 200);
        } catch (error) { return handleAdminError(c, error, logger); }
    };
    app.post('/admin/api/subscriptions', requireAuth, saveSubscription(true));
    app.put('/admin/api/subscriptions/:code', requireAuth, saveSubscription(false));
    app.delete('/admin/api/subscriptions/:code', requireAuth, async (c) => {
        try {
            await subscriptions().delete(c.req.param('code'));
            return c.body(null, 204);
        } catch (error) { return handleAdminError(c, error, logger); }
    });

    app.get('/admin/api/config', requireAuth, async (c) => {
        try {
            return c.json(await adminConfig.getConfig());
        } catch (error) {
            return handleAdminError(c, error, logger);
        }
    });

    app.put('/admin/api/config', requireAuth, async (c) => {
        try {
            const body = await readJsonBody(c);
            // The service owns validation, so an unusable payload surfaces as InvalidConfigError.
            const saved = await adminConfig.saveConfig(body);
            return c.json({ ok: true, config: saved });
        } catch (error) {
            return handleAdminError(c, error, logger);
        }
    });

    app.post('/admin/api/reset', requireAuth, async (c) => {
        try {
            await adminConfig.resetConfig();
            return c.json({ ok: true });
        } catch (error) {
            return handleAdminError(c, error, logger);
        }
    });
}

// AdminPage is a Hono JSX node, which is already escaped on render; wrapping it through
// the html tag keeps the nested markup intact while still escaping the title.
function renderPage({ t, lang, authed, adminDisabled }) {
    return Layout({
        title: t('adminTitle'),
        children: html`${AdminPage({ t, lang, authed, adminDisabled })}`
    });
}

async function readJsonBody(c) {
    try {
        return await c.req.json();
    } catch {
        return undefined;
    }
}

function handleAdminError(c, error, logger) {
    if (error instanceof ServiceError) return c.json({ error: error.message }, error.status);
    logger?.error?.('Admin API error', error);
    return c.json({ error: error?.message || 'Internal error' }, 500);
}

// Passwords are compared through a fixed-length digest-free loop: equal-length strings are
// compared byte-by-byte and unequal lengths still walk the longer input, so the response
// time does not reveal how much of the password matched.
function constantTimeEqual(a, b) {
    const length = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let i = 0; i < length; i += 1) {
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
}