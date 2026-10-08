import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// Node, not auto.
			//
			// The old deployment was a static Vercel build proxying `/api/*` to the Rust
			// process. That shape cannot host this app: the session is resolved in `load`
			// functions, which need a server. adapter-node runs the same artefact on the VPS
			// where the backend already lives -- one deployment target, one `BACKEND_URL`.
			adapter: adapter(),

			// Runes everywhere in this app, no exceptions.
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			csp: {
				// Nonce mode, because there is exactly one inline script in this app --
				// the theme switch in `app.html` that stops dark mode flashing white -- and
				// a nonce lets it stay inline instead of costing `unsafe-inline`.
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// Svelte injects component styles as inline `<style>` elements at
					// runtime, so styles cannot use a nonce. Scripts can, and do.
					'style-src': ['self', 'unsafe-inline'],
					// Every image is served from this origin: the logo, the login
					// artwork, the favicon. No third party, no CDN.
					'img-src': ['self', 'data:'],
					// The browser never talks to the API cross-origin; every call is
					// same-origin through SvelteKit.
					'connect-src': ['self'],
					'font-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});