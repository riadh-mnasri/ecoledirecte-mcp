import type { ResultCache } from "../domain/ports.js";

export interface ResilientResult<T> {
  data: T;
  stale: boolean;
  savedAt?: string;
  liveError?: string;
}

export async function resilientFetch<T>(
  cache: ResultCache,
  key: string,
  fetchLive: () => Promise<T>,
): Promise<ResilientResult<T>> {
  try {
    const data = await fetchLive();
    cache.write(key, data);
    return { data, stale: false };
  } catch (error) {
    const cached = cache.read<T>(key);
    if (!cached) throw error;
    return {
      data: cached.data,
      stale: true,
      savedAt: cached.savedAt,
      liveError: error instanceof Error ? error.message : String(error),
    };
  }
}
