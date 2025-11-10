import { Hono } from "hono";
import { Tailscale } from "./durableobjects/Tailscale";

const app = new Hono<{ Bindings: Env }>();

app.get("/login", async (c) => {
    const tailscaleDo = c.env.TAILSCALE.getByName("singleton");
    const url = await tailscaleDo.login();
    return c.redirect(url.toString());
});

app.get("/proxy", async (c) => {
    const tailscaleDo = c.env.TAILSCALE.getByName("singleton");
    const url = c.req.query("url");
    if (!url) return c.json({ error: "Missing url parameter" }, 400);
    const result = await tailscaleDo.proxy(url!);
    if (!result) return c.json({ error: "Tailscale login required. Visit /login." }, 403);
    return c.text(result);
});

export default {
    fetch: app.fetch
} satisfies ExportedHandler<Env>;
export { Tailscale };