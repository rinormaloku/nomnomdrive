<script lang="ts">
  import { toastStore } from '../lib/stores';
  import Bot from './Bot.svelte';
</script>

<div class="toast" class:visible={$toastStore.visible}>
  <span class="toast-bot"><Bot size={18} /></span>
  <span>{$toastStore.message}</span>
</div>
