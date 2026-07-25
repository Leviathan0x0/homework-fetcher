import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import {
  fetchHomework,
  refreshHomework,
  setHomeworkCompleted,
  setHomeworkNote,
  type HomeworkResult,
} from "../../api/endpoints";
import { queryKeys } from "../../query/keys";

/**
 * Homework server state.
 *
 * `GET /api/homework` is cheap (it serves a SQLite cache) but can transparently
 * trigger a slow school-portal scrape when the cache is stale, so it is given a
 * long `staleTime` and is never invalidated as a side effect of a mutation.
 */
export function useHomeworkQuery() {
  return useQuery({
    queryKey: queryKeys.homework,
    queryFn: fetchHomework,
    staleTime: 60_000,
  });
}

function patchItem(
  current: HomeworkResult | undefined,
  id: string,
  patch: Partial<{ completed: boolean; note: string | null }>,
): HomeworkResult | undefined {
  if (!current) return current;
  return {
    ...current,
    items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  };
}

interface OptimisticContext {
  snapshot: HomeworkResult | undefined;
}

/**
 * Marks an item complete, optimistically.
 *
 * The optimistic value is exactly what is sent, so on success there is nothing to
 * reconcile and no refetch is issued — that keeps a swipe from kicking off a
 * portal scrape. On failure the previous cache is restored wholesale.
 */
export function useToggleHomeworkComplete(): UseMutationResult<
  void,
  unknown,
  { id: string; completed: boolean },
  OptimisticContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, completed }) => setHomeworkCompleted(id, completed),
    onMutate: async ({ id, completed }) => {
      // Stop an in-flight refetch from overwriting the optimistic value.
      await queryClient.cancelQueries({ queryKey: queryKeys.homework });
      const snapshot = queryClient.getQueryData<HomeworkResult>(queryKeys.homework);
      queryClient.setQueryData<HomeworkResult>(queryKeys.homework, (current) =>
        patchItem(current, id, { completed }),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(queryKeys.homework, context.snapshot);
      }
    },
  });
}

/** Saves a note, optimistically, with rollback that restores the previous text. */
export function useSetHomeworkNote(): UseMutationResult<
  void,
  unknown,
  { id: string; note: string | null },
  OptimisticContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }) => setHomeworkNote(id, note),
    onMutate: async ({ id, note }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.homework });
      const snapshot = queryClient.getQueryData<HomeworkResult>(queryKeys.homework);
      queryClient.setQueryData<HomeworkResult>(queryKeys.homework, (current) =>
        patchItem(current, id, { note: note && note.length > 0 ? note : null }),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(queryKeys.homework, context.snapshot);
      }
    },
  });
}

/**
 * Forces a re-scrape of the school portal.
 *
 * Slow (up to ~15s) and user-initiated, so it is a mutation rather than a
 * refetch: the caller gets `isPending` to drive real progress copy instead of an
 * indeterminate pull-to-refresh spinner that looks stuck.
 */
export function useRefreshHomework(): UseMutationResult<HomeworkResult, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => refreshHomework(),
    onSuccess: (result) => {
      queryClient.setQueryData<HomeworkResult>(queryKeys.homework, result);
    },
  });
}
