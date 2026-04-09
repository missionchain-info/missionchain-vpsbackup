import sys, json, re, os, urllib.request, urllib.parse, urllib.error

DEEPL_KEY = sys.argv[1]
SOURCE_FILE = sys.argv[2]
OUTPUT_DIR = sys.argv[3]
LANGUAGES = {"ES": "es", "PT-BR": "pt", "KO": "ko", "VI": "vi"}

# DeepL API Pro endpoint (header-based auth)
DEEPL_URL_PRO = "https://api.deepl.com/v2/translate"

# Brand terms that must NOT be translated (from Glossary_Brand_Terms)
PROTECTED_TERMS = [
    "Mission Chain", "Mission Chain Network", "Mission Chain World",
    "missionchain.info", "missionchain.world", "missionchain.io",
    "MIC", "MIC Token", "MICE", "MICE License", "MICE Mining",
    "MFP-NFT", "Mission Faith Passport", "Mission Faith Passport NFT",
    "SOPHIA", "SOPHIA WORD", "SOPHIA AI",
    "Mission DAO", "Treasure DAO",
    "Adaptive Emission Engine",
    "Gnosis Safe", "PancakeSwap", "TWAP", "Chainlink",
    "BEP-20", "ERC-1155", "ERC-20", "TRC-20",
    "BSC", "BNB Smart Chain", "BNB",
    "USDT", "DEX", "CEX", "DApp", "NFT", "KYC",
    "Imago Dei", "Constitutional Steward",
    "Founding Partner", "Strategic Partner", "Luminary Founder",
    "Content Module", "Challenge Module", "Talent & Portfolio",
    "Work Marketplace", "Community Network", "Recognition System",
]

def protect_terms(text):
    """Wrap protected terms in <span translate='no'> tags."""
    for term in sorted(PROTECTED_TERMS, key=len, reverse=True):
        # Only protect terms not already inside HTML tags
        text = re.sub(
            r'(?<![<\w/])(' + re.escape(term) + r')(?![^<]*>)',
            r"<span translate='no'>\1</span>",
            text
        )
    return text

def unprotect_terms(text):
    """Remove the translate='no' wrapper after translation."""
    text = re.sub(r"<span translate='no'>([^<]*)</span>", r'\1', text)
    return text

def deepl_translate(text, target_lang, deepl_key):
    """Translate text using DeepL API with header-based auth and HTML tag handling."""
    # Protect brand terms before sending to DeepL
    text = protect_terms(text)

    data = json.dumps({
        "text": [text],
        "target_lang": target_lang,
        "tag_handling": "html",
        "ignore_tags": ["style", "script", "code", "pre"],
        "split_sentences": "nonewlines",
    }).encode("utf-8")

    req = urllib.request.Request(DEEPL_URL_PRO, data=data, method="POST")
    req.add_header("Authorization", f"DeepL-Auth-Key {deepl_key}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            translated = result["translations"][0]["text"]
            return unprotect_terms(translated)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise Exception(f"DeepL API error {e.code}: {body}")

def split_html(html):
    """Split HTML into translatable body chunks and non-translatable parts."""
    # Extract everything between <style>...</style> and <script>...</script>
    # We'll translate only the body content, excluding style and script blocks

    # Find body content
    body_match = re.search(r'(<body[^>]*>)([\s\S]*)(</body>)', html)
    if not body_match:
        return html, [], []

    before_body = html[:body_match.start()]
    body_open = body_match.group(1)
    body_content = body_match.group(2)
    body_close = body_match.group(3)
    after_body = html[body_match.end():]

    # Extract and replace script blocks with placeholders
    scripts = []
    def save_script(m):
        scripts.append(m.group(0))
        return f'<!--SCRIPT_PLACEHOLDER_{len(scripts)-1}-->'
    body_content = re.sub(r'<script>[\s\S]*?</script>', save_script, body_content)

    # Extract and replace style blocks with placeholders
    styles = []
    def save_style(m):
        styles.append(m.group(0))
        return f'<!--STYLE_PLACEHOLDER_{len(styles)-1}-->'
    body_content = re.sub(r'<style>[\s\S]*?</style>', save_style, body_content)

    return {
        'before_body': before_body,
        'body_open': body_open,
        'body_content': body_content,
        'body_close': body_close,
        'after_body': after_body,
        'scripts': scripts,
        'styles': styles,
    }

def reassemble_html(parts, translated_body):
    """Put translated body back together with scripts and styles."""
    # Restore script placeholders
    for i, script in enumerate(parts['scripts']):
        translated_body = translated_body.replace(f'<!--SCRIPT_PLACEHOLDER_{i}-->', script)

    # Restore style placeholders
    for i, style in enumerate(parts['styles']):
        translated_body = translated_body.replace(f'<!--STYLE_PLACEHOLDER_{i}-->', style)

    return (parts['before_body'] + parts['body_open'] +
            translated_body + parts['body_close'] + parts['after_body'])

def chunk_html(html_body, max_size=40000):
    """Split HTML body into chunks at safe boundaries (between top-level sections)."""
    # Split at section boundaries
    chunks = []
    sections = re.split(r'(<!-- ══[^>]*══ -->)', html_body)

    current_chunk = ""
    for part in sections:
        if len(current_chunk) + len(part) > max_size and current_chunk:
            chunks.append(current_chunk)
            current_chunk = part
        else:
            current_chunk += part

    if current_chunk:
        chunks.append(current_chunk)

    return chunks

# Read source file
print(f"Reading {SOURCE_FILE}...")
with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
    html = f.read()

# Split HTML
parts = split_html(html)
body_content = parts['body_content']

# Chunk the body for translation (DeepL has size limits)
chunks = chunk_html(body_content)
print(f"Split into {len(chunks)} chunks for translation")

os.makedirs(OUTPUT_DIR, exist_ok=True)

for deepl_lang, locale in LANGUAGES.items():
    print(f"\n{'='*40}")
    print(f"Translating to {deepl_lang} ({locale})...")
    print(f"{'='*40}")

    translated_chunks = []
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)} ({len(chunk)} chars)...", end=" ", flush=True)
        try:
            translated = deepl_translate(chunk, deepl_lang, DEEPL_KEY)
            translated_chunks.append(translated)
            print("OK")
        except Exception as e:
            if "text without parent" in str(e) or "Tag handling" in str(e):
                # Wrap in <div> to fix orphan text issue
                print("retrying with wrapper...", end=" ", flush=True)
                try:
                    wrapped = f"<div>{chunk}</div>"
                    translated = deepl_translate(wrapped, deepl_lang, DEEPL_KEY)
                    # Remove wrapper
                    translated = re.sub(r'^<div>([\s\S]*)</div>$', r'\1', translated)
                    translated_chunks.append(translated)
                    print("OK")
                except Exception as e2:
                    print(f"ERROR: {e2}")
                    translated_chunks.append(chunk)
            else:
                print(f"ERROR: {e}")
                translated_chunks.append(chunk)  # Fallback to original

    # Reassemble
    translated_body = "".join(translated_chunks)
    translated_html = reassemble_html(parts, translated_body)

    # Update lang attribute
    translated_html = re.sub(r'<html lang="en">', f'<html lang="{locale}">', translated_html)

    # Save
    locale_dir = os.path.join(OUTPUT_DIR, locale)
    os.makedirs(locale_dir, exist_ok=True)
    output_file = os.path.join(locale_dir, "index.html")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(translated_html)
    print(f"  Saved: {output_file} ({len(translated_html)} bytes)")

print("\n✅ All translations complete!")
