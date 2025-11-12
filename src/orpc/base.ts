import { os } from "@orpc/server";

export const base = os.$context<({ Bindings: Env })>();