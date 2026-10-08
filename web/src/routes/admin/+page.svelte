<script lang="ts">
	/** Props */
	interface Props {
		data: {
			user: import('$lib/api/types').Account;
			summary: { entries: number; classes: { id: number; name: string }[]; subjects: number };
		};
	}

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>Admin · MMSS64</title>
</svelte:head>

<header class="mb-6">
	<h1 class="display text-[1.75rem] leading-tight">Admin</h1>
	<p class="mt-1 text-[13px] text-muted-foreground">What this deployment currently holds.</p>
</header>

<div class="grid gap-3 sm:grid-cols-3">
	<div class="surface p-4">
		<p class="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">Entries</p>
		<p class="mt-1.5 text-[1.75rem] leading-none tabular-nums">{data.summary.entries}</p>
	</div>
	<div class="surface p-4">
		<p class="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">Classes</p>
		<p class="mt-1.5 text-[1.75rem] leading-none tabular-nums">{data.summary.classes.length}</p>
	</div>
	<div class="surface p-4">
		<p class="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">Subjects</p>
		<p class="mt-1.5 text-[1.75rem] leading-none tabular-nums">{data.summary.subjects}</p>
	</div>
</div>

{#if data.summary.classes.length > 0}
	<section class="mt-8">
		<h2 class="mb-3 text-[13px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
			Classes with homework
		</h2>
		<div class="flex flex-wrap gap-1.5">
			{#each data.summary.classes as option (option.id)}
				<span class="rounded-full border border-border bg-card px-3 py-1 text-[12px]">
					{option.name}
				</span>
			{/each}
		</div>
	</section>
{/if}

<!--
	Deliberately honest about what is not here.

	An admin screen that silently omitted account management would read as "this feature
	does not exist yet". Saying where the feature *is* -- and why -- is more useful than an
	empty panel.
-->
<section class="mt-10 border-t border-border pt-6">
	<h2 class="mb-2 text-[13px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
		Account management
	</h2>
	<p class="max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">
		Enrolling, deactivating and issuing first-password codes are operator commands rather
		than browser actions. That is deliberate: they run against the deployment, they are
		recorded in an audit trail, and they cannot be triggered by whoever reaches a URL.
	</p>
	<pre class="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-[12px] leading-relaxed"><code>mmss-backend accounts deactivate --roster leavers.csv --reason "left the school"
mmss-backend accounts setup-tokens --roster new-students.csv
mmss-backend accounts revoke-tokens --roster compromised.csv
mmss-backend import --roster term-start.csv</code></pre>
	<p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">
		See <code class="rounded bg-muted px-1 py-0.5 text-[11px]">ACCOUNT_LIFECYCLE.md</code>
		for the full procedure.
	</p>
</section>