<script lang="ts">
	import type { Account } from '$lib/api/types';

	/** Props */
	interface Props {
		user: Account;
		current: string;
	}

	let { user, current }: Props = $props();

	/**
	 * The navigation, by role.
	 *
	 * This is presentation, not security: the links a person sees are a convenience. A
	 * student who types a teacher's URL gets a 403 from the backend and an explanation,
	 * which is the real boundary. Duplicating the rule here as an *authorisation* check is
	 * exactly the drift the brief warns about.
	 */
	const isAdmin = $derived(user.isAdmin || user.role === 'admin');
	const isTeacher = $derived(!isAdmin && (user.isTeacher || user.role === 'teacher'));

	// The feed, the notes and the subject list are student routes: the backend answers 403
	// to anything else, so a teacher or admin is not shown a link that can only fail. The
	// old app worked the same way -- a teacher landed on a teacher view, never on a feed.
	const links = $derived.by(() => {
		if (isAdmin) return [{ href: '/admin', label: 'Admin' }];
		if (isTeacher) return [{ href: '/teacher', label: 'My classes' }];
		return [
			{ href: '/homework', label: 'Homework' },
			{ href: '/notes', label: 'Notes' }
		];
	});
</script>

<!-- Desktop sidebar. Hidden below `lg`, where the bottom bar takes over. -->
<aside
	class="hidden shrink-0 border-r border-sidebar-border bg-sidebar lg:flex
	       lg:w-[228px] lg:flex-col"
>
	<div class="flex items-center gap-2.5 px-5 py-5">
		<div
			class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg
			       border border-sidebar-border bg-card p-1"
		>
			<img src="/logo.png" alt="" class="h-full w-full object-contain" />
		</div>
		<span class="text-[15px] font-medium tracking-tight">MMSS64</span>
	</div>

	<nav class="flex flex-1 flex-col gap-0.5 px-3">
		{#each links as link (link.href)}
			<a
				href={link.href}
				aria-current={current === link.href ? 'page' : undefined}
				class="rounded-md px-3 py-2 text-[14px] transition-colors
				       {current === link.href
				           ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
				           : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}"
			>
				{link.label}
			</a>
		{/each}
	</nav>

	<div class="border-t border-sidebar-border p-3">
		<a
			href="/settings"
			class="flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent/60"
		>
			<span
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted
				       text-[11px] font-medium text-muted-foreground"
				aria-hidden="true"
			>
				{(user.displayName || user.studentId).slice(0, 2).toUpperCase()}
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[13px] font-medium text-sidebar-accent-foreground">
					{user.displayName || user.studentId}
				</span>
				<span class="block truncate text-[11px] text-sidebar-foreground/55">
					{user.section ?? user.role}
				</span>
			</span>
		</a>
	</div>
</aside>

<!--
	Mobile bar.

	Fixed to the bottom and padded for the home indicator, because a tab bar that sits under
	the gesture bar is unusable on exactly the phones a student checks homework on.
-->
<nav
	class="fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-background/95
	       pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
	style="grid-template-columns: repeat({Math.max(links.length, 3)}, 1fr);"
	aria-label="Main"
>
	{#each links as link (link.href)}
		<a
			href={link.href}
			aria-current={current === link.href ? 'page' : undefined}
			class="flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors
			       {current === link.href ? 'text-foreground' : 'text-muted-foreground'}"
		>
			<span
				class="h-1 w-1 rounded-full {current === link.href ? 'bg-foreground' : 'bg-transparent'}"
				aria-hidden="true"
			></span>
			{link.label}
		</a>
	{/each}
	<a
		href="/settings"
		aria-current={current === '/settings' ? 'page' : undefined}
		class="flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors
		       {current === '/settings' ? 'text-foreground' : 'text-muted-foreground'}"
	>
		<span
			class="h-1 w-1 rounded-full {current === '/settings' ? 'bg-foreground' : 'bg-transparent'}"
			aria-hidden="true"
		></span>
		You
	</a>
</nav>