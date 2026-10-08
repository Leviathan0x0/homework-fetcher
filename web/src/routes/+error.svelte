<script lang="ts">
	import { page } from '$app/state';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
</script>

<svelte:head>
	<title>{page.status} · MMSS64</title>
</svelte:head>

<div class="page flex min-h-dvh flex-col justify-center py-16">
	<h1 class="display mb-2 text-[2rem]">{page.status}</h1>
	<p class="mb-6 max-w-[42ch] text-[15px] leading-relaxed text-muted-foreground">
		{page.status === 404
			? 'That page does not exist.'
			: page.status === 403
				? 'You do not have access to that.'
				: page.error?.message || 'Something went wrong.'}
	</p>
	<a
		href="/"
		class="inline-flex w-fit rounded-md border border-border bg-card px-3.5 py-2 text-[14px] transition-colors hover:bg-accent"
	>
		Back to your homework
	</a>
</div>
