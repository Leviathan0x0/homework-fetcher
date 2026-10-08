<script lang="ts">
	import { enhance } from '$app/forms';

	/** Props */
	interface Props {
		/** The message the backend sent, verbatim. */
		form?: { studentId?: string; error?: string } | null;
	}

	let { form }: Props = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Sign in · MMSS64</title>
</svelte:head>

<!--
	The one screen that is deliberately not neutral.

	Carried over from the old login page because it is the strongest thing in the existing
	app: full-bleed school artwork, a warm serif heading, and a form that stays quiet. The
	palette and the layout are preserved; only the implementation is new.
-->
<div class="relative h-dvh w-dvw overflow-hidden bg-[#0b0b0c] text-[#f5f2eb]">
	<div class="absolute inset-0" aria-hidden="true">
		{#if false}
			<!-- Placeholder: drop `login-hero.jpg` into `static/` to enable. The overlay alone
			     reads well without it, so the screen is not broken by its absence. -->
		{/if}
		<img src="/login-hero.jpg" alt="" class="h-full w-full object-cover" onerror={(e) => e.currentTarget.remove()} />
		<div class="absolute inset-0 bg-[#08080a]/55"></div>
		<div
			class="absolute inset-0 bg-gradient-to-r from-[#09090b]/95 via-[#09090b]/85 to-[#09090b]/40
			       md:via-[#09090b]/70 md:to-[#09090b]/10"
		></div>
		<div class="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#09090b]/55 to-transparent"></div>
	</div>

	<div class="relative z-10 flex h-full w-full items-center justify-center overflow-y-auto px-6 py-10">
		<div class="w-full max-w-[410px]">
			<div class="mb-8">
				<div class="mb-6 flex items-center gap-3">
					<div
						class="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl
						       border border-white/20 bg-white p-1 shadow-sm"
					>
						<img src="/logo.png" alt="" class="h-full w-full object-contain" />
					</div>
					<p class="text-sm font-medium text-[#f5f2eb]/80">MMSS Mohali</p>
				</div>

				<h1 class="display text-[2.5rem] leading-[1.04] text-[#f8f5ee] sm:text-[2.8rem]">
					Sign in
				</h1>
				<p class="mt-3.5 max-w-[36ch] text-[15px] leading-relaxed text-[#f5f2eb]/70">
					Enter your school ID and password to see your homework.
				</p>
			</div>

			{#if form?.error}
				<div
					class="mb-5 flex items-start gap-3 rounded-xl border border-rose-300/30 bg-rose-950/75
					       px-4 py-3 text-sm text-rose-100"
					role="alert"
				>
					<span class="mt-0.5 shrink-0 text-rose-300" aria-hidden="true">!</span>
					<p class="flex-1 leading-relaxed">{form.error}</p>
				</div>
			{/if}

			<form method="POST" class="space-y-5" use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					// `reset` would clear the ID on a failed attempt, which is the one field
					// the person most likely got right and least likely wants to retype.
					await update({ reset: false });
					submitting = false;
				};
			}}>
				<div class="space-y-2">
					<label for="studentId" class="block text-sm font-medium text-[#f5f2eb]/80">
						School ID
					</label>
					<input
						id="studentId"
						name="studentId"
						type="text"
						autocomplete="username"
						required
						value={form?.studentId ?? ''}
						placeholder="e.g. 2026001"
						class="w-full rounded-lg border border-white/15 bg-black/25 px-3.5 py-2.5
						       text-[15px] text-[#f5f2eb] placeholder:text-[#f5f2eb]/30
						       transition-colors focus:border-white/35 focus:outline-none"
					/>
				</div>

				<div class="space-y-2">
					<label for="password" class="block text-sm font-medium text-[#f5f2eb]/80">
						Password
					</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
						class="w-full rounded-lg border border-white/15 bg-black/25 px-3.5 py-2.5
						       text-[15px] text-[#f5f2eb] transition-colors
						       focus:border-white/35 focus:outline-none"
					/>
				</div>

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-lg bg-[#f5f2eb] px-4 py-2.5 text-[15px] font-medium
					       text-[#09090b] transition-opacity hover:opacity-90
					       disabled:cursor-not-allowed disabled:opacity-60"
				>
					{submitting ? 'Signing in…' : 'Sign in'}
				</button>
			</form>

			<p class="mt-8 text-[12px] leading-relaxed text-[#f5f2eb]/45">
				New student? Ask the office for your setup link.
			</p>
		</div>
	</div>
</div>