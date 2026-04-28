import { health } from "./procedures/health";
import { login } from "./procedures/tailscale/login";
import { peers } from "./procedures/tailscale/peers";
import { destroy } from "./procedures/tailscale/destroy";
import { self } from "./procedures/tailscale/self";

export const router = {
    health,
    tailscale: {
        peers,
        self,
        login,
        destroy,
    }
} as const;