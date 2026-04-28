import { base } from "../../base";

export const peers = base
    .route({ method: "GET", path: "/peers" })
    .handler(async ({ context }): Promise<IPNNetMapPeerNode[]> => {
        const tailscale = context.base.Bindings.TAILSCALE.getByName(context.base.Variables.country);
        return await tailscale.getPeers();
    });