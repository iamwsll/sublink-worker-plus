import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';

async function buildClash(input) {
    const builder = new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN', 'mihomo');
    return yaml.load(await builder.build());
}

describe('REALITY X25519MLKEM768 preservation', () => {
    it('preserves support-x25519mlkem768=true from a VLESS URI', async () => {
        const input = 'vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&type=tcp&sni=www.example.com&pbk=test-public-key&sid=0123456789abcdef&support-x25519mlkem768=true&flow=xtls-rprx-vision#PQ-URI';

        const built = await buildClash(input);
        const proxy = built.proxies.find(item => item.name === 'PQ-URI');

        expect(proxy).toBeDefined();
        expect(proxy['reality-opts']).toMatchObject({
            'public-key': 'test-public-key',
            'short-id': '0123456789abcdef',
            'support-x25519mlkem768': true
        });
    });

    it('preserves an explicit false value from Mihomo YAML', async () => {
        const input = `proxies:
  - name: PQ-Off
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    servername: www.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: test-public-key
      short-id: 0123456789abcdef
      support-x25519mlkem768: false
`;

        const built = await buildClash(input);
        const proxy = built.proxies.find(item => item.name === 'PQ-Off');

        expect(proxy).toBeDefined();
        expect(proxy['reality-opts']).toHaveProperty('support-x25519mlkem768', false);
    });

    it('does not invent the option when the source omitted it', async () => {
        const input = `proxies:
  - name: PQ-Unspecified
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    servername: www.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: test-public-key
      short-id: 0123456789abcdef
`;

        const built = await buildClash(input);
        const proxy = built.proxies.find(item => item.name === 'PQ-Unspecified');

        expect(proxy).toBeDefined();
        expect(proxy['reality-opts']).not.toHaveProperty('support-x25519mlkem768');
    });
});
