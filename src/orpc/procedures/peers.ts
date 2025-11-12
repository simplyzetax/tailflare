import { base } from "../base";

export const peers = base
    .route({ method: "GET", path: "/peers" })
    .handler(async ({ context }): Promise<IPNNetMapPeerNode[]> => {
        const tailscale = context.Bindings.TAILSCALE.getByName("singleton");
        return await tailscale.getPeers();
    });