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
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
	DEFAULT_REDIRECT,
	getSigningKey,
	LOGIN_STATE_COOKIE,
	LOGIN_STATE_TTL_SECONDS,
	NOTOUCH_CALLBACK_PATH,
	NOTOUCH_PATH,
	randomToken,
	sanitizeRedirect,
	SESSION_COOKIE,
	SESSION_TTL_SECONDS,
	signLoginState,
	tailnetHost,
	verifyLoginState,
	verifySession,
} from './auth/notouch';

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

/**
 * No-touch login. Fully redirect-based so it works from an HTTPS page (a script fetch to the
 * plain-HTTP tailnet address would be blocked as mixed content):
 *
 *   Worker /notouchlogin ──303──▶ http://<tailflare tailnet IP>/api/v1/notouchlogin?state=…
 *        (only reachable from the tailnet; the DO identifies the source peer)
 *   ◀──303── Worker /notouchlogin/callback?code=…&state=…  ──303──▶ redirect target
 *
 * The session token never appears in a URL: the DO hands out a single-use code bound to a nonce
 * that only lives in the initiating browser's cookie.
 */
app.get(NOTOUCH_PATH, async (c) => {
	const redirect = sanitizeRedirect(c.req.query('redirect'));
	const key = getSigningKey(c.env.AUTH_SECRET);

	// Already signed in: skip the round trip.
	if (await verifySession(getCookie(c, SESSION_COOKIE), key)) {
		return c.redirect(redirect, 303);
	}

	const node = c.get('country');
	const tailscale = c.env.TAILSCALE.getByName(node);

	if (await tailscale.needsLogin()) {
		return c.redirect(await tailscale.login(), 303);
	}

	const host = tailnetHost(await tailscale.getSelf());
	if (!host) return errors.tailscale.selfNotFound.toResponse();

	const nonce = randomToken();
	const state = await signLoginState(
		{
			nonce,
			callback: new URL(NOTOUCH_CALLBACK_PATH, c.req.url).toString(),
			redirect,
			node,
		},
		key,
	);

	setCookie(c, LOGIN_STATE_COOKIE, nonce, {
		httpOnly: true,
		maxAge: LOGIN_STATE_TTL_SECONDS,
		path: NOTOUCH_PATH,
		sameSite: 'Lax',
		secure: c.env.NODE_ENV !== 'development',
	});
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');

	const target = new URL(`http://${host.includes(':') ? `[${host}]` : host}${NOTOUCH_PATH}`);
	target.searchParams.set('state', state);
	return c.redirect(target.toString(), 303);
});

app.get(NOTOUCH_CALLBACK_PATH, async (c) => {
	const fail = (reason: string) => {
		deleteCookie(c, LOGIN_STATE_COOKIE, { path: NOTOUCH_PATH });
		return c.redirect(`${DEFAULT_REDIRECT}?login_error=${encodeURIComponent(reason)}`, 303);
	};

	const code = c.req.query('code');
	const stateToken = c.req.query('state');
	if (!code || !stateToken) return fail('missing_parameters');

	const key = getSigningKey(c.env.AUTH_SECRET);
	const state = await verifyLoginState(stateToken, key);
	if (!state) return fail('expired');

	const nonce = getCookie(c, LOGIN_STATE_COOKIE);
	if (!nonce || nonce !== state.nonce) return fail('state_mismatch');

	const token = await c.env.TAILSCALE.getByName(state.node).redeemLoginCode(code, nonce);
	if (!token || !(await verifySession(token, key))) return fail('invalid_code');

	deleteCookie(c, LOGIN_STATE_COOKIE, { path: NOTOUCH_PATH });
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		maxAge: SESSION_TTL_SECONDS,
		path: '/',
		sameSite: 'Lax',
		secure: c.env.NODE_ENV !== 'development',
	});
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');

	return c.redirect(state.redirect, 303);
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
