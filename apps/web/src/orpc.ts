import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import type { router } from '@tailflare/worker/router';

const link = new RPCLink({
	url: `${window.location.origin}/rpc`,
	fetch: (request, init) =>
		globalThis.fetch(request, {
			...init,
			credentials: 'include',
		}),
});

export const orpcClient: RouterClient<typeof router> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(orpcClient);
