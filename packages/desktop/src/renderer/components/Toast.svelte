<script lang="ts">
  import { toastStore } from '../lib/stores';
</script>

<div class="toast" class:visible={$toastStore.visible}>{$toastStore.message}</div>
