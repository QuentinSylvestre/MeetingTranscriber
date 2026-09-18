import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateTranscriptionCost, calculateSummaryCost } from '../../src/main/pricing/calculate';
import { DEFAULT_PRICING_RATES } from '../../src/shared/ipc-types';
import type { ProviderUsage } from '../../src/main/providers/types';

const rates = DEFAULT_PRICING_RATES;

describe('calculateTranscriptionCost', () => {
  it('AssemblyAI Universal-3.5-Pro tier (modelUsed absent) — hand-computed', () => {
    const usage: ProviderUsage = { kind: 'duration', seconds: 3600 };
    // (3600/3600) * (0.21 + 0.02) = 0.23
    expect(calculateTranscriptionCost('assemblyai', usage, rates)).toBeCloseTo(0.23, 10);
  });

  it('AssemblyAI Universal-3.5-Pro tier (modelUsed explicit)', () => {
    const usage: ProviderUsage = { kind: 'duration', seconds: 1800, modelUsed: 'universal-3-5-pro' };
    // (1800/3600) * (0.21 + 0.02) = 0.5 * 0.23 = 0.115
    expect(calculateTranscriptionCost('assemblyai', usage, rates)).toBeCloseTo(0.115, 10);
  });

  it('AssemblyAI Universal-2 tier (modelUsed contains universal-2) — selects the cheaper rate', () => {
    const usage: ProviderUsage = { kind: 'duration', seconds: 3600, modelUsed: 'universal-2' };
    // (3600/3600) * (0.15 + 0.02) = 0.17
    expect(calculateTranscriptionCost('assemblyai', usage, rates)).toBeCloseTo(0.17, 10);
  });

  it('AssemblyAI with a usage.kind mismatch (tokens instead of duration) returns 0', () => {
    const usage: ProviderUsage = { kind: 'tokens', inputTokens: 100, outputTokens: 50 };
    expect(calculateTranscriptionCost('assemblyai', usage, rates)).toBe(0);
  });

  it('ElevenLabs — hand-computed', () => {
    const usage: ProviderUsage = { kind: 'duration', seconds: 1800 };
    // (1800/3600) * 0.22 = 0.11
    expect(calculateTranscriptionCost('elevenlabs', usage, rates)).toBeCloseTo(0.11, 10);
  });

  it('ElevenLabs with a usage.kind mismatch (tokens) returns 0, not NaN', () => {
    const usage: ProviderUsage = { kind: 'tokens', inputTokens: 100, outputTokens: 50 };
    const cost = calculateTranscriptionCost('elevenlabs', usage, rates);
    expect(cost).toBe(0);
    expect(Number.isNaN(cost)).toBe(false);
  });

  it('OpenAI transcribe — hand-computed (audioTokens present but not consumed)', () => {
    const usage: ProviderUsage = { kind: 'tokens', inputTokens: 1_000_000, outputTokens: 500_000, audioTokens: 900_000 };
    // (1e6/1e6)*2.50 + (5e5/1e6)*10.00 = 2.50 + 5.00 = 7.50
    expect(calculateTranscriptionCost('openai', usage, rates)).toBeCloseTo(7.5, 10);
  });

  it('OpenAI with a usage.kind mismatch (duration) returns 0, not NaN or a throw', () => {
    const usage: ProviderUsage = { kind: 'duration', seconds: 100 };
    expect(() => calculateTranscriptionCost('openai', usage, rates)).not.toThrow();
    const cost = calculateTranscriptionCost('openai', usage, rates);
    expect(cost).toBe(0);
    expect(Number.isNaN(cost)).toBe(false);
  });

  it('Google — hand-computed', () => {
    const usage: ProviderUsage = { kind: 'tokens', inputTokens: 2_000_000, outputTokens: 1_000_000 };
    // (2e6/1e6)*2.00 + (1e6/1e6)*12.00 = 4.00 + 12.00 = 16.00
    expect(calculateTranscriptionCost('google', usage, rates)).toBeCloseTo(16.0, 10);
  });

  it('Google with a usage.kind mismatch (duration usage passed to a token-based provider) returns 0, not NaN or a throw', () => {
    const usage: ProviderUsage = { kind: 'duration', seconds: 100 };
    expect(() => calculateTranscriptionCost('google', usage, rates)).not.toThrow();
    const cost = calculateTranscriptionCost('google', usage, rates);
    expect(cost).toBe(0);
    expect(Number.isNaN(cost)).toBe(false);
  });
});

describe('calculateSummaryCost', () => {
  it('hand-computed with a cached-token discount applied', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cachedTokens: 200_000 };
    // non-cached: 800_000 -> 0.8 * 4.00 = 3.2
    // cached: 200_000 -> 0.2 * 0.40 = 0.08
    // output: 500_000 -> 0.5 * 20.00 = 10.0
    // total: 13.28
    expect(calculateSummaryCost(usage, rates)).toBeCloseTo(13.28, 10);
  });

  it('hand-computed with no cachedTokens field (defaults to 0 cached)', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    // 1.0 * 4.00 + 0 * 0.40 + 0.5 * 20.00 = 4.00 + 0 + 10.00 = 14.00
    expect(calculateSummaryCost(usage, rates)).toBeCloseTo(14.0, 10);
  });

  it('clamps cachedTokens > inputTokens so the cost never goes negative', () => {
    const usage = { inputTokens: 100_000, outputTokens: 50_000, cachedTokens: 500_000 };
    // cached clamped to 100_000; non-cached: 0
    // 0 * 4.00 + 0.1 * 0.40 + 0.05 * 20.00 = 0 + 0.04 + 1.00 = 1.04
    const cost = calculateSummaryCost(usage, rates);
    expect(cost).toBeCloseTo(1.04, 10);
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

// isValidPricingRates and the settings:set-preference IPC handler boundary.
// Mirrors tests/unit/summary-ipc.test.ts's pattern of mocking electron.ipcMain.handle
// to capture registered handlers, so the handler can be invoked directly — bypassing
// the renderer/UI entirely, exactly like a raw IPC call would.
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/settings/store', () => ({
  getPreference: mocks.getPreference,
  setPreference: mocks.setPreference,
}));

describe('isValidPricingRates', () => {
  it('accepts DEFAULT_PRICING_RATES', async () => {
    const { isValidPricingRates } = await import('../../src/main/ipc/settings');
    expect(isValidPricingRates(DEFAULT_PRICING_RATES)).toBe(true);
  });

  it('rejects a negative number in a leaf field', async () => {
    const { isValidPricingRates } = await import('../../src/main/ipc/settings');
    const bad = { ...DEFAULT_PRICING_RATES, elevenlabs: { perHourUsd: -0.22 } };
    expect(isValidPricingRates(bad)).toBe(false);
  });

  it('rejects a non-numeric value in a leaf field', async () => {
    const { isValidPricingRates } = await import('../../src/main/ipc/settings');
    const bad = { ...DEFAULT_PRICING_RATES, google: { inputPerMillionUsd: 'two', outputPerMillionUsd: 12 } };
    expect(isValidPricingRates(bad)).toBe(false);
  });

  it('rejects a missing sub-object', async () => {
    const { isValidPricingRates } = await import('../../src/main/ipc/settings');
    const { assemblyai: _omit, ...bad } = DEFAULT_PRICING_RATES;
    expect(isValidPricingRates(bad)).toBe(false);
  });

  it('rejects a non-finite number (Infinity/NaN) in a leaf field', async () => {
    const { isValidPricingRates } = await import('../../src/main/ipc/settings');
    expect(isValidPricingRates({ ...DEFAULT_PRICING_RATES, elevenlabs: { perHourUsd: Infinity } })).toBe(false);
    expect(isValidPricingRates({ ...DEFAULT_PRICING_RATES, elevenlabs: { perHourUsd: NaN } })).toBe(false);
  });

  it('rejects a non-object value', async () => {
    const { isValidPricingRates } = await import('../../src/main/ipc/settings');
    expect(isValidPricingRates(null)).toBe(false);
    expect(isValidPricingRates('0.21')).toBe(false);
    expect(isValidPricingRates(42)).toBe(false);
  });
});

describe('settings:set-preference IPC handler — pricingRates boundary (raw IPC call, bypassing the UI)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    const { registerSettingsHandlers } = await import('../../src/main/ipc/settings');
    registerSettingsHandlers();
  });

  const setPreference = (key: string, value: unknown) =>
    mocks.handlers.get('settings:set-preference')!({}, { key, value });

  it('accepts a fully-valid pricingRates object and writes it', () => {
    setPreference('pricingRates', DEFAULT_PRICING_RATES);
    expect(mocks.setPreference).toHaveBeenCalledWith('pricingRates', DEFAULT_PRICING_RATES);
  });

  it('silently drops a write with a negative rate (never reaches store.setPreference)', () => {
    const bad = { ...DEFAULT_PRICING_RATES, assemblyai: { ...DEFAULT_PRICING_RATES.assemblyai, universal35ProPerHourUsd: -1 } };
    setPreference('pricingRates', bad);
    expect(mocks.setPreference).not.toHaveBeenCalled();
  });

  it('silently drops a write with a non-numeric rate (never reaches store.setPreference)', () => {
    const bad = { ...DEFAULT_PRICING_RATES, google: { inputPerMillionUsd: 'not-a-number', outputPerMillionUsd: 12 } };
    setPreference('pricingRates', bad);
    expect(mocks.setPreference).not.toHaveBeenCalled();
  });
});
