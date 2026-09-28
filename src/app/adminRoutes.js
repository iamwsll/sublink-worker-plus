import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { Layout } from '../components/Layout.jsx';
import { AdminPage } from '../components/admin/AdminPage.jsx';
import { InvalidConfigError } from '../services/errors.js';
import { resolveLanguage } from '../i18n/index.js';

// Matches the token lifetime in adminAuth so the cookie and the signature expire together.
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Mount the admin page and its JSON API on an existing Hono app.
 *
 * @param {import('hono').Hono} app
 * @param {{ runtime: object, services: object, auth: { cookieName: string, isEnabled: boolean, issueToken: () => Promise<string>, verifyToken: (token?: string | null) => Promise<boolean> } }} deps
 */
export function registerAdminRoutes(app, { runtime, services, auth }) {
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
    if (error instanceof InvalidConfigError) {
        return c.json({ error: error.message }, 400);
    }
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