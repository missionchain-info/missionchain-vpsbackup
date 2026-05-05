#!/usr/bin/env python3
"""
Translate HTML files from EN → ES/KO/PT/VI using Claude API.
Chunked approach: split on safe HTML boundaries, translate each chunk, concatenate.
For VI: additionally apply font patches (Montserrat for all + Be Vietnam Pro + Noto Serif Display imports).
"""
import os
import re
import sys
import json
import time
from pathlib import Path
from anthropic import Anthropic

# Pick up API key
with open("/opt/claudia/config/.env") as f:
    for line in f:
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.strip().split("=", 1)[1]
            break

client = Anthropic()
MODEL = "claude-sonnet-4-5"

GLOSSARY_PRESERVE = [
    "MIC", "MICE", "MFP-NFT", "MissionChain", "Mission Chain", "SOPHIA", "NIRA",
    "BSC", "BEP-20", "BNB", "USDT", "DAO", "DEX", "CEX",
    "PancakeSwap", "Chainlink", "Claude", "Anthropic", "Sumsub",
    "LockManager", "MICToken", "LiquidityPool", "DAOGovernor",
    "Builder", "Maker", "Luminary", "Mission Founders Pass",
    "Adaptive Emission Engine", "Mission World",
    "KYC", "AML", "OFAC", "GDPR",
    "CertiK", "Immunefi", "OpenZeppelin", "TWAP", "APY", "TVL", "ROI",
    "GV Bonus", "Weekly Growth Reward", "Monthly Community Reward", "Lucky Draw",
    "Seed Round", "SEED", "Pre-Sale", "PreSale",
    "Founding Partner", "Early Bird", "Package",
    "Hybrid Lock", "Circuit Breaker", "Standing Committee",
    "Timelock", "AccessControl", "E(t)", "E₀", "D(t)", "R(t)", "W(t)", "T_half", "λ",
    "Smart Contract", "OpenClaw", "CLAUDIA",
]

LANG_NAMES = {
    "ES": "Spanish (Español)",
    "KO": "Korean (한국어)",
    "PT": "Portuguese (Português brasileiro)",
    "VI": "Vietnamese (Tiếng Việt)",
}

SYSTEM_PROMPT = """You are a professional technical translator specializing in Web3/blockchain whitepapers.

TASK: Translate HTML content from English to {target_lang}.

STRICT RULES:
1. PRESERVE all HTML tags, attributes, CSS classes, IDs, scripts, styles, comments EXACTLY
2. ONLY translate human-readable text content inside tags (between > and <)
3. DO NOT translate these terms (keep them in English):
{glossary}
4. DO NOT translate: numbers, percentages, $amounts, URLs, email addresses, HTML/CSS/JS code
5. For Vietnamese: use standard diacritics; keep technical tone
6. Output ONLY the translated HTML — no commentary, no markdown code blocks
7. Output must have EXACTLY the same HTML structure and number of tags as input
8. Translate attribute values that display to users: alt, title, aria-label, placeholder, data-t

Return the translated HTML chunk directly."""

def build_system_prompt(target_lang):
    glossary = "\n".join(f"   - {t}" for t in GLOSSARY_PRESERVE)
    return SYSTEM_PROMPT.format(target_lang=LANG_NAMES[target_lang], glossary=glossary)

def split_html(html, max_chars=30000):
    """Split HTML into chunks at safe boundaries.
    Keep head intact as first chunk; body split at section/div boundaries."""
    # Find <head>...</head>
    head_match = re.search(r"(.*?</head>\s*<body[^>]*>)(.*?)(</body>.*)", html, re.DOTALL)
    if not head_match:
        # fallback: just split by size at element boundaries
        return [html]
    head = head_match.group(1)
    body = head_match.group(2)
    tail = head_match.group(3)
    chunks = [head]
    # Split body into chunks at </section>, </div class="section">, </div> top-level boundaries
    # Heuristic: split on double newlines between major blocks
    current = []
    size = 0
    lines = body.split("\n")
    for line in lines:
        current.append(line)
        size += len(line) + 1
        # Good split points: after closing tags of major sections
        if size >= max_chars and (
            re.search(r"</section>\s*$", line) or
            re.search(r"</div>\s*$", line) or
            re.search(r"<!-- .*? -->\s*$", line)
        ):
            chunks.append("\n".join(current))
            current = []
            size = 0
    if current:
        chunks.append("\n".join(current))
    chunks.append(tail)
    return chunks

def translate_chunk(chunk, target_lang, chunk_idx, total):
    system = build_system_prompt(target_lang)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=[{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"}
        }],
        messages=[{
            "role": "user",
            "content": f"Translate this HTML chunk to {LANG_NAMES[target_lang]} (chunk {chunk_idx}/{total}):\n\n{chunk}"
        }]
    )
    text = resp.content[0].text
    return text, resp.usage

def apply_vi_font_patches(html):
    """For Vietnamese: change --font-b and --font-m to Montserrat, add extra Google Fonts import."""
    # Change CSS vars
    html = re.sub(
        r'--font-b:\s*"Inter"\s*,\s*sans-serif;',
        '--font-b:     "Montserrat",sans-serif;',
        html
    )
    html = re.sub(
        r'--font-m:\s*"JetBrains Mono"\s*,\s*monospace;',
        '--font-m:     "Montserrat",sans-serif;',
        html
    )
    # Add extra Google Fonts import after existing Montserrat+Inter+JetBrains link
    extra_link = '<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700;800&family=Noto+Serif+Display:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>'
    if 'Be+Vietnam+Pro' not in html:
        html = re.sub(
            r'(<link href="https://fonts\.googleapis\.com/css2\?family=Montserrat[^"]+"\s*rel="stylesheet"/>)',
            r'\1\n' + extra_link,
            html, count=1
        )
    return html

def translate_file(src_path, target_lang, dest_path, verbose=True):
    html = Path(src_path).read_text(encoding="utf-8")
    chunks = split_html(html, max_chars=30000)
    if verbose:
        print(f"[{target_lang}] {src_path.name}: {len(chunks)} chunks")
    translated_parts = []
    total_in = total_out = total_cached_in = 0
    for i, chunk in enumerate(chunks, 1):
        if verbose:
            print(f"  chunk {i}/{len(chunks)} ({len(chunk)} chars)...", end=" ", flush=True)
        t0 = time.time()
        try:
            translated, usage = translate_chunk(chunk, target_lang, i, len(chunks))
            translated_parts.append(translated)
            total_in += usage.input_tokens
            total_out += usage.output_tokens
            if hasattr(usage, "cache_read_input_tokens"):
                total_cached_in += usage.cache_read_input_tokens or 0
            if verbose:
                print(f"done in {time.time()-t0:.1f}s  (in={usage.input_tokens} out={usage.output_tokens})")
        except Exception as e:
            if verbose:
                print(f"ERROR: {e}")
            raise
    result = "\n".join(translated_parts)
    if target_lang == "VI":
        result = apply_vi_font_patches(result)
    Path(dest_path).parent.mkdir(parents=True, exist_ok=True)
    Path(dest_path).write_text(result, encoding="utf-8")
    if verbose:
        print(f"  Wrote {dest_path} ({len(result)} bytes)")
        print(f"  Total tokens: in={total_in}  out={total_out}  cached_read={total_cached_in}")
    return total_in, total_out, total_cached_in

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: translate.py <source-file> <target-lang> [<output-path>]")
        sys.exit(1)
    src = Path(sys.argv[1])
    lang = sys.argv[2]
    dest = Path(sys.argv[3]) if len(sys.argv) > 3 else src.parent / lang / src.name
    translate_file(src, lang, dest)
