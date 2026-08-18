#!/usr/bin/env python3
"""brand.json -> ghi token vao globals.css cua tung app.

Cach lam: KHONG xoa khoi :root cu. Doc tung khai bao --x: y trong :root, ghi de
nhung bien co trong bang anh xa, giu nguyen phan con lai (--build-stamp,
--transition, --grad-*...). Nhu vay khong lam mat thu minh chua hieu.

    python3 sync.py            # xem truoc, khong ghi
    python3 sync.py --write    # ghi that (co .bak)
"""
import json, re, sys, shutil, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
B = json.load(open(os.path.join(HERE, "brand.json")))
WRITE = "--write" in sys.argv
# Cho phep chi dinh file cu the: sync.py <file1> <file2> --write
_files = [a for a in sys.argv[1:] if not a.startswith("--")]
APPS = ({os.path.basename(p): p for p in _files} if _files else {
    "web":   os.path.join(HERE, "../../apps/web/styles/globals.css"),
    "admin": os.path.join(HERE, "../../apps/admin/styles/globals.css"),
})
K, R, T, S, SEC = B["kit"], B["ramp"], B["text"], B["semantic"], B["secondary"]

# bien CSS -> gia tri moi. Ten bien giu nguyen de khong phai sua 13k dong CSS.
VARS = {
    "--bg": R["bg"], "--bg2": R["bg2"], "--bg3": R["bg3"], "--bg4": R["bg4"],
    "--gold": K["gold"]["hex"], "--gold2": K["goldLight"]["hex"],
    "--crimson": K["red"]["hex"], "--crimson2": "#C05A66",
    "--blue": K["red"]["hex"], "--blue2": "#C05A66",      # web goi nhanh do la --blue
    "--purple": SEC["purple"]["hex"], "--purple2": SEC["purple2"]["hex"],
    "--white": T["white"], "--cream": K["ivory"]["hex"],
    "--gray": T["gray"], "--gray2": T["gray2"], "--muted": T["gray"],
    "--copper": K["goldLight"]["hex"], "--cyan": K["blue"]["hex"],
    "--success": S["success"], "--warning": S["warning"],
    "--error": S["error"], "--info": S["info"],
    "--border":  "rgba(212,166,60,0.22)",
    "--border2": "rgba(212,166,60,0.40)",
    "--glow-p":  "rgba(27,95,168,0.20)",
    "--glow-b":  "rgba(212,166,60,0.16)",
    "--glow-c":  "rgba(212,166,60,0.16)",
    # chu: Archivo xuyen suot. Tieng Viet giu font hien tai qua :lang(vi) o duoi.
    "--font-d": B["type"]["primaryStack"],
    "--font-b": B["type"]["primaryStack"],
    "--font-wordmark": B["type"]["primaryStack"],
    "--font-m": B["type"]["mono"],
    "--font-greek": B["type"]["greek"],
    # bien moi cua kit
    # Gradient: kit quy dinh HANH DONG CHINH la Action Red, khong phai tim.
    # Tim chi con la mau phu (cham quy dao, diem nhan), khong dung cho nut chinh.
    "--grad-p":    "linear-gradient(135deg, #8C1524, #6E1220)",
    "--grad-g":    "linear-gradient(135deg, #D4A63C, #E8C874)",
    "--grad-full": "linear-gradient(90deg, #0E2148, #6E1220, #D4A63C)",
    "--navy": K["navy"]["hex"], "--covenant": K["crimson"]["hex"],
    "--action": K["red"]["hex"], "--globe": K["blue"]["hex"],
    "--ivory": K["ivory"]["hex"], "--bg0": R["bg0"],
}
VI = B["type"]["vietnamese"]
LANG_BLOCK = f"""
/* ── MIC Brand-kit · tieng Viet giu font hien tai (Owner chot 17/08/2026) ──
   Chi an khi the mang lang="vi". <html lang> phai doi theo ngon ngu dang chon,
   neu khong quy tac nay khong khop gi ca. Chu tieng Viet nam trong trang khac
   ngon ngu se dung Archivo — Archivo co day du bo dau tieng Viet nen khong vo chu. */
:lang(vi) {{ --font-d: {VI["display"]}; --font-b: {VI["body"]}; --font-wordmark: {VI["display"]}; }}
"""
FONT_IMPORT = ("@import url('https://fonts.googleapis.com/css2?"
               "family=Archivo:wght@400;500;600;700;800&"
               "family=Sora:wght@400;500;600;700;800&"
               "family=Space+Grotesk:wght@400;500;600;700&"
               "family=JetBrains+Mono:wght@400;500;700&"
               "family=Noto+Serif:wght@400;600&"
               "family=Noto+Sans+KR:wght@300;400;500;700&display=swap');")
MARK = "/* ==== MIC Brand-kit tokens · sinh boi packages/brand/sync.py — dung sua tay ==== */"

def patch(css):
    changed = []
    m = re.search(r"(:root\s*\{)(.*?)(\})", css, re.S)
    if not m: raise SystemExit("khong thay khoi :root")
    body = m.group(2)
    for var, new in VARS.items():
        pat = re.compile(rf"(^\s*{re.escape(var)}\s*:\s*)([^;]+)(;)", re.M)
        hit = pat.search(body)
        if hit:
            if hit.group(2).strip() != new:
                changed.append((var, hit.group(2).strip(), new))
                body = pat.sub(lambda mm: mm.group(1)+new+mm.group(3), body, count=1)
        else:
            changed.append((var, "(chua co)", new))
            body = body.rstrip() + f"\n  {var}: {new};\n"
    body = body.replace(
        "/* Dark REFRESH (2026-08) — indigo-plum depth, luminous violet + gold, crisper text */",
        "/* MIC Brand-kit (17/08/2026) — Mission Navy lam nen chinh, Seal Gold cho duong ke,\n     Action Red cho hanh dong. Tim giu lam mau phu ngoai kit theo quyet dinh cua Owner. */")
    body = body.replace(
        "/* ── BRAND TOKENS (exact from whitepaper) ── */", "")
    css = css[:m.start(2)] + body + css[m.end(2):]
    css = re.sub(r"@import url\('https://fonts\.googleapis\.com[^']*'\);", FONT_IMPORT, css, count=1)
    if ":lang(vi)" not in css:
        css = css.replace(m.group(3), m.group(3) + "\n" + LANG_BLOCK, 1) if False else \
              re.sub(r"(:root\s*\{.*?\})", r"\1\n" + LANG_BLOCK.replace("\\", "\\\\"), css, count=1, flags=re.S)
    if MARK not in css:
        css = MARK + "\n" + css
    return css, changed

for app, path in APPS.items():
    src = open(path).read()
    out, changed = patch(src)
    print(f"\n=== {app} · {len(changed)} bien ===")
    for v, old, new in changed[:8]:
        print(f"   {v:16s} {old[:34]:36s} → {new[:40]}")
    if len(changed) > 8: print(f"   … con {len(changed)-8} bien nua")
    if WRITE:
        shutil.copy(path, path + f".bak-{datetime.date.today()}")
        open(path, "w").write(out)
        print(f"   ✓ da ghi (sao luu .bak-{datetime.date.today()})")
    else:
        open(path + ".new", "w").write(out)
        print(f"   → xem truoc: {os.path.basename(path)}.new")
