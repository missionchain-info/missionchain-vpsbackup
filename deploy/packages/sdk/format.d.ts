/**
 * Display-value formatting helpers.
 *
 * Rule: a numeric value that would render as 0 / 0.00 / empty is displayed as "-"
 * so users can distinguish "no data" from "data that happens to be zero".
 *
 * Exclusions (caller's responsibility — do NOT use these helpers):
 *   - pagination / row indexes, timestamps, block numbers, IDs
 *   - time durations like "X days" (show 0 days, not "- days")
 */
export declare const DASH = "-";
/** Returns true for null, undefined, NaN, Infinity, 0, 0n, "", "0", "0.00"-like strings. */
export declare function isEmpty(v: unknown): boolean;
/**
 * Format a plain number with locale thousands separators.
 * Returns DASH for empty/zero.
 */
export declare function fmtNum(v: number | string | bigint | null | undefined, decimals?: number): string;
/**
 * Format a USD value. Returns DASH (not "$-") for empty/zero.
 */
export declare function fmtUsd(v: number | string | null | undefined, decimals?: number): string;
/**
 * Format a percent. Returns DASH (not "-%") for empty/zero.
 * Pass the percentage value directly (e.g., 35 → "35%", not 0.35).
 */
export declare function fmtPct(v: number | null | undefined, decimals?: number): string;
/**
 * Format a bigint token balance (e.g., 18-dec MIC, 6-dec USDT).
 * Returns DASH for empty/zero.
 */
export declare function fmtBalance(val: bigint | undefined | null, decimals?: number, displayDecimals?: number): string;
/**
 * Format a number in compact notation (1.2K, 3.4M, 5B).
 * Returns DASH for empty/zero.
 */
export declare function fmtCompact(v: number | string | null | undefined): string;
/**
 * Composite value like "N / TOTAL" (e.g., "0 / 25,000" → "- / 25,000").
 * Only the left (numerator) turns into dash; right stays as-is.
 */
export declare function fmtRatio(numerator: number | string | null | undefined, denominator: number | string | null | undefined, denomDecimals?: number): string;
