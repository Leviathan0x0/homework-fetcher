<script lang="ts">
	import { ApiError } from '$lib/api';

	/** Props */
	interface Props {
		/** The failure to describe. */
		error: unknown;
		/** A `Retry` button, when retrying could plausibly help. */
		onRetry?: () => void;
	}

	let { error: failure, onRetry }: Props = $props();

	/**
	 * What to say, by status.
	 *
	 * The backend's own message is used for 400s because it is written to be read -- it
	 * names the field that was wrong. Everything else gets a sentence written for the
	 * status, because the backend's text for a 500 is deliberately flat ("internal server
	 * error") and showing that to a student helps nobody.
	 */
	const heading = $derived.by(() => {
		if (!(failure instanceof ApiError)) return 'Something went wrong';
		if (failure.isUnauthenticated) return 'Your session has ended';
		if (failure.isForbidden) return 'You do not have access to this';
		if (failure.isNotFound) return 'Not found';
		if (failure.isServerError) return 'The server had a problem';
		return 'That request could not be completed';
	});

	const detail = $derived.by(() => {
		if (!(failure instanceof ApiError)) {
			return failure instanceof Error && failure.message
				? failure.message
				: 'An unexpected error occurred.';
		}
		// A 400 is safe and useful to show verbatim. Everything else is described above.
		if (failure.isBadRequest) return failure.message;
		if (failure.isUnauthenticated) return 'Please sign in again to continue.';
		if (failure.isForbidden) return 'Ask the office if you think this is wrong.';
		if (failure.isNotFound) return 'It may have been removed.';
		if (failure.isServerError) return 'Please try again in a moment.';
		return failure.message;
	});
</script>

<div
	class="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3"
	role="alert"
>
	<span class="mt-0.5 shrink-0 text-destructive" aria-hidden="true">!</span>
	<div class="min-w-0 flex-1">
		<p class="text-sm font-medium text-foreground">{heading}</p>
		<p class="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{detail}</p>
	</div>
	{#if onRetry}
		<button
			type="button"
			class="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium
			       text-foreground transition-colors hover:bg-accent"
			onclick={onRetry}
		>
			Retry
		</button>
	{/if}
</div>