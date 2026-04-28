import { Hono } from "hono";
import { html } from "hono/html";
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIGenerator } from "@orpc/openapi";
import { CORSPlugin } from '@orpc/server/plugins';
import { onError } from '@orpc/server';
import { ZodToJsonSchemaConverter } from '@orpc/zod';

import { Tailscale } from "./durable-objects/tailscale";
import { router } from "./orpc/router";
import { errors } from "./utils/errors";
import { tryCatch } from "./utils/try";

const openAPIGenerator = new OpenAPIGenerator({
    schemaConverters: [
        new ZodToJsonSchemaConverter(),
    ],
});

const handler = new OpenAPIHandler(router, {
    plugins: [new CORSPlugin()],
    interceptors: [
        onError((error) => {
            console.error(error);
        }),
    ],
});
export type AppContext = {
    Bindings: Env;
    Variables: { country: Iso3166Alpha2Code };
};
const app = new Hono<AppContext>()
    .use('*', async (c, next) => {
        if (!c.req.raw.cf) {
            return errors.internalServerError.toResponse();
        }

        const country = c.req.raw.cf.country as Iso3166Alpha2Code;
        if (!country) {
            return errors.internalServerError.toResponse();
        }

        c.set("country", country);
        await next();
    });

app.use('*', async (c, next) => {
    const { response, matched } = await handler.handle(c.req.raw, {
        prefix: "/api/v1",
        context: {
            Bindings: c.env,
            Variables: c.var,
        }
    });
    if (!matched) await next();
    return response;
});

app.onError((err, c) => {
    console.error(err);
    return errors.internalServerError.withMessage(err.message).toResponse();
});

app.notFound((c) => {
    return errors.notFound.toResponse();
});

app.get("/openapi.json", async (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/api/v1";
    const specFromRouter = await openAPIGenerator.generate(router, {
        info: {
            title: 'Tailflare',
            version: '0.0.0',
        },
        servers: [
            { url: url.toString() },
        ],
    });
    return c.json(specFromRouter);
});

app.get("/scalar", async (c) => {
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
            url: '/openapi.json',
            authentication: {
              securitySchemes: {
                bearerAuth: {
                  token: '',
                },
              },
            },
          })
        </script>
      </body>
    </html>
  `;

    return c.html(htmlContent);
});

app.all("/api/v1/proxy", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName(c.get("country"));

    const url = c.req.query("url");
    if (!url) return errors.badRequest.withMessage("Missing url parameter").toResponse();

    const cleanURL = await tryCatch(async () => new URL(url));
    if (!cleanURL) return errors.badRequest.withMessage("Invalid url parameter").toResponse();

    const request = new Request(cleanURL.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
    });

    return await tailscale.proxy(request);
});

export default {
    fetch: app.fetch
} satisfies ExportedHandler<Env>;

export { Tailscale };
