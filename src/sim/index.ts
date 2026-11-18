/**
 * What an evaluation's controller imports from `@tenonai/yew/sim` (docs/sim.md): loading a world into
 * a data folder, and signing in to the `yew serve` that runs on it.
 */
export { type SimClient, signIn, signInToken } from "./client.ts";
export type * from "./types.ts";
export { loadWorld, WORLD_FORMAT } from "./world.ts";
