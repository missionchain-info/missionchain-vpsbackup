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
export const DASH = "-";
/** Returns true for null, undefined, NaN, Infinity, 0, 0n, "", "0", "0.00"-like strings. */
export function isEmpty(v) {
    if (v === null || v === undefined)
        return true;
    if (typeof v === "number")
        return !isFinite(v) || v === 0;
    if (typeof v === "bigint")
        return v === 0n;
    if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed)
            return true;
        const n = parseFloat(trimmed);
        return !isNaN(n) && n === 0;
    }
    return false;
}
/**
 * Format a plain number with locale thousands separators.
 * Returns DASH for empty/zero.
 */
export function fmtNum(v, decimals = 0) {
    if (isEmpty(v))
        return DASH;
    const n = typeof v === "bigint" ? Number(v) : typeof v === "string" ? parseFloat(v) : v;
    if (!isFinite(n))
        return DASH;
    return n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}
/**
 * Format a USD value. Returns DASH (not "$-") for empty/zero.
 */
export function fmtUsd(v, decimals = 2) {
    if (isEmpty(v))
        return DASH;
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (!isFinite(n))
        return DASH;
    return "$" + n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}
/**
 * Format a percent. Returns DASH (not "-%") for empty/zero.
 * Pass the percentage value directly (e.g., 35 → "35%", not 0.35).
 */
export function fmtPct(v, decimals = 1) {
    if (isEmpty(v))
        return DASH;
    if (!isFinite(v))
        return DASH;
    return v.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }) + "%";
}
/**
 * Format a bigint token balance (e.g., 18-dec MIC, 6-dec USDT).
 * Returns DASH for empty/zero.
 */
export function fmtBalance(val, decimals = 18, displayDecimals = 4) {
    if (!val || val === 0n)
        return DASH;
    const divisor = 10n ** BigInt(decimals);
    const whole = val / divisor;
    const frac = val % divisor;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, displayDecimals);
    const combined = parseFloat(whole.toString() + "." + fracStr);
    if (!isFinite(combined) || combined === 0)
        return DASH;
    return combined.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: displayDecimals,
    });
}
/**
 * Format a number in compact notation (1.2K, 3.4M, 5B).
 * Returns DASH for empty/zero.
 */
export function fmtCompact(v) {
    if (isEmpty(v))
        return DASH;
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (!isFinite(n))
        return DASH;
    const num = n;
    if (num >= 1000000000)
        return (num / 1000000000).toFixed(2).replace(/\.?0+$/, "") + "B";
    if (num >= 1000000)
        return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (num >= 1000)
        return num.toLocaleString("en-US");
    return num.toString();
}
/**
 * Composite value like "N / TOTAL" (e.g., "0 / 25,000" → "- / 25,000").
 * Only the left (numerator) turns into dash; right stays as-is.
 */
export function fmtRatio(numerator, denominator, denomDecimals = 0) {
    const left = fmtNum(numerator);
    const right = isEmpty(denominator) ? DASH : fmtNum(denominator, denomDecimals);
    return `${left} / ${right}`;
}
