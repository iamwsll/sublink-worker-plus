/**
 * Alpine.js state for the /admin panel.
 *
 * This function is injected into the page through toString(), so its body must stay
 * self-contained: no imports, no module-scope references. `t` is the translator that
 * AdminPage hands in, and in the browser it resolves through window.ADMIN_TRANSLATIONS.
 */
export const adminLogicFn = (t) => {
    const text = (key) => (typeof t === 'function' ? t(key) : key);

    const TEMPLATE_ID_UNSAFE = /[^a-z0-9-]/g;

    const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const trimString = (value) => (typeof value === 'string' ? value.trim() : '');

    // why: textareas are the editor for string arrays here, and blank lines are noise the
    // backend would drop on save anyway
    const splitLines = (value) =>
        String(value === null || value === undefined ? '' : value)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    const joinLines = (value) => (Array.isArray(value) ? value.join('\n') : '');

    // why: ids travel into URLs and generated config names, so keep them inside the same
    // pattern the storage layer enforces instead of letting a bad id be dropped silently
    const sanitizeTemplateId = (value) =>
        String(value === null || value === undefined ? '' : value)
            .trim()
            .toLowerCase()
            .replace(TEMPLATE_ID_UNSAFE, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 41);

    window.adminData = function () {
        return {
            // Populated from window.ADMIN_TRANSLATIONS so no translated string is duplicated in JS
            loading: true,
            loadError: '',
            saveState: '',
            saveMessage: '',
            keySeq: 0,

            password: '',
            loginError: '',
            loggingIn: false,

            configVersion: 1,
            defaultRulePreset: 'balanced',
            profileUpdateIntervalHours: 24,
            ruleSets: [],
            groupDefaultRows: [],
            templates: [],

            async init() {
                // why: Alpine bootstraps this object on the login screen too, where the config
                // endpoint is not authorized yet
                if (!window.ADMIN_AUTHED) return;

                // why: Alpine calls init() on its own and the panel also declares x-init, so the
                // in-flight promise is shared instead of fetching the config twice
                if (!this.loadPromise) this.loadPromise = this.loadConfig();
                return this.loadPromise;
            },

            // why: unique x-for keys keep input DOM nodes tied to their row, so deleting a row
            // never leaves a stale value behind
            nextKey(prefix) {
                this.keySeq += 1;
                return prefix + '-' + this.keySeq;
            },

            templateToModel(template) {
                const source = isPlainObject(template) ? template : {};
                const id = sanitizeTemplateId(source.id);
                return {
                    key: this.nextKey('tpl'),
                    id: id,
                    // why: ids are referenced by stored links, so an existing template must not
                    // be renamed by accident
                    idLocked: Boolean(id),
                    name: trimString(source.name),
                    enabled: source.enabled !== false,
                    isDefault: source.isDefault === true,
                    clashRuleBase: trimString(source.clashRuleBase),
                    linesText: joinLines(source.subconverterLines),
                    expanded: false
                };
            },

            async loadConfig() {
                this.loading = true;
                this.loadError = '';
                try {
                    const response = await fetch('/admin/api/config', { headers: { Accept: 'application/json' } });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    this.applyConfig(await response.json());
                } catch (error) {
                    this.loadError = text('adminLoadFailed');
                } finally {
                    this.loading = false;
                }
            },

            applyConfig(config) {
                const source = isPlainObject(config) ? config : {};
                const preset = trimString(source.defaultRulePreset) || 'balanced';
                const updateHours = Number(source.profileUpdateIntervalHours);

                this.configVersion = Number.isFinite(Number(source.version)) ? Number(source.version) : 1;
                this.profileUpdateIntervalHours = Number.isFinite(updateHours) && updateHours >= 1
                    ? Math.trunc(updateHours)
                    : 24;

                this.ruleSets = (Array.isArray(source.customRuleSets) ? source.customRuleSets : []).map((ruleSet) => {
                    const item = isPlainObject(ruleSet) ? ruleSet : {};
                    return {
                        key: this.nextKey('rs'),
                        name: trimString(item.name),
                        urlsText: joinLines(item.urls),
                        defaultOption: trimString(item.defaultOption)
                    };
                });

                this.groupDefaultRows = Object.entries(
                    isPlainObject(source.groupDefaults) ? source.groupDefaults : {}
                ).map(([name, option]) => ({
                    key: this.nextKey('gd'),
                    name: name,
                    option: typeof option === 'string' ? option : ''
                }));

                this.templates = (Array.isArray(source.templates) ? source.templates : []).map((template) =>
                    this.templateToModel(template)
                );

                // why: template ids only become selectable options once x-for has rendered them,
                // so binding the preset before that would silently reset the select to ""
                this.$nextTick(() => {
                    this.defaultRulePreset = preset;
                });
            },

            addRuleSet() {
                this.ruleSets.push({ key: this.nextKey('rs'), name: '', urlsText: '', defaultOption: '' });
            },

            removeRuleSet(index) {
                this.ruleSets.splice(index, 1);
            },

            addGroupDefault() {
                this.groupDefaultRows.push({ key: this.nextKey('gd'), name: '', option: '' });
            },

            removeGroupDefault(index) {
                this.groupDefaultRows.splice(index, 1);
            },

            addTemplate() {
                this.templates.push({
                    key: this.nextKey('tpl'),
                    id: this.uniqueTemplateId('template'),
                    // why: a brand new template has no stored references yet, so its id stays editable
                    idLocked: false,
                    name: '',
                    enabled: true,
                    isDefault: false,
                    clashRuleBase: '',
                    linesText: '',
                    expanded: true
                });
            },

            removeTemplate(index) {
                this.templates.splice(index, 1);
            },

            sanitizeId(value) {
                return sanitizeTemplateId(value);
            },

            uniqueTemplateId(base, exclude) {
                const taken = new Set(
                    this.templates.filter((template) => template !== exclude).map((template) => template.id)
                );
                const root = sanitizeTemplateId(base) || 'template';
                if (!taken.has(root)) return root;

                let counter = 2;
                while (taken.has(root + '-' + counter)) counter += 1;
                return root + '-' + counter;
            },

            dedupeTemplateId(template) {
                const id = sanitizeTemplateId(template.id);
                const taken = new Set(
                    this.templates.filter((item) => item !== template).map((item) => item.id)
                );
                template.id = id && !taken.has(id) ? id : this.uniqueTemplateId(id || 'template', template);
            },

            buildConfig() {
                let errorKey = '';
                let errorDetail = '';

                const templates = this.templates.map((template) => ({
                    id: sanitizeTemplateId(template.id),
                    name: trimString(template.name),
                    enabled: template.enabled === true,
                    isDefault: template.isDefault === true,
                    clashRuleBase: trimString(template.clashRuleBase),
                    subconverterLines: splitLines(template.linesText)
                }));

                // why: the storage layer drops templates with an unusable id, so a bad id would
                // silently delete the template on save instead of telling the operator
                const nameless = templates.find((template) => !template.id);
                if (nameless && !errorKey) {
                    errorKey = 'adminTemplateId';
                    errorDetail = nameless.name || '';
                }

                const groupDefaults = {};
                this.groupDefaultRows.forEach((row) => {
                    const name = trimString(row.name);
                    const option = trimString(row.option);
                    // Empty pairs cannot name a group or an option, so they are not worth sending
                    if (name && option) groupDefaults[name] = option;
                });

                return {
                    errorKey: errorKey,
                    errorDetail: errorDetail,
                    config: {
                        version: this.configVersion,
                        defaultRulePreset: trimString(this.defaultRulePreset) || 'balanced',
                        profileUpdateIntervalHours: Number.isFinite(Number(this.profileUpdateIntervalHours))
                            ? Math.max(1, Math.trunc(Number(this.profileUpdateIntervalHours)))
                            : 24,
                        customRuleSets: this.ruleSets
                            .map((ruleSet) => ({
                                name: trimString(ruleSet.name),
                                urls: splitLines(ruleSet.urlsText),
                                defaultOption: trimString(ruleSet.defaultOption)
                            }))
                            .filter((ruleSet) => ruleSet.name),
                        groupDefaults: groupDefaults,
                        templates: templates
                    }
                };
            },

            async save() {
                if (this.saveState === 'saving') return;

                const built = this.buildConfig();
                if (built.errorKey) {
                    this.saveState = 'failed';
                    this.saveMessage = built.errorDetail
                        ? text(built.errorKey) + ': ' + built.errorDetail
                        : text(built.errorKey);
                    return;
                }

                this.saveState = 'saving';
                this.saveMessage = text('adminSaving');

                try {
                    const response = await fetch('/admin/api/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(built.config)
                    });
                    if (!response.ok) {
                        // why: validation errors (e.g. dangling template references) carry a
                        // server-written message that pinpoints the broken line
                        let detail = '';
                        try {
                            const body = await response.json();
                            if (body && typeof body.error === 'string') detail = body.error;
                        } catch { }
                        throw new Error(detail || 'HTTP ' + response.status);
                    }

                    this.saveState = 'saved';
                    this.saveMessage = text('adminSaved');
                } catch (error) {
                    this.saveState = 'failed';
                    this.saveMessage = error?.message && !error.message.startsWith('HTTP ')
                        ? error.message
                        : text('adminSaveFailed');
                }
            },

            async resetConfig() {
                if (!confirm(text('adminResetConfirm'))) return;

                this.saveState = 'saving';
                this.saveMessage = text('adminSaving');

                try {
                    const response = await fetch('/admin/api/reset', { method: 'POST' });
                    if (!response.ok) throw new Error('HTTP ' + response.status);

                    await this.loadConfig();
                    if (this.loadError) {
                        // why: a failed reload leaves nothing trustworthy to report, and staying in
                        // the "saving" state would keep the save button disabled forever
                        this.saveState = 'failed';
                        this.saveMessage = this.loadError;
                        return;
                    }

                    this.saveState = 'saved';
                    this.saveMessage = text('adminSaved');
                } catch (error) {
                    this.saveState = 'failed';
                    this.saveMessage = text('adminSaveFailed');
                }
            },

            async login() {
                if (this.loggingIn) return;

                this.loggingIn = true;
                this.loginError = '';

                try {
                    const response = await fetch('/admin/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: this.password })
                    });
                    if (!response.ok) throw new Error('HTTP ' + response.status);

                    // The session cookie is server-owned, so a reload is the only reliable way
                    // to re-render the panel in its authenticated state
                    window.location.reload();
                } catch (error) {
                    this.loginError = text('adminLoginFailed');
                } finally {
                    this.loggingIn = false;
                }
            },

            async logout() {
                try {
                    await fetch('/admin/api/logout', { method: 'POST' });
                } catch (error) {
                    // why: navigation must happen even when the request fails, otherwise the
                    // operator is stuck on a stale authenticated page
                }
                window.location.assign('/admin');
            }
        };
    };
};