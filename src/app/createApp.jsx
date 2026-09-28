/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { Layout } from '../components/Layout.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { Form } from '../components/Form.jsx';
import { Footer } from '../components/Footer.jsx';
import { UpdateChecker } from '../components/UpdateChecker.jsx';
import { SingboxConfigBuilder } from '../builders/SingboxConfigBuilder.js';
import { ClashConfigBuilder } from '../builders/ClashConfigBuilder.js';
import { SurgeConfigBuilder } from '../builders/SurgeConfigBuilder.js';
import { createTranslator, resolveLanguage } from '../i18n/index.js';
import { encodeBase64, tryDecodeSubscriptionLines, parseBool } from '../utils.js';
import { APP_NAME, APP_SUBTITLE } from '../constants.js';
import { ShortLinkService } from '../services/shortLinkService.js';
import { ConfigStorageService } from '../services/configStorageService.js';
import { AdminConfigService } from '../services/adminConfigService.js';
import { normalizeClashRuleBaseCacheTtl, resolveClashRuleBaseConfig } from '../services/clashRuleBaseCache.js';
import { ServiceError, MissingDependencyError } from '../services/errors.js';
import { normalizeRuntime } from '../runtime/runtimeConfig.js';
import { PREDEFINED_RULE_SETS, SING_BOX_CONFIG, SING_BOX_CONFIG_V1_11, generateSubconverterConfig } from '../config/index.js';
import { generateTemplateSubconverterConfig, summarizeTemplate } from '../config/ruleTemplate.js';
import { normalizeCustomRuleGroups } from '../utils/customRuleGroups.js';
import { createAdminAuth } from './adminAuth.js';
import { registerAdminRoutes } from './adminRoutes.js';

const DEFAULT_USER_AGENT = 'curl/7.74.0';

export function createApp(bindings = {}) {
    const runtime = normalizeRuntime(bindings);
    const services = {
        shortLinks: runtime.kv ? new ShortLinkService(runtime.kv, { shortLinkTtlSeconds: runtime.config.shortLinkTtlSeconds }) : null,
        configStorage: runtime.kv ? new ConfigStorageService(runtime.kv, { configTtlSeconds: runtime.config.configTtlSeconds }) : null,
        // Always available: the service falls back to in-memory storage when KV is absent.
        adminConfig: new AdminConfigService(runtime.kv)
    };

    const app = new Hono();
    const adminAuth = createAdminAuth(runtime.config.adminPassword);

    app.use('*', async (c, next) => {
        const acceptLanguage = getRequestHeader(c.req, 'Accept-Language');
        const lang = c.req.query('lang') || acceptLanguage?.split(',')[0] || 'zh-CN';
        c.set('lang', lang);
        c.set('t', createTranslator(lang));
        await next();
    });

    // Registered after the language middleware so admin pages can translate their chrome.
    registerAdminRoutes(app, { runtime, services, auth: adminAuth });

    app.get('/', async (c) => {
        const t = c.get('t');
        const lang = resolveLanguage(c.get('lang'));
        const subtitle = APP_SUBTITLE[lang] || APP_SUBTITLE['zh-CN'];
        // The form pre-fills admin-defined rule sets, so a broken admin config must degrade
        // to an empty one rather than breaking the landing page.
        const storedConfig = await loadAdminConfig(services.adminConfig, runtime.logger);
        const defaultTemplate = storedConfig ? findDefaultTemplate(storedConfig) : null;
        const adminConfig = storedConfig
            ? {
                customRuleSets: storedConfig.customRuleSets,
                groupDefaults: storedConfig.groupDefaults,
                defaultRulePreset: storedConfig.defaultRulePreset,
                // A default template owns the generated rule section, so the form must hide
                // its rule pickers instead of emitting selectedRules that would block it.
                defaultTemplateName: defaultTemplate?.name || '',
                // Parsed statically (no user nodes yet) so visitors see which groups and
                // rules the fixed template provides, not just its name.
                defaultTemplateSummary: defaultTemplate ? summarizeTemplate(defaultTemplate) : null
            }
            : null;

        return c.html(
            <Layout title={t('pageTitle')} description={t('pageDescription')} keywords={t('pageKeywords')}>
                <div class="flex flex-col min-h-screen">
                    <Navbar />
                    <main class="flex-1">
                        <div class="container mx-auto px-4 py-8 pt-24">
                            <div class="max-w-4xl mx-auto">
                                <div class="text-center mb-12 pt-8">
                                    <h1 class="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">
                                        {APP_NAME}
                                    </h1>
                                    <p class="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                                        {subtitle}
                                    </p>
                                </div>
                                <Form t={t} lang={lang} adminConfig={adminConfig} />
                            </div>
                        </div>
                    </main>
                    <Footer />
                    <UpdateChecker />
                </div>
            </Layout>
        );
    });

    app.get('/singbox', async (c) => {
        try {
            const config = c.req.query('config');
            if (!config) {
                return c.text('Missing config parameter', 400);
            }

            const adminConfig = await loadAdminConfig(services.adminConfig, runtime.logger);
            const selectedRules = resolveSelectedRules(c.req.query('selectedRules'), adminConfig?.defaultRulePreset);
            const customRules = parseJsonArray(c.req.query('customRules'));
            const customRuleGroups = mergeRuleGroups(adminConfig?.customRuleSets, parseCustomRuleGroups(c.req.query('customRuleGroups')));
            const ua = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const groupDefaults = resolveGroupDefaults(c.req.query('group_defaults'), adminConfig?.groupDefaults);
            const enableClashUI = parseBooleanFlag(c.req.query('enable_clash_ui'));
            const externalController = c.req.query('external_controller');
            const externalUiDownloadUrl = c.req.query('external_ui_download_url');
            const configId = c.req.query('configId');
            const lang = c.get('lang');

            const requestedSingboxVersion = c.req.query('singbox_version') || c.req.query('sb_version') || c.req.query('sb_ver');
            const requestUserAgent = getRequestHeader(c.req, 'User-Agent');
            const singboxConfigVersion = resolveSingboxConfigVersion(requestedSingboxVersion, requestUserAgent);

            let baseConfig = singboxConfigVersion === '1.11' ? SING_BOX_CONFIG_V1_11 : SING_BOX_CONFIG;
            if (configId?.startsWith('singbox_')) {
                const storage = requireConfigStorage(services.configStorage);
                const storedConfig = await storage.getConfigById(configId);
                if (storedConfig) {
                    baseConfig = storedConfig;
                }
            }

            const builder = new SingboxConfigBuilder(
                config,
                selectedRules,
                customRules,
                baseConfig,
                lang,
                ua,
                groupByCountry,
                enableClashUI,
                externalController,
                externalUiDownloadUrl,
                singboxConfigVersion,
                includeAutoSelect,
                groupDefaults,
                customRuleGroups
            );
            await builder.build();
            const userinfo = builder.getSubscriptionUserinfo();
            if (userinfo) {
                c.header('subscription-userinfo', userinfo);
            }
            return c.json(builder.config);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/clash', async (c) => {
        try {
            const config = c.req.query('config');
            if (!config) {
                return c.text('Missing config parameter', 400);
            }

            const adminConfig = await loadAdminConfig(services.adminConfig, runtime.logger);
            const selectedRules = resolveSelectedRules(c.req.query('selectedRules'), adminConfig?.defaultRulePreset);
            const customRules = parseJsonArray(c.req.query('customRules'));
            const customRuleGroups = mergeRuleGroups(adminConfig?.customRuleSets, parseCustomRuleGroups(c.req.query('customRuleGroups')));
            const ua = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const groupDefaults = resolveGroupDefaults(c.req.query('group_defaults'), adminConfig?.groupDefaults);
            const enableClashUI = parseBooleanFlag(c.req.query('enable_clash_ui'));
            const externalController = c.req.query('external_controller');
            const externalUiDownloadUrl = c.req.query('external_ui_download_url');
            const configId = c.req.query('configId');
            // UDP defaults to on for every proxy; udp=false is the explicit opt-out.
            const forceUdp = parseBool(c.req.query('udp'), true);
            const lang = c.get('lang');

            const clashRuleBase = c.req.query('clash_rule_base') || c.req.query('clashRuleBase');
            // TTL precedence: per-request query > runtime default (env).
            const clashRuleBaseCacheTtl = normalizeClashRuleBaseCacheTtl(
                c.req.query('clash_rule_base_ttl') ?? c.req.query('clashRuleBaseTtl'),
                runtime.config.clashRuleBaseCacheTtlSeconds
            );
            const refreshClashRuleBase = parseBooleanFlag(c.req.query('clash_rule_base_refresh')) ||
                parseBooleanFlag(c.req.query('refresh_clash_rule_base'));

            // A template owns the whole rule section, so it only applies when the caller did not
            // ask for any per-request rule customisation of their own.
            const template = resolveTemplate(adminConfig, c, [
                'selectedRules',
                'customRules',
                'customRuleGroups',
                'clash_rule_base',
                'clashRuleBase',
                'configId'
            ]);

            let baseConfig;
            if (configId?.startsWith('clash_')) {
                const storage = requireConfigStorage(services.configStorage);
                baseConfig = await storage.getConfigById(configId);
            } else if (clashRuleBase) {
                // An explicit base URL outranks the template's own base config; the template
                // still owns the rule section when it applies.
                baseConfig = await resolveClashRuleBaseConfig({
                    url: clashRuleBase,
                    userAgent: ua,
                    kv: runtime.kv,
                    cacheTtlSeconds: clashRuleBaseCacheTtl,
                    refresh: refreshClashRuleBase,
                    logger: runtime.logger
                });
            } else if (template) {
                baseConfig = await resolveTemplateClashRuleBase({
                    template,
                    userAgent: ua,
                    kv: runtime.kv,
                    cacheTtlSeconds: clashRuleBaseCacheTtl,
                    refresh: refreshClashRuleBase,
                    logger: runtime.logger
                });
            }

            const builder = new ClashConfigBuilder(
                config,
                selectedRules,
                customRules,
                baseConfig,
                lang,
                ua,
                groupByCountry,
                enableClashUI,
                externalController,
                externalUiDownloadUrl,
                includeAutoSelect,
                groupDefaults,
                forceUdp,
                customRuleGroups
            );
            await builder.build();
            const userinfo = builder.getSubscriptionUserinfo();
            const headers = { 'Content-Type': 'text/yaml; charset=utf-8' };
            if (userinfo) {
                headers['subscription-userinfo'] = userinfo;
            }
            const body = template ? builder.formatTemplateConfig(template) : builder.formatConfig();
            return c.text(body, 200, headers);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/surge', async (c) => {
        try {
            const config = c.req.query('config');
            if (!config) {
                return c.text('Missing config parameter', 400);
            }

            const adminConfig = await loadAdminConfig(services.adminConfig, runtime.logger);
            const selectedRules = resolveSelectedRules(c.req.query('selectedRules'), adminConfig?.defaultRulePreset);
            const customRules = parseJsonArray(c.req.query('customRules'));
            const customRuleGroups = mergeRuleGroups(adminConfig?.customRuleSets, parseCustomRuleGroups(c.req.query('customRuleGroups')));
            const ua = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const groupDefaults = resolveGroupDefaults(c.req.query('group_defaults'), adminConfig?.groupDefaults);
            const configId = c.req.query('configId');
            const lang = c.get('lang');

            let baseConfig;
            if (configId?.startsWith('surge_')) {
                const storage = requireConfigStorage(services.configStorage);
                baseConfig = await storage.getConfigById(configId);
            }

            const builder = new SurgeConfigBuilder(
                config,
                selectedRules,
                customRules,
                baseConfig,
                lang,
                ua,
                groupByCountry,
                includeAutoSelect,
                groupDefaults,
                customRuleGroups
            );
            builder.setSubscriptionUrl(c.req.url);
            await builder.build();

            const userinfo = builder.getSubscriptionUserinfo();
            if (userinfo) {
                c.header('subscription-userinfo', userinfo);
            }
            return c.text(builder.formatConfig());
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/subconverter', async (c) => {
        try {
            const adminConfig = await loadAdminConfig(services.adminConfig, runtime.logger);
            const rawSelectedRules = c.req.query('selectedRules');
            // /subconverter has no configId/clash_rule_base override, so the template query or
            // the default template is the only entry point. Its base URLs are template
            // overrides, not rule customisation, so they do not block the default template.
            const template = resolveTemplate(adminConfig, c, ['selectedRules', 'customRules', 'customRuleGroups']);

            if (template) {
                const config = generateTemplateSubconverterConfig(template, {
                    clashRuleBase: c.req.query('clash_rule_base') || c.req.query('clashRuleBase'),
                    quanxRuleBase: c.req.query('quanx_rule_base') || c.req.query('quanxRuleBase')
                });
                return c.text(config, 200, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });
            }

            let selectedRules;

            if (!rawSelectedRules) {
                selectedRules = resolveSelectedRules(undefined, adminConfig?.defaultRulePreset);
            } else if (PREDEFINED_RULE_SETS[rawSelectedRules]) {
                selectedRules = PREDEFINED_RULE_SETS[rawSelectedRules];
            } else {
                try {
                    const parsed = JSON.parse(rawSelectedRules);
                    if (Array.isArray(parsed)) {
                        selectedRules = parsed;
                    } else {
                        return c.text('Invalid selectedRules: must be a preset name (minimal, balanced, comprehensive) or a JSON array', 400);
                    }
                } catch {
                    return c.text(`Invalid selectedRules: "${rawSelectedRules}" is not a valid preset name or JSON array. Valid presets: minimal, balanced, comprehensive`, 400);
                }
            }

            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const customRules = parseJsonArray(c.req.query('customRules'));
            const customRuleGroups = mergeRuleGroups(adminConfig?.customRuleSets, parseCustomRuleGroups(c.req.query('customRuleGroups')));
            const groupDefaults = resolveGroupDefaults(c.req.query('group_defaults'), adminConfig?.groupDefaults);
            const lang = c.get('lang');

            const config = generateSubconverterConfig({
                selectedRules,
                customRules,
                customRuleGroups,
                lang,
                includeAutoSelect,
                groupByCountry,
                groupDefaults
            });

            return c.text(config, 200, {
                'Content-Type': 'text/plain; charset=utf-8'
            });
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/xray', async (c) => {
        const inputString = c.req.query('config');
        if (!inputString) {
            return c.text('Missing config parameter', 400);
        }

        const proxylist = inputString.split('\n');
        const finalProxyList = [];
        let subscriptionUserinfo;
        const userAgent = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
        const headers = { 'User-Agent': userAgent };

        for (const proxy of proxylist) {
            const trimmedProxy = proxy.trim();
            if (!trimmedProxy) continue;

            if (trimmedProxy.startsWith('http://') || trimmedProxy.startsWith('https://')) {
                try {
                    const response = await fetch(trimmedProxy, { method: 'GET', headers });
                    const fetchedUserinfo = response.headers.get('subscription-userinfo');
                    if (fetchedUserinfo && subscriptionUserinfo === undefined) {
                        subscriptionUserinfo = fetchedUserinfo;
                    }
                    const text = await response.text();
                    let processed = tryDecodeSubscriptionLines(text, { decodeUriComponent: true });
                    if (!Array.isArray(processed)) processed = [processed];
                    finalProxyList.push(...processed.filter(item => typeof item === 'string' && item.trim() !== ''));
                } catch (e) {
                    runtime.logger.warn('Failed to fetch the proxy', e);
                }
            } else {
                let processed = tryDecodeSubscriptionLines(trimmedProxy);
                if (!Array.isArray(processed)) processed = [processed];
                finalProxyList.push(...processed.filter(item => typeof item === 'string' && item.trim() !== ''));
            }
        }

        const finalString = finalProxyList.join('\n');
        if (!finalString) {
            return c.text('Missing config parameter', 400);
        }

        const responseHeaders = {};
        if (subscriptionUserinfo) {
            responseHeaders['subscription-userinfo'] = subscriptionUserinfo;
        }

        return c.text(encodeBase64(finalString), 200, responseHeaders);
    });

    app.get('/shorten-v2', async (c) => {
        try {
            const url = c.req.query('url');
            if (!url) {
                return c.text('Missing URL parameter', 400);
            }
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            } catch {
                return c.text('Invalid URL parameter', 400);
            }
            const queryString = parsedUrl.search;

            const shortLinks = requireShortLinkService(services.shortLinks);
            const code = await shortLinks.createShortLink(queryString, c.req.query('shortCode'));
            return c.text(code);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    const redirectHandler = (prefix) => async (c) => {
        try {
            const code = c.req.param('code');
            const shortLinks = requireShortLinkService(services.shortLinks);
            const originalParam = await shortLinks.resolveShortCode(code);
            if (!originalParam) return c.text('Short URL not found', 404);

            const url = new URL(c.req.url);
            return c.redirect(`${url.origin}/${prefix}${originalParam}`);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    };

    app.get('/s/:code', redirectHandler('surge'));
    app.get('/b/:code', redirectHandler('singbox'));
    app.get('/c/:code', redirectHandler('clash'));
    app.get('/x/:code', redirectHandler('xray'));

    app.post('/config', async (c) => {
        try {
            const { type, content } = await c.req.json();
            const storage = requireConfigStorage(services.configStorage);
            const configId = await storage.saveConfig(type, content);
            return c.text(configId);
        } catch (error) {
            if (error instanceof SyntaxError) {
                return c.text(`Invalid format: ${error.message}`, 400);
            }
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/resolve', async (c) => {
        try {
            const shortUrl = c.req.query('url');
            const t = c.get('t');
            if (!shortUrl) return c.text(t('missingUrl'), 400);

            let urlObj;
            try {
                urlObj = new URL(shortUrl);
            } catch {
                return c.text(t('invalidShortUrl'), 400);
            }
            const pathParts = urlObj.pathname.split('/');
            if (pathParts.length < 3) return c.text(t('invalidShortUrl'), 400);

            const prefix = pathParts[1];
            const shortCode = pathParts[2];
            if (!['b', 'c', 'x', 's'].includes(prefix)) return c.text(t('invalidShortUrl'), 400);

            const shortLinks = requireShortLinkService(services.shortLinks);
            const originalParam = await shortLinks.resolveShortCode(shortCode);
            if (!originalParam) return c.text(t('shortUrlNotFound'), 404);

            const mapping = { b: 'singbox', c: 'clash', x: 'xray', s: 'surge' };
            const originalUrl = `${urlObj.origin}/${mapping[prefix]}${originalParam}`;
            return c.json({ originalUrl });
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/favicon.ico', async (c) => {
        if (!runtime.assetFetcher) {
            return c.notFound();
        }
        try {
            return await runtime.assetFetcher(c.req.raw);
        } catch (error) {
            runtime.logger.warn('Asset fetch failed', error);
            return c.notFound();
        }
    });

    return app;
}

export function parseSelectedRules(raw) {
    if (!raw) return [];

    // 首先检查是否是预设名称 (minimal, balanced, comprehensive)
    // 这确保向后兼容主分支的 API 行为
    if (typeof raw === 'string' && PREDEFINED_RULE_SETS[raw]) {
        return PREDEFINED_RULE_SETS[raw];
    }

    // 尝试解析为 JSON 数组
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // 解析失败，回退到 minimal 预设
        console.warn(`Failed to parse selectedRules: ${raw}, falling back to minimal`);
        return PREDEFINED_RULE_SETS.minimal;
    }
}

function parseJsonArray(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseBooleanFlag(value) {
    return value === 'true' || value === true;
}

// Admin config is an optional input: a broken store must not turn every subscription
// request into a 500, so failures degrade to "no admin config".
async function loadAdminConfig(adminConfigService, logger) {
    try {
        return await adminConfigService.getConfig();
    } catch (error) {
        logger?.warn?.('Failed to read admin config', error);
        return null;
    }
}

// selectedRules keeps its historical "empty when absent" contract; the admin-defined
// default preset is applied on top of it.
function resolveSelectedRules(raw, defaultPreset) {
    const selected = parseSelectedRules(raw);
    if (raw || selected.length > 0) return selected;
    // An unknown preset name would silently drop all rules, so fall back to balanced.
    return PREDEFINED_RULE_SETS[defaultPreset] || PREDEFINED_RULE_SETS.balanced;
}

function parseGroupDefaults(raw) {
    if (!raw) return {};
    try {
        return normalizeGroupDefaults(JSON.parse(raw));
    } catch {
        return {};
    }
}

// Query values win over admin config as a whole; per-key merging would mix two sources
// of truth for the same group.
function resolveGroupDefaults(raw, adminGroupDefaults) {
    const parsed = parseGroupDefaults(raw);
    return Object.keys(parsed).length > 0 ? parsed : (adminGroupDefaults || {});
}

function normalizeGroupDefaults(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }
    const normalized = {};
    Object.entries(parsed).forEach(([groupName, preferred]) => {
        // Only string -> string pairs can name a group and an option.
        if (typeof preferred !== 'string') return;
        const key = groupName.trim();
        const value = preferred.trim();
        if (!key || !value) return;
        normalized[key] = value;
    });
    return normalized;
}

function parseCustomRuleGroups(raw) {
    if (!raw) return [];
    try {
        return normalizeCustomRuleGroups(JSON.parse(raw)).map(({ name, urls }) => ({ name, urls }));
    } catch {
        return [];
    }
}

// Admin rule groups are the defaults; a query group with the same name replaces it and
// keeps its position, so query order stays authoritative for the caller.
function mergeRuleGroups(adminSets = [], queryGroups = []) {
    const groups = new Map();
    (Array.isArray(adminSets) ? adminSets : []).forEach(group => {
        if (group && typeof group.name === 'string') groups.set(group.name, group);
    });
    (Array.isArray(queryGroups) ? queryGroups : []).forEach(group => {
        if (group && typeof group.name === 'string') groups.set(group.name, group);
    });
    return [...groups.values()];
}

/**
 * Pick the rule template for a request.
 *
 * An explicit `template` id always wins. Otherwise a template only applies to a request
 * that carries no rule customisation at all: templates own the rule section wholesale, so
 * applying one while the caller passes selectedRules/customRules would silently discard
 * their input.
 *
 * `treatAsCustomization` lists the query params that block an implicit template. Callers
 * pass what their endpoint actually honours, because /subconverter treats its base-config
 * overrides as template inputs rather than as rule customisation.
 */
function resolveTemplate(adminConfig, c, treatAsCustomization) {
    const templates = Array.isArray(adminConfig?.templates) ? adminConfig.templates : [];
    const requestedId = c.req.query('template');
    if (requestedId) {
        // Only enabled templates are reachable from a URL, even if an id is guessed.
        return templates.find(template => template.enabled && template.id === requestedId) || null;
    }

    if (treatAsCustomization.some(param => c.req.query(param))) return null;

    return templates.find(template => template.enabled && template.isDefault) ||
        templates.find(template => template.enabled && template.id === adminConfig?.defaultRulePreset) ||
        null;
}

// Mirrors the implicit-template branch of resolveTemplate for the landing page, where no
// query parameters exist yet.
function findDefaultTemplate(adminConfig) {
    const templates = Array.isArray(adminConfig?.templates) ? adminConfig.templates : [];
    return templates.find(item => item.enabled && item.isDefault) ||
        templates.find(item => item.enabled && item.id === adminConfig?.defaultRulePreset) ||
        null;
}

// A template without its own base URL must still resolve: its embedded fallback config is
// the only copy of the template's rule-providers available offline.
async function resolveTemplateClashRuleBase({ template, userAgent, kv, cacheTtlSeconds, refresh, logger }) {
    const fallbackConfig = template.fallbackClashConfig || undefined;
    if (!template.clashRuleBase) {
        // Nothing to fetch: the builder falls back to its built-in base config when this
        // returns undefined, and a template fallback (when present) is used as-is.
        return fallbackConfig;
    }
    return resolveClashRuleBaseConfig({
        url: template.clashRuleBase,
        userAgent,
        kv,
        cacheTtlSeconds,
        refresh,
        fallbackConfig,
        logger
    });
}

function parseSemverLike(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const match = trimmed.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) {
        return null;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: match[3] ? Number(match[3]) : 0
    };
}

function isSingboxLegacyConfig(version) {
    if (!version || Number.isNaN(version.major) || Number.isNaN(version.minor)) {
        return false;
    }
    if (version.major !== 1) {
        return version.major < 1;
    }
    return version.minor < 12;
}

// 1.14 swaps rule-set download_detour for http_client, which older clients
// reject as an unknown field, so it needs its own config tier.
function isSingboxModernConfig(version) {
    if (!version || Number.isNaN(version.major) || Number.isNaN(version.minor)) {
        return false;
    }
    if (version.major !== 1) {
        return version.major > 1;
    }
    return version.minor >= 14;
}

function resolveSingboxConfigTier(version) {
    if (isSingboxLegacyConfig(version)) return '1.11';
    return isSingboxModernConfig(version) ? '1.14' : '1.12';
}

function resolveSingboxConfigVersion(requestedVersion, userAgent) {
    const normalizedRequested = typeof requestedVersion === 'string' ? requestedVersion.trim().toLowerCase() : '';
    if (normalizedRequested && normalizedRequested !== 'auto') {
        if (normalizedRequested === 'legacy') return '1.11';
        if (normalizedRequested === 'latest') return '1.14';
        const parsed = parseSemverLike(normalizedRequested);
        if (parsed) {
            return resolveSingboxConfigTier(parsed);
        }
    }

    if (typeof userAgent === 'string' && userAgent) {
        const uaMatch = userAgent.match(/sing-box\/(\d+\.\d+(?:\.\d+)?)/i) || userAgent.match(/sing-box\s+(\d+\.\d+(?:\.\d+)?)/i);
        const versionString = uaMatch?.[1];
        const parsed = versionString ? parseSemverLike(versionString) : null;
        if (parsed) {
            return resolveSingboxConfigTier(parsed);
        }
    }

    return '1.12';
}

function getRequestHeader(request, name) {
    if (!request || !name) {
        return undefined;
    }

    try {
        const value = request.header(name);
        if (value !== undefined) {
            return value;
        }
    } catch {
        // Fallback if HonoRequest.header cannot read from the raw request.
    }

    const headers = request.raw?.headers;
    if (!headers) {
        return undefined;
    }

    if (typeof headers.get === 'function') {
        return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
    }

    if (typeof headers === 'object') {
        const lowerName = name.toLowerCase();
        const headerValue = headers[lowerName] ?? headers[name];
        if (Array.isArray(headerValue)) {
            return headerValue[0];
        }
        return headerValue;
    }

    return undefined;
}

function requireShortLinkService(service) {
    if (!service) {
        throw new MissingDependencyError('Short link functionality is unavailable');
    }
    return service;
}

function requireConfigStorage(service) {
    if (!service) {
        throw new MissingDependencyError('Config storage functionality is unavailable');
    }
    return service;
}

function handleError(c, error, logger) {
    if (error instanceof ServiceError) {
        return c.text(error.message, error.status);
    }
    logger.error?.('Unhandled error', error);
    return c.text(`Error: ${error.message}`, 500);
}
