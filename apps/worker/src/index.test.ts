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
		route: vi.fn(),
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

	it('returns the no-touch login page for a Tailscale self node', async () => {
		const response = await dispatch(createRequest('/api/v1/notouchlogin'));
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(body).toContain('Signing you in with Tailscale');
		expect(body).toContain('data-token-url="http://tailflare.tailnet.ts.net/api/v1/notouchlogin"');
	});

	it('redirects no-touch login to the Tailscale login URL when the Durable Object needs login', async () => {
		useNextIPN({ state: 'NeedsLogin' });

		const response = await dispatch(createRequest('/api/v1/notouchlogin'));

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe('https://login.tailscale.com/a/test');
		expect(createdIPNs[0]?.login).toHaveBeenCalledOnce();
	});

	it('rejects no-touch login when the self node has no MagicDNS name', async () => {
		useNextIPN({ self: null });
		const response = await dispatch(createRequest('/api/v1/notouchlogin'));

		expect(response.status).toBe(404);
		expect(await jsonBody(response)).toMatchObject({
			errorCode: 'errors.tailflare.tailscale.selfNotFound',
		});
	});

	it('rejects a no-touch login callback without a token', async () => {
		const response = await dispatch(createRequest('/api/v1/notouchlogin/callback'));

		expect(response.status).toBe(400);
		expect(await jsonBody(response)).toMatchObject({ errorMessage: 'Missing token parameter' });
	});

	it('rejects a no-touch login callback with an invalid token', async () => {
		const response = await dispatch(createRequest('/api/v1/notouchlogin/callback?token=not-a-jwt'));

		expect(response.status).toBe(401);
		expect(await jsonBody(response)).toMatchObject({ errorMessage: 'Invalid token' });
	});

	it('sets the authentication cookie for a valid no-touch login callback token', async () => {
		const token = await createToken();
		const response = await dispatch(createRequest(`/api/v1/notouchlogin/callback?token=${encodeURIComponent(token)}`));
		const cookie = response.headers.get('Set-Cookie');

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe('/me');
		expect(cookie).toContain(`tailflare_token=${token}`);
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Max-Age=10800');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).toContain('Secure');
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
