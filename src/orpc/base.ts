import { os } from "@orpc/server";
import type { AppContext } from "../index";
import { ResponseHeadersPluginContext } from "@orpc/server/plugins";

interface ORPCContext extends ResponseHeadersPluginContext {
    base: AppContext;
}

export const base = os.$context<ORPCContext>();