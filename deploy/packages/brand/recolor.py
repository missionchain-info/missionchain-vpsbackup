#!/usr/bin/env python3
"""Doi tong mau viet cung trong CSS sang he MIC Brand-kit.

KHONG anh xa tung ma mau mot (135 ma — lam vay se ra bun). Cach lam:
giu NGUYEN do sang L va do bao hoa tuong doi, chi keo TONG mau ve dung ho:
  tim/violet  -> Mission Navy      xanh duong -> Globe Blue
  vang/cam    -> Seal Gold         do/hong    -> Action Red
  xanh la     -> giu (mau trang thai)   xam    -> pha nhe sac navy
Giu L nghia la giao dien sang van sang, toi van toi, tuong phan khong doi.

    python3 recolor.py <file.css> [--write]
"""
import re, sys, colorsys, shutil, datetime, os

KEEP = {"0E2148","142A57","1B3668","24457E","091530","D4A63C","E8C874","8C1524",
        "C05A66","6E1220","1B5FA8","F3F2F2","FFFFFF","A8B4CC","7D8CA8","2E9E6B",
        "8B6EF0","B9A3FA","000000"}
def hue_of(hexs):
    r,g,b=(int(hexs[i:i+2],16)/255 for i in (0,2,4))
    return colorsys.rgb_to_hls(r,g,b)[0]
H_NAVY, H_GOLD, H_RED, H_BLUE = map(hue_of, ("0E2148","D4A63C","8C1524","1B5FA8"))

def convert(hexs):
    r,g,b=(int(hexs[i:i+2],16)/255 for i in (0,2,4))
    h,l,s = colorsys.rgb_to_hls(r,g,b)
    deg = h*360
    if s < 0.10:                       th, ts = H_NAVY, min(0.10, s+0.05)   # xam -> pha navy
    elif 250 <= deg <= 330:            th, ts = H_NAVY, s                    # tim
    elif 200 <= deg < 250:             th, ts = H_BLUE, s                    # xanh duong
    elif 25 <= deg <= 70:              th, ts = H_GOLD, s                    # vang/cam
    elif deg < 20 or deg > 330:        th, ts = H_RED,  s                    # do/hong
    else:                              return None                           # xanh la: giu
    r2,g2,b2 = colorsys.hls_to_rgb(th, l, ts)
    return "%02X%02X%02X" % tuple(round(v*255) for v in (r2,g2,b2))

src = sys.argv[1]; write = "--write" in sys.argv
css = open(src).read()
# Voi file CSS: bo qua khoi :root dau tien (da dat dung token).
# Voi file HTML (--all): xu ly ca file — HTML khong co lop token de giu.
if "--all" in sys.argv:
    head, body = "", css
else:
    m = re.search(r":root\s*\{.*?\}", css, re.S)
    head, body = (css[:m.end()], css[m.end():]) if m else ("", css)

seen = {}
def sub(mm):
    hx = mm.group(1).upper()
    if hx in KEEP: return mm.group(0)
    new = convert(hx)
    if not new: return mm.group(0)
    seen[hx] = new
    return "#" + new
body = re.sub(r"#([0-9a-fA-F]{6})\b", sub, body)

# rgb()/rgba() cung phai doi — rat nhieu nen the va vien trong file nay viet bang
# rgba(), neu chi doi hex thi giao dien van con mang tim.
def sub_rgb(mm):
    r,g,b = (int(v) for v in mm.group(2,3,4))
    hx = "%02X%02X%02X" % (r,g,b)
    if hx in KEEP: return mm.group(0)
    new = convert(hx)
    if not new: return mm.group(0)
    seen[hx] = new
    nr,ng,nb = (int(new[i:i+2],16) for i in (0,2,4))
    tail = mm.group(5) or ""
    return f"{mm.group(1)}({nr}, {ng}, {nb}{tail})"
body = re.sub(r"\b(rgba?)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,[^)]*)?\)",
              sub_rgb, body)

print(f"{os.path.basename(src)}: doi {len(seen)} ma mau")
for old,new in sorted(seen.items(), key=lambda kv:-len(kv[0]))[:10]:
    print(f"   #{old} → #{new}")
if write:
    shutil.copy(src, f"{src}.bak2-{datetime.date.today()}")
    open(src,"w").write(head+body)
    print("   ✓ da ghi")
else:
    open(src+".new","w").write(head+body); print(f"   → xem truoc: {os.path.basename(src)}.new")
