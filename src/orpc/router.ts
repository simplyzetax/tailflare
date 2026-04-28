import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod';

import { base } from './base';
import { health } from './procedures/health';
import { me } from './procedures/me';
import { login } from './procedures/tailscale/login';
import { peers } from './procedures/tailscale/peers';
import { destroy } from './procedures/tailscale/destroy';
import { self } from './procedures/tailscale/self';

const openAPIGenerator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
});

const apiRouter = {
	health,
	me,
	tailscale: {
		peers,
		self,
		login,
		destroy,
	},
} as const;

const openapi = base.route({ method: 'GET', path: '/openapi.json' }).handler(async ({ context }) => {
	const url = new URL(context.base.Request.url);
	url.pathname = '/api/v1';

	return openAPIGenerator.generate(apiRouter, {
		info: {
			title: 'Tailflare',
			version: '0.0.0',
		},
		servers: [{ url: url.toString() }],
	});
});

export const router = {
	openapi,
	...apiRouter,
} as const;
