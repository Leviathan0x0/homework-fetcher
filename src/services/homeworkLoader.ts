export interface HomeworkLoadResult<T> {
  items: T[];
  schoolSessionExpired: boolean;
  isStale: boolean;
}

export function getHomeworkRequest(forceRefresh = false): {
  path: string;
  options: RequestInit;
} {
  return forceRefresh
    ? {
        path: "/api/homework/refresh",
        options: {
          method: "POST",
          headers: { Accept: "application/json" },
        },
      }
    : {
        path: "/api/homework",
        options: { headers: { Accept: "application/json" } },
      };
}

/**
 * Loads the fast cached response first, then waits for fresh school data when
 * the server says that cache is stale. The stale callback lets the dashboard
 * paint useful cached rows while the second request is still in flight.
 */
export async function loadHomeworkWithRevalidation<T>(
  load: (forceRefresh: boolean) => Promise<HomeworkLoadResult<T>>,
  forceRefresh = false,
  onStale?: (result: HomeworkLoadResult<T>) => void,
): Promise<HomeworkLoadResult<T>> {
  const result = await load(forceRefresh);

  if (forceRefresh || !result.isStale || result.schoolSessionExpired) {
    return result;
  }

  onStale?.(result);
  return load(true);
}
