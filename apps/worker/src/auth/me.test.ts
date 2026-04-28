import { describe, expect, it } from 'vitest';

import { createAvailableTailflareContext, createUnavailableTailflareContext, getCookieFromRequest, normalizeJwtPayload } from './me';

describe('normalizeJwtPayload', () => {
	it('normalizes supported identity and session claims', () => {
		const result = normalizeJwtPayload({
			sub: 'finns-macbook.tailnet.ts.net',
			name: 'Finn',
			addresses: ['100.64.0.1', 42, 'fd7a::1'],
			machineKey: 'mkey:test',
			nodeKey: 'nodekey:test',
			iat: 1777340000,
			exp: 1777350800,
		});

		expect(result).toEqual({
			identity: {
				name: 'Finn',
				subject: 'finns-macbook.tailnet.ts.net',
				addresses: ['100.64.0.1', 'fd7a::1'],
				machineKey: 'mkey:test',
				nodeKey: 'nodekey:test',
			},
			session: {
				issuedAt: new Date(1777340000 * 1000).toISOString(),
				expiresAt: new Date(1777350800 * 1000).toISOString(),
			},
		});
	});

	it('falls back to nulls and empty arrays for unsupported claims', () => {
		const result = normalizeJwtPayload({});

		expect(result.identity).toEqual({
			name: null,
			subject: null,
			addresses: [],
			machineKey: null,
			nodeKey: null,
		});
		expect(result.session).toEqual({ issuedAt: null, expiresAt: null });
	});
});

describe('createUnavailableTailflareContext', () => {
	it('returns a stable unavailable context', () => {
		expect(createUnavailableTailflareContext('failed')).toEqual({
			status: 'unavailable',
			error: 'failed',
			self: null,
			peers: [],
			peerCount: 0,
		});
	});
});

describe('createAvailableTailflareContext', () => {
	it('maps self and peers into the me response tailflare context', () => {
		const result = createAvailableTailflareContext(
			{
				name: 'tailflare.tailnet.ts.net',
				magicDNSName: 'tailflare.tailnet.ts.net',
				host: 'tailflare',
				addresses: ['100.64.0.1'],
				ipv4: '100.64.0.1',
				ipv6: null,
				machineKey: 'mkey:self',
				machineStatus: 'MachineAuthorized',
				nodeKey: 'nodekey:self',
			},
			[
				{
					name: 'device.tailnet.ts.net',
					addresses: ['100.64.0.2'],
					machineKey: 'mkey:peer',
					nodeKey: 'nodekey:peer',
					tailscaleSSHEnabled: false,
				},
			],
		);

		expect(result).toEqual({
			status: 'available',
			error: null,
			self: {
				name: 'tailflare.tailnet.ts.net',
				magicDNSName: 'tailflare.tailnet.ts.net',
				host: 'tailflare',
				addresses: ['100.64.0.1'],
				ipv4: '100.64.0.1',
				ipv6: null,
				machineStatus: 'MachineAuthorized',
			},
			peers: [
				{
					name: 'device.tailnet.ts.net',
					addresses: ['100.64.0.2'],
					machineKey: 'mkey:peer',
					nodeKey: 'nodekey:peer',
				},
			],
			peerCount: 1,
		});
	});

	it('marks the tailflare context as needing login until the machine is authorized', () => {
		const result = createAvailableTailflareContext(
			{
				name: null,
				magicDNSName: null,
				host: null,
				addresses: [],
				ipv4: null,
				ipv6: null,
				machineKey: null,
				machineStatus: 'MachineUnauthorized',
				nodeKey: null,
			},
			[],
		);

		expect(result.status).toBe('needs_login');
		expect(result.peerCount).toBe(0);
	});
});

describe('getCookieFromRequest', () => {
	it('reads a named cookie from the request header', () => {
		const request = new Request('https://example.com', {
			headers: {
				cookie: 'other=value; tailflare_token=abc123; theme=warm',
			},
		});

		expect(getCookieFromRequest(request, 'tailflare_token')).toBe('abc123');
	});

	it('decodes encoded cookie values and preserves equals signs', () => {
		const request = new Request('https://example.com', {
			headers: {
				cookie: 'tailflare_token=a%3Db%3Dc',
			},
		});

		expect(getCookieFromRequest(request, 'tailflare_token')).toBe('a=b=c');
	});

	it('returns null when there is no cookie header', () => {
		const request = new Request('https://example.com');

		expect(getCookieFromRequest(request, 'tailflare_token')).toBeNull();
	});

	it('returns null when the cookie is missing', () => {
		const request = new Request('https://example.com', {
			headers: {
				cookie: 'other=value',
			},
		});

		expect(getCookieFromRequest(request, 'tailflare_token')).toBeNull();
	});

	it('returns null for malformed encoded cookie values', () => {
		const request = new Request('https://example.com', {
			headers: {
				cookie: 'tailflare_token=%E0%A4%A',
			},
		});

		expect(getCookieFromRequest(request, 'tailflare_token')).toBeNull();
	});
});
