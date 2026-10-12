/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

export const SubscriptionPanel = ({ lang }) => {
    const zh = !lang || lang.startsWith('zh');
    const label = (cn, en) => zh ? cn : en;
    const input = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white';
    const button = 'px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';
    return (
        <section x-data="subscriptionData()" class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-gray-900 dark:text-white" aria-label={label('订阅链接管理', 'Subscription management')}>
            <div class="flex flex-wrap justify-between gap-3 mb-3">
                <h3 class="text-lg font-semibold">{label('订阅链接管理', 'Subscription links')}</h3>
                <div class="flex gap-2">
                    <button type="button" class={button} x-on:click="load(false)" x-bind:disabled="busy">{label('刷新列表', 'Refresh')}</button>
                    <button type="button" class={button} x-on:click="startNew()" x-bind:disabled="busy">{label('新增订阅', 'New subscription')}</button>
                </div>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">{label('管理保存在本站的短链接。修改后链接不变，客户端下次刷新时获取新配置。长链接需转为短链接后重新分发。', 'Manage stored short URLs. Changes apply on the next client refresh at the same URL. Full conversion URLs must first be shortened and redistributed.')}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">{label('时间按当前设备时区显示，从此功能上线后开始记录成功的订阅拉取；管理员预览不计入。存储同步可能有延迟，密集拉取时间为近似值。', 'Times use your device timezone. Successful subscription fetches are recorded from this release onward; admin previews are excluded. Storage propagation may be delayed; rapid concurrent fetch times are approximate.')}</p>
            <input type="search" class={input} x-model="search" placeholder={label('搜索已加载的别名、标识或备注', 'Search loaded aliases, codes or notes')} aria-label={label('搜索订阅', 'Search subscriptions')} />
            <p x-cloak x-show="busy" class="text-sm py-3" role="status">{label('处理中…', 'Working…')}</p>
            <p x-cloak x-show="error" x-text="error" class="text-red-600 py-3 break-words" role="alert"></p>
            <p x-cloak x-show="message" x-text="message" class="text-green-600 py-3" role="status"></p>
            <div class="my-4 divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-y-auto">
                <template x-for="item in filteredItems" x-bind:key="item.code">
                    <div class="flex items-center gap-3">
                        <button type="button" x-on:click="edit(item.code)" x-bind:disabled="busy" class="flex-1 min-w-0 text-left flex items-center justify-between gap-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                            <span class="min-w-0"><span class="block font-medium truncate" x-text="item.name || item.code"></span><span class="block text-xs text-gray-500 truncate" x-text="item.code"></span><span class="block text-xs text-gray-500 dark:text-gray-400 mt-1">{label('最后成功拉取：', 'Last successful fetch: ')}<span x-text="formatFetchTime(item.lastFetchedAt)"></span></span></span>
                            <span class="text-xs shrink-0" x-text={zh ? "item.enabled ? '启用' : '停用'" : "item.enabled ? 'Enabled' : 'Disabled'"}></span>
                        </button>
                        <button type="button" x-on:click="removeSubscription(item)" x-bind:disabled="busy" class={button + ' shrink-0 text-red-600 dark:text-red-400'} x-bind:aria-label="'Delete ' + (item.name || item.code)">{label('删除', 'Delete')}</button>
                    </div>
                </template>
                <p x-show="!busy && filteredItems.length === 0" class="text-gray-500 text-sm py-4">{label('当前页没有匹配的订阅。若有下一页，请继续加载。', 'No matching subscriptions on this page. Load more if available.')}</p>
            </div>
            <button type="button" x-cloak x-show="cursor" x-on:click="load(true)" x-bind:disabled="busy" class={button}>{label('继续加载', 'Load more')}</button>
            <template x-if="editor">
                <form {...{ 'x-on:submit.prevent': 'saveSubscription()' }} class="border-t border-gray-200 dark:border-gray-700 pt-5 mt-4 space-y-4">
                    <h4 class="font-semibold" x-text={zh ? "editor.isNew ? '新增订阅' : '编辑订阅'" : "editor.isNew ? 'New subscription' : 'Edit subscription'"}></h4>
                    <div class="grid sm:grid-cols-2 gap-4">
                        <label class="block text-sm">{label('订阅别名', 'Subscription alias')}<input class={input} x-model="editor.name" maxlength="120" placeholder={label('例如：我的手机、家里电脑', 'e.g. My phone, Home PC')} /></label>
                        <label class="block text-sm">{label('链接标识（新建时留空自动生成）', 'URL code (leave empty to generate)')}<input class={input} x-model="editor.code" x-bind:disabled="!editor.isNew" pattern="[A-Za-z0-9_-]{1,64}" maxlength="64" /></label>
                    </div>
                    <p class="text-xs text-gray-500">{label('别名仅用于后台识别，保存后显示在列表中，不改变订阅链接。', 'The alias identifies this subscription in the admin list without changing its URL.')}</p>
                    <label class="block text-sm">{label('备注 / 分发对象', 'Notes / recipient')}<textarea class={input} rows="2" x-model="editor.note" maxlength="2000"></textarea></label>
                    <div class="grid sm:grid-cols-2 gap-4 items-center">
                        <label class="flex gap-2 text-sm"><input type="checkbox" x-model="editor.enabled" />{label('启用订阅（关闭后停止提供更新）', 'Enabled (disable to stop updates)')}</label>
                        <label class="block text-sm">{label('到期时间（本地时间；留空永久有效）', 'Expires at (local time; empty means never)')}<input type="datetime-local" class={input} x-model="expiresLocal" /></label>
                    </div>
                    <details class="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                        <summary class="cursor-pointer text-sm">{label('从已有长链接导入参数', 'Import parameters from a full URL')}</summary>
                        <input class={input + ' mt-3'} type="url" x-model="importUrl" placeholder="https://example.com/clash?config=..." aria-label={label('原始长链接', 'Full conversion URL')} />
                        <button type="button" class={button + ' mt-2'} x-on:click="importParameters()">{label('读取参数', 'Read parameters')}</button>
                    </details>
                    <label class="block text-sm">{label('订阅来源 / 节点内容（config 参数）', 'Subscription sources / nodes (config parameter)')}<textarea class={input + ' font-mono text-xs'} rows="5" x-model="source" spellcheck="false"></textarea></label>
                    <label class="block text-sm">{label('转换参数（JSON；包含模板、规则、分组等）', 'Conversion parameters (JSON: templates, rules, groups, etc.)')}<textarea class={input + ' font-mono text-xs'} rows="7" x-model="optionsText" spellcheck="false"></textarea></label>
                    <details class="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                        <summary class="cursor-pointer text-sm">{label('基础配置（可选）', 'Base configuration (optional)')}</summary>
                        <p class="text-xs text-gray-500 my-2">{label('引用的基础配置会在此显示。填写后保存为持久化副本；留空则按上方 configId 参数处理。', 'Referenced base configurations appear here. Non-empty content is saved as a persistent copy; otherwise configId above is used.')}</p>
                        <select class={input} x-model="configType" aria-label={label('基础配置类型', 'Base configuration type')}><option value="">{label('选择类型', 'Choose type')}</option><option value="clash">Clash</option><option value="singbox">Sing-box</option><option value="surge">Surge</option></select>
                        <textarea class={input + ' font-mono text-xs mt-2'} rows="7" x-model="baseConfigText" spellcheck="false" aria-label={label('基础配置 JSON', 'Base configuration JSON')}></textarea>
                    </details>
                    <div x-show="!editor.isNew" class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2">
                        <p class="text-sm font-medium">{label('固定订阅链接（复制到客户端）', 'Stable subscription URLs (copy to client)')}</p>
                        {[['c','Clash'],['b','Sing-box'],['s','Surge'],['x','Xray']].map(([prefix, name]) => (
                            <div class="flex flex-wrap items-center gap-2 text-xs"><span class="w-16">{name}</span><code class="flex-1 break-all" x-text={`link('${prefix}')`}></code><button type="button" class={button} x-on:click={`copyLink('${prefix}')`}>{label('复制', 'Copy')}</button><a class={button} x-bind:href={`previewLink('${prefix}')`} target="_blank" rel="noreferrer">{label('预览内容', 'Preview content')}</a></div>
                        ))}
                    </div>
                    <div class="flex flex-wrap gap-3">
                        <button type="submit" x-bind:disabled="busy" class="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">{label('保存此订阅', 'Save subscription')}</button>
                        <button type="button" class={button} x-on:click="editor = null" x-bind:disabled="busy">{label('关闭', 'Close')}</button>
                        <button type="button" x-show="!editor.isNew" class={button + ' text-red-600'} x-on:click="removeSubscription()" x-bind:disabled="busy">{label('删除订阅', 'Delete subscription')}</button>
                    </div>
                </form>
            </template>
        </section>
    );
};
