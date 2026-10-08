<script lang="ts">
	import type { Attachment } from '$lib/api/types';

	/** Props */
	interface Props {
		attachments: Attachment[];
	}

	let { attachments = [] }: Props = $props();

	/** `2.0 MB`, or `912 KB`. Plain, and never a bare number. */
	function size(bytes: number): string {
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	}

	/**
	 * A one-letter mark per file type.
	 *
	 * Deliberately not an icon library: R2 stores metadata only and there is no upload, so
	 * there is nothing for an icon to act on, and a row of tiny generic file glyphs would say
	 * less than the extension does.
	 */
	function mark(mimeType: string): string {
		const type = mimeType.split('/')[1] ?? '';
		if (type === 'pdf') return 'PDF';
		if (type.startsWith('image')) return 'IMG';
		if (type.includes('word') || type.includes('document')) return 'DOC';
		if (type.includes('sheet') || type.includes('excel')) return 'XLS';
		if (type.includes('presentation') || type.includes('powerpoint')) return 'PPT';
		return type.slice(0, 3).toUpperCase() || 'FILE';
	}
</script>

<!--
	Metadata display only.

	R2 deliberately stores no file bytes -- there is no upload endpoint and no storage
	service -- so this is a description of what a teacher declared, not a download. It says
	so, rather than offering a link that would 404.
-->
{#if attachments.length > 0}
	<ul class="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
		{#each attachments as attachment (attachment.id)}
			<li class="flex items-center gap-2.5 text-[13px] text-muted-foreground">
				<span
					class="flex h-6 w-9 shrink-0 items-center justify-center rounded border border-border
					       bg-muted/70 text-[9px] font-semibold tracking-wide text-muted-foreground"
					aria-hidden="true"
				>
					{mark(attachment.mimeType)}
				</span>
				<span class="min-w-0 flex-1 truncate text-foreground/85">{attachment.filename}</span>
				<span class="shrink-0 tabular-nums">{size(attachment.sizeBytes)}</span>
			</li>
		{/each}
	</ul>
{/if}