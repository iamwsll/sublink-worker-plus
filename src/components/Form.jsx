/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { PREDEFINED_RULE_SETS, UNIFIED_RULES } from '../config/index.js';
import { CustomRules } from './CustomRules.jsx';
import { TextareaWithActions } from './TextareaWithActions.jsx';
import { ValidatedTextarea } from './ValidatedTextarea.jsx';
import { formLogicFn } from './formLogic.js';

const LINK_FIELDS = [
  { key: 'xray', labelKey: 'xrayLink' },
  { key: 'singbox', labelKey: 'singboxLink' },
  { key: 'clash', labelKey: 'clashLink' },
  { key: 'surge', labelKey: 'surgeLink' }
];

// Admin-supplied names are interpolated into an inline <script>, where JSON.stringify alone
// leaves `</script>` live and would end the block early; escaping `<` keeps the JSON valid
// inside a JS string literal and inert for the HTML parser.
const toScriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

export const Form = (props) => {
  const { t, lang, adminConfig } = props;
  // Backend-defined rule groups are rendered as extra checkboxes below the built-in list.
  const adminRuleSets = adminConfig?.customRuleSets || [];

  const translations = {
    processing: t('processing'),
    convert: t('convert'),
    saveConfigSuccess: t('saveConfigSuccess'),
    saveConfig: t('saveConfig'),
    savingConfig: t('savingConfig'),
    configContentRequired: t('configContentRequired'),
    configSaveFailed: t('configSaveFailed'),
    confirmClearConfig: t('confirmClearConfig'),
    confirmClearAll: t('confirmClearAll'),
    errorGeneratingLinks: t('errorGeneratingLinks'),
    shortenLinks: t('shortenLinks'),
    shortening: t('shortening'),
    alreadyShortened: t('alreadyShortened'),
    shortenFailed: t('shortenFailed'),
    customShortCode: t('customShortCode'),
    optional: t('optional'),
    customShortCodePlaceholder: t('customShortCodePlaceholder'),
    showFullLinks: t('showFullLinks'),
    followBuiltInDefault: t('followBuiltInDefault'),
    // The policy selects render inside Alpine templates, so outbound names must be reachable
    // from the injected runtime rather than only from the server render.
    outboundNames: {
      'Node Select': t('outboundNames.Node Select'),
      'Auto Select': t('outboundNames.Auto Select'),
      'Fall Back': t('outboundNames.Fall Back'),
      'Manual Switch': t('outboundNames.Manual Switch')
    }
  };

  const scriptContent = `
    window.APP_TRANSLATIONS = ${toScriptJson(translations)};
    window.PREDEFINED_RULE_SETS = ${toScriptJson(PREDEFINED_RULE_SETS)};
    window.ADMIN_RULE_SETS = ${toScriptJson(adminRuleSets)};
    window.ADMIN_GROUP_DEFAULTS = ${toScriptJson(adminConfig?.groupDefaults || {})};
    window.APP_LANG = ${JSON.stringify(lang || 'zh-CN')};
    if (typeof __name === 'undefined') { var __name = function(fn) { return fn; }; }
    (${formLogicFn.toString()})();
  `;

  return (
    <div x-data="formData()" x-init="init()" class="max-w-4xl mx-auto">
      <form {...{'x-on:submit.prevent': 'submitForm'}} class="space-y-8">

      {/* Input Section */}
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-all duration-300 hover:shadow-md group">
        <TextareaWithActions
          id="input"
          name="input"
          label={t('shareUrls')}
          labelPrefix={
            <span class="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center">
              <i class="fas fa-link text-sm"></i>
            </span>
          }
          model="input"
          rows={5}
          placeholder={t('urlPlaceholder')}
          required
          labelActionsWrapperClass="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          labelActions={[
            {
              key: 'paste',
              icon: 'fas fa-paste',
              label: t('paste'),
              hideLabelOnMobile: true,
              className:
                'px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1',
              title: t('paste'),
              attrs: {
                'x-on:click': "navigator.clipboard.readText().then(text => input = text).catch(() => {})"
              }
            },
            {
              key: 'clear',
              icon: 'fas fa-times',
              label: t('clear'),
              hideLabelOnMobile: true,
              className:
                'px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-1',
              title: t('clear'),
              attrs: {
                'x-on:click': "input = ''",
                'x-show': 'input'
              }
            }
          ]}
        />
      </div>

      {/* Advanced Options Toggle */}
      <div 
        class="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors" 
        x-on:click="showAdvanced = !showAdvanced"
        role="button"
        tabindex="0"
        {...{
          'x-on:keydown.enter.prevent': 'showAdvanced = !showAdvanced',
          'x-on:keydown.space.prevent': 'showAdvanced = !showAdvanced'
        }}
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center">
            <i class="fas fa-sliders-h"></i>
          </div>
          <span class="font-semibold text-gray-900 dark:text-white">{t('advancedOptions')}</span>
        </div>
        <div 
          class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 transition-transform duration-300" 
          x-bind:class="{'rotate-180': showAdvanced}"
        >
          <i class="fas fa-chevron-down"></i>
        </div>
      </div>

  {/* Advanced Options Content */ }
  <div x-show="showAdvanced" {...{'x-transition:enter': 'transition ease-out duration-300', 'x-transition:enter-start': 'opacity-0 transform -translate-y-4', 'x-transition:enter-end': 'opacity-100 transform translate-y-0', 'x-transition:leave': 'transition ease-in duration-200', 'x-transition:leave-start': 'opacity-100 transform translate-y-0', 'x-transition:leave-end': 'opacity-0 transform -translate-y-4'}} class="space-y-6">

    {/* Rule Selection */ }
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <i class="fas fa-filter text-gray-400"></i>
          {t('ruleSelection')}
        </h3>
        <select x-model="selectedPredefinedRule" x-on:change="applyPredefinedRule()" class="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent">
        <option value="custom">{t('custom')}</option>
        <option value="minimal">{t('minimal')}</option>
        <option value="balanced">{t('balanced')}</option>
        <option value="comprehensive">{t('comprehensive')}</option>
      </select>
          </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {UNIFIED_RULES.map((rule) => (
      <label class="flex items-center p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors group">
        <input
          type="checkbox"
          value={rule.name}
          x-model="selectedRules" 
                    x-on:change="selectedPredefinedRule = 'custom'"
        class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600"
                  />
        <span class="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
          {t(`outboundNames.${rule.name}`)}
        </span>
      </label>
    ))}
    {adminRuleSets.map((ruleSet) => (
      <label class="flex items-center p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors group">
        <input
          type="checkbox"
          value={ruleSet.name}
          x-model="selectedRules"
          x-on:change="selectedPredefinedRule = 'custom'"
          class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600"
        />
        {/* Admin-defined names are user data, so they are shown verbatim instead of through t(). */}
        <span class="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
          {ruleSet.name}
        </span>
      </label>
    ))}
  </div>

  {/* Per-rule policy default override. Rendered statically (with x-show) instead of through
      x-for so every select binds to a literal groupDefaults key. */}
  <div class="mt-6">
    <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('policyDefaultOption')}</h4>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {UNIFIED_RULES.concat(adminRuleSets).map((rule) => (
        <div
          x-show={`selectedRules.includes(${JSON.stringify(rule.name)})`}
          class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
        >
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">{rule.name}</label>
          <select
            x-model={`groupDefaults[${JSON.stringify(rule.name)}]`}
            class="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {/* The empty option means "no UI override"; its label spells out the effective default. */}
            <option value="" x-text={`getFollowBuiltInDefaultLabel(${JSON.stringify(rule.name)})`}>{t('followBuiltInDefault')}</option>
            <option value="DIRECT">DIRECT</option>
            <option value="REJECT">REJECT</option>
            <option value="Node Select" x-text="translateOutbound('Node Select')"></option>
            <option value="Auto Select" x-text="translateOutbound('Auto Select')"></option>
          </select>
        </div>
      ))}
    </div>
  </div>

          </div>

  {/* Custom Rules Component */ }
  <CustomRules t={t} />

  {/* Custom Rule Groups */ }
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <i class="fas fa-layer-group text-gray-400"></i>
        {t('customRuleGroups')}
      </h3>
      <button
        type="button"
        x-on:click="addCustomRuleGroup(); selectedPredefinedRule = 'custom'"
        class="px-3 py-1.5 text-xs rounded-lg border border-primary-200 dark:border-primary-700 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
      >
        {t('addCustomRuleGroup')}
      </button>
    </div>

    <div class="space-y-4">
      <template x-for="(customGroup, groupIndex) in customRuleGroups" x-bind:key="groupIndex">
        <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 space-y-3">
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              x-bind:value="customGroup.name"
              x-model="selectedRules"
              x-on:change="selectedPredefinedRule = 'custom'"
              class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600"
            />
            <input
              type="text"
              x-model="customGroup.name"
              x-on:input="selectedPredefinedRule = 'custom'"
              class="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder={t('customRuleGroupNamePlaceholder')}
            />
            <button
              type="button"
              x-on:click="removeCustomRuleGroup(groupIndex); selectedPredefinedRule = 'custom'"
              class="px-2 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title={t('removeCustomRuleGroup')}
            >
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>

          <template x-for="(url, urlIndex) in customGroup.urls" x-bind:key="urlIndex">
            <div class="flex items-center gap-2">
              <input
                type="url"
                x-model="customGroup.urls[urlIndex]"
                x-on:input="selectedPredefinedRule = 'custom'"
                class="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="https://example.com/rules.list"
              />
              <button
                type="button"
                x-on:click="removeRuleSetUrl(groupIndex, urlIndex); selectedPredefinedRule = 'custom'"
                class="px-2 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title={t('removeRuleSetUrl')}
              >
                <i class="fas fa-minus"></i>
              </button>
            </div>
          </template>

          <div>
            <button
              type="button"
              x-on:click="addRuleSetUrl(groupIndex); selectedPredefinedRule = 'custom'"
              class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              {t('addRuleSetUrl')}
            </button>
          </div>

          {/* Locally authored groups are not known at render time, so their override key is bound
              dynamically (admin-defined groups get a static select above instead). */}
          <div x-show="customGroup.name && selectedRules.includes(customGroup.name)">
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('policyDefaultOption')}</label>
            <select
              x-model="groupDefaults[customGroup.name]"
              class="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">{t('followBuiltInDefault')}</option>
              <option value="DIRECT">DIRECT</option>
              <option value="REJECT">REJECT</option>
              <option value="Node Select" x-text="translateOutbound('Node Select')"></option>
              <option value="Auto Select" x-text="translateOutbound('Auto Select')"></option>
            </select>
          </div>
        </div>
      </template>
    </div>
  </div>

    {/* General Options */ }
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <i class="fas fa-cog text-gray-400"></i>
              {t('generalSettings')}
            </h3>
            
            <div class="space-y-4">
              <label class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                <span class="font-medium text-gray-700 dark:text-gray-300">{t('groupByCountry')}</span>
                <div class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" x-model="groupByCountry" class="sr-only peer" />
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </div>
              </label>

              <label class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                <span class="font-medium text-gray-700 dark:text-gray-300">{t('includeAutoSelect')}</span>
                <div class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" x-model="includeAutoSelect" class="sr-only peer" />
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </div>
              </label>

              <label class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                <span class="font-medium text-gray-700 dark:text-gray-300">{t('enableClashUI')}</span>
                <div class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" x-model="enableClashUI" class="sr-only peer" />
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </div>
              </label>

              <label class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                <span class="font-medium text-gray-700 dark:text-gray-300">{t('enableUdp')}</span>
                <div class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" x-model="forceUdp" class="sr-only peer" />
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </div>
              </label>

              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('clashRuleBaseUrl')}</label>
                <input
                  type="url"
                  x-model="clashRuleBase"
                  class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={t('clashRuleBaseUrlPlaceholder')}
                />
              </div>

              <div
                x-show="enableClashUI"
                {...{
                  'x-transition:enter': 'transition ease-out duration-200',
                  'x-transition:enter-start': 'opacity-0 transform -translate-y-2',
                  'x-transition:enter-end': 'opacity-100 transform translate-y-0',
                  'x-transition:leave': 'transition ease-in duration-150',
                  'x-transition:leave-start': 'opacity-100 transform translate-y-0',
                  'x-transition:leave-end': 'opacity-0 transform -translate-y-2'
                }}
                class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2"
              >
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('externalController')}</label>
                  <input type="text" x-model="externalController" class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder={t('externalControllerPlaceholder')} />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('externalUiDownloadUrl')}</label>
                  <input type="text" x-model="externalUiDownloadUrl" class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder={t('externalUiDownloadUrlPlaceholder')} />
                </div>
              </div>
          </div>
          </div>

  {/* Subconverter External Config */}
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
      <i class="fas fa-file-export text-gray-400"></i>
      {t('subconverterConfigTitle')}
    </h3>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('subconverterConfigDesc')}</p>
    <div class="px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
      <p class="font-mono text-sm text-gray-600 dark:text-gray-400 break-all" x-text="getSubconverterUrl()"></p>
    </div>
    <div class="mt-3 flex justify-end">
      <button
        type="button"
        x-on:click="copySubconverterUrl()"
        class="px-4 py-2 rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
        x-bind:class="subconverterCopied ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'"
      >
        <i class="fas" x-bind:class="subconverterCopied ? 'fa-check' : 'fa-copy'"></i>
        <span x-text={`subconverterCopied ? '${t('copiedSubconverterUrl')}' : '${t('copySubconverterUrl')}'`}></span>
      </button>
    </div>
  </div>

  {/* Base Config */ }
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <i class="fas fa-file-code text-gray-400"></i>
                {t('baseConfigSettings')}
              </h3>
              <select x-model="configType" class="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent">
                <option value="singbox">SingBox (JSON)</option>
                <option value="clash">Clash (YAML)</option>
                <option value="surge">Surge (JSON/INI)</option>
              </select>
          </div>
            
            <ValidatedTextarea
              id="configEditor"
              name="configEditor"
              model="configEditor"
              rows={5}
              placeholder="Paste your custom config here..."
              variant="mono"
              containerClass="mt-0 group"
              labelWrapperClass="flex items-center justify-end mb-2"
              labelActionsWrapperClass="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              pasteLabel={t('paste')}
              clearLabel={t('clear')}
              validation={{
                button: {
                  key: 'validate-config',
                  label: t('validateConfig'),
                  className:
                    'px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2',
                  attrs: {
                    'x-on:click': 'validateBaseConfig()'
                  }
                },
                success: {
                  show: "configValidationState === 'success'",
                  textExpr: 'configValidationMessage'
                },
                error: {
                  show: "configValidationState === 'error'",
                  textExpr: 'configValidationMessage'
                }
              }}
              inlineActionsWrapperClass="absolute bottom-4 right-4 flex gap-2"
              preserveLabelSpace={false}
            />
            
            <div class="flex justify-end gap-3 mt-4">
              <button 
                type="button" 
                x-on:click="saveBaseConfig()" 
                x-bind:disabled="savingConfig"
                class="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium text-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <i class="fas" x-bind:class="savingConfig ? 'fa-spinner fa-spin' : 'fa-save'"></i>
                <span x-text="savingConfig ? savingConfigText : saveConfigText">{t('saveConfig')}</span>
              </button>
              <button type="button" x-on:click="clearBaseConfig()" class="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium text-sm" >
  { t('clearConfig') }
              </button>
          </div>
          </div >

  {/* User Agent */ }
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <i class="fas fa-user-secret text-gray-400"></i>
              {t('UASettings')}
            </h3>
            <input 
              type="text" 
              x-model="customUA" 
              class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent" 
              placeholder="curl/7.74.0" 
            />
          </div>
        </div>

  {/* Action Buttons */ }
  <div class="flex flex-col sm:flex-row gap-4">
          <button 
            type="submit" 
            class="flex-1 py-3.5 px-6 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white rounded-xl font-bold shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40 transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2"
            x-bind:disabled="loading"
          >
            <i class="fas fa-sync-alt" x-bind:class="loading ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i>
            <span x-text="loading ? processingText : convertText">{t('convert')}</span>
          </button>

  <button
    type="button" 
            x-on:click="clearAll()"
class="px-6 py-3.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
  >
  <i class="fas fa-trash-alt"></i>
{ t('clear') }
          </button>
        </div>
      </form>

  {/* Results Section */ }
  <div x-cloak x-show="generatedLinks" x-data="{ copied: null }" {...{'x-transition:enter': 'transition ease-out duration-500', 'x-transition:enter-start': 'opacity-0 transform translate-y-8', 'x-transition:enter-end': 'opacity-100 transform translate-y-0'}} class="mt-12">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8 transition-all duration-300 hover:shadow-md">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <span class="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center">
            <i class="fas fa-link text-sm"></i>
          </span>
          {t('subscriptionLinks')}
        </h2>
      </div>

      <div class="mt-6 space-y-4">
        {LINK_FIELDS.map((field) => (
          <div class="relative group" key={field.key}>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t(field.labelKey)}
            </label>
            <div class="flex gap-2">
              <input
                type="text"
                readonly
                x-bind:value={`shortenedLinks ? shortenedLinks?.${field.key} : generatedLinks?.${field.key}`}
                class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:border-transparent transition-all duration-200 font-mono text-sm"
                x-bind:class="shortenedLinks ? 'text-primary-600 dark:text-primary-400 font-semibold focus:ring-primary-500' : 'text-gray-600 dark:text-gray-400 focus:ring-green-500'"
              />
              <button
                type="button"
                x-on:click={`navigator.clipboard.writeText((shortenedLinks || generatedLinks)?.${field.key}); copied = '${field.key}'; setTimeout(() => copied = null, 2000)`}
                class="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
                x-bind:class={`{
                  'hover:bg-green-100 dark:hover:bg-green-900/30 hover:text-green-600 dark:hover:text-green-400': !shortenedLinks,
                  'hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:text-primary-600 dark:hover:text-primary-400': shortenedLinks,
                  'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400': !shortenedLinks && copied === '${field.key}',
                  'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400': shortenedLinks && copied === '${field.key}'
                }`}
              >
                <i class="fas" x-bind:class={`copied === '${field.key}' ? 'fa-check' : 'fa-copy'`}></i>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Shortening Controls */}
      <div class="mt-6">
        <div class="flex flex-col items-center gap-3">
          <div class="w-full max-w-md">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-center">
              {t('customShortCode')} <span class="text-gray-400">({t('optional')})</span>
            </label>
            <input
              type="text"
              x-model="customShortCode"
              placeholder={t('customShortCodePlaceholder')}
              class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 text-center"
            />
          </div>
        </div>
        <div class="flex justify-center mt-4">
          <button
            type="button"
            x-on:click="shortenedLinks ? shortenedLinks = null : shortenLinks()"
            x-bind:disabled="!shortenedLinks && shortening"
            class="px-6 py-3 rounded-xl font-semibold transition-all duration-200 flex items-center gap-2 shadow-lg"
            x-bind:class="shortenedLinks
              ? 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm'
              : 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white shadow-primary-500/30 hover:shadow-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed'"
          >
            <i
              class="fas"
              x-bind:class="shortenedLinks ? 'fa-expand-alt' : (shortening ? 'fa-spinner fa-spin' : 'fa-compress-alt')"
            ></i>
            <span
              x-text="shortenedLinks ? showFullLinksText : (shortening ? shorteningText : shortenLinksText)"
            ></span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <script dangerouslySetInnerHTML={{ __html: scriptContent }} />
    </div>
  );
};
