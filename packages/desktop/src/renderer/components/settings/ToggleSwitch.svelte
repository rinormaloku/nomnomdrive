<script lang="ts">
  export let checked = false;
  export let disabled = false;
</script>

<label class="toggle" class:disabled>
  <input type="checkbox" bind:checked {disabled} />
  <span class="toggle-track">
    <span class="toggle-knob"></span>
  </span>
</label>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .toggle.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .toggle-track {
    position: relative;
    width: 32px;
    height: 18px;
    background: var(--bg3);
    border-radius: 9px;
    transition: background var(--transition);
    border: 1px solid var(--border);
  }

  input:checked + .toggle-track {
    background: var(--accent);
    border-color: var(--accent);
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: #fff;
    border-radius: 50%;
    transition: transform var(--transition);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  input:checked + .toggle-track .toggle-knob {
    transform: translateX(14px);
  }
</style>
