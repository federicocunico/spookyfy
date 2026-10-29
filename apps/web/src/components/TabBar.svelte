<script lang="ts">
import { type RouteName, pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';
import Icon, { type IconName } from './Icon.svelte';

const { router } = services();

const tabs: { label: string; path: string; icon: IconName; activeIcon: IconName; match: RouteName[] }[] = [
  { label: 'Home', path: pathOf.home(), icon: 'home-outline', activeIcon: 'home', match: ['home'] },
  { label: 'Cerca', path: pathOf.search(), icon: 'search', activeIcon: 'search', match: ['search'] },
  {
    label: 'La tua Libreria',
    path: pathOf.library(),
    icon: 'library',
    activeIcon: 'library',
    match: [
      'library',
      'downloaded',
      'albums',
      'genres',
      'album',
      'genre',
      'favorites',
      'playlist',
      'settings',
    ],
  },
];

function go(e: MouseEvent, path: string) {
  e.preventDefault();
  router.navigate(path);
}
</script>

<nav class="tabbar" aria-label="Navigazione principale">
  <span class="brand" aria-hidden="true"><img src="/icons/favicon.svg" alt="" width="32" height="32" />Spookyfy</span>
  {#each tabs as tab (tab.path)}
    {@const active = tab.match.includes(router.route.name)}
    <a
      href={tab.path}
      class="tab"
      class:active
      aria-current={active ? 'page' : undefined}
      onclick={(e) => go(e, tab.path)}
    >
      <Icon name={active ? tab.activeIcon : tab.icon} size={24} />
      <span>{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-tabbar);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    height: calc(var(--tabbar-h) + var(--safe-bottom));
    padding-bottom: var(--safe-bottom);
    background: var(--tabbar-bg);
    -webkit-backdrop-filter: blur(10px) saturate(140%);
    backdrop-filter: blur(10px) saturate(140%);
  }
  .brand {
    display: none;
  }
  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 44px;
    color: var(--text-2);
    font-size: 0.6875rem;
    font-weight: 600;
  }
  .tab.active {
    color: var(--text);
  }
  .tab:active {
    transform: scale(0.94);
  }
  /* PC: colonna di navigazione a sinistra, sopra la barra del player. */
  @media (min-width: 1024px) {
    .tabbar {
      top: var(--space-2);
      left: var(--space-2);
      right: auto;
      bottom: calc(var(--miniplayer-h) + var(--space-4));
      width: calc(var(--sidebar-w) - var(--space-4));
      height: auto;
      padding: var(--space-4) var(--space-3);
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      border-radius: var(--radius-m);
      background: var(--surface-1);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: 0 var(--space-3) var(--space-4);
      font-size: var(--fs-l);
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .brand img {
      border-radius: var(--radius-m);
    }
    .tab {
      flex-direction: row;
      justify-content: flex-start;
      gap: var(--space-4);
      min-height: 48px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-m);
      font-size: var(--fs-m);
      font-weight: 700;
    }
    .tab:hover {
      color: var(--text);
      background: var(--surface-hover);
    }
    .tab:active {
      transform: none;
    }
  }
</style>
