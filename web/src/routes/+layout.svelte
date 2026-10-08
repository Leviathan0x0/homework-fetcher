<script lang="ts">
	import AppNav from '$lib/components/AppNav.svelte';
	// The CSS has to be imported from a component. Importing it here used to live in
	// `+layout.server.ts`, which is a server-only module: the import compiled, the build
	// passed, and the browser got an unstyled page. Only a real browser finds that.
	import './layout.css';
	import '../app.css';

	/** Props */
	interface Props {
		data: {
			session: { authenticated: boolean; user: import('$lib/api/types').Account | null };
			pathname: string;
			denied: string | null;
		};
		children: import('svelte').Snippet;
	}

	let { data, children }: Props = $props();

	/** The login and setup screens are full-bleed by design and take no app chrome. */
	const bare = $derived(data.pathname === '/login' || data.pathname.startsWith('/password'));

	const denied = $derived(data.denied);

	/** The highlight for the nav, ignoring a trailing slash and any query. */
	const current = $derived(data.pathname.replace(/\/$/, '') || '/');

	let menuOpen = $state(false);

	/** Writes the choice and flips the class, so the choice survives a reload. */
	function toggleTheme() {
		const root = document.documentElement;
		const dark = !root.classList.contains('dark');
		root.classList.toggle('dark', dark);
		root.classList.toggle('light', !dark);
		try {
			localStorage.setItem('mmss-theme', dark ? 'dark' : 'light');
		} catch {
			/* Storage unavailable: the choice lasts for this page only. */
		}
		menuOpen = false;
	}
</script>

<svelte:head>
	<title>MMSS64</title>
</svelte:head>

{#if bare || !data.session.authenticated || !data.session.user}
	{@render children()}
{:else}
	<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
	                      focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm">
		Skip to content
	</a>

	<div class="flex min-h-dvh">
		<AppNav user={data.session.user} current={current} />

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Mobile header: the logo, and the two controls the bottom bar cannot hold. -->
			<header
				class="sticky top-0 z-30 flex items-center justify-between gap-3 border-b
				       border-border bg-background/90 px-4 py-3 backdrop-blur-sm lg:hidden"
			>
				<a href="/" class="flex items-center gap-2 py-2">
					<span class="text-[15px] font-medium tracking-tight">MMSS64</span>
				</a>
				<button
					type="button"
					class="flex h-10 w-10 items-center justify-center rounded-md border border-border
					       text-muted-foreground transition-colors hover:bg-accent"
					onclick={toggleTheme}
					aria-label="Switch between light and dark"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						{#if true}
							<path
								d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linejoin="round"
							/>
						{/if}
					</svg>
				</button>
			</header>

			<main id="main" class="page flex-1 pb-24 pt-6 lg:pb-16 lg:pt-10">
				{#if denied}
					<!--
						Explains a redirect the backend caused. Without it, a student who typed
						`/teacher` lands on their feed with no idea why.
					-->
					<p
						class="mb-5 rounded-lg border border-border bg-card px-4 py-3 text-[13px]
						       leading-relaxed text-muted-foreground"
						role="status"
					>
						{#if denied === 'teacher'}
							That page is for teachers. This is your homework.
						{:else if denied === 'admin'}
							That page is for administrators.
						{:else if denied === 'student'}
							Homework and notes belong to a student's account. This is your own home page.
						{:else}
							You do not have access to that page.
						{/if}
					</p>
				{/if}
				{@render children()}
			</main>
		</div>
	</div>
{/if}