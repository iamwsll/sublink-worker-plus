// Injected into the page through toString(); keep all browser dependencies inside the function.
export const subscriptionLogicFn = () => {
    window.subscriptionData = () => ({
        items: [], cursor: null, search: '', busy: false, error: '', message: '', editor: null,
        source: '', optionsText: '{}', baseConfigText: '', configType: '', expiresLocal: '', importUrl: '',
        async init() { await this.load(false); },
        async api(path, method = 'GET', body) {
            const response = await fetch('/admin/api/subscriptions' + path, {
                method, headers: { 'Content-Type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            if (response.status === 204) return null;
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
            return data;
        },
        async load(more = false) {
            this.busy = true; this.error = '';
            try {
                const page = await this.api(more && this.cursor ? '?cursor=' + encodeURIComponent(this.cursor) : '');
                const records = more ? [...this.items, ...page.items] : page.items;
                this.items = [...new Map(records.map(item => [item.code, item])).values()];
                this.cursor = page.cursor;
            } catch (error) { this.error = error.message; }
            finally { this.busy = false; }
        },
        get filteredItems() {
            const q = this.search.toLowerCase();
            return this.items.filter(item => [item.code, item.name, item.note].some(value => (value || '').toLowerCase().includes(q)));
        },
        setParameters(query) {
            const params = new URLSearchParams(query);
            this.source = params.get('config') || '';
            params.delete('config');
            this.optionsText = JSON.stringify(Object.fromEntries(params), null, 2);
        },
        startNew() {
            this.error = ''; this.message = '';
            this.editor = { code: '', name: '', note: '', enabled: true, isNew: true };
            this.source = ''; this.optionsText = '{}'; this.baseConfigText = ''; this.configType = ''; this.expiresLocal = ''; this.importUrl = '';
        },
        async edit(code) {
            this.busy = true; this.error = ''; this.message = '';
            try {
                const item = await this.api('/' + encodeURIComponent(code));
                this.editor = { ...item, isNew: false };
                this.setParameters(item.queryString);
                this.configType = item.configType;
                this.baseConfigText = item.baseConfig ? JSON.stringify(item.baseConfig, null, 2) : '';
                const date = item.expiresAt ? new Date(item.expiresAt) : null;
                this.expiresLocal = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
                this.importUrl = '';
            } catch (error) { this.error = error.message; }
            finally { this.busy = false; }
        },
        importParameters() {
            this.error = '';
            try {
                const url = new URL(this.importUrl);
                if (!['http:', 'https:'].includes(url.protocol) || !['/clash', '/singbox', '/surge', '/xray'].includes(url.pathname)) {
                    throw new Error('Please paste a full conversion URL (/clash, /singbox, /surge or /xray).');
                }
                this.setParameters(url.search);
                this.baseConfigText = ''; this.configType = '';
            } catch (error) { this.error = error.message; }
        },
        async saveSubscription() {
            this.busy = true; this.error = ''; this.message = '';
            try {
                const options = JSON.parse(this.optionsText);
                if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Conversion parameters must be a JSON object.');
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(options)) {
                    if (key === 'config') continue;
                    if (value !== null) params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
                }
                if (this.source) params.set('config', this.source);
                const payload = {
                    code: this.editor.code || undefined, name: this.editor.name, note: this.editor.note,
                    enabled: this.editor.enabled, expiresAt: this.expiresLocal ? new Date(this.expiresLocal).getTime() : null,
                    queryString: params.size ? '?' + params.toString() : ''
                };
                if (this.baseConfigText.trim()) {
                    payload.baseConfig = JSON.parse(this.baseConfigText);
                    payload.configType = this.configType;
                }
                const saved = await this.api(this.editor.isNew ? '' : '/' + encodeURIComponent(this.editor.code), this.editor.isNew ? 'POST' : 'PUT', payload);
                const index = this.items.findIndex(item => item.code === saved.code);
                if (index >= 0) this.items.splice(index, 1, saved); else this.items.unshift(saved);
                this.editor = { ...saved, isNew: false };
                this.setParameters(saved.queryString);
                this.message = window.APP_LANG?.startsWith('zh') ? '已保存；客户端下次刷新时生效。' : 'Saved. Applied on the next client refresh.';
            } catch (error) { this.error = error.message; }
            finally { this.busy = false; }
        },
        async removeSubscription() {
            const warning = window.APP_LANG?.startsWith('zh') ? '删除后，此订阅链接将无法再拉取更新。确认删除？' : 'This subscription URL will stop serving updates. Delete it?';
            if (!window.confirm(warning)) return;
            this.busy = true; this.error = ''; this.message = '';
            try {
                await this.api('/' + encodeURIComponent(this.editor.code), 'DELETE');
                this.items = this.items.filter(item => item.code !== this.editor.code);
                this.editor = null;
            } catch (error) { this.error = error.message; }
            finally { this.busy = false; }
        },
        link(prefix) { return window.location.origin + '/' + prefix + '/' + encodeURIComponent(this.editor?.code || ''); },
        async copyLink(prefix) {
            try { await navigator.clipboard.writeText(this.link(prefix)); }
            catch { window.prompt('Copy URL', this.link(prefix)); }
        }
    });
};
