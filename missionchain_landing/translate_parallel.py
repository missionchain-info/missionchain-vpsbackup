#!/usr/bin/env python3
"""Run 15 remaining translations in parallel using AsyncAnthropic."""
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

# Jobs: (source_file, target_lang, dest_path)
FILES = ["White_Paper.html", "Glossary_Brand_Terms.html", "mc_seed_round.html", "mc_announcement.html"]
LANGS = ["ES", "KO", "PT", "VI"]

# Concurrent limits
CHUNK_SEM = asyncio.Semaphore(8)   # max 8 concurrent API calls
LOG_LOCK = asyncio.Lock()

async def log(msg):
    async with LOG_LOCK:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

async def translate_chunk_async(chunk, target_lang, chunk_idx, total):
    async with CHUNK_SEM:
        system = build_system_prompt(target_lang)
        resp = await client.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": f"Translate this HTML chunk to {LANG_NAMES[target_lang]} (chunk {chunk_idx}/{total}):\n\n{chunk}"}]
        )
        return resp.content[0].text, resp.usage

async def translate_job(src_name, target_lang):
    """Translate one source file to one language."""
    src = BASE / src_name
    dest = BASE / target_lang / src_name
    if dest.exists() and dest.stat().st_size > 10000:
        await log(f"[SKIP] {target_lang}/{src_name} already exists ({dest.stat().st_size} bytes)")
        return
    html = src.read_text(encoding="utf-8")
    chunks = split_html(html, max_chars=25000)
    await log(f"[START] {target_lang}/{src_name} — {len(chunks)} chunks, {len(html)} bytes")
    t0 = time.time()
    tasks = [translate_chunk_async(c, target_lang, i+1, len(chunks)) for i, c in enumerate(chunks)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    parts = []
    total_in = total_out = 0
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            await log(f"[ERROR] {target_lang}/{src_name} chunk {i+1}: {r}")
            parts.append(chunks[i])  # fallback: keep original
        else:
            text, usage = r
            parts.append(text)
            total_in += usage.input_tokens
            total_out += usage.output_tokens
    result = "\n".join(parts)
    if target_lang == "VI":
        result = apply_vi_font_patches(result)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(result, encoding="utf-8")
    elapsed = time.time() - t0
    await log(f"[DONE] {target_lang}/{src_name} — {elapsed:.0f}s, in={total_in}, out={total_out}, bytes={len(result)}")

async def main():
    all_jobs = []
    for f in FILES:
        for lang in LANGS:
            all_jobs.append(translate_job(f, lang))
    await log(f"=== Starting {len(all_jobs)} translation jobs in parallel ===")
    t0 = time.time()
    await asyncio.gather(*all_jobs)
    await log(f"=== ALL DONE in {time.time()-t0:.0f}s ===")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
