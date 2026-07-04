<script lang="ts">
  import { stats } from '../lib/stores';
  import Bot from './Bot.svelte';
</script>

<!-- Idle banner -->
<div class="sync-banner" id="sync-banner">
  <div class="sync-banner-idle">
    <div class="sync-status-row">
      <div class="bot-mini bot-idle">
        <Bot size={40} shadow blink />
      </div>
      <div class="sync-idle-text">
        <span class="sync-label">Up to date</span>
        <div class="sync-stats">
          <span>{$stats.fileCount} file{$stats.fileCount !== 1 ? 's' : ''}</span>
          <span class="stat-sep">&middot;</span>
          <span>{$stats.chunkCount} chunk{$stats.chunkCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  </div>
</div>
