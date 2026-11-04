import * as jose from 'jose';

/** Cookie holding the signed tailnet session for the browser. */
export const SESSION_COOKIE = 'tailflare_token';
/** Short-lived cookie binding an in-flight no-touch login to the browser that started it. */
export const LOGIN_STATE_COOKIE = 'tailflare_login_state';

export const SESSION_AUDIENCE = 'tailflare:session';
export const LOGIN_STATE_AUDIENCE = 'tailflare:notouch-state';

export const SESSION_TTL_SECONDS = 60 * 60 * 3;
export const LOGIN_STATE_TTL_SECONDS = 60 * 5;
export const LOGIN_CODE_TTL_MS = 60 * 1000;

export const NOTOUCH_PATH = '/api/v1/notouchlogin';
export const NOTOUCH_CALLBACK_PATH = '/api/v1/notouchlogin/callback';
export const DEFAULT_REDIRECT = '/me';

export type LoginState = {
	/** Random value also stored in the login state cookie, so a callback only completes in the browser that started it. */
	nonce: string;
	/** Absolute callback URL on the Worker origin that started the login. */
	callback: string;
	/** Same-origin path to land on after login. */
	redirect: string;
	/** Durable Object name that issued the login code. */
	node: string;
};

export function getSigningKey(secret: string | undefined): Uint8Array {
	if (!secret) throw new Error('AUTH_SECRET is not configured');
	const key = new TextEncoder().encode(secret);
	if (key.byteLength < 32) throw new Error('AUTH_SECRET must be at least 32 bytes');
	return key;
}

export function randomToken(bytes = 32): string {
	const buffer = crypto.getRandomValues(new Uint8Array(bytes));
	return jose.base64url.encode(buffer);
}

/** Only allow same-origin relative paths, so the login can't be used as an open redirect. */
export function sanitizeRedirect(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_REDIRECT;
	try {
		const url = new URL(value, 'https://tailflare.invalid');
		if (url.origin !== 'https://tailflare.invalid') return DEFAULT_REDIRECT;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return DEFAULT_REDIRECT;
	}
}

export async function signLoginState(state: LoginState, key: Uint8Array): Promise<string> {
	return new jose.SignJWT({ ...state })
		.setProtectedHeader({ alg: 'HS256' })
		.setAudience(LOGIN_STATE_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(`${LOGIN_STATE_TTL_SECONDS}s`)
		.sign(key);
}

export async function verifyLoginState(token: string, key: Uint8Array): Promise<LoginState | null> {
	try {
		const { payload } = await jose.jwtVerify(token, key, { audience: LOGIN_STATE_AUDIENCE, algorithms: ['HS256'] });
		const { nonce, callback, redirect, node } = payload;
		if (typeof nonce !== 'string' || typeof callback !== 'string' || typeof redirect !== 'string' || typeof node !== 'string') {
			return null;
		}
		return { nonce, callback, redirect: sanitizeRedirect(redirect), node };
	} catch {
		return null;
	}
}

export async function signSession(node: IPNNetMapNode, key: Uint8Array): Promise<string> {
	return new jose.SignJWT({
		name: node.name,
		addresses: node.addresses,
		machineKey: node.machineKey,
		nodeKey: node.nodeKey,
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(node.name)
		.setAudience(SESSION_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(`${SESSION_TTL_SECONDS}s`)
		.sign(key);
}

export async function verifySession(token: string | null | undefined, key: Uint8Array): Promise<jose.JWTPayload | null> {
	if (!token) return null;
	try {
		const { payload } = await jose.jwtVerify(token, key, { audience: SESSION_AUDIENCE, algorithms: ['HS256'] });
		return payload;
	} catch {
		return null;
	}
}

/**
 * Address browsers should use to reach the Tailflare node over the tailnet.
 * The IPv4 address works even when MagicDNS is disabled on the client, and browsers
 * don't try to auto-upgrade IP literals to HTTPS.
 */
export function tailnetHost(self: Pick<TailscaleSelf, 'ipv4' | 'magicDNSName'>): string | null {
	if (self.ipv4) return self.ipv4;
	return self.magicDNSName?.replace(/\.$/, '') || null;
}

export function htmlPage(title: string, message: string, status: number): Response {
	const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
	return new Response(
		`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tailflare</title>` +
			`<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#2c2418;background:#f6f0e4}h1{font-size:1.4rem}</style></head>` +
			`<body><h1>${escape(title)}</h1><p>${escape(message)}</p></body></html>`,
		{
			status,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
				'Referrer-Policy': 'no-referrer',
			},
		},
	);
}
