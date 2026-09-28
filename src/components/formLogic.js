export const formLogicFn = (t) => {
    const GROUP_DEFAULTS_SAVE_DEBOUNCE_MS = 120;
    // Keep this helper inlined instead of importing from utils so formLogicFn.toString()
    // remains self-contained when injected into the browser runtime.
    const normalizeCustomRuleGroups = (rawGroups = []) => {
        if (!Array.isArray(rawGroups)) return [];
        return rawGroups
            .map(group => {
                if (!group || typeof group !== 'object') return null;
                const name = typeof group.name === 'string' ? group.name.trim() : '';
                // Backward compatibility: older links used singular `url`, new format uses `urls`.
                const urls = Array.isArray(group.urls)
                    ? group.urls
                    : (typeof group.url === 'string' ? [group.url] : []);
                const normalizedUrls = urls
                    .filter(url => typeof url === 'string')
                    .map(url => url.trim())
                    .filter(Boolean);
                if (!name || normalizedUrls.length === 0) return null;
                return { name, urls: normalizedUrls };
            })
            .filter(Boolean);
    };

    window.formData = function () {
        // Inline parseSurgeConfigInput to make it available in toString()
        const parseSurgeValue = (rawValue = '') => {
            const trimmed = rawValue.trim();
            if (trimmed === '') return '';
            const unquoted = trimmed.replace(/^"(.*)"$/, '$1');
            const lower = unquoted.toLowerCase();
            if (lower === 'true') return true;
            if (lower === 'false') return false;
            if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
            return unquoted;
        };

        const convertSurgeIniToJson = (content) => {
            const lines = content.split(/\r?\n/);
            const config = {};
            let currentSection = null;
            const ensureObject = (key) => {
                if (!config[key]) config[key] = {};
                return config[key];
            };
            const ensureArray = (key) => {
                if (!config[key]) config[key] = [];
                return config[key];
            };
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line || line.startsWith(';') || line.startsWith('#')) continue;
                const sectionMatch = line.match(/^\[(.+)]$/);
                if (sectionMatch) {
                    currentSection = sectionMatch[1].trim();
                    continue;
                }
                if (!currentSection) continue;
                const sectionName = currentSection.toLowerCase();
                if (sectionName === 'general' || sectionName === 'replica') {
                    const equalsIndex = line.indexOf('=');
                    if (equalsIndex === -1) continue;
                    const key = line.slice(0, equalsIndex).trim();
                    const value = line.slice(equalsIndex + 1).trim();
                    if (!key) continue;
                    const target = ensureObject(sectionName);
                    target[key] = parseSurgeValue(value);
                } else if (sectionName === 'proxy') {
                    ensureArray('proxies').push(line);
                } else if (sectionName === 'proxy group') {
                    ensureArray('proxy-groups').push(line);
                } else if (sectionName === 'rule') {
                    ensureArray('rules').push(line);
                } else {
                    ensureArray(sectionName).push(line);
                }
            }
            if (!config.general && !config.replica && !config.proxies && !config['proxy-groups']) {
                throw new Error('Unable to parse Surge INI content');
            }
            return config;
        };

        const parseSurgeConfigInput = (content) => {
            const trimmed = content.trim();
            if (!trimmed) throw new Error('Config content is empty');
            try {
                return { configObject: JSON.parse(trimmed), convertedFromIni: false };
            } catch {
                const converted = convertSurgeIniToJson(content);
                return { configObject: converted, convertedFromIni: true };
            }
        };

        return {
            input: '',
            showAdvanced: false,
            // Accordion states for each section (二级手风琴状态)
            accordionSections: {
                rules: true,        // 规则选择 - 默认展开
                customRules: false, // 自定义规则
                general: false,     // 通用设置
                baseConfig: false,  // 基础配置
                ua: false          // User Agent
            },
            selectedRules: [],
            selectedPredefinedRule: 'balanced',
            subconverterCopied: false,
            groupByCountry: false,
            includeAutoSelect: true,
            groupDefaults: {},
            customRuleGroups: [],
            clashRuleBase: '',
            // Default off: UDP is only forced onto every proxy when the user opts in.
            forceUdp: false,
            enableClashUI: false,
            externalController: '',
            externalUiDownloadUrl: '',
            configType: 'singbox',
            configEditor: '',
            savingConfig: false,
            currentConfigId: '',
            saveConfigText: '',
            savingConfigText: '',
            configContentRequiredText: '',
            configSaveFailedText: '',
            configValidationState: '',
            configValidationMessage: '',
            customUA: '',
            loading: false,
            generatedLinks: null,
            shortenedLinks: null,
            shortening: false,
            customShortCode: '',
            parsingUrl: false,
            parseDebounceTimer: null,
            groupDefaultsSaveTimer: null,
            // These will be populated from window.APP_TRANSLATIONS
            processingText: '',
            convertText: '',
            shortenLinksText: '',
            shorteningText: '',
            showFullLinksText: '',

            init() {
                // Load translations
                if (window.APP_TRANSLATIONS) {
                    this.processingText = window.APP_TRANSLATIONS.processing;
                    this.convertText = window.APP_TRANSLATIONS.convert;
                    this.shortenLinksText = window.APP_TRANSLATIONS.shortenLinks;
                    this.shorteningText = window.APP_TRANSLATIONS.shortening;
                    this.showFullLinksText = window.APP_TRANSLATIONS.showFullLinks;
                    this.saveConfigText = window.APP_TRANSLATIONS.saveConfig;
                    this.savingConfigText = window.APP_TRANSLATIONS.savingConfig;
                    this.configContentRequiredText = window.APP_TRANSLATIONS.configContentRequired;
                    this.configSaveFailedText = window.APP_TRANSLATIONS.configSaveFailed;
                }

                // Load saved data
                this.input = localStorage.getItem('inputTextarea') || '';
                this.showAdvanced = localStorage.getItem('advancedToggle') === 'true';
                this.groupByCountry = localStorage.getItem('groupByCountry') === 'true';
                this.includeAutoSelect = localStorage.getItem('includeAutoSelect') !== 'false';
                this.enableClashUI = localStorage.getItem('enableClashUI') === 'true';
                this.forceUdp = localStorage.getItem('forceUdp') === 'true';
                // Displaying a group's admin-defined default means seeding the override map: customRuleSets
                // own per-group `defaultOption`, groupDefaults carries the rest. The server still
                // applies its own defaults when nothing is sent.
                this.groupDefaults = {};
                (window.ADMIN_RULE_SETS || []).forEach(ruleSet => {
                    const name = typeof ruleSet?.name === 'string' ? ruleSet.name.trim() : '';
                    const option = typeof ruleSet?.defaultOption === 'string' ? ruleSet.defaultOption.trim() : '';
                    if (name && option) this.groupDefaults[name] = option;
                });
                const adminDefaults = window.ADMIN_GROUP_DEFAULTS;
                if (adminDefaults && typeof adminDefaults === 'object' && !Array.isArray(adminDefaults)) {
                    Object.assign(this.groupDefaults, adminDefaults);
                }
                const savedGroupDefaults = localStorage.getItem('groupDefaults');
                if (savedGroupDefaults) {
                    try {
                        const parsedDefaults = JSON.parse(savedGroupDefaults);
                        if (parsedDefaults && typeof parsedDefaults === 'object' && !Array.isArray(parsedDefaults)) {
                            this.groupDefaults = { ...this.groupDefaults, ...parsedDefaults };
                        }
                    } catch { }
                }
                this.customRuleGroups = [];
                this.clashRuleBase = localStorage.getItem('clashRuleBase') || '';
                this.externalController = localStorage.getItem('externalController') || '';
                this.externalUiDownloadUrl = localStorage.getItem('externalUiDownloadUrl') || '';
                this.customUA = localStorage.getItem('userAgent') || '';
                this.configEditor = localStorage.getItem('configEditor') || '';
                this.configType = localStorage.getItem('configType') || 'singbox';
                this.customShortCode = localStorage.getItem('customShortCode') || '';
                const initialUrlParams = new URLSearchParams(window.location.search);
                this.currentConfigId = initialUrlParams.get('configId') || '';

                // Load accordion states
                const savedAccordion = localStorage.getItem('accordionSections');
                if (savedAccordion) {
                    try {
                        this.accordionSections = JSON.parse(savedAccordion);
                    } catch (e) {
                        // If parsing fails, keep defaults
                    }
                }

                // Initialize rules
                this.applyPredefinedRule();

                // Watchers to save state
                this.$watch('input', val => {
                    localStorage.setItem('inputTextarea', val);
                    this.handleInputChange(val);
                });
                this.$watch('showAdvanced', val => localStorage.setItem('advancedToggle', val));
                this.$watch('groupByCountry', val => localStorage.setItem('groupByCountry', val));
                this.$watch('includeAutoSelect', val => localStorage.setItem('includeAutoSelect', val));
                this.$watch('enableClashUI', val => localStorage.setItem('enableClashUI', val));
                this.$watch('forceUdp', val => localStorage.setItem('forceUdp', val));
                this.$watch('clashRuleBase', val => localStorage.setItem('clashRuleBase', val || ''));
                // Deep changes fire on every keystroke, so the write is debounced to keep
                // localStorage traffic proportional to edits rather than to characters.
                this.$watch('groupDefaults', val => {
                    if (this.groupDefaultsSaveTimer) {
                        clearTimeout(this.groupDefaultsSaveTimer);
                    }
                    this.groupDefaultsSaveTimer = setTimeout(() => {
                        localStorage.setItem('groupDefaults', JSON.stringify(val || {}));
                    }, GROUP_DEFAULTS_SAVE_DEBOUNCE_MS);
                }, { deep: true });
                this.$watch('customRuleGroups', () => localStorage.removeItem('customRuleGroups'), { deep: true });
                this.$watch('externalController', val => localStorage.setItem('externalController', val));
                this.$watch('externalUiDownloadUrl', val => localStorage.setItem('externalUiDownloadUrl', val));
                this.$watch('customUA', val => localStorage.setItem('userAgent', val));
                this.$watch('configEditor', val => {
                    localStorage.setItem('configEditor', val);
                    this.resetConfigValidation();
                });
                this.$watch('configType', val => {
                    localStorage.setItem('configType', val);
                    this.resetConfigValidation();
                });
                this.$watch('customShortCode', val => localStorage.setItem('customShortCode', val));
                this.$watch('accordionSections', val => localStorage.setItem('accordionSections', JSON.stringify(val)), { deep: true });
            },

            toggleAccordion(section) {
                this.accordionSections[section] = !this.accordionSections[section];
            },

            applyPredefinedRule() {
                if (this.selectedPredefinedRule === 'custom') return;

                // PREDEFINED_RULE_SETS will be injected globally
                const rules = window.PREDEFINED_RULE_SETS;
                if (rules && rules[this.selectedPredefinedRule]) {
                    this.selectedRules = rules[this.selectedPredefinedRule];
                }
            },

            // Presets do not carry per-group defaults, so the effective default of a rule is resolved
            // from the admin config at runtime; the UI shows it as the empty option's label.
            getFollowBuiltInDefaultLabel(ruleName) {
                const label = window.APP_TRANSLATIONS?.followBuiltInDefault || 'Follow built-in default';
                const effective = this.getAdminRuleDefault(ruleName);
                return effective ? label + ' (' + this.translateOutbound(effective) + ')' : label;
            },

            // Admin rule sets own a per-group defaultOption, admin groupDefaults owns the rest;
            // together they are what the server falls back to when no override is sent.
            getAdminRuleDefault(ruleName) {
                if (!ruleName) return '';
                const ruleSet = (window.ADMIN_RULE_SETS || []).find(set => set?.name === ruleName);
                const option = typeof ruleSet?.defaultOption === 'string' ? ruleSet.defaultOption.trim() : '';
                if (option) return option;
                const adminDefaults = window.ADMIN_GROUP_DEFAULTS;
                const groupOption = adminDefaults && typeof adminDefaults === 'object' ? adminDefaults[ruleName] : undefined;
                return typeof groupOption === 'string' ? groupOption.trim() : '';
            },

            translateOutbound(name) {
                // Admin groups reuse the same outbound keys as built-in rules, so an unknown
                // name must fall back to itself rather than render "undefined".
                return window.APP_TRANSLATIONS?.outboundNames?.[name] || name;
            },

            getCustomRuleGroupsForPayload() {
                return normalizeCustomRuleGroups(this.customRuleGroups);
            },

            // Only rules that are actually selected produce a group, and an empty option means
            // "follow the built-in default", so neither belongs in the query. Filtering here
            // (instead of deleting keys) keeps admin-seeded defaults if the rule is re-selected.
            getGroupDefaultsForPayload() {
                const selected = new Set(this.selectedRules || []);
                const result = {};
                Object.entries(this.groupDefaults || {}).forEach(([ruleName, option]) => {
                    if (!selected.has(ruleName)) return;
                    if (typeof option !== 'string' || !option.trim()) return;
                    result[ruleName] = option.trim();
                });
                return result;
            },

            addCustomRuleGroup() {
                this.customRuleGroups.push({ name: '', urls: [''] });
            },

            removeCustomRuleGroup(index) {
                if (index < 0 || index >= this.customRuleGroups.length) return;
                const removed = this.customRuleGroups[index];
                this.customRuleGroups.splice(index, 1);
                if (removed?.name) {
                    this.selectedRules = (this.selectedRules || []).filter(name => name !== removed.name);
                    delete this.groupDefaults[removed.name];
                }
            },

            addRuleSetUrl(group) {
                if (!group) return;
                if (!Array.isArray(group.urls)) group.urls = [];
                group.urls.push('');
            },

            removeRuleSetUrl(group, urlIndex) {
                if (!group || !Array.isArray(group.urls)) return;
                if (urlIndex < 0 || urlIndex >= group.urls.length) return;
                group.urls.splice(urlIndex, 1);
                if (group.urls.length === 0) {
                    group.urls.push('');
                }
            },

            // Shared by /subconverter, the per-client links and the shorten flow so every
            // generated URL carries the same customisation.
            appendCustomizationParams(params) {
                const customRuleGroups = this.getCustomRuleGroupsForPayload();
                if (customRuleGroups.length > 0) {
                    params.append('customRuleGroups', JSON.stringify(customRuleGroups));
                }

                const groupDefaults = this.getGroupDefaultsForPayload();
                if (Object.keys(groupDefaults).length > 0) {
                    params.append('group_defaults', JSON.stringify(groupDefaults));
                }

                if (this.forceUdp) {
                    params.append('udp', 'true');
                }

                if (this.clashRuleBase && this.clashRuleBase.trim()) {
                    params.append('clash_rule_base', this.clashRuleBase.trim());
                }
            },

            getSubconverterUrl() {
                const origin = window.location.origin;
                const params = new URLSearchParams();

                // Use preset name directly if a predefined rule set is selected
                if (this.selectedPredefinedRule && this.selectedPredefinedRule !== 'custom') {
                    params.append('selectedRules', this.selectedPredefinedRule);
                } else if (this.selectedPredefinedRule === 'custom') {
                    params.append('selectedRules', JSON.stringify(this.selectedRules));
                }

                // Include customRules when available (best-effort; may make URL long)
                try {
                    const customRulesInput = document.querySelector('input[name="customRules"]');
                    const customRules = customRulesInput && customRulesInput.value ? JSON.parse(customRulesInput.value) : [];
                    if (Array.isArray(customRules) && customRules.length > 0) {
                        params.append('customRules', JSON.stringify(customRules));
                    }
                } catch { }

                if (!this.includeAutoSelect) {
                    params.append('include_auto_select', 'false');
                }

                if (this.groupByCountry) {
                    params.append('group_by_country', 'true');
                }

                this.appendCustomizationParams(params);

                // Include lang parameter so subconverter gets correct group names
                const appLang = window.APP_LANG || 'zh-CN';
                if (appLang !== 'zh-CN') {
                    params.append('lang', appLang);
                }

                const queryString = params.toString();
                return origin + '/subconverter' + (queryString ? '?' + queryString : '');
            },

            copySubconverterUrl() {
                const url = this.getSubconverterUrl();
                navigator.clipboard.writeText(url).then(() => {
                    this.subconverterCopied = true;
                    setTimeout(() => this.subconverterCopied = false, 2000);
                }).catch(() => {});
            },

            resetConfigValidation() {
                this.configValidationState = '';
                this.configValidationMessage = '';
            },

            async saveBaseConfig() {
                const content = (this.configEditor || '').trim();
                if (!content) {
                    alert(this.configContentRequiredText || window.APP_TRANSLATIONS.configContentRequired);
                    return;
                }

                let payloadContent = this.configEditor;
                if (this.configType === 'surge') {
                    try {
                        const { configObject } = parseSurgeConfigInput(this.configEditor);
                        payloadContent = JSON.stringify(configObject);
                    } catch (parseError) {
                        const prefix = window.APP_TRANSLATIONS.configValidationError || 'Config validation error:';
                        alert(`${prefix} ${parseError?.message || ''}`.trim());
                        return;
                    }
                }

                this.savingConfig = true;
                try {
                    const response = await fetch('/config', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            type: this.configType,
                            content: payloadContent
                        })
                    });
                    const responseText = await response.text();
                    if (!response.ok) {
                        throw new Error(responseText || response.statusText || 'Request failed');
                    }
                    const configId = responseText.trim();
                    if (!configId) {
                        throw new Error('Missing config ID');
                    }
                    this.currentConfigId = configId;
                    this.updateConfigIdInUrl(configId);

                    const successMessage = window.APP_TRANSLATIONS.saveConfigSuccess || 'Configuration saved successfully!';
                    alert(`${successMessage}\nID: ${configId}`);
                } catch (error) {
                    console.error('Failed to save base config:', error);
                    const errorPrefix = this.configSaveFailedText || window.APP_TRANSLATIONS.configSaveFailed || 'Failed to save configuration';
                    alert(`${errorPrefix}: ${error?.message || 'Unknown error'}`);
                } finally {
                    this.savingConfig = false;
                }
            },

            validateBaseConfig() {
                const content = (this.configEditor || '').trim();
                if (!content) {
                    this.configValidationState = 'error';
                    this.configValidationMessage = this.configContentRequiredText || window.APP_TRANSLATIONS.configContentRequired;
                    return;
                }

                try {
                    if (this.configType === 'clash') {
                        if (!window.jsyaml || !window.jsyaml.load) {
                            throw new Error(window.APP_TRANSLATIONS.parserUnavailable || 'Parser unavailable. Please refresh and try again.');
                        }
                        window.jsyaml.load(content);
                        this.configValidationState = 'success';
                        this.configValidationMessage =
                            window.APP_TRANSLATIONS.validYamlConfig || 'YAML config is valid';
                    } else if (this.configType === 'surge') {
                        parseSurgeConfigInput(this.configEditor);
                        this.configValidationState = 'success';
                        this.configValidationMessage =
                            window.APP_TRANSLATIONS.validJsonConfig || 'JSON config is valid';
                    } else {
                        JSON.parse(content);
                        this.configValidationState = 'success';
                        this.configValidationMessage =
                            window.APP_TRANSLATIONS.validJsonConfig || 'JSON config is valid';
                    }
                } catch (error) {
                    this.configValidationState = 'error';
                    const prefix = window.APP_TRANSLATIONS.configValidationError || 'Config validation error: ';
                    this.configValidationMessage = `${prefix}${error?.message || ''}`;
                }
            },

            clearBaseConfig() {
                if (confirm(window.APP_TRANSLATIONS.confirmClearConfig)) {
                    this.configEditor = '';
                    localStorage.removeItem('configEditor');
                    this.currentConfigId = '';
                    this.updateConfigIdInUrl(null);
                }
            },

            clearAll() {
                if (confirm(window.APP_TRANSLATIONS.confirmClearAll)) {
                    this.input = '';
                    this.generatedLinks = null;
                    this.shortenedLinks = null;
                    this.customShortCode = '';
                    // Also clear from localStorage
                    localStorage.removeItem('customShortCode');
                }
            },

            updateConfigIdInUrl(configId) {
                const url = new URL(window.location.href);
                if (configId) {
                    url.searchParams.set('configId', configId);
                } else {
                    url.searchParams.delete('configId');
                }
                window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
            },

            async submitForm() {
                this.loading = true;
                this.shortenedLinks = null; // Reset shortened links when generating new links
                try {
                    // Get custom rules from the child component via the hidden input
                    const customRulesInput = document.querySelector('input[name="customRules"]');
                    const customRules = customRulesInput && customRulesInput.value ? JSON.parse(customRulesInput.value) : [];

                    // Construct URLs
                    const origin = window.location.origin;
                    const params = new URLSearchParams();
                    params.append('config', this.input);
                    params.append('ua', this.customUA);
                    params.append('selectedRules', JSON.stringify(this.selectedRules));
                    params.append('customRules', JSON.stringify(customRules));

                    if (this.groupByCountry) params.append('group_by_country', 'true');
                    if (!this.includeAutoSelect) params.append('include_auto_select', 'false');
                    if (this.enableClashUI) params.append('enable_clash_ui', 'true');
                    if (this.externalController) params.append('external_controller', this.externalController);
                    if (this.externalUiDownloadUrl) params.append('external_ui_download_url', this.externalUiDownloadUrl);

                    this.appendCustomizationParams(params);

                    // Add configId if present in URL
                    const urlParams = new URLSearchParams(window.location.search);
                    const configId = this.currentConfigId || urlParams.get('configId');
                    if (configId) {
                        params.append('configId', configId);
                    }

                    const queryString = params.toString();

                    this.generatedLinks = {
                        xray: origin + '/xray?' + queryString,
                        singbox: origin + '/singbox?' + queryString,
                        clash: origin + '/clash?' + queryString,
                        surge: origin + '/surge?' + queryString
                    };

                    // Scroll to results
                    setTimeout(() => {
                        const resultsDiv = document.querySelector('.mt-12');
                        if (resultsDiv) {
                            resultsDiv.scrollIntoView({ behavior: 'smooth' });
                        }
                    }, 100);

                } catch (error) {
                    console.error('Error generating links:', error);
                    alert(window.APP_TRANSLATIONS.errorGeneratingLinks);
                } finally {
                    this.loading = false;
                }
            },

            async shortenLinks() {
                // Check if links are already shortened
                if (this.shortenedLinks) {
                    alert(window.APP_TRANSLATIONS.alreadyShortened);
                    return;
                }

                if (!this.generatedLinks) {
                    return;
                }

                this.shortening = true;
                try {
                    const origin = window.location.origin;
                    const shortened = {};

                    // Use custom short code if provided, otherwise let backend generate it once
                    let shortCode = this.customShortCode.trim();
                    let isFirstRequest = true;

                    // Shorten each link type
                    for (const [type, url] of Object.entries(this.generatedLinks)) {
                        try {
                            let apiUrl = `${origin}/shorten-v2?url=${encodeURIComponent(url)}`;

                            // For the first request, either use custom code or let backend generate
                            // For subsequent requests, use the code from first request
                            if (shortCode) {
                                apiUrl += `&shortCode=${encodeURIComponent(shortCode)}`;
                            }

                            const response = await fetch(apiUrl);
                            if (!response.ok) {
                                throw new Error(`Failed to shorten ${type} link`);
                            }
                            const returnedCode = await response.text();

                            // If this is the first request and no custom code was provided,
                            // use the backend-generated code for all subsequent requests
                            if (isFirstRequest && !shortCode) {
                                shortCode = returnedCode;
                            }
                            isFirstRequest = false;

                            // Map types to their corresponding path prefixes
                            const prefixMap = {
                                xray: 'x',
                                singbox: 'b',
                                clash: 'c',
                                surge: 's'
                            };

                            shortened[type] = `${origin}/${prefixMap[type]}/${returnedCode}`;
                        } catch (error) {
                            console.error(`Error shortening ${type} link:`, error);
                            throw error;
                        }
                    }

                    this.shortenedLinks = shortened;
                } catch (error) {
                    console.error('Error shortening links:', error);
                    alert(window.APP_TRANSLATIONS.shortenFailed);
                } finally {
                    this.shortening = false;
                }
            },

            // Handle input change with debounce
            handleInputChange(val) {
                // Clear previous timer
                if (this.parseDebounceTimer) {
                    clearTimeout(this.parseDebounceTimer);
                }

                // If input is empty, don't try to parse
                if (!val || !val.trim()) {
                    return;
                }

                // Debounce for 500ms
                this.parseDebounceTimer = setTimeout(() => {
                    this.tryParseSubscriptionUrl(val.trim());
                }, 500);
            },

            // Check if input looks like a subscription URL
            isSubscriptionUrl(text) {
                // Check if it's a single line URL (not multiple lines)
                if (text.includes('\n')) {
                    return false;
                }

                try {
                    const url = new URL(text);
                    // Check if it matches our short link pattern: /[bcxs]/[code]
                    const pathMatch = url.pathname.match(/^\/([bcxs])\/([a-zA-Z0-9_-]+)$/);
                    if (pathMatch) {
                        return true;
                    }

                    // Check if it's a full subscription URL with query params
                    const fullMatch = url.pathname.match(/^\/(singbox|clash|xray|surge)$/);
                    if (fullMatch && url.search) {
                        return true;
                    }

                    return false;
                } catch {
                    return false;
                }
            },

            // Try to parse subscription URL
            async tryParseSubscriptionUrl(text) {
                if (!this.isSubscriptionUrl(text)) {
                    return;
                }

                this.parsingUrl = true;
                try {
                    let urlToParse;

                    try {
                        urlToParse = new URL(text);
                    } catch {
                        return;
                    }

                    // Check if it's a short link
                    const shortMatch = urlToParse.pathname.match(/^\/([bcxs])\/([a-zA-Z0-9_-]+)$/);

                    if (shortMatch) {
                        // It's a short link, resolve it first
                        const response = await fetch(`/resolve?url=${encodeURIComponent(text)}`);
                        if (!response.ok) {
                            console.warn('Failed to resolve short URL');
                            return;
                        }

                        const data = await response.json();
                        if (!data.originalUrl) {
                            console.warn('No original URL returned');
                            return;
                        }

                        urlToParse = new URL(data.originalUrl);
                    }

                    // Now parse the full URL and populate form
                    this.populateFormFromUrl(urlToParse);

                    // Show a success message
                    const message = window.APP_TRANSLATIONS?.urlParsedSuccess || '已成功解析订阅链接配置';
                    console.log(message);

                } catch (error) {
                    console.error('Error parsing subscription URL:', error);
                } finally {
                    this.parsingUrl = false;
                }
            },

            // Populate form fields from parsed URL
            populateFormFromUrl(url) {
                const params = new URLSearchParams(url.search);

                // Extract config (the original subscription URLs)
                const config = params.get('config');
                if (config) {
                    this.input = config;
                }

                // Extract selectedRules
                const selectedRules = params.get('selectedRules');
                if (selectedRules) {
                    try {
                        const parsed = JSON.parse(selectedRules);
                        if (Array.isArray(parsed)) {
                            this.selectedRules = parsed;
                            this.selectedPredefinedRule = 'custom';
                        }
                    } catch (e) {
                        console.warn('Failed to parse selectedRules:', e);
                    }
                }

                // Extract customRules
                const customRules = params.get('customRules');
                if (customRules) {
                    try {
                        const parsed = JSON.parse(customRules);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            // Dispatch custom event for CustomRules component to listen
                            window.dispatchEvent(new CustomEvent('restore-custom-rules', {
                                detail: { rules: parsed }
                            }));
                        }
                    } catch (e) {
                        console.warn('Failed to parse customRules:', e);
                    }
                }

                // Extract other parameters
                this.groupByCountry = params.get('group_by_country') === 'true';
                this.includeAutoSelect = params.get('include_auto_select') !== 'false';
                this.enableClashUI = params.get('enable_clash_ui') === 'true';

                // Links always carry udp only when it is forced, so an absent param means "off".
                const hasUdpParam = params.has('udp');
                this.forceUdp = params.get('udp') === 'true';

                const clashRuleBase = params.get('clash_rule_base');
                if (clashRuleBase) {
                    this.clashRuleBase = clashRuleBase;
                }

                const customRuleGroups = params.get('customRuleGroups');
                if (customRuleGroups) {
                    try {
                        const parsed = JSON.parse(customRuleGroups);
                        if (Array.isArray(parsed)) {
                            this.customRuleGroups = normalizeCustomRuleGroups(parsed);
                        }
                    } catch (e) {
                        console.warn('Failed to parse customRuleGroups:', e);
                    }
                }

                const groupDefaults = params.get('group_defaults');
                if (groupDefaults) {
                    try {
                        const parsed = JSON.parse(groupDefaults);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            this.groupDefaults = parsed;
                        }
                    } catch (e) {
                        console.warn('Failed to parse group_defaults:', e);
                    }
                }

                const externalController = params.get('external_controller');
                if (externalController) {
                    this.externalController = externalController;
                }

                const externalUiDownloadUrl = params.get('external_ui_download_url');
                if (externalUiDownloadUrl) {
                    this.externalUiDownloadUrl = externalUiDownloadUrl;
                }

                const ua = params.get('ua');
                if (ua) {
                    this.customUA = ua;
                }

                const configId = params.get('configId');
                if (configId) {
                    this.currentConfigId = configId;
                    this.updateConfigIdInUrl(configId);
                }

                // Expand advanced options if any advanced settings are present
                if (selectedRules || customRules || customRuleGroups || this.groupByCountry || this.enableClashUI ||
                    hasUdpParam || clashRuleBase || groupDefaults || externalController || externalUiDownloadUrl || ua || configId) {
                    this.showAdvanced = true;
                }
            }
        }
    }
};
