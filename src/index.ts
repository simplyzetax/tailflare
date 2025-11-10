import { Hono } from "hono";
import { Tailscale } from "./durableobjects/Tailscale";

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
    const cleanURL = new URL(url);

    const request = new Request(cleanURL.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
    });

    const response = await tailscale.proxy(request);
    if (!response) return c.json({ error: "Failed to proxy request. Please check if you are logged in and if the host you are trying to access is reachable." }, 500);

    return response;
});

app.get("/ready", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");
    const ready = await tailscale.isReady;
    return c.json({ ready });
});

app.get("/warm", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");
    await tailscale.warm();
    return c.json({ message: "Warmed up" });
});

export default {
    fetch: app.fetch
} satisfies ExportedHandler<Env>;
export { Tailscale };