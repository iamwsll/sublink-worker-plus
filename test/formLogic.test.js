import { describe, it, expect } from 'vitest';
import { formLogicFn } from '../src/components/formLogic.js';

describe('formLogic toString fix', () => {
  it('includes parseSurgeConfigInput definition in toString output', () => {
    const fnString = formLogicFn.toString();

    // Verify the function references parseSurgeConfigInput
    expect(fnString).toContain('parseSurgeConfigInput');

    // Verify the arrow function definitions ARE included
    expect(fnString).toMatch(/(?:const|var|let)\s+parseSurgeConfigInput\s*=/);
    expect(fnString).toMatch(/(?:const|var|let)\s+parseSurgeValue\s*=/);
    expect(fnString).toMatch(/(?:const|var|let)\s+convertSurgeIniToJson\s*=/);
  });

  it('does not contain __name calls that break in browser runtime', () => {
    const fnString = formLogicFn.toString();
    // Ensure no function declarations that esbuild would inject __name() for
    expect(fnString).not.toMatch(/^\s*function\s+parseSurgeValue\b/m);
    expect(fnString).not.toMatch(/^\s*function\s+convertSurgeIniToJson\b/m);
    expect(fnString).not.toMatch(/^\s*function\s+parseSurgeConfigInput\b/m);
  });

  it('formData() returns a valid Alpine data object', () => {
    // Simulate browser global environment using Function constructor
    const fakeWindow = { APP_TRANSLATIONS: {}, PREDEFINED_RULE_SETS: {} };
    const fn = new Function('window', '(' + formLogicFn.toString() + ')(); return window;');
    const result = fn(fakeWindow);
    const data = result.formData();
    expect(typeof data.submitForm).toBe('function');
    expect(typeof data.toggleAccordion).toBe('function');
    expect(data.showAdvanced).toBe(false);
  });
});

it('keeps different format parameters in separate short codes while reusing identical queries', async () => {
  const calls = [];
  const fakeWindow = { APP_TRANSLATIONS: {}, PREDEFINED_RULE_SETS: {}, location: { origin: 'https://example.com' } };
  const fakeFetch = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, text: async () => 'code' + calls.length };
  };
  const data = new Function('window', 'fetch', 'alert', '(' + formLogicFn.toString() + ')(); return window.formData();')(fakeWindow, fakeFetch, message => { throw new Error(message); });
  const longLink = `https://example.com/clash?config=${'x'.repeat(20000)}`;
  data.generatedLinks = {
    clash: longLink,
    singbox: 'https://example.com/singbox?config=second',
    xray: longLink.replace('/clash?', '/xray?')
  };
  data.customShortCode = 'my-code';
  await data.shortenLinks();
  expect(calls).toEqual([
    { url: 'https://example.com/shorten-v2', method: 'POST', body: { url: longLink, shortCode: 'my-code' } },
    { url: 'https://example.com/shorten-v2', method: 'POST', body: { url: data.generatedLinks.singbox, shortCode: 'my-code-singbox' } }
  ]);
  expect(data.shortenedLinks).toEqual({ clash: 'https://example.com/c/code1', singbox: 'https://example.com/b/code2', xray: 'https://example.com/x/code1' });
});
