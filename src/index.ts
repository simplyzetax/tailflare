import { Hono } from "hono";
import { Tailscale } from "./durableobjects/Tailscale";
import { errors } from "./utils/errors";
import { tryCatch } from "./utils/try";

const app = new Hono<{ Bindings: Env }>();

app.get("/login", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");
    const url = await tailscale.login();
    return c.redirect(url.toString());
});

app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error", message: err.message }, 500);
});

app.get("/proxy", async (c) => {
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
    if (!response) return errors.tailscale.notAuthenticated.toResponse();

    return response;
});

app.get("/peers", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");
    const peers = await tailscale.getPeers();
    return c.json(peers);
});

export default {
    fetch: app.fetch
} satisfies ExportedHandler<Env>;
export { Tailscale };