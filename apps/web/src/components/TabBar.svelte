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
    match: ['library', 'downloaded', 'favorites', 'playlist', 'settings'],
  },
];

function go(e: MouseEvent, path: string) {
  e.preventDefault();
  router.navigate(path);
}
</script>

<nav class="tabbar" aria-label="Navigazione principale">
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
    border-top: 1px solid rgba(255, 255, 255, 0.06);
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
    color: var(--accent);
  }
  .tab:active {
    transform: scale(0.94);
  }
</style>
