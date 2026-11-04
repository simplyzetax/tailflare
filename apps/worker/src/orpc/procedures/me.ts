import { ORPCError } from '@orpc/server';
import {
	createAvailableTailflareContext,
	createUnavailableTailflareContext,
	getCookieFromRequest,
	type MeResponse,
	normalizeJwtPayload,
} from '../../auth/me';
import { getSigningKey, SESSION_COOKIE, verifySession } from '../../auth/notouch';
import { tryCatch } from '../../utils/try';
import { base } from '../base';

export const me = base.route({ method: 'GET', path: '/me' }).handler(async ({ context }): Promise<MeResponse> => {
	const token = getCookieFromRequest(context.base.Request, SESSION_COOKIE);
	if (!token) {
		throw new ORPCError('UNAUTHORIZED', {
			status: 401,
			message: 'Missing authentication cookie',
		});
	}

	const signingKey = tryGetSigningKey(context.base.Bindings.AUTH_SECRET);
	if (!signingKey) {
		throw new ORPCError('INTERNAL_SERVER_ERROR', {
			status: 500,
			message: 'AUTH_SECRET must be at least 32 bytes',
		});
	}

	const payload = await verifySession(token, signingKey);
	if (!payload) {
		throw new ORPCError('UNAUTHORIZED', {
			status: 401,
			message: 'Invalid authentication cookie',
		});
	}

	const identity = normalizeJwtPayload(payload);
	const tailscale = context.base.Bindings.TAILSCALE.getByName(context.base.Variables.country);
	const tailflare = await tryCatch(async () => {
		const [self, peers] = await Promise.all([tailscale.getSelf(), tailscale.getPeers()]);
		return createAvailableTailflareContext(self, peers);
	});

	return {
		...identity,
		tailflare: tailflare ?? createUnavailableTailflareContext('Unable to load live Tailscale context'),
	};
});

function tryGetSigningKey(secret: string | undefined): Uint8Array | null {
	try {
		return getSigningKey(secret);
	} catch {
		return null;
	}
}
