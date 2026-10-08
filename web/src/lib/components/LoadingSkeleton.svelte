<script lang="ts">
	/** Props */
	interface Props {
		/** How many card-shaped placeholders to draw. */
		count?: number;
	}

	let { count = 3 }: Props = $props();
</script>

<!--
	A skeleton that is shaped like the thing it replaces.

	A centred spinner was the old app's loading state, and it was wrong in a specific way: a
	student opening the app saw nothing at all until the feed arrived, then everything at
	once. Drawing the cards' own silhouette means the layout does not jump when they do.
-->
<div class="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
	{#each Array.from({ length: count }) as _, index (index)}
		<div class="animate-pulse rounded-xl border border-border bg-card p-4">
			<div class="mb-3 flex items-center gap-2">
				<div class="h-3 w-16 rounded-full bg-muted"></div>
				<div class="h-3 w-10 rounded-full bg-muted/60"></div>
			</div>
			<div class="space-y-2">
				<div class="h-3 rounded-full bg-muted" style="width: {92 - index * 7}%"></div>
				<div class="h-3 rounded-full bg-muted/70" style="width: {64 - index * 5}%"></div>
			</div>
		</div>
	{/each}
</div>