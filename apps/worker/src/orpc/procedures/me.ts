import { ORPCError } from '@orpc/server';
import * as jose from 'jose';

import {
	createAvailableTailflareContext,
	createUnavailableTailflareContext,
	getCookieFromRequest,
	type MeResponse,
	normalizeJwtPayload,
} from '../../auth/me';
import { tryCatch } from '../../utils/try';
import { base } from '../base';

export const me = base.route({ method: 'GET', path: '/me' }).handler(async ({ context }): Promise<MeResponse> => {
	const token = getCookieFromRequest(context.base.Request, 'tailflare_token');
	if (!token) {
		throw new ORPCError('UNAUTHORIZED', {
			status: 401,
			message: 'Missing authentication cookie',
		});
	}

	const signingKey = new TextEncoder().encode(context.base.Bindings.AUTH_SECRET);
	if (signingKey.byteLength < 32) {
		throw new ORPCError('INTERNAL_SERVER_ERROR', {
			status: 500,
			message: 'AUTH_SECRET must be at least 32 bytes',
		});
	}

	const result = await tryCatch(async () => jose.jwtVerify(token, signingKey));
	if (!result) {
		throw new ORPCError('UNAUTHORIZED', {
			status: 401,
			message: 'Invalid authentication cookie',
		});
	}

	const identity = normalizeJwtPayload(result.payload);
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
