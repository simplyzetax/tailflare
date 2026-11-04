import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tailflare/tailscale-wasm', () => ({ createIPN: vi.fn() }));

import { createIPN } from '@tailflare/tailscale-wasm';
import type { Tailscale } from './durable-objects/tailscale';
import worker from './index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const self: IPNNetMapSelfNode = {
	name: 'tailflare.tailnet.ts.net',
	addresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
	machineKey: 'mkey:self',
	nodeKey: 'nodekey:self',
	machineStatus: 'MachineAuthorized',
};

const peer: IPNNetMapPeerNode = {
	name: 'device.tailnet.ts.net',
	addresses: ['100.64.0.2'],
	machineKey: 'mkey:peer',
	nodeKey: 'nodekey:peer',
	tailscaleSSHEnabled: false,
};

type CreateIPNConfig = Parameters<typeof createIPN>[0];
type FakeIPNOptions = {
	fetch?: (request: Request) => Promise<Response>;
	peers?: IPNNetMapPeerNode[];
	self?: IPNNetMapSelfNode | null;
	state?: IPNState;
};
type FakeIPN = IPN & {
	callbacks: IPNCallbacks | null;
	fetch: ReturnType<typeof vi.fn<(request: Request) => Promise<IPNResponse>>>;
	getPeers: ReturnType<typeof vi.fn<() => IPNNetMapPeerNode[]>>;
	getSelf: ReturnType<typeof vi.fn<() => IPNNetMapSelfNode | null>>;
	login: ReturnType<typeof vi.fn<() => void>>;
	logout: ReturnType<typeof vi.fn<() => void>>;
	route: ReturnType<typeof vi.fn<(path: string, handler: IPNRouteHandler) => void>>;
	routes: Map<string, IPNRouteHandler>;
	run: ReturnType<typeof vi.fn<(callbacks: IPNCallbacks) => void>>;
};

const createIPNMock = vi.mocked(createIPN);
let createdIPNs: FakeIPN[] = [];
let consoleLog: ReturnType<typeof vi.spyOn> | null = null;
let nextIPNOptions: FakeIPNOptions = {};

function asIPNResponse(response: Response): IPNResponse {
	return response as unknown as IPNResponse;
}

function createFakeIPN(_config: CreateIPNConfig, options: FakeIPNOptions): FakeIPN {
	const routes = new Map<string, IPNRouteHandler>();
	const fake = {
		callbacks: null,
		fetch: vi.fn(async (request: Request) => {
			const response = options.fetch ? await options.fetch(request) : new Response(await request.text(), { status: 201 });
			return asIPNResponse(response);
		}),
		getPeers: vi.fn(() => options.peers ?? [peer]),
		getSelf: vi.fn(() => ('self' in options ? options.self : self) ?? null),
		login: vi.fn(() => fake.callbacks?.notifyBrowseToURL('https://login.tailscale.com/a/test')),
		logout: vi.fn(),
		route: vi.fn((path: string, handler: IPNRouteHandler) => routes.set(path, handler)),
		routes,
		run: vi.fn((callbacks: IPNCallbacks) => {
			fake.callbacks = callbacks;
			callbacks.notifyState(options.state ?? 'Running');
		}),
		ssh: vi.fn(() => ({ close: vi.fn(() => true), resize: vi.fn(() => true) })),
	} as unknown as FakeIPN;

	return fake;
}

function useNextIPN(options: FakeIPNOptions) {
	nextIPNOptions = options;
}

function createRequest(path: string, init: RequestInit<IncomingRequestCfProperties> = {}): Request {
	return new IncomingRequest(`https://tailflare.test${path}`, {
		cf: { country: 'DE' as Iso3166Alpha2Code } as unknown as IncomingRequestCfProperties,
		...init,
	});
}

async function dispatch(request: Request): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function jsonBody(response: Response) {
	return response.json() as Promise<Record<string, unknown>>;
}

async function createToken(country: Iso3166Alpha2Code = 'DE') {
	return runInDurableObject<Tailscale, string>(env.TAILSCALE.getByName(country), (instance) => instance.createToken(peer));
}

beforeEach(() => {
	createdIPNs = [];
	consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	nextIPNOptions = {};
	createIPNMock.mockImplementation(async (config) => {
		const ipn = createFakeIPN(config, nextIPNOptions);
		createdIPNs.push(ipn);
		return ipn;
	});
});

afterEach(async () => {
	consoleLog?.mockRestore();
	await abortAllDurableObjects();
});

describe('worker fetch handler', () => {
	it('requires Cloudflare request metadata before routing', async () => {
		const response = await dispatch(new IncomingRequest('https://tailflare.test/api/v1/health'));

		expect(response.status).toBe(500);
		expect(await jsonBody(response)).toMatchObject({
			errorCode: 'errors.tailflare.internalServerError',
			errorMessage: 'Internal server error',
		});
	});

	it('serves the health endpoint through the OpenAPI handler', async () => {
		const response = await dispatch(createRequest('/api/v1/health'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('serves an OpenAPI document with the request origin as server URL', async () => {
		const response = await dispatch(createRequest('/api/v1/openapi.json'));
		const body = await jsonBody(response);

		expect(response.status).toBe(200);
		expect(body.info).toMatchObject({ title: 'Tailflare', version: '0.0.0' });
		expect(body.servers).toEqual([{ url: 'https://tailflare.test/api/v1' }]);
	});

	it('returns the authenticated me response with live Tailscale context', async () => {
		const token = await createToken();

		const response = await dispatch(
			createRequest('/api/v1/me', {
				headers: { cookie: `tailflare_token=${encodeURIComponent(token)}` },
			}),
		);
		const body = await jsonBody(response);

		expect(response.status).toBe(200);
		expect(body.identity).toMatchObject({
			addresses: ['100.64.0.2'],
			machineKey: 'mkey:peer',
			name: 'device.tailnet.ts.net',
			nodeKey: 'nodekey:peer',
			subject: 'device.tailnet.ts.net',
		});
		expect(body.tailflare).toMatchObject({
			peerCount: 1,
			status: 'available',
		});
	});

	it('rejects the me response without an authentication cookie', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			const response = await dispatch(createRequest('/api/v1/me'));

			expect(response.status).toBe(401);
			expect(error).toHaveBeenCalledOnce();
		} finally {
			error.mockRestore();
		}
	});

	it('returns the Tailscale self procedure response through the Worker', async () => {
		const response = await dispatch(createRequest('/api/v1/self'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			addresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
			host: 'tailflare',
			ipv4: '100.64.0.1',
			ipv6: 'fd7a:115c:a1e0::1',
			machineKey: 'mkey:self',
			machineStatus: 'MachineAuthorized',
			magicDNSName: 'tailflare.tailnet.ts.net',
			name: 'tailflare.tailnet.ts.net',
			nodeKey: 'nodekey:self',
		});
	});

	it('returns the Tailscale peers procedure response through the Worker', async () => {
		const response = await dispatch(createRequest('/api/v1/peers'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([peer]);
	});

	it('returns the Tailscale login procedure response through the Worker', async () => {
		const response = await dispatch(createRequest('/api/v1/login'));

		expect(response.status).toBe(200);
		expect(await response.json()).toBe('https://login.tailscale.com/a/test');
	});

	it('destroys the country-scoped Tailscale object through the Worker', async () => {
		const response = await dispatch(createRequest('/api/v1/destroy'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
	});

	it('serves the Scalar API reference page', async () => {
		const response = await dispatch(createRequest('/scalar'));
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/html');
		expect(body).toContain("Scalar.createApiReference('#app'");
		expect(body).toContain("url: '/api/v1/openapi.json'");
	});

	it('returns the project error envelope for unmatched routes', async () => {
		const response = await dispatch(createRequest('/missing'));

		expect(response.status).toBe(404);
		expect(await jsonBody(response)).toMatchObject({
			errorCode: 'errors.tailflare.notFound',
			errorMessage: 'Not found',
		});
	});

	function cookieValue(response: Response, name: string): string | null {
		for (const cookie of response.headers.getSetCookie()) {
			const [pair] = cookie.split(';');
			const [key, ...value] = pair.split('=');
			if (key === name) return value.join('=');
		}
		return null;
	}

	/** Simulates the browser following the redirect over the tailnet to the Durable Object's route. */
	async function visitTailnet(location: string, sourceIP = '100.64.0.2'): Promise<Response> {
		return runInDurableObject<Tailscale, Response>(env.TAILSCALE.getByName('DE'), async () => {
			const url = new URL(location);
			const handler = createdIPNs[0]?.routes.get(url.pathname);
			if (!handler) throw new Error(`No tailnet route for ${url.pathname}`);
			const response = (await handler({
				destinationIP: url.hostname,
				destinationPort: 80,
				headers: {},
				method: 'GET',
				path: url.pathname,
				sourceIP,
				sourcePort: 50000,
				url: location,
			})) as Response;
			return new Response(response.body, response);
		});
	}

	async function startLogin(query = '') {
		const start = await dispatch(createRequest(`/api/v1/notouchlogin${query}`));
		const location = start.headers.get('Location') ?? '';
		const nonce = cookieValue(start, 'tailflare_login_state');
		return { start, location, nonce };
	}

	it('completes the no-touch login entirely through redirects', async () => {
		const { start, location, nonce } = await startLogin('?redirect=%2Fme%3Ftab%3Dpeers');
		expect(start.status).toBe(303);
		expect(location).toMatch(/^http:\/\/100\.64\.0\.1\/api\/v1\/notouchlogin\?state=/);
		expect(nonce).toBeTruthy();
		expect(start.headers.getSetCookie()[0]).toContain('Path=/api/v1/notouchlogin');

		const tailnet = await visitTailnet(location);
		expect(tailnet.status).toBe(303);
		const callback = tailnet.headers.get('Location') ?? '';
		expect(callback).toMatch(/^https:\/\/tailflare\.test\/api\/v1\/notouchlogin\/callback\?code=/);
		expect(new URL(callback).searchParams.get('code')).not.toContain('.'); // an opaque code, not the session JWT

		const done = await dispatch(createRequest(new URL(callback).pathname + new URL(callback).search, { headers: { cookie: `tailflare_login_state=${nonce}` } }));
		expect(done.status).toBe(303);
		expect(done.headers.get('Location')).toBe('/me?tab=peers');
		const session = cookieValue(done, 'tailflare_token');
		expect(session).toBeTruthy();
		const sessionCookie = done.headers.getSetCookie().find((c) => c.startsWith('tailflare_token='));
		expect(sessionCookie).toContain('HttpOnly');
		expect(sessionCookie).toContain('Max-Age=10800');
		expect(sessionCookie).toContain('SameSite=Lax');
		expect(sessionCookie).toContain('Secure');
		expect(cookieValue(done, 'tailflare_login_state')).toBe('');

		const me = await dispatch(createRequest('/api/v1/me', { headers: { cookie: `tailflare_token=${session}` } }));
		expect(me.status).toBe(200);
		expect((await jsonBody(me)).identity).toMatchObject({ name: 'device.tailnet.ts.net' });

		// The code is single-use.
		const replay = await dispatch(createRequest(new URL(callback).pathname + new URL(callback).search, { headers: { cookie: `tailflare_login_state=${nonce}` } }));
		expect(replay.headers.get('Location')).toBe('/me?login_error=invalid_code');
	});

	it('skips the round trip when the browser already has a valid session', async () => {
		const token = await createToken();
		const response = await dispatch(createRequest('/api/v1/notouchlogin?redirect=/me', { headers: { cookie: `tailflare_token=${token}` } }));

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe('/me');
	});

	it('ignores off-site redirect targets', async () => {
		const token = await createToken();
		for (const redirect of ['https://evil.test/', '//evil.test/', '/\\evil.test']) {
			const response = await dispatch(
				createRequest(`/api/v1/notouchlogin?redirect=${encodeURIComponent(redirect)}`, { headers: { cookie: `tailflare_token=${token}` } }),
			);
			expect(response.headers.get('Location')).toBe('/me');
		}
	});

	it('refuses to complete a login started in another browser', async () => {
		const { location } = await startLogin();
		const callback = new URL((await visitTailnet(location)).headers.get('Location') ?? '');

		const withoutCookie = await dispatch(createRequest(callback.pathname + callback.search));
		expect(withoutCookie.headers.get('Location')).toBe('/me?login_error=state_mismatch');
		expect(withoutCookie.headers.get('Set-Cookie') ?? '').not.toContain('tailflare_token=ey');

		const wrongCookie = await dispatch(createRequest(callback.pathname + callback.search, { headers: { cookie: 'tailflare_login_state=attacker' } }));
		expect(wrongCookie.headers.get('Location')).toBe('/me?login_error=state_mismatch');
	});

	it('does not accept a login state token as a session', async () => {
		const { location } = await startLogin();
		const state = new URL(location).searchParams.get('state') ?? '';
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const me = await dispatch(createRequest('/api/v1/me', { headers: { cookie: `tailflare_token=${state}` } }));
			expect(me.status).toBe(401);
		} finally {
			error.mockRestore();
		}
	});

	it('rejects tailnet requests from unknown peers', async () => {
		const { location } = await startLogin();
		const response = await visitTailnet(location, '100.64.0.99');

		expect(response.status).toBe(403);
		expect(response.headers.get('Location')).toBeNull();
	});

	it('falls back to MagicDNS when the node has no IPv4 address', async () => {
		useNextIPN({ self: { ...self, addresses: ['fd7a:115c:a1e0::1'] } });
		const { location } = await startLogin();

		expect(location).toMatch(/^http:\/\/tailflare\.tailnet\.ts\.net\/api\/v1\/notouchlogin\?state=/);
	});

	it('redirects no-touch login to the Tailscale login URL when the Durable Object needs login', async () => {
		useNextIPN({ state: 'NeedsLogin' });

		const response = await dispatch(createRequest('/api/v1/notouchlogin'));

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe('https://login.tailscale.com/a/test');
		expect(createdIPNs[0]?.login).toHaveBeenCalledOnce();
	});

	it('rejects no-touch login when the self node has no tailnet address', async () => {
		useNextIPN({ self: null });
		const response = await dispatch(createRequest('/api/v1/notouchlogin'));

		expect(response.status).toBe(404);
		expect(await jsonBody(response)).toMatchObject({
			errorCode: 'errors.tailflare.tailscale.selfNotFound',
		});
	});

	it('sends incomplete or forged callbacks back to the sign-in page with an error', async () => {
		const missing = await dispatch(createRequest('/api/v1/notouchlogin/callback'));
		expect(missing.status).toBe(303);
		expect(missing.headers.get('Location')).toBe('/me?login_error=missing_parameters');

		const forged = await dispatch(createRequest('/api/v1/notouchlogin/callback?code=x&state=not-a-jwt'));
		expect(forged.headers.get('Location')).toBe('/me?login_error=expired');
	});

	it('rejects proxy requests without a url parameter', async () => {
		const response = await dispatch(createRequest('/api/v1/proxy'));

		expect(response.status).toBe(400);
		expect(await jsonBody(response)).toMatchObject({ errorMessage: 'Missing url parameter' });
	});

	it('rejects proxy requests with an invalid url parameter', async () => {
		const response = await dispatch(createRequest('/api/v1/proxy?url=not-a-url'));

		expect(response.status).toBe(400);
		expect(await jsonBody(response)).toMatchObject({ errorMessage: 'Invalid url parameter' });
	});

	it('proxies valid requests through the country-scoped Tailscale object', async () => {
		const response = await dispatch(
			createRequest('/api/v1/proxy?url=https%3A%2F%2Fdevice%2Fapi', {
				body: 'proxied-body',
				headers: { 'X-Test': 'yes' },
				method: 'POST',
			}),
		);
		const proxiedRequest = createdIPNs[0]?.fetch.mock.calls[0]?.[0];

		expect(response.status).toBe(201);
		expect(await response.text()).toBe('proxied-body');
		expect(proxiedRequest?.url).toBe('https://device/api');
		expect(proxiedRequest?.method).toBe('POST');
		expect(proxiedRequest?.headers.get('X-Test')).toBe('yes');
	});
});
