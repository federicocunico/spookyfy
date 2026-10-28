<script lang="ts">
/**
 * Copertina quadrata con spazio riservato fin dal primo frame (aspect-ratio) e
 * colore dominante come segnaposto: nessuno spostamento al caricamento.
 */
let {
  src,
  color = '#282828',
  size,
  radius = 'var(--radius-s)',
  alt = '',
  eager = false,
  shadow = false,
}: {
  src: string | null;
  color?: string;
  size?: number | string;
  radius?: string;
  alt?: string;
  eager?: boolean;
  shadow?: boolean;
} = $props();

let failed = $state(false);
let loaded = $state(false);
$effect(() => {
  void src;
  failed = false;
  loaded = false;
});
const width = $derived(typeof size === 'number' ? `${size}px` : (size ?? '100%'));
</script>

<div class="cover" class:shadow style:width style:--cover-color={color} style:border-radius={radius}>
  {#if src && !failed}
    <img
      {src}
      {alt}
      class:loaded
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable="false"
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
  {/if}
</div>

<style>
  .cover {
    position: relative;
    flex: none;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--cover-color);
  }
  .shadow {
    box-shadow: var(--shadow-cover);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  img.loaded {
    opacity: 1;
  }
</style>
