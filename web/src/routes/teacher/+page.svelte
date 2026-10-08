<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import AttachmentList from '$lib/components/AttachmentList.svelte';
	import type { TeacherHomework } from '$lib/api/types';

	/** Props */
	interface Props {
		data: {
			items: TeacherHomework[];
			classes: { id: number; name: string }[];
			subjects: { id: number; name: string }[];
			editing: TeacherHomework | null;
		};
		form?: { error?: string; message?: string; id?: number; dueDate?: string; homework?: string; classwork?: string } | null;
	}

	let { data, form }: Props = $props();

	let confirmingDelete = $state<number | null>(null);

	/** Today, as `YYYY-MM-DD` in the browser's own timezone. */
	function today(): string {
		const now = new Date();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${now.getFullYear()}-${month}-${day}`;
	}

	function formatDate(iso: string): string {
		const [year, month, day] = iso.split('-').map(Number);
		if (!year || !month || !day) return iso;
		return new Date(year, month - 1, day).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>My classes · MMSS64</title>
</svelte:head>

<header class="mb-6">
	<h1 class="display text-[1.75rem] leading-tight">My classes</h1>
	<p class="mt-1 text-[13px] text-muted-foreground">
		{data.items.length} {data.items.length === 1 ? 'entry' : 'entries'} across
		{data.classes.length} {data.classes.length === 1 ? 'class' : 'classes'}
	</p>
</header>

{#if form?.error}
	<div
		class="mb-5 rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-[13px]"
		role="alert"
	>
		{form.error}
	</div>
{/if}

<!--
	The create form.

	Which classes appear here is the honest limit of what the API offers: there is no "my
	classes" endpoint, so the list is the ones this teacher has already posted to, and R5
	left class assignment as a provisioning-roster operation. The backend re-checks every one
	of these writes regardless.
-->
<section class="surface mb-8 p-4">
	<h2 class="mb-3 text-[13px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
		{data.editing ? 'Edit entry' : 'New entry'}
	</h2>

	{#if data.classes.length === 0 || data.subjects.length === 0}
		<p class="text-[13px] leading-relaxed text-muted-foreground">
			{#if data.classes.length === 0}
				You have no classes yet. An administrator assigns them through the roster, and
				this page can only list the ones you have already posted to — so there is nothing
				to post into until that happens.
			{:else}
				No subjects yet. They appear here once you have posted to one.
			{/if}
		</p>
	{:else}
		<form method="POST" action={data.editing ? '?/update' : '?/create'} class="flex flex-col gap-3">
			{#if data.editing}
				<input type="hidden" name="id" value={data.editing.id} />
			{:else}
				<label class="flex flex-col gap-1.5">
					<span class="text-[12px] font-medium text-muted-foreground">Class</span>
					<select
						name="classId"
						required
						class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
					>
						{#each data.classes as option (option.id)}
							<option value={option.id}>{option.name}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if !data.editing}
				<label class="flex flex-col gap-1.5">
					<span class="text-[12px] font-medium text-muted-foreground">Subject</span>
					<select
						name="subjectId"
						required
						class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
					>
						{#each data.subjects as option (option.id)}
							<option value={option.id}>{option.name}</option>
						{/each}
					</select>
				</label>
			{/if}

			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">Due date</span>
				<input
					type="date"
					name="dueDate"
					required
					value={form?.dueDate ?? data.editing?.dueDate ?? today()}
					class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
				/>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">Homework (optional)</span>
				<textarea
					name="homework"
					rows="3"
					maxlength="20000"
					value={form?.homework ?? data.editing?.homework ?? ''}
					placeholder="Read pages 10–20"
					class="resize-y rounded-lg border border-input bg-background px-3 py-2 text-[14px] leading-relaxed"
				></textarea>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">Classwork (optional)</span>
				<textarea
					name="classwork"
					rows="3"
					maxlength="20000"
					value={form?.classwork ?? data.editing?.classwork ?? ''}
					placeholder="Chapter 4 examples"
					class="resize-y rounded-lg border border-input bg-background px-3 py-2 text-[14px] leading-relaxed"
				></textarea>
			</label>

			<div class="flex gap-2">
				<button
					type="submit"
					class="rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
				>
					{data.editing ? 'Save changes' : 'Post homework'}
				</button>
				{#if data.editing}
					<a
						href="/teacher"
						class="rounded-md px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent"
					>
						Cancel
					</a>
				{/if}
			</div>

			<p class="text-[11px] leading-relaxed text-muted-foreground">
				Attachments are not part of this phase. R2 stores metadata only — there is no
				upload endpoint and no file storage behind it.
			</p>
		</form>
	{/if}
</section>

{#if data.items.length === 0}
	<EmptyState
		title="Nothing posted yet"
		description="Homework you post will be listed here."
		mark="○"
	/>
{:else}
	<ul class="flex flex-col gap-3">
		{#each data.items as item (item.id)}
			<li class="surface p-4">
				<header class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
						{formatDate(item.dueDate)}
					</span>
					<span class="text-[11px] text-border" aria-hidden="true">/</span>
					<span class="text-[13px] font-medium">{item.subject}</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
						{item.className}
					</span>
				</header>

				{#if item.homework}
					<p class="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
						{item.homework}
					</p>
				{/if}
				{#if item.classwork}
					<p class="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-muted-foreground">
						{item.classwork}
					</p>
				{/if}

				<AttachmentList attachments={item.attachments} />

				<footer class="mt-3 flex gap-3 border-t border-border pt-3">
					<a
						href="/teacher?edit={item.id}"
						class="-my-2 px-1 py-2 text-[13px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
					>
						Edit
					</a>

					{#if confirmingDelete === item.id}
						<span class="flex items-center gap-2 text-[13px]">
							<span class="text-muted-foreground">Delete this entry?</span>
							<form method="POST" action="?/remove" use:enhance>
								<input type="hidden" name="id" value={item.id} />
								<button
									type="submit"
									class="-my-2 py-2 font-medium text-destructive underline-offset-2 hover:underline"
								>
									Yes, delete
								</button>
							</form>
							<button
								type="button"
								class="-my-2 py-2 text-muted-foreground hover:text-foreground"
								onclick={() => (confirmingDelete = null)}
							>
								No
							</button>
						</span>
					{:else}
						<button
							type="button"
							class="-my-2 py-2 text-[13px] text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline"
							onclick={() => (confirmingDelete = item.id)}
						>
							Delete
						</button>
					{/if}
				</footer>
			</li>
		{/each}
	</ul>
{/if}