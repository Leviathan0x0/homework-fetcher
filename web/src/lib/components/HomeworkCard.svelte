<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import AttachmentList from './AttachmentList.svelte';
	import type { FeedRow } from '$lib/api/feed';
	import type { SubmitFunction } from '@sveltejs/kit';

	/** Props */
	interface Props {
		row: FeedRow;
		/** Whether completion and notes are editable here. Teachers have no per-student state. */
		interactive?: boolean;
	}

	let { row, interactive = true }: Props = $props();

	let editingNote = $state(false);
	// Seeded when the editor opens rather than from `row`, so a background revalidation
	// cannot overwrite something half-typed -- the old app clobbered in-progress note edits
	// whenever the feed refetched.
	let noteDraft = $state('');
	let savingNote = $state(false);
	let savedNote = $state(false);

	/** Refresh from the server once a write settles, so a refusal snaps back. */
	const afterWrite: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			await invalidateAll();
		};
	};

	function openNoteEditor() {
		noteDraft = row.note ?? '';
		editingNote = true;
	}
</script>

<article
	class="rounded-xl border bg-card p-4 {row.completed ? 'border-border/70 opacity-70' : 'border-border'}"
>
	<header class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
		<span class="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
			{row.displayDate}
		</span>
		<span class="text-[11px] text-border" aria-hidden="true">/</span>
		<span class="text-[13px] font-medium text-foreground/85">{row.subject}</span>
	</header>

	<!--
		The body.

		`row.body` is already homework-if-present-else-classwork, which is what R10's fix
		turned from "a blank card for a classwork-only entry" into the teacher's own text.
	-->
	<p
		class="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground
		       {row.completed ? 'line-through decoration-border' : ''}"
	>
		{row.body}
	</p>

	<!-- Both halves, when an entry has both, so neither hides behind the other. -->
	{#if row.homework && row.classwork}
		<details class="group mt-3">
			<summary
				class="inline-flex cursor-pointer list-none items-center gap-1.5 py-1.5 text-[12px] text-muted-foreground
				       transition-colors hover:text-foreground"
			>
				<span class="transition-transform group-open:rotate-90" aria-hidden="true">›</span>
				Show both parts
			</summary>
			<div class="mt-2 space-y-2 border-l-2 border-border pl-3">
				<div>
					<p class="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
						Homework
					</p>
					<p class="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{row.homework}</p>
				</div>
				<div>
					<p class="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
						Classwork
					</p>
					<p class="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{row.classwork}</p>
				</div>
			</div>
		</details>
	{/if}

	{#if row.author?.displayName}
		<p class="mt-3 text-[12px] text-muted-foreground">— {row.author.displayName}</p>
	{/if}

	<AttachmentList attachments={row.attachments} />

	{#if interactive}
		<footer class="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
			<!--
				A real form, enhanced rather than replaced.

				The completion checkbox therefore works with JavaScript disabled, which is not
				paranoia: a school's wifi drops, and a student on mobile data should still be
				able to tick something off.
			-->
			<form method="POST" action="?/toggle" use:enhance={afterWrite}>
				<input type="hidden" name="id" value={row.id} />
				<input type="hidden" name="completed" value={row.completed ? 'false' : 'true'} />
				<label class="inline-flex items-center gap-2 py-2 text-[13px] text-muted-foreground select-none">
					<input
						type="checkbox"
						class="h-4 w-4 rounded border-border accent-foreground"
						checked={row.completed}
						onchange={(event) => event.currentTarget.form?.requestSubmit()}
					/>
					<span class={row.completed ? 'text-foreground' : ''}>
						{row.completed ? 'Done' : 'Mark done'}
					</span>
				</label>
			</form>

			<button
				type="button"
				class="py-2 text-[13px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
				onclick={() => (editingNote ? (editingNote = false) : openNoteEditor())}
			>
				{row.note ? 'Edit note' : 'Add note'}
			</button>

			{#if savedNote}
				<span class="animate-[fade-in_180ms_ease-out] text-[12px] text-success">Saved</span>
			{/if}
		</footer>

		{#if editingNote}
			<form
				method="POST"
				action="?/note"
				class="mt-3 flex animate-[rise_220ms_cubic-bezier(0.22,1,0.36,1)] flex-col gap-2"
				use:enhance={() =>
					async ({ update }) => {
						savingNote = true;
						await update({ reset: false });
						savingNote = false;
						editingNote = false;
						savedNote = true;
						setTimeout(() => (savedNote = false), 1600);
						await invalidateAll();
					}}
			>
				<input type="hidden" name="id" value={row.id} />
				<textarea
					name="note"
					class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-[14px]
					       leading-relaxed placeholder:text-muted-foreground/70"
					rows="3"
					maxlength="4000"
					placeholder="A reminder to yourself"
					bind:value={noteDraft}
				></textarea>
				<div class="flex gap-2">
					<button
						type="submit"
						disabled={savingNote}
						class="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground
						       transition-opacity hover:opacity-90 disabled:opacity-60"
					>
						{savingNote ? 'Saving…' : 'Save'}
					</button>
					<button
						type="button"
						class="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
						onclick={() => (editingNote = false)}
					>
						Cancel
					</button>
				</div>
			</form>
		{:else if row.note}
			<p
				class="mt-3 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-[13px] text-muted-foreground"
			>
				{row.note}
			</p>
		{/if}
	{/if}
</article>