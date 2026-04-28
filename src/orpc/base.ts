import { os } from "@orpc/server";
import { AppContext } from "../index";

export const base = os.$context<AppContext>();