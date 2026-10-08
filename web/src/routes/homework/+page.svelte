<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import HomeworkCard from '$lib/components/HomeworkCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { filterRows, subjectsOf, type FeedRow } from '$lib/api/feed';
	import type { Account } from '$lib/api/types';

	/** Props */
	interface Props {
		data: {
			user: Account;
			rows: FeedRow[];
			subjects: { id: number; name: string }[];
			totalCount: number;
		};
		form?: { error?: string } | null;
	}

	let { data, form }: Props = $props();

	let query = $state('');
	let subject = $state<string | null>(null);

	/**
	 * Filtering runs on the rows already in memory rather than as a server round trip.
	 *
	 * The old app re-requested the whole feed on every keystroke. For a list a school-wide
	 * feed holds -- tens of entries -- that is a request per character typed, which is why
	 * search there felt laggy rather than instant.
	 */
	const visible = $derived(filterRows(data.rows, { query, subject }));
	const availableSubjects = $derived(subjectsOf(data.rows));
	const doneCount = $derived(data.rows.filter((row) => row.completed).length);

	function clearFilters() {
		query = '';
		subject = null;
	}
</script>

<svelte:head>
	<title>Homework · MMSS64</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
	<h1 class="display text-[1.75rem] leading-tight">Homework</h1>
	<p class="text-[13px] text-muted-foreground">
		{#if data.user.section}{data.user.section} ·{/if}
		<span class="tabular-nums">{doneCount} of {data.totalCount} done</span>
	</p>
</header>

{#if form?.error}
	<div class="mb-4"><ErrorBanner error={new Error(form.error)} /></div>
{/if}

<div class="mb-5 flex flex-col gap-3">
	<input
		type="search"
		class="app-search-input w-full rounded-lg border border-input bg-card px-3.5 py-2.5
		       text-[14px] placeholder:text-muted-foreground/70"
		placeholder="Search homework"
		aria-label="Search homework"
		bind:value={query}
	/>

	{#if availableSubjects.length > 1}
		<div
			class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
			role="group"
			aria-label="Filter by subject"
		>
			<button
				type="button"
				aria-pressed={subject === null}
				class="shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors
				       {subject === null
				           ? 'border-foreground bg-primary text-primary-foreground'
				           : 'border-border bg-card text-muted-foreground hover:bg-accent'}"
				onclick={() => (subject = null)}
			>
				All
			</button>
			{#each availableSubjects as name (name)}
				<button
					type="button"
					aria-pressed={subject === name}
					class="shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors
					       {subject === name
					           ? 'border-foreground bg-primary text-primary-foreground'
					           : 'border-border bg-card text-muted-foreground hover:bg-accent'}"
					onclick={() => (subject = subject === name ? null : name)}
				>
					{name}
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if visible.length === 0}
	{#if data.rows.length === 0}
		<EmptyState
			title="Nothing here yet"
			description="When a teacher posts homework for your section, it will appear here."
			mark="○"
		/>
	{:else}
		<EmptyState title="Nothing matches" description="Try a different search." mark="○">
			<button
				type="button"
				class="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] transition-colors hover:bg-accent"
				onclick={clearFilters}
			>
				Clear filters
			</button>
		</EmptyState>
	{/if}
{:else}
	<div class="flex flex-col gap-3">
		{#each visible as row (row.id)}
			<HomeworkCard {row} />
		{/each}
	</div>
{/if}