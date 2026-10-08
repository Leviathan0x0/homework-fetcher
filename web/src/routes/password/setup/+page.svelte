<script lang="ts">
	import { enhance } from '$app/forms';

	/** Props */
	interface Props {
		data: { token: string };
		form?: { error?: string } | null;
	}

	let { data, form }: Props = $props();
</script>

<svelte:head>
	<title>Set your password · MMSS64</title>
</svelte:head>

<!--
	The same quiet, dark treatment as the sign-in screen.

	Consistency matters here more than usual: this is the first screen a brand-new student
	ever sees, and it should feel like the same place as the one they will come back to.
-->
<div class="relative flex min-h-dvh w-full items-center justify-center bg-[#0b0b0c] px-6 py-10 text-[#f5f2eb]">
	<div class="absolute inset-0" aria-hidden="true">
		<div class="absolute inset-0 bg-[#08080a]/70"></div>
		<div
			class="absolute inset-0 bg-gradient-to-b from-[#09090b]/60 via-[#09090b]/85 to-[#09090b]"
		></div>
	</div>

	<div class="relative z-10 w-full max-w-[410px]">
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

			<h1 class="display text-[2.1rem] leading-[1.08] text-[#f8f5ee]">Set your password</h1>
			<p class="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-[#f5f2eb]/70">
				Choose a password only you know. You will use your school ID to sign in with it.
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

		<form method="POST" use:enhance class="space-y-5">
			<div class="space-y-2">
				<label for="token" class="block text-sm font-medium text-[#f5f2eb]/80">
					Setup code
				</label>
				<input
					id="token"
					name="token"
					type="text"
					required
					value={data.token}
					autocomplete="one-time-code"
					spellcheck="false"
					placeholder="Paste the code from the office"
					class="w-full rounded-lg border border-white/15 bg-black/25 px-3.5 py-2.5 font-mono
					       text-[14px] text-[#f5f2eb] placeholder:font-sans placeholder:text-[#f5f2eb]/30
					       transition-colors focus:border-white/35 focus:outline-none"
				/>
			</div>

			<div class="space-y-2">
				<label for="newPassword" class="block text-sm font-medium text-[#f5f2eb]/80">
					New password
				</label>
				<input
					id="newPassword"
					name="newPassword"
					type="password"
					required
					minlength="8"
					autocomplete="new-password"
					class="w-full rounded-lg border border-white/15 bg-black/25 px-3.5 py-2.5
					       text-[15px] text-[#f5f2eb] transition-colors focus:border-white/35 focus:outline-none"
				/>
				<p class="text-[12px] text-[#f5f2eb]/45">At least 8 characters.</p>
			</div>

			<div class="space-y-2">
				<label for="confirmPassword" class="block text-sm font-medium text-[#f5f2eb]/80">
					New password, again
				</label>
				<input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					required
					minlength="8"
					autocomplete="new-password"
					class="w-full rounded-lg border border-white/15 bg-black/25 px-3.5 py-2.5
					       text-[15px] text-[#f5f2eb] transition-colors focus:border-white/35 focus:outline-none"
				/>
			</div>

			<button
				type="submit"
				class="w-full rounded-lg bg-[#f5f2eb] px-4 py-2.5 text-[15px] font-medium text-[#09090b]
				       transition-opacity hover:opacity-90"
			>
				Set password and continue
			</button>
		</form>

		<p class="mt-8 text-[12px] leading-relaxed text-[#f5f2eb]/45">
			Already set one?
			<a href="/login" class="underline underline-offset-2 hover:text-[#f5f2eb]/75">Sign in instead</a>.
		</p>
	</div>
</div>