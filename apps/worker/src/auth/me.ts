import type { JWTPayload } from 'jose';

export type MeIdentity = {
	name: string | null;
	subject: string | null;
	addresses: string[];
	machineKey: string | null;
	nodeKey: string | null;
};

export type MeSession = {
	issuedAt: string | null;
	expiresAt: string | null;
};

export type MeTailflareContext = {
	status: 'available' | 'needs_login' | 'unavailable';
	error: string | null;
	self: {
		name: string | null;
		magicDNSName: string | null;
		host: string | null;
		addresses: string[];
		ipv4: string | null;
		ipv6: string | null;
		machineStatus: string | null;
	} | null;
	peers: Array<{
		name: string | null;
		addresses: string[];
		machineKey: string | null;
		nodeKey: string | null;
	}>;
	peerCount: number;
};

export type MeResponse = {
	identity: MeIdentity;
	session: MeSession;
	tailflare: MeTailflareContext;
};

export function normalizeJwtPayload(payload: JWTPayload): Pick<MeResponse, 'identity' | 'session'> {
	const addresses = Array.isArray(payload.addresses)
		? payload.addresses.filter((address): address is string => typeof address === 'string')
		: [];

	return {
		identity: {
			name: typeof payload.name === 'string' ? payload.name : null,
			subject: typeof payload.sub === 'string' ? payload.sub : null,
			addresses,
			machineKey: typeof payload.machineKey === 'string' ? payload.machineKey : null,
			nodeKey: typeof payload.nodeKey === 'string' ? payload.nodeKey : null,
		},
		session: {
			issuedAt: typeof payload.iat === 'number' ? new Date(payload.iat * 1000).toISOString() : null,
			expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
		},
	};
}

export function createUnavailableTailflareContext(error: string): MeTailflareContext {
	return {
		status: 'unavailable',
		error,
		self: null,
		peers: [],
		peerCount: 0,
	};
}

export function createAvailableTailflareContext(self: TailscaleSelf, peers: IPNNetMapPeerNode[]): MeTailflareContext {
	return {
		status: self.machineStatus === 'MachineAuthorized' ? 'available' : 'needs_login',
		error: null,
		self: {
			name: self.name,
			magicDNSName: self.magicDNSName,
			host: self.host,
			addresses: self.addresses,
			ipv4: self.ipv4,
			ipv6: self.ipv6,
			machineStatus: self.machineStatus,
		},
		peers: peers.map((peer) => ({
			name: peer.name ?? null,
			addresses: peer.addresses ?? [],
			machineKey: peer.machineKey ?? null,
			nodeKey: peer.nodeKey ?? null,
		})),
		peerCount: peers.length,
	};
}

export function getCookieFromRequest(request: Request, name: string): string | null {
	const cookie = request.headers.get('Cookie');
	if (!cookie) return null;

	for (const part of cookie.split(';')) {
		const [rawKey, ...rawValue] = part.trim().split('=');
		if (rawKey !== name) continue;

		try {
			return decodeURIComponent(rawValue.join('='));
		} catch {
			return null;
		}
	}

	return null;
}
