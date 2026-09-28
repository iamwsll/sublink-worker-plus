// Admin session tokens: `<expiryMs>.<hexHmac>` signed with HMAC-SHA256 over the expiry.
// Web Crypto is used directly because the same code runs on Workers, Node and Vercel,
// and node:crypto is not available in every runtime.

const COOKIE_NAME = 'sublink_admin';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

/**
 * @param {string | null | undefined} password
 * @returns {{ cookieName: string, isEnabled: boolean, issueToken: () => Promise<string>, verifyToken: (token?: string | null) => Promise<boolean> }}
 */
export function createAdminAuth(password) {
    const secret = typeof password === 'string' ? password : '';
    // An empty ADMIN_PASSWORD means "admin surface disabled", not "any password works".
    const isEnabled = secret.length > 0;
    let keyPromise = null;

    const getKey = () => {
        // Importing the key is pure overhead per request, so keep the derived key for the
        // lifetime of this app instance (the password cannot change without a restart).
        keyPromise ??= crypto.subtle.importKey(
            'raw',
            textEncoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        return keyPromise;
    };

    const sign = async (payload) => toHex(await crypto.subtle.sign('HMAC', await getKey(), textEncoder.encode(payload)));

    return {
        cookieName: COOKIE_NAME,
        isEnabled,

        async issueToken() {
            if (!isEnabled) return '';
            const expiry = Date.now() + TOKEN_TTL_MS;
            return `${expiry}.${await sign(String(expiry))}`;
        },

        async verifyToken(token) {
            if (!isEnabled || typeof token !== 'string') return false;

            const separator = token.indexOf('.');
            if (separator <= 0) return false;
            const expiryPart = token.slice(0, separator);
            const signature = token.slice(separator + 1);
            // Only digits can round-trip through issueToken; anything else is a forged shape.
            if (!/^\d+$/.test(expiryPart)) return false;

            const expiry = Number(expiryPart);
            if (!Number.isFinite(expiry) || Date.now() > expiry) return false;

            let expected;
            try {
                expected = await sign(expiryPart);
            } catch {
                return false;
            }
            return timingSafeEqual(signature, expected);
        }
    };
}

function toHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i += 1) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

// Comparing hex digests of equal length byte-by-byte avoids leaking the signature prefix
// through response timing.
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}