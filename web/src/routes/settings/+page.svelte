<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Account } from '$lib/api/types';

	/** Props */
	interface Props {
		data: { user: Account };
		form?: { section?: string; error?: string; saved?: string } | null;
	}

	let { data, form }: Props = $props();

	/**
	 * Three sections, one column.
	 *
	 * The old app had a sidebar, a modal and a separate settings page for what is really
	 * three short forms. One page is calmer and is what the content needs.
	 */
	const sections = [
		{ id: 'profile', label: 'Your details' },
		{ id: 'password', label: 'Password' },
		{ id: 'session', label: 'Session' }
	] as const;

	type SectionId = (typeof sections)[number]['id'];
	let active = $state<SectionId>('profile');

	/** The backend answers on the section that was submitted, so a failure is shown there. */
	$effect(() => {
		if (form?.section === 'profile' || form?.section === 'password') {
			active = form.section;
		}
	});

	/** Whether a form message belongs to the section currently on screen. */
	function isFor(section: SectionId): boolean {
		return form?.section === section;
	}
</script>

<svelte:head>
	<title>Settings · MMSS64</title>
</svelte:head>

<header class="mb-6">
	<h1 class="display text-[1.75rem] leading-tight">Settings</h1>
</header>

<div class="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="Settings sections">
	{#each sections as section (section.id)}
		<button
			type="button"
			role="tab"
			aria-selected={active === section.id}
			class="-mb-px border-b-2 px-3 py-3 text-[13px] transition-colors
			       {active === section.id
			           ? 'border-foreground font-medium text-foreground'
			           : 'border-transparent text-muted-foreground hover:text-foreground'}"
			onclick={() => (active = section.id)}
		>
			{section.label}
		</button>
	{/each}
</div>

<!-- ------------------------------------------------------------------ profile -->
{#if active === 'profile'}
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-[14px] font-medium">Your name</h2>
			<p class="mt-1 max-w-[54ch] text-[13px] leading-relaxed text-muted-foreground">
				This is the name other people see next to your work. Your school ID never changes.
			</p>
		</div>

		{#if isFor('profile') && form?.error}
			<p class="text-[13px] text-destructive" role="alert">{form.error}</p>
		{:else if form?.saved === 'profile'}
			<p class="text-[13px] text-success" role="status">Saved.</p>
		{/if}

		<form method="POST" action="?/profile" use:enhance class="flex max-w-sm flex-col gap-3">
			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">School ID</span>
				<input
					type="text"
					value={data.user.studentId}
					disabled
					class="cursor-not-allowed rounded-lg border border-input bg-muted/50 px-3 py-2
					       text-[14px] text-muted-foreground"
				/>
				<span class="text-[11px] text-muted-foreground">
					Issued by the school. Managed through the roster, not here.
				</span>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">Display name</span>
				<input
					type="text"
					name="displayName"
					value={data.user.displayName ?? ''}
					maxlength="200"
					required
					placeholder="How your name appears"
					class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
				/>
			</label>

			<div>
				<button
					type="submit"
					class="rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground
					       transition-opacity hover:opacity-90"
				>
					Save
				</button>
			</div>
		</form>
	</section>
{/if}

<!-- ----------------------------------------------------------------- password -->
{#if active === 'password'}
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-[14px] font-medium">Change your password</h2>
			<p class="mt-1 max-w-[54ch] text-[13px] leading-relaxed text-muted-foreground">
				Changing this signs out every other device — phone, laptop, a browser you forgot
				about. This one stays signed in.
			</p>
		</div>

		{#if isFor('password') && form?.error}
			<p class="text-[13px] text-destructive" role="alert">{form.error}</p>
		{:else if form?.saved === 'password'}
			<p class="text-[13px] text-success" role="status">Password changed.</p>
		{/if}

		<form method="POST" action="?/password" use:enhance class="flex max-w-sm flex-col gap-3">
			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">Current password</span>
				<input
					type="password"
					name="currentPassword"
					autocomplete="current-password"
					required
					class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
				/>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">New password</span>
				<input
					type="password"
					name="newPassword"
					autocomplete="new-password"
					required
					minlength="8"
					class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
				/>
				<span class="text-[11px] text-muted-foreground">At least 8 characters.</span>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-[12px] font-medium text-muted-foreground">New password, again</span>
				<input
					type="password"
					name="confirmPassword"
					autocomplete="new-password"
					required
					minlength="8"
					class="rounded-lg border border-input bg-background px-3 py-2 text-[14px]"
				/>
			</label>

			<div>
				<button
					type="submit"
					class="rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground
					       transition-opacity hover:opacity-90"
				>
					Change password
				</button>
			</div>
		</form>
	</section>
{/if}

<!-- ----------------------------------------------------------------- session -->
{#if active === 'session'}
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-[14px] font-medium">Signed in as</h2>
			<dl class="mt-3 flex max-w-sm flex-col gap-2 text-[13px]">
				<div class="flex justify-between gap-4 border-b border-border pb-2">
					<dt class="text-muted-foreground">Name</dt>
					<dd class="font-medium">{data.user.displayName || data.user.studentId}</dd>
				</div>
				<div class="flex justify-between gap-4 border-b border-border pb-2">
					<dt class="text-muted-foreground">School ID</dt>
					<dd class="tabular-nums">{data.user.studentId}</dd>
				</div>
				<div class="flex justify-between gap-4 border-b border-border pb-2">
					<dt class="text-muted-foreground">Class</dt>
					<dd>{data.user.section ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-4 border-b border-border pb-2">
					<dt class="text-muted-foreground">Role</dt>
					<dd class="capitalize">{data.user.role}</dd>
				</div>
			</dl>
		</div>

		<form method="POST" action="?/signOut" use:enhance class="w-fit">
			<button
				type="submit"
				class="rounded-md border border-border bg-card px-3.5 py-2 text-[13px] font-medium
				       transition-colors hover:bg-accent"
			>
				Sign out
			</button>
		</form>
	</section>
{/if}