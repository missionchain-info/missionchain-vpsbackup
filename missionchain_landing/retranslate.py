#!/usr/bin/env python3
"""Re-translate failed files with smaller chunks + validation + retry."""
import os, sys, time, asyncio, re
from pathlib import Path
from anthropic import AsyncAnthropic

with open("/opt/claudia/config/.env") as f:
    for line in f:
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.strip().split("=", 1)[1]
            break

sys.path.insert(0, "/opt/missionchain/missionchain_landing")
from translate import build_system_prompt, split_html, apply_vi_font_patches, LANG_NAMES, MODEL

client = AsyncAnthropic()
BASE = Path("/opt/missionchain/missionchain_landing/documents")

# Files that need re-translation (ratio < 0.7)
FAILED_JOBS = [
    ("mc_seed_round.html", "ES"),
    ("mc_seed_round.html", "PT"),
    ("mc_seed_round.html", "VI"),
    ("mc_announcement.html", "ES"),
    ("mc_announcement.html", "KO"),
    ("mc_announcement.html", "PT"),
    ("mc_announcement.html", "VI"),
]

CHUNK_SEM = asyncio.Semaphore(10)
LOG_LOCK = asyncio.Lock()

STRICT_SYSTEM = """You are a professional translator. Translate HTML from English to {target_lang}.

ABSOLUTELY CRITICAL RULES — NON-NEGOTIABLE:
1. Your output MUST contain EVERY element, tag, attribute, comment, and piece of content from the input.
2. NEVER summarize, condense, abbreviate, or skip ANY content. Translate every sentence, list item, table row, button text.
3. Output length must be similar to input length (within 20%). If your translation is much shorter, you have missed content — add it back.
4. Preserve ALL HTML tags, CSS classes, IDs, attributes, scripts (including @keyframes, @media), styles, HTML comments, whitespace.
5. ONLY translate: visible text between > and <, alt/title/aria-label/placeholder/data-t attribute values.
6. DO NOT translate: CSS code, JS code, URLs, emails, numbers, brand terms below.
7. Keep UNCHANGED (English): MIC, MICE, MFP-NFT, MissionChain, Mission Chain, SOPHIA, NIRA, BSC, BEP-20, BNB, USDT, DAO, DEX, CEX, PancakeSwap, Chainlink, Claude, Anthropic, Sumsub, LockManager, MICToken, LiquidityPool, DAOGovernor, Builder, Maker, Luminary, Mission Founders Pass, Adaptive Emission Engine, Mission World, KYC, AML, OFAC, GDPR, CertiK, Immunefi, OpenZeppelin, TWAP, APY, TVL, ROI, GV Bonus, Weekly Growth Reward, Monthly Community Reward, Lucky Draw, Seed Round, SEED, Pre-Sale, PreSale, Founding Partner, Early Bird, Package, Hybrid Lock, Circuit Breaker, Standing Committee, Timelock, AccessControl, E(t), E₀, D(t), R(t), W(t), T_half, λ, Smart Contract, OpenClaw, CLAUDIA.
8. Output ONLY the translated HTML — NO markdown code blocks (no ```html), NO commentary, NO explanation.
9. Start output with the same first characters as input, end with the same last characters.

For Vietnamese: use proper diacritics, keep technical tone.
"""

async def log(msg):
    async with LOG_LOCK:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

async def translate_chunk_strict(chunk, target_lang, attempt=1):
    async with CHUNK_SEM:
        system = STRICT_SYSTEM.format(target_lang=LANG_NAMES[target_lang])
        try:
            resp = await client.messages.create(
                model=MODEL,
                max_tokens=16000,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": f"Translate this HTML to {LANG_NAMES[target_lang]}:\n\n{chunk}"}],
                timeout=300.0,  # 5 min per chunk
            )
            text = resp.content[0].text
            # Remove any stray markdown fences
            text = re.sub(r'^```html\s*\n?', '', text)
            text = re.sub(r'\n?```\s*$', '', text)
            return text, resp.usage, None
        except Exception as e:
            return None, None, str(e)

async def translate_job(src_name, target_lang, max_chars=8000):
    src = BASE / src_name
    dest = BASE / target_lang / src_name
    html = src.read_text(encoding="utf-8")
    chunks = split_html(html, max_chars=max_chars)
    await log(f"[START] {target_lang}/{src_name} — {len(chunks)} chunks (max {max_chars} chars each), EN size={len(html)}")
    t0 = time.time()
    translated_parts = [None] * len(chunks)
    total_in = total_out = 0

    async def process_chunk(i, chunk):
        nonlocal total_in, total_out
        for attempt in range(1, 3):
            text, usage, err = await translate_chunk_strict(chunk, target_lang, attempt)
            if err:
                await log(f"  [RETRY {attempt}] {target_lang}/{src_name} chunk {i+1}: {err[:100]}")
                continue
            # Size validation
            in_len = len(chunk)
            out_len = len(text)
            ratio = out_len / max(in_len, 1)
            if ratio < 0.7 and in_len > 2000:
                await log(f"  [SHORT] {target_lang}/{src_name} chunk {i+1} attempt {attempt}: in={in_len} out={out_len} ratio={ratio:.2f}")
                if attempt < 2:
                    continue  # retry once
            translated_parts[i] = text
            total_in += usage.input_tokens
            total_out += usage.output_tokens
            return
        # After retries: fallback to original
        await log(f"  [FAIL] {target_lang}/{src_name} chunk {i+1}: keeping EN original")
        translated_parts[i] = chunk

    tasks = [process_chunk(i, c) for i, c in enumerate(chunks)]
    await asyncio.gather(*tasks)
    result = "\n".join(translated_parts)
    if target_lang == "VI":
        result = apply_vi_font_patches(result)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Backup broken version
    bak = dest.with_suffix(".html.truncated-bak")
    if dest.exists() and not bak.exists():
        bak.write_bytes(dest.read_bytes())
    dest.write_text(result, encoding="utf-8")
    elapsed = time.time() - t0
    en_size = len(html)
    out_size = len(result)
    pct = int(out_size * 100 / en_size)
    flag = " ✓" if pct >= 80 else f" ⚠️ STILL TRUNCATED ({pct}%)"
    await log(f"[DONE] {target_lang}/{src_name} — {elapsed:.0f}s, in={total_in}, out={total_out}, size={out_size} ({pct}% of EN){flag}")

async def main():
    all_jobs = [translate_job(f, lang) for f, lang in FAILED_JOBS]
    await log(f"=== Re-translating {len(all_jobs)} failed files with smaller chunks ===")
    t0 = time.time()
    await asyncio.gather(*all_jobs)
    await log(f"=== ALL DONE in {time.time()-t0:.0f}s ===")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
