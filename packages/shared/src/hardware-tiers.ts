/**
 * Hardware-aware model recommendations.
 *
 * NomNomDrive keeps the embedder and the chat model resident at the same time —
 * neither is unloaded when idle — so a machine has to fit *both* plus whatever
 * the desktop is already using. Every number below is therefore a budget for the
 * pair, not for a single model.
 *
 * The numbers are grounded in the real GGUF blob sizes published on HuggingFace
 * (see `runtimeGb` in `model-catalog.ts`), not in nominal parameter counts —
 * Gemma 4 E2B, for instance, ships a 2.5 GB Q3_K_M file despite the "2B" name,
 * because the per-layer embeddings travel with the weights.
 */

import { EMBED_MODELS, CHAT_MODELS, type ModelOption } from './model-catalog';

// ── Budget constants ─────────────────────────────────────────────────────────

/**
 * Share of detected memory we are willing to plan against. The rest belongs to
 * the compositor, the browser the user actually works in, and the driver's own
 * allocations — an indexer that claims the whole GPU makes the machine unusable.
 */
export const USABLE_MEMORY_FRACTION = 0.7;

/**
 * Held back from the budget on tiers that run a local chat model, so adding a
 * reranker later does not force every user back through model selection.
 * Sized for a 0.6B reranker at Q8 (~0.64 GB of weights plus working set).
 */
export const RERANKER_RESERVE_GB = 1.0;

/** Below this there is no point pretending a local model is a good idea. */
const MIN_VIABLE_BUDGET_GB = 1.0;

// ── Types ────────────────────────────────────────────────────────────────────

/** Where the memory figure came from, which changes how much to trust it. */
export type MemoryKind =
  /** Dedicated GPU memory — the reliable case. */
  | 'vram'
  /** Apple Silicon and other SoCs: one pool shared with the CPU. */
  | 'unified'
  /** No usable GPU; inference falls back to the CPU and system RAM. */
  | 'ram';

export interface HardwareProfile {
  /** Dedicated VRAM in bytes, 0 when no discrete GPU was found. */
  vramBytes: number;
  /** Total system RAM in bytes. */
  ramBytes: number;
  /** True when VRAM and RAM are the same physical pool (Apple Silicon, iGPUs). */
  unified: boolean;
  /** Human-readable adapter names, e.g. ["NVIDIA GeForce RTX 4070"]. */
  gpuNames: string[];
  /** How the figures were obtained — surfaced in the UI so users can sanity-check. */
  source: string;
}

export type HardwareTierId =
  | 'workstation'
  | 'high'
  | 'balanced'
  | 'light'
  | 'assisted'
  | 'api-only';

/** One concrete embed+chat pairing, already resolved to catalog entries. */
export interface ModelPick {
  embedModelId: string;
  embedLabel: string;
  /** null means "no local chat model — use an external API". */
  chatModelId: string | null;
  chatLabel: string | null;
  /** Estimated resident memory for the pair, including the reranker reserve. */
  estimatedGb: number;
}

export interface HardwareRecommendation {
  tier: HardwareTierId;
  tierLabel: string;
  /** Detected total, in GB, of whichever pool inference will draw from. */
  totalGb: number;
  /** What we plan against: `totalGb` × USABLE_MEMORY_FRACTION. */
  budgetGb: number;
  memoryKind: MemoryKind;
  /** Best local pairing for this machine, or null when nothing local fits. */
  local: ModelPick | null;
  /** Smaller pairing for the same machine — lighter embedder and/or quant. */
  localLight: ModelPick | null;
  /** Which onboarding option starts selected. */
  preferred: 'local' | 'api';
  /** One line, shown as the step's headline. */
  headline: string;
  /** Two or three sentences of reasoning, shown under the headline. */
  detail: string;
}

// ── Tier table ───────────────────────────────────────────────────────────────

interface TierSpec {
  id: HardwareTierId;
  label: string;
  /** Minimum budget (post-haircut, in GB) required to land on this tier. */
  minBudgetGb: number;
  standard: { embed: string; chat: string | null };
  light: { embed: string; chat: string | null } | null;
  preferred: 'local' | 'api';
}

const E2B_Q3 = 'hf:unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q3_K_M.gguf';
const E2B_Q2 = 'hf:unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-UD-Q2_K_XL.gguf';
const E4B_Q4 = 'hf:unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q4_K_M.gguf';
const G12B_Q4 = 'hf:unsloth/gemma-4-12b-it-GGUF/gemma-4-12b-it-Q4_K_M.gguf';

const JINA_Q8 =
  'hf:jinaai/jina-embeddings-v5-text-small-text-matching-GGUF/v5-small-text-matching-Q8_0.gguf';
const JINA_Q4 =
  'hf:jinaai/jina-embeddings-v5-text-small-text-matching-GGUF/v5-small-text-matching-Q4_K_M.gguf';
const QWEN_06B = 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF';
const QWEN_4B_Q4 = 'hf:Qwen/Qwen3-Embedding-4B-GGUF/Qwen3-Embedding-4B-Q4_K_M.gguf';
const QWEN_4B_Q8 = 'hf:Qwen/Qwen3-Embedding-4B-GGUF/Qwen3-Embedding-4B-Q8_0.gguf';

/**
 * Ordered strongest-first; `recommendForHardware` picks the first tier whose
 * `minBudgetGb` the machine clears.
 *
 * Embedding tops out at 4B on purpose — a bigger embedder would eat the headroom
 * reserved for a future reranker, which buys more retrieval quality per GB than
 * the same bytes spent on embedding capacity.
 */
export const HARDWARE_TIERS: TierSpec[] = [
  {
    id: 'workstation',
    label: 'Workstation',
    minBudgetGb: 14.5,
    standard: { embed: QWEN_4B_Q8, chat: G12B_Q4 },
    light: { embed: QWEN_4B_Q4, chat: E4B_Q4 },
    preferred: 'local',
  },
  {
    id: 'high',
    label: 'High-end GPU',
    minBudgetGb: 10.5,
    standard: { embed: QWEN_4B_Q4, chat: E4B_Q4 },
    light: { embed: JINA_Q8, chat: E2B_Q3 },
    preferred: 'local',
  },
  {
    id: 'balanced',
    label: 'Mainstream GPU',
    minBudgetGb: 5.8,
    standard: { embed: JINA_Q8, chat: E2B_Q3 },
    light: { embed: QWEN_06B, chat: E2B_Q2 },
    preferred: 'local',
  },
  {
    id: 'light',
    label: 'Entry GPU',
    // 5.2 GB is exactly what this pairing costs with the reranker reserve, which
    // puts an 8 GB card here and sends 6 GB cards down to external chat. A 6 GB
    // card can technically load these weights, but not with room to stay usable.
    minBudgetGb: 5.2,
    standard: { embed: QWEN_06B, chat: E2B_Q2 },
    light: null,
    preferred: 'api',
  },
  {
    id: 'assisted',
    label: 'Limited GPU',
    minBudgetGb: MIN_VIABLE_BUDGET_GB,
    // Embedding still fits locally, so documents never have to leave the machine.
    // Chat does not — an external model is both faster and far more capable here.
    standard: { embed: JINA_Q8, chat: null },
    light: { embed: JINA_Q4, chat: null },
    preferred: 'api',
  },
  {
    id: 'api-only',
    label: 'No local acceleration',
    minBudgetGb: 0,
    standard: { embed: JINA_Q4, chat: null },
    light: null,
    preferred: 'api',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const BYTES_PER_GB = 1024 ** 3;

function findModel(pool: ModelOption[], id: string): ModelOption | undefined {
  return pool.find((m) => m.id === id);
}

/**
 * Resident memory for an embed+chat pair. The reranker reserve only applies when
 * a local chat model is in play — on API-chat tiers there is nothing to protect
 * the headroom from, and charging for it would push weak machines off local
 * embedding for no reason.
 */
export function estimatePairGb(embed?: ModelOption, chat?: ModelOption | null): number {
  const embedGb = embed?.runtimeGb ?? 0;
  const chatGb = chat?.runtimeGb ?? 0;
  const reserve = chat ? RERANKER_RESERVE_GB : 0;
  return Math.round((embedGb + chatGb + reserve) * 10) / 10;
}

function buildPick(spec: { embed: string; chat: string | null }): ModelPick | null {
  const embed = findModel(EMBED_MODELS, spec.embed);
  if (!embed) return null;
  const chat = spec.chat ? findModel(CHAT_MODELS, spec.chat) : null;
  // A tier naming a chat model the catalog doesn't carry is a table bug, not a
  // runtime condition — fail loudly rather than silently downgrading the user.
  if (spec.chat && !chat) return null;
  return {
    embedModelId: embed.id,
    embedLabel: embed.label,
    chatModelId: chat?.id ?? null,
    chatLabel: chat?.label ?? null,
    estimatedGb: estimatePairGb(embed, chat),
  };
}

/**
 * Which memory pool inference will actually draw from, and how big it is.
 *
 * A discrete GPU wins when present. Apple Silicon and iGPUs report `unified`, so
 * the RAM figure is the right one but has to be shared with everything else the
 * OS is doing. With no GPU at all we fall back to RAM and CPU inference.
 */
export function resolveMemoryPool(profile: HardwareProfile): {
  totalBytes: number;
  kind: MemoryKind;
} {
  if (profile.vramBytes > 0 && !profile.unified) {
    return { totalBytes: profile.vramBytes, kind: 'vram' };
  }
  if (profile.unified) {
    return { totalBytes: profile.vramBytes || profile.ramBytes, kind: 'unified' };
  }
  return { totalBytes: profile.ramBytes, kind: 'ram' };
}

/** True when a model (or pair) fits the machine's planned budget. */
export function fitsBudget(estimatedGb: number, budgetGb: number): boolean {
  return estimatedGb <= budgetGb;
}

// ── Recommendation ───────────────────────────────────────────────────────────

function tierIndex(id: HardwareTierId): number {
  return HARDWARE_TIERS.findIndex((t) => t.id === id);
}

export function recommendForHardware(profile: HardwareProfile): HardwareRecommendation {
  const { totalBytes, kind } = resolveMemoryPool(profile);
  const totalGb = Math.round((totalBytes / BYTES_PER_GB) * 10) / 10;
  const budgetGb = Math.round(totalGb * USABLE_MEMORY_FRACTION * 10) / 10;

  // `minBudgetGb` states the intent for each tier, but the authority is what the
  // pairing actually costs — otherwise editing a quant in the catalog silently
  // starts recommending models that don't fit. Both must pass.
  let specIndex = HARDWARE_TIERS.findIndex((t) => {
    if (budgetGb < t.minBudgetGb) return false;
    const pick = buildPick(t.standard);
    return pick === null || pick.estimatedGb <= budgetGb;
  });
  if (specIndex < 0) specIndex = HARDWARE_TIERS.length - 1;

  // Without a GPU the budget may look generous — 64 GB of RAM clears every
  // threshold — but CPU token generation is slow enough that recommending a 12B
  // model would be misleading. Cap the tier and steer to an API for chat.
  if (kind === 'ram') {
    specIndex = Math.max(specIndex, tierIndex('balanced'));
  }

  const spec = HARDWARE_TIERS[specIndex];
  const local = buildPick(spec.standard);
  const localLight = spec.light ? buildPick(spec.light) : null;

  const preferred = kind === 'ram' ? 'api' : spec.preferred;
  const { headline, detail } = describe(spec, kind, totalGb, budgetGb, local, profile);

  return {
    tier: spec.id,
    tierLabel: spec.label,
    totalGb,
    budgetGb,
    memoryKind: kind,
    local,
    localLight,
    preferred,
    headline,
    detail,
  };
}

function poolName(kind: MemoryKind): string {
  if (kind === 'vram') return 'GPU memory';
  if (kind === 'unified') return 'unified memory';
  return 'system RAM';
}

function describe(
  spec: TierSpec,
  kind: MemoryKind,
  totalGb: number,
  budgetGb: number,
  local: ModelPick | null,
  profile: HardwareProfile,
): { headline: string; detail: string } {
  const gpu = profile.gpuNames[0];
  const found = gpu
    ? `${gpu} — ${totalGb} GB ${poolName(kind)}`
    : `${totalGb} GB ${poolName(kind)}`;
  const budgetNote = `We plan against ${budgetGb} GB so the rest of your machine stays responsive.`;

  if (kind === 'ram') {
    return {
      headline: `${found}, no GPU acceleration detected`,
      detail:
        `${budgetNote} Embedding runs fine on the CPU — indexing is just slower. ` +
        `Chat is the problem: a local model on CPU generates a few tokens per second, ` +
        `so connecting an external model gives you a far better experience.`,
    };
  }

  switch (spec.id) {
    case 'workstation':
      return {
        headline: `${found} — you can run the full local stack`,
        detail:
          `${budgetNote} That fits a 4B embedding model alongside Gemma 4 12B, ` +
          `which is the strongest local combination NomNomDrive ships. ` +
          `An external model is still sharper at multi-step tool use, so it stays worth trying.`,
      };
    case 'high':
      return {
        headline: `${found} — strong local setup available`,
        detail:
          `${budgetNote} A 4B embedding model plus Gemma 4 E4B fits comfortably. ` +
          `E4B roughly doubles E2B's tool-calling accuracy, which is what drives ` +
          `answer quality here since every answer comes from a document search.`,
      };
    case 'balanced':
      return {
        headline: `${found} — good local setup available`,
        detail:
          `${budgetNote} Jina v5 Small plus Gemma 4 E2B fits with room to spare. ` +
          `Retrieval will be genuinely good; the chat model is small, so expect it to ` +
          `summarise well and reason less. External models remain the quality ceiling.`,
      };
    case 'light':
      return {
        headline: `${found} — local chat will be tight`,
        detail:
          `${budgetNote} Embedding fits, so your documents can stay on this machine. ` +
          `A local chat model only fits at a heavy quantisation that noticeably hurts ` +
          `tool use, so we suggest an external model for chat instead.`,
      };
    case 'assisted':
      return {
        headline: `${found} — local embedding only`,
        detail:
          `${budgetNote} That is enough for a local embedding model, so document ` +
          `contents never leave your machine. There is no room for a local chat ` +
          `model, so connect an external one.`,
      };
    default:
      return {
        headline: `${found} — external models recommended`,
        detail:
          `${budgetNote} That is not enough to run models locally at a useful speed. ` +
          `NomNomDrive works the same way with external embedding and chat models — ` +
          `only the text you search over is sent, and this is also the fastest setup.`,
      };
  }
}

/**
 * Annotate a catalog for display: does each option fit this machine's budget?
 * `companionGb` is the memory already spoken for by the other model, so the
 * chat list can be scored against the chosen embedder and vice versa.
 */
export function annotateCatalog(
  models: ModelOption[],
  budgetGb: number,
  companionGb = 0,
): Array<ModelOption & { fits: boolean; needGb: number }> {
  return models.map((m) => {
    const needGb = Math.round(((m.runtimeGb ?? 0) + companionGb) * 10) / 10;
    return { ...m, needGb, fits: fitsBudget(needGb, budgetGb) };
  });
}
