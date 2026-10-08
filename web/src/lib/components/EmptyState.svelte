<script lang="ts">
	/** Props */
	interface Props {
		/** A title that explains why there is nothing here. */
		title: string;
		/** One sentence of context. Optional, and omitted rather than padded. */
		description?: string;
		/** A short decorative mark. Keep it abstract -- not a mascot. */
		mark?: string;
		children?: import('svelte').Snippet;
	}

	let { title, description, mark = '·', children }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center px-6 py-16 text-center">
	<div
		class="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/60 text-lg text-muted-foreground"
		aria-hidden="true"
	>
		{mark}
	</div>
	<p class="text-[15px] font-medium text-foreground">{title}</p>
	{#if description}
		<p class="mt-1.5 max-w-[38ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
	{/if}
	{#if children}
		<div class="mt-5">{@render children()}</div>
	{/if}
</div>