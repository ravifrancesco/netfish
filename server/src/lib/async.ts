/** Map with bounded concurrency — the Pi and its services prefer a gentle pace. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Resolve to a fallback instead of throwing; for optional bits of a page. */
export async function settle<T>(promise: Promise<T>, fallback: T, onError?: (err: unknown) => void): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    onError?.(err);
    return fallback;
  }
}
