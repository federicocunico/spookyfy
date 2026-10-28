<script lang="ts">
/** Testo che scorre orizzontalmente solo se non entra nello spazio disponibile. */
let { text, class: className = '' }: { text: string; class?: string } = $props();

let outer: HTMLElement | undefined = $state();
let inner: HTMLElement | undefined = $state();
let overflowing = $state(false);
let distance = $state(0);

function measure() {
  if (!outer || !inner) return;
  const over = inner.scrollWidth - outer.clientWidth;
  overflowing = over > 1;
  distance = inner.scrollWidth + 40;
}

$effect(() => {
  void text;
  if (!outer || !inner) return;
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(outer);
  ro.observe(inner);
  return () => ro.disconnect();
});
</script>

<span class="marquee {className}" bind:this={outer} data-overflowing={overflowing}>
  <span
    class="track"
    class:scrolling={overflowing}
    style:--distance={`${distance}px`}
    style:--duration={`${Math.max(6, distance / 30)}s`}
  >
    <span bind:this={inner} class="item">{text}</span>
    {#if overflowing}<span class="item gap" aria-hidden="true">{text}</span>{/if}
  </span>
</span>

<style>
  .marquee {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    min-width: 0;
  }
  .marquee[data-overflowing='true'] {
    mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 16px), transparent);
  }
  .track {
    display: inline-flex;
  }
  .item {
    display: inline-block;
  }
  .gap {
    padding-left: 40px;
  }
  .scrolling {
    animation: marquee var(--duration) linear 1.5s infinite;
  }
  @keyframes marquee {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(calc(-1 * var(--distance)));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrolling {
      animation: none;
    }
  }
</style>
