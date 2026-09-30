/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { adminLogicFn } from './adminLogic.js';

// Presets that live in code; a stored preset may also be one of the admin-defined template ids.
const BUILTIN_PRESETS = ['minimal', 'balanced', 'comprehensive'];

const CARD_CLASS =
  'bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-all duration-300 hover:shadow-md';

const INPUT_CLASS =
  'w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200';

const TEXTAREA_CLASS =
  'w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 resize-y placeholder-gray-400 dark:placeholder-gray-500';

const LABEL_CLASS = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

const SectionHeading = ({ icon, title, hint = null }) => (
  <div class="mb-4">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
      <i class={`fas ${icon} text-gray-400`}></i>
      {title}
    </h3>
    {hint ? <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{hint}</p> : null}
  </div>
);

const Toggle = ({ model, label }) => (
  <label class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
    <span class="font-medium text-gray-700 dark:text-gray-300 text-sm">{label}</span>
    <div class="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" x-model={model} class="sr-only peer" />
      <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
    </div>
  </label>
);

export const AdminPage = (props) => {
  const { t, lang, authed, adminDisabled } = props;

  // Only strings the injected logic needs at runtime; every static label stays in the JSX,
  // where SSR already resolved the translation.
  const translations = {
    adminLoadFailed: t('adminLoadFailed'),
    adminSaving: t('adminSaving'),
    adminSaved: t('adminSaved'),
    adminSaveFailed: t('adminSaveFailed'),
    adminTemplateId: t('adminTemplateId'),
    adminResetConfirm: t('adminResetConfirm'),
    adminLoginFailed: t('adminLoginFailed')
  };

  // why: adminLogicFn is injected through toString(), so it cannot close over this module's
  // scope; the translator and the strings must arrive as globals instead.
  const scriptContent = `
    window.ADMIN_TRANSLATIONS = ${JSON.stringify(translations)};
    window.ADMIN_AUTHED = ${authed ? 'true' : 'false'};
    window.APP_LANG = ${JSON.stringify(lang || 'zh-CN')};
    if (typeof __name === 'undefined') { var __name = function(fn) { return fn; }; }
    (${adminLogicFn.toString()})(function (key) {
      var table = window.ADMIN_TRANSLATIONS || {};
      return table[key] || key;
    });
  `;

  if (adminDisabled) {
    return (
      <div class="container mx-auto px-4 py-8">
        <div class={`${CARD_CLASS} max-w-2xl mx-auto text-center`}>
          <div class="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-500 flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-lock text-xl"></i>
          </div>
          <h1 class="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('adminTitle')}</h1>
          <p class="text-gray-600 dark:text-gray-400 mb-6">{t('adminDisabledHint')}</p>
          <a
            href="/"
            class="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
          >
            <i class="fas fa-home"></i>
            {t('adminBackHome')}
          </a>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div class="container mx-auto px-4 py-8" x-data="adminData()" x-init="init()">
        <div class={`${CARD_CLASS} max-w-md mx-auto`}>
          <div class="text-center mb-6">
            <div class="w-14 h-14 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-user-shield text-xl"></i>
            </div>
            <h1 class="text-xl font-bold text-gray-900 dark:text-white">{t('adminLoginTitle')}</h1>
          </div>

          <form {...{ 'x-on:submit.prevent': 'login()' }} class="space-y-4">
            <div>
              <label class={LABEL_CLASS} for="adminPassword">
                {t('adminPassword')}
              </label>
              <input
                id="adminPassword"
                name="password"
                type="password"
                autocomplete="current-password"
                required
                x-model="password"
                class={INPUT_CLASS}
              />
            </div>

            <div
              x-cloak
              x-show="loginError"
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm"
            >
              <i class="fas fa-exclamation-circle"></i>
              <span x-text="loginError"></span>
            </div>

            <button
              type="submit"
              x-bind:disabled="loggingIn"
              class="w-full py-3 px-6 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white rounded-xl font-bold shadow-lg shadow-primary-500/30 transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <i class="fas" x-bind:class="loggingIn ? 'fa-spinner fa-spin' : 'fa-sign-in-alt'"></i>
              <span>{t('adminLogin')}</span>
            </button>
          </form>

          <div class="mt-6 text-center">
            <a
              href="/"
              class="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors inline-flex items-center gap-1"
            >
              <i class="fas fa-arrow-left"></i>
              {t('adminBackHome')}
            </a>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: scriptContent }} />
      </div>
    );
  }

  return (
    <div class="container mx-auto px-4 py-8" x-data="adminData()" x-init="init()">
      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <h1 class="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center">
            <i class="fas fa-sliders-h"></i>
          </span>
          {t('adminTitle')}
        </h1>
        <div class="flex items-center gap-3">
          <a
            href="/"
            class="px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
          >
            <i class="fas fa-home"></i>
            {t('adminBackHome')}
          </a>
          <button
            type="button"
            x-on:click="logout()"
            class="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium text-sm flex items-center gap-2"
          >
            <i class="fas fa-sign-out-alt"></i>
            {t('adminLogout')}
          </button>
        </div>
      </div>

      {/* Load failure: the panel stays visible but empty, so the operator can retry a save */}
      <div
        x-cloak
        x-show="loadError"
        class="mb-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm"
      >
        <i class="fas fa-exclamation-triangle"></i>
        <span x-text="loadError"></span>
      </div>

      <div x-cloak x-show="loading" class="mb-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm">
        <i class="fas fa-spinner fa-spin"></i>
        <span>{t('processing')}</span>
      </div>

      <div class="space-y-6 pb-28">
        {/* General */}
        <div class={CARD_CLASS}>
          <SectionHeading icon="fa-cog" title={t('adminGeneralSection')} />
          <div class="space-y-4">
            <div>
              <label class={LABEL_CLASS} for="adminDefaultPreset">
                {t('adminDefaultPreset')}
              </label>
              <select id="adminDefaultPreset" x-model="defaultRulePreset" class={INPUT_CLASS}>
                {BUILTIN_PRESETS.map((preset) => (
                  <option value={preset}>{t(preset)}</option>
                ))}
                <template x-for="template in templates" x-bind:key="'preset-' + template.key">
                  <option x-bind:value="template.id" x-text="template.id"></option>
                </template>
              </select>
            </div>

            <div>
              <label class={LABEL_CLASS} for="adminProfileUpdateIntervalHours">
                {t('adminProfileUpdateIntervalHours')}
              </label>
              <input
                id="adminProfileUpdateIntervalHours"
                type="number"
                min="1"
                step="1"
                x-model.number="profileUpdateIntervalHours"
                class={INPUT_CLASS}
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('adminProfileUpdateIntervalHint')}
              </p>
            </div>
          </div>
        </div>

        {/* Custom rule sets */}
        <div class={CARD_CLASS}>
          <SectionHeading icon="fa-layer-group" title={t('adminRuleSetsSection')} hint={t('adminRuleSetsHint')} />

          {/* A default template owns the Clash rule section, so these groups only reach
              sing-box/surge output while one is active. Reactive to the edit in progress. */}
          <div
            x-show="templates.some(template => template.enabled && template.isDefault)"
            x-cloak
            class="mb-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm flex items-start gap-2"
          >
            <i class="fas fa-exclamation-triangle mt-0.5"></i>
            <span>{t('adminRuleSetsTemplateHint')}</span>
          </div>

          <div class="space-y-4">
            <template x-for="(ruleSet, index) in ruleSets" x-bind:key="ruleSet.key">
              <div class="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                  <span class="font-medium text-gray-900 dark:text-white text-sm flex items-center gap-2">
                    <span
                      class="w-6 h-6 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs"
                      x-text="index + 1"
                    ></span>
                    {t('adminRuleSetName')}
                  </span>
                  <button
                    type="button"
                    x-on:click="removeRuleSet(index)"
                    title={t('adminRemoveRuleSet')}
                    class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <i class="fas fa-trash-alt"></i>
                  </button>
                </div>

                <div class="space-y-3">
                  <div>
                    <label class={LABEL_CLASS}>{t('adminRuleSetName')}</label>
                    <input type="text" x-model="ruleSet.name" class={INPUT_CLASS} placeholder="MyRuleGroup" />
                  </div>
                  <div>
                    <label class={LABEL_CLASS}>{t('adminRuleSetUrls')}</label>
                    <textarea rows={3} x-model="ruleSet.urlsText" class={TEXTAREA_CLASS}></textarea>
                  </div>
                  <div>
                    <label class={LABEL_CLASS}>{t('adminRuleSetDefaultOption')}</label>
                    <input type="text" x-model="ruleSet.defaultOption" class={INPUT_CLASS} placeholder="REJECT" />
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div class="mt-4">
            <button
              type="button"
              x-on:click="addRuleSet()"
              class="px-4 py-2 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors font-medium text-sm flex items-center gap-2"
            >
              <i class="fas fa-plus"></i>
              {t('adminAddRuleSet')}
            </button>
          </div>
        </div>

        {/* Policy group defaults */}
        <div class={CARD_CLASS}>
          <SectionHeading icon="fa-bullseye" title={t('adminGroupDefaultsSection')} hint={t('adminGroupDefaultsHint')} />

          <div class="space-y-3">
            <template x-for="(row, index) in groupDefaultRows" x-bind:key="row.key">
              <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div class="flex-1 w-full">
                  <label class={LABEL_CLASS}>{t('adminGroupDefaultRule')}</label>
                  <input type="text" x-model="row.name" class={INPUT_CLASS} placeholder="Proxy" />
                </div>
                <div class="flex-1 w-full">
                  <label class={LABEL_CLASS}>{t('adminGroupDefaultOption')}</label>
                  <input type="text" x-model="row.option" class={INPUT_CLASS} placeholder="DIRECT" />
                </div>
                <button
                  type="button"
                  x-on:click="removeGroupDefault(index)"
                  title={t('adminRemoveRuleSet')}
                  class="sm:mt-6 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </template>
          </div>

          <div class="mt-4">
            <button
              type="button"
              x-on:click="addGroupDefault()"
              class="px-4 py-2 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors font-medium text-sm flex items-center gap-2"
            >
              <i class="fas fa-plus"></i>
              {t('adminAddGroupDefault')}
            </button>
          </div>
        </div>

        {/* Rule templates */}
        <div class={CARD_CLASS}>
          <SectionHeading icon="fa-file-code" title={t('adminTemplatesSection')} hint={t('adminTemplatesHint')} />

          <div class="space-y-4">
            <template x-for="(template, index) in templates" x-bind:key="template.key">
              <div class="bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Collapsed summary row */}
                <div class="flex items-center gap-3 p-4">
                  <button
                    type="button"
                    x-on:click="template.expanded = !template.expanded"
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 transition-transform duration-300 flex-shrink-0"
                    x-bind:class="{ 'rotate-180': template.expanded }"
                  >
                    <i class="fas fa-chevron-down"></i>
                  </button>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-900 dark:text-white truncate" x-text="template.name || template.id || ('#' + (index + 1))"></p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate" x-text="template.id"></p>
                  </div>
                  <span
                    x-show="template.enabled"
                    class="px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex-shrink-0"
                  >
                    {t('adminTemplateEnabled')}
                  </span>
                  <span
                    x-show="template.isDefault"
                    class="px-2 py-0.5 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex-shrink-0"
                  >
                    {t('adminTemplateIsDefault')}
                  </span>
                  <button
                    type="button"
                    x-on:click="removeTemplate(index)"
                    title={t('adminRemoveTemplate')}
                    class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0"
                  >
                    <i class="fas fa-trash-alt"></i>
                  </button>
                </div>

                <div x-show="template.expanded" x-cloak class="px-4 pb-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class={LABEL_CLASS}>{t('adminTemplateId')}</label>
                      <input
                        type="text"
                        x-model="template.id"
                        x-bind:readonly="template.idLocked"
                        x-on:change="dedupeTemplateId(template)"
                        class={`${INPUT_CLASS} font-mono disabled:opacity-60 read-only:bg-gray-100 dark:read-only:bg-gray-800`}
                      />
                    </div>
                    <div>
                      <label class={LABEL_CLASS}>{t('adminTemplateName')}</label>
                      <input type="text" x-model="template.name" class={INPUT_CLASS} />
                    </div>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Toggle model="template.enabled" label={t('adminTemplateEnabled')} />
                    <Toggle model="template.isDefault" label={t('adminTemplateIsDefault')} />
                  </div>

                  <div>
                    <label class={LABEL_CLASS}>{t('adminTemplateClashRuleBase')}</label>
                    <input type="text" x-model="template.clashRuleBase" class={INPUT_CLASS} />
                  </div>

                  <div>
                    <label class={LABEL_CLASS}>{t('adminTemplateLines')}</label>
                    <textarea rows={8} x-model="template.linesText" class={TEXTAREA_CLASS}></textarea>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div class="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              x-on:click="addTemplate()"
              class="px-4 py-2 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors font-medium text-sm flex items-center gap-2"
            >
              <i class="fas fa-plus"></i>
              {t('adminAddTemplate')}
            </button>
          </div>
        </div>
      </div>

      {/* Sticky action bar: saving is the only way out of the page, so it stays reachable */}
      <div class="fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 z-40">
        <div class="container mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="text-sm min-h-[1.5rem] flex items-center gap-2">
            <span
              x-cloak
              x-show="saveMessage"
              class="flex items-center gap-2"
              x-bind:class="saveState === 'failed'
                ? 'text-red-600 dark:text-red-400'
                : (saveState === 'saved' ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400')"
            >
              <i
                class="fas"
                x-bind:class="saveState === 'saving'
                  ? 'fa-spinner fa-spin'
                  : (saveState === 'failed' ? 'fa-exclamation-circle' : (saveState === 'saved' ? 'fa-check-circle' : 'fa-info-circle'))"
              ></i>
              <span x-text="saveMessage"></span>
            </span>
          </div>

          <div class="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              x-on:click="resetConfig()"
              class="flex-1 sm:flex-none px-5 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-semibold text-sm flex items-center justify-center gap-2"
            >
              <i class="fas fa-undo-alt"></i>
              {t('adminReset')}
            </button>
            <button
              type="button"
              x-on:click="save()"
              x-bind:disabled="saveState === 'saving'"
              class="flex-1 sm:flex-none px-6 py-2.5 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white rounded-xl font-bold shadow-lg shadow-primary-500/30 transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <i class="fas" x-bind:class="saveState === 'saving' ? 'fa-spinner fa-spin' : 'fa-save'"></i>
              {t('adminSave')}
            </button>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: scriptContent }} />
    </div>
  );
};