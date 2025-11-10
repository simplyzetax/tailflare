import { Hono } from "hono";
import { Tailscale } from "./durableobjects/Tailscale";

const app = new Hono<{ Bindings: Env }>();

app.get("/login", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");
    const url = await tailscale.login();
    return c.redirect(url.toString());
});

app.get("/proxy", async (c) => {
    const tailscale = c.env.TAILSCALE.getByName("singleton");

    const url = c.req.query("url");
    if (!url) return c.json({ error: "Missing url parameter" }, 400);

    return await tailscale.proxy(url);
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