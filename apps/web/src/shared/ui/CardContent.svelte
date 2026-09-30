<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@/shared/utils/cn";
  let {
    children,
    class: className = "",
  }: { children?: Snippet; class?: string } = $props();
</script>

<div class={cn("p-4 pt-0", className)}>{@render children?.()}</div>
