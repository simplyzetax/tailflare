// External dependencies
import { Hono } from "hono";
import { html } from "hono/html";
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIGenerator } from "@orpc/openapi";
import { CORSPlugin } from '@orpc/server/plugins';
import { onError } from '@orpc/server';
import { ZodToJsonSchemaConverter } from '@orpc/zod';

// Local imports
import { Tailscale } from "./durableobjects/Tailscale";
import { router } from "./orpc/router";
import { errors } from "./utils/errors";
import { tryCatch } from "./utils/try";

// Initialize OpenAPI generator
const openAPIGenerator = new OpenAPIGenerator({
    schemaConverters: [
        new ZodToJsonSchemaConverter(),
    ],
});

// Initialize OpenAPI handler
const handler = new OpenAPIHandler(router, {
    plugins: [new CORSPlugin()],
    interceptors: [
        onError((error) => {
            console.error(error);
        }),
    ],
});

// Initialize Hono app
const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', async (c, next) => {
    const { response, matched } = await handler.handle(c.req.raw, {
        prefix: "/api/v1",
        context: {
            Bindings: c.env
        }
    });
    if (!matched) await next();
    return response;
});

app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error", message: err.message }, 500);
});

app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
});

// Documentation routes
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

// API routes
app.all("/api/v1/tailscale/proxy", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");

    const url = c.req.query("url");
    if (!url) return c.json({ error: "Missing url parameter" }, 400);

    const cleanURL = await tryCatch(async () => new URL(url));
    if (!cleanURL) return errors.badRequest.withMessage("Invalid url parameter").toResponse();

    const request = new Request(cleanURL.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
    });

    const response = await tailscale.proxy(request);
    return response;
});

// Legacy routes
app.get("/peers", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");
    const peers = await tailscale.getPeers();
    return c.json(peers);
});

// Exports
export default {
    fetch: app.fetch
} satisfies ExportedHandler<Env>;

export { Tailscale };
