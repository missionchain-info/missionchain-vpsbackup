#!/usr/bin/env python3
"""Phuong an B — dung lai he NEN cua landing theo ti le kit (navy 58%).

Buoc 1 (recolor.py) chi doi TONG mau, giu nguyen do sang, nen den van den.
Buoc nay NANG nen len Mission Navy: anh xa tuong minh 17 ma nen toi -> thang navy,
ghim token cua ca 3 chu de ve dung mau kit, va doi font sang Archivo.

    python3 landing_b.py <file.html> [--vi] [--write]
    --vi : file tieng Viet — GIU font hien tai (Owner chot 17/08/2026)
"""
import re, sys, shutil, datetime, os

# Nen toi -> thang navy. Trai qua do sang, khong doi mu tung ma.
GROUND = {
 "03050A":"091530", "050910":"091530",          # day nhat
 "080B12":"0E2148", "081626":"0E2148",          # NEN CHINH -> Mission Navy
 "0F1625":"142A57", "0A2038":"142A57", "0E2945":"142A57",
 "1A263E":"1B3668", "16304C":"1B3668",
 "1A366E":"24457E", "2A517A":"24457E",
 # crimson & gold: ghim ve dung mau kit
 "6B141F":"6E1220", "6B1A24":"6E1220", "8B1A28":"8C1524",
 "231F15":"0E2148",                              # chu tren nen sang -> navy
 "2D2718":"1B3668", "7A622A":"D4A63C",
}
# Token co ten -> gia tri kit, theo tung chu de
TOKENS = {
 "dark": {"--burgundy":"#6E1220", "--deep-purple":"#142A57", "--gold":"#D4A63C",
          "--gold-light":"#E8C874", "--cream":"#F3F2F2", "--white":"#FFFFFF",
          "--body-bg":"#0E2148", "--card-bg":"rgba(255,255,255,0.05)",
          "--border":"rgba(212,166,60,0.25)", "--nav-bg":"rgba(14,33,72,0.88)",
          "--dropdown-bg":"rgba(14,33,72,0.97)", "--text-dim":"rgba(243,242,242,0.72)"},
 "light":{"--burgundy":"#6E1220", "--deep-purple":"#1B3668", "--gold":"#A07A22",
          "--gold-light":"#8A6A1E", "--cream":"#0E2148", "--white":"#FFFFFF",
          "--body-bg":"#F3F2F2", "--card-bg":"rgba(255,255,255,0.78)",
          "--border":"rgba(160,122,34,0.24)", "--nav-bg":"rgba(243,242,242,0.94)",
          "--dropdown-bg":"rgba(255,255,255,0.98)", "--text-dim":"rgba(14,33,72,0.72)"},
 "royal":{"--burgundy":"#1B5FA8", "--deep-purple":"#1B3668", "--gold":"#D4A63C",
          "--gold-light":"#E8C874", "--cream":"#F3F2F2", "--body-bg":"#142A57",
          "--card-bg":"rgba(27,95,168,0.12)", "--border":"rgba(212,166,60,0.28)",
          "--nav-bg":"rgba(14,33,72,0.90)", "--dropdown-bg":"rgba(20,42,87,0.98)"},
}
FONT_MAP = {"Raleway":"Archivo", "Cinzel":"Archivo", "Montserrat":"Archivo", "Inter":"Archivo"}

def theme_of(block_start, text):
    """Selector that la 'body.theme-light' / 'body.theme-royal' — KHONG phai
    'body.light'. Doan nham thi chu de sang bi ap bo token toi va thanh khong doc duoc."""
    head = text[max(0, block_start-140):block_start]
    sel = head.strip().split("\n")[-1].strip()
    if "theme-royal" in sel: return "royal"
    if "theme-light" in sel or sel.startswith("body.light"): return "light"
    return "dark"

def run(path, keep_font, write):
    s = open(path).read(); orig = s
    n_ground = 0
    def g(m):
        nonlocal n_ground
        h = m.group(1).upper()
        if h in GROUND: n_ground += 1; return "#" + GROUND[h]
        return m.group(0)
    s = re.sub(r"#([0-9a-fA-F]{6})\b", g, s)

    n_tok = 0
    for m in list(re.finditer(r"\{[^{}]*?--body-bg\s*:[^{}]*?\}", s, re.S))[::-1]:
        th = theme_of(m.start(), s); blk = m.group(0)
        for k, v in TOKENS[th].items():
            blk, c = re.subn(rf"({re.escape(k)}\s*:\s*)([^;]+)(;)", lambda mm: mm.group(1)+v+mm.group(3), blk)
            n_tok += c
        s = s[:m.start()] + blk + s[m.end():]

    n_font = 0
    if not keep_font:
        for old, new in FONT_MAP.items():
            s, c = re.subn(rf"'{old}'", f"'{new}'", s); n_font += c
            s, c = re.subn(rf'"{old}"', f'"{new}"', s); n_font += c
        s = re.sub(r"family=(Raleway|Cinzel|Montserrat|Inter)(:[^&\"']*)?", r"family=Archivo:wght@400;500;600;700;800", s)
        s = re.sub(r"(family=Archivo:wght@400;500;600;700;800&?)+", r"family=Archivo:wght@400;500;600;700;800&", s)

    rel = os.path.basename(os.path.dirname(path)) + "/" + os.path.basename(path)
    print(f"  {rel:34s} nen {n_ground:3d} · token {n_tok:3d} · font {n_font:3d}"
          + ("   (giu font VI)" if keep_font else ""))
    if write and s != orig:
        shutil.copy(path, f"{path}.bakB-{datetime.date.today()}")
        open(path, "w").write(s)

if __name__ == "__main__":
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    for f in files:
        run(f, "--vi" in sys.argv or "/VI/" in f, "--write" in sys.argv)
