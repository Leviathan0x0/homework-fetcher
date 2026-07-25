import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

/**
 * Read-through cache persistence.
 *
 * Only the three read-mostly lists named in the offline requirement are written
 * to disk. Everything else (messages, search, notifications, the unread badge)
 * stays in memory: stale message threads shown as if current would be worse than
 * showing nothing, and the badge would be wrong on launch.
 *
 * Nothing here is a write queue. Mutations are never persisted — an unsent
 * message must fail visibly rather than sit in a silent queue.
 */
const PERSISTED_ROOTS = new Set<string>(["homework", "classwork", "conversations"]);

/** Bump the version when a cached shape changes so stale entries are dropped. */
const CACHE_KEY = "homework.query-cache.v1";

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: 1000,
});

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister,
  // A week-old homework list is still useful context offline; older than that and
  // it is more misleading than helpful.
  maxAge: 1000 * 60 * 60 * 24 * 7,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      if (query.state.status !== "success") return false;
      const root = query.queryKey[0];
      return typeof root === "string" && PERSISTED_ROOTS.has(root);
    },
  },
};
