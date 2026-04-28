import { Hono } from 'hono';
import { html } from 'hono/html';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RPCHandler } from '@orpc/server/fetch';
import { CORSPlugin } from '@orpc/server/plugins';
import { onError } from '@orpc/server';

import { Tailscale } from './durable-objects/tailscale';
import { router } from './orpc/router';
import { errors } from './utils/errors';
import { tryCatch } from './utils/try';
import { setCookie } from 'hono/cookie';
import * as jose from 'jose';

const handler = new OpenAPIHandler(router, {
	plugins: [new CORSPlugin()],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});
const rpcHandler = new RPCHandler(router, {
	plugins: [new CORSPlugin()],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});
export type AppContext = {
	Bindings: Env;
	Request: Request;
	Variables: { country: Iso3166Alpha2Code };
};

const app = new Hono<AppContext>().use('*', async (c, next) => {
	if (!c.req.raw.cf) {
		return errors.internalServerError.toResponse();
	}

	const country = c.req.raw.cf.country as Iso3166Alpha2Code;
	if (!country) {
		return errors.internalServerError.toResponse();
	}

	c.set('country', country);
	await next();
});

app.use('/rpc/*', async (c, next) => {
	const { response, matched } = await rpcHandler.handle(c.req.raw, {
		prefix: '/rpc',
		context: {
			base: {
				Bindings: c.env,
				Request: c.req.raw,
				Variables: c.var,
			},
		},
	});

	if (matched) return response;
	await next();
});

app.use('*', async (c, next) => {
	const { response, matched } = await handler.handle(c.req.raw, {
		prefix: '/api/v1',
		context: {
			base: {
				Bindings: c.env,
				Request: c.req.raw,
				Variables: c.var,
			},
		},
	});
	if (matched) return response;
	await next();
});

app.onError((err, c) => {
	console.error(err);
	return errors.internalServerError.withMessage(err.message).toResponse();
});

app.notFound((c) => {
	return errors.notFound.toResponse();
});

app.get('/scalar', async (c) => {
	const htmlContent = html`
		<!doctype html>
		<html>
			<head>
				<title>Tailflare</title>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<link rel="icon" type="image/svg+xml" href="https://orpc.unnoq.com/icon.svg" />
			</head>
			<body>
				<div id="app"></div>

				<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
				<script>
					Scalar.createApiReference('#app', {
						url: '/api/v1/openapi.json',
						authentication: {
							securitySchemes: {
								bearerAuth: {
									token: '',
								},
							},
						},
					});
				</script>
			</body>
		</html>
	`;

	return c.html(htmlContent);
});

app.get('/api/v1/notouchlogin', async (c) => {
	const tailscale = c.env.TAILSCALE.getByName(c.get('country'));

	const self = await tailscale.getSelf();
	const magicDNSName = self.magicDNSName;
	if (!magicDNSName) return errors.tailscale.selfNotFound.toResponse();

	const tailnetLoginURL = `http://${magicDNSName}/api/v1/notouchlogin`;

	return c.html(html`
		<!doctype html>
		<html>
			<head>
				<title>Tailflare</title>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
			</head>
			<body>
				<main data-token-url="${tailnetLoginURL}">
					<p id="status">Signing you in with Tailscale...</p>
				</main>
				<script>
					(async () => {
						const status = document.getElementById('status');
						const tokenUrl = document.querySelector('main').dataset.tokenUrl;

						try {
							const response = await fetch(tokenUrl);
							if (!response.ok) {
								throw new Error('Tailnet login failed with status ' + response.status);
							}

							const callbackUrl = new URL('/api/v1/notouchlogin/callback', window.location.href);
							callbackUrl.searchParams.set('token', await response.text());
							window.location.assign(callbackUrl.toString());
						} catch (error) {
							status.textContent = error instanceof Error ? error.message : 'Tailnet login failed';
						}
					})();
				</script>
			</body>
		</html>
	`);
});

app.get('/api/v1/notouchlogin/callback', async (c) => {
	const token = c.req.query('token');
	if (!token) return errors.badRequest.withMessage('Missing token parameter').toResponse();

	const signingKey = new TextEncoder().encode(c.env.AUTH_SECRET);
	if (signingKey.byteLength < 32) {
		return errors.internalServerError.withMessage('AUTH_SECRET must be at least 32 bytes').toResponse();
	}

	const result = await tryCatch(async () => jose.jwtVerify(token, signingKey));
	if (!result) return errors.unauthorized.withMessage('Invalid token').toResponse();

	setCookie(c, 'tailflare_token', token, {
		httpOnly: true,
		maxAge: 60 * 60 * 3,
		path: '/',
		sameSite: 'Lax',
		secure: c.env.NODE_ENV !== 'development',
	});

	return c.redirect('/me', 303);
});

app.all('/api/v1/proxy', async (c) => {
	const tailscale = c.env.TAILSCALE.getByName(c.get('country'));

	const url = c.req.query('url');
	if (!url) return errors.badRequest.withMessage('Missing url parameter').toResponse();

	const cleanURL = await tryCatch(async () => new URL(url));
	if (!cleanURL) return errors.badRequest.withMessage('Invalid url parameter').toResponse();

	const request = new Request(cleanURL.toString(), {
		method: c.req.method,
		headers: c.req.raw.headers,
		body: c.req.raw.body,
	});

	return await tailscale.proxy(request);
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { Tailscale };
