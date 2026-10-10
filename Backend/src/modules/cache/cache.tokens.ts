import type { CacheService } from "./cache.service";

export const CACHE_SERVICE = Symbol("CACHE_SERVICE");
export type CacheProvider = CacheService;
