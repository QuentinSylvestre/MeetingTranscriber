import type { PricingRates, ProviderName } from '../../shared/ipc-types';
import type { ProviderUsage } from '../providers/types';

// Pure cost-calculation functions — no side effects, no I/O. Given the same
// provider's usage shape and the same rates, always returns the same number.

/**
 * Computes the exact transcription cost for one provider call from its own
 * inline usage/duration field, multiplied by the (per-provider, and for
 * AssemblyAI per-tier) rate. Returns 0 — never NaN, never throws — when the
 * usage shape doesn't match what the given provider bills on (e.g. token-based
 * usage handed to a duration-billed provider), since that indicates the
 * provider's response didn't carry the expected field rather than a real
 * zero-cost call.
 */
export function calculateTranscriptionCost(provider: ProviderName, usage: ProviderUsage, rates: PricingRates): number {
  switch (provider) {
    case 'assemblyai': {
      if (usage.kind !== 'duration') return 0;
      // modelUsed selects the tier; default to the Pro rate (the first-listed,
      // primary model) when the field is absent or doesn't match a known tier.
      const perHour = usage.modelUsed?.includes('universal-2')
        ? rates.assemblyai.universal2PerHourUsd : rates.assemblyai.universal35ProPerHourUsd;
      return (usage.seconds / 3600) * (perHour + rates.assemblyai.diarizationPerHourUsd);
    }
    case 'elevenlabs':
      return usage.kind === 'duration' ? (usage.seconds / 3600) * rates.elevenlabs.perHourUsd : 0;
    case 'openai':
      // usage.audioTokens (when present) is a diagnostic breakdown of inputTokens,
      // not an additional billable quantity — OpenAI bills all input tokens for
      // this model at one uniform rate (research finding), so it is intentionally
      // not consumed here; consuming it would double-count against inputTokens.
      return usage.kind === 'tokens'
        ? (usage.inputTokens / 1e6) * rates.openaiTranscribe.inputPerMillionUsd
          + (usage.outputTokens / 1e6) * rates.openaiTranscribe.outputPerMillionUsd : 0;
    case 'google':
      // usage.cachedTokens (when present) is intentionally not consumed here — unlike
      // OpenAI's audioTokens above, this is not a resolved design decision but a still-
      // open question: whether Google's total_input_tokens already includes cached
      // tokens (in which case also applying a separate cached discount would
      // double-count) or is additive to them (in which case omitting them here
      // undercounts). Phase 5's review explicitly assigned resolving this to Phase 6
      // (plan's Follow-up Work (Deferred) list, "Resolve whether Google's
      // total_input_tokens includes or excludes cached tokens"; Phase 5 review, Domain
      // expert finding #8) and it remains unverified — no real-world confirmation was
      // available this pass. Do not wire a google.cachedInputPerMillionUsd rate or
      // otherwise consume cachedTokens until that question is answered.
      return usage.kind === 'tokens'
        ? (usage.inputTokens / 1e6) * rates.google.inputPerMillionUsd
          + (usage.outputTokens / 1e6) * rates.google.outputPerMillionUsd : 0;
  }
}

/**
 * Computes the exact compte-rendu (summary) cost from OpenAI Responses API's
 * usage.input_tokens/output_tokens/input_tokens_details.cached_tokens.
 */
export function calculateSummaryCost(
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number }, rates: PricingRates
): number {
  // Clamp defensively: cachedTokens is documented as a subset of inputTokens, but
  // a malformed/inconsistent provider response could report more cached than
  // total input tokens, which would otherwise drive the subtraction negative.
  const cached = Math.min(usage.cachedTokens ?? 0, usage.inputTokens);
  return ((usage.inputTokens - cached) / 1e6) * rates.openaiSummary.inputPerMillionUsd
       + (cached / 1e6) * rates.openaiSummary.cachedInputPerMillionUsd
       + (usage.outputTokens / 1e6) * rates.openaiSummary.outputPerMillionUsd;
}
