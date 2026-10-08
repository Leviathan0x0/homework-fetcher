<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { Note } from '$lib/api/types';

	/** Props */
	interface Props {
		data: { notes: Note[] };
		form?: { error?: string } | null;
	}

	let { data, form }: Props = $props();

	/** `2 Oct 2026`, from epoch milliseconds. */
	function when(epochMs: number): string {
		return new Date(epochMs).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Notes · MMSS64</title>
</svelte:head>

<header class="mb-6">
	<h1 class="display text-[1.75rem] leading-tight">Notes</h1>
	<p class="mt-1 text-[13px] text-muted-foreground">
		Everything you have written down, newest first.
	</p>
</header>

{#if form?.error}
	<p class="mb-4 text-[13px] text-destructive" role="alert">{form.error}</p>
{/if}

{#if data.notes.length === 0}
	<EmptyState
		title="No notes yet"
		description="Add a note to any homework entry and it will show up here."
		mark="✎"
	/>
{:else}
	<ul class="flex flex-col gap-2.5">
		{#each data.notes as note (note.id)}
			<li class="surface group p-4">
				<div class="flex items-start justify-between gap-3">
					<p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed">
						{note.body}
					</p>
					<form method="POST" action="?/remove" use:enhance>
						<input type="hidden" name="id" value={note.id} />
						<button
							type="submit"
							class="-my-2 shrink-0 rounded-md px-2 py-2 text-[12px] text-muted-foreground
							       transition-colors hover:bg-accent hover:text-destructive"
							aria-label="Delete this note"
						>
							Delete
						</button>
					</form>
				</div>
				<p class="mt-2 text-[11px] text-muted-foreground">
					{when(note.createdAt)}{#if note.homeworkId} · on a homework entry{/if}
				</p>
			</li>
		{/each}
	</ul>
{/if}