#!/usr/bin/env python3
"""Sinh bo anh nhan dien cho DApp / Admin / World tu MIC Brand-kit.

README cua kit: file goc con dau co NEN TRANG, nen tren nen toi phai CAT TRON
chu khong dan o vuong. Duoi 120px thi dung monogram chu khong dung dau day du.
Script khong ve lai con dau — chi cat nen trang va thu nho.
"""
import os, sys, shutil, datetime
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
KIT  = os.path.join(ROOT, "MIC Brand-kit")
WRITE = "--write" in sys.argv

def seal_circle(size):
    """Con dau -> RGBA vuong canh `size`.

    Ban kit 18/08/2026 DA la RGBA co nen trong suot san (khac ban truoc co nen
    trang). Vi vay KHONG bo nen trang va KHONG mask tron nua — lam vay se cat cut
    hinh. Chi cat sat vien alpha roi dem cho vuong, giu nguyen net ve.
    """
    im = Image.open(os.path.join(KIT, "logo/seal-source.png")).convert("RGBA")
    box = im.split()[3].getbbox()          # vien thuc cua net ve
    im = im.crop(box)
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return sq.resize((size, size), Image.LANCZOS)

def monogram(size):
    im = Image.open(os.path.join(KIT, "avatars/monogram-circle-800.png")).convert("RGBA")
    return im.resize((size, size), Image.LANCZOS)

# duoi 120px dung monogram — luat trong README
TARGETS = [
 ("deploy/apps/web/public/images/mission-chain-logo-clear.png", 1024, "seal"),
 ("deploy/apps/web/public/images/mission-chain-logo-hd.png",    1024, "seal"),
 ("deploy/apps/web/public/icons/icon-512.png",                   512, "seal"),
 ("deploy/apps/web/public/icons/icon-192.png",                   192, "seal"),
 ("deploy/apps/web/public/icons/apple-touch-180.png",            180, "seal"),
 ("deploy/apps/web/public/icons/icon-32.png",                     32, "mono"),
 ("deploy/apps/admin/public/images/mission-chain-logo-clear.png",1024, "seal"),
 ("deploy/apps/admin/public/images/mission-chain-logo-hd.png",   1024, "seal"),
 ("missionchain_world/public/images/mission-chain-logo-clear.png",1024,"seal"),
 ("missionchain_world/public/images/mission-chain-logo-hd.png",  1024, "seal"),
]
stamp = datetime.date.today()
for rel, size, kind in TARGETS:
    dst = os.path.join(ROOT, "missionchain", rel)
    if not os.path.exists(os.path.dirname(dst)):
        print(f"  ⚠ khong co thu muc: {rel}"); continue
    img = seal_circle(size) if kind == "seal" else monogram(size)
    old = f"{size}px cu" if os.path.exists(dst) else "(moi)"
    print(f"  {kind:5s} {size:5d}px  {rel}")
    if WRITE:
        if os.path.exists(dst): shutil.copy(dst, f"{dst}.bak-{stamp}")
        img.save(dst)
if not WRITE:
    seal_circle(512).save("/tmp/_seal_preview.png"); monogram(128).save("/tmp/_mono_preview.png")
    print("\n  xem truoc: /tmp/_seal_preview.png · /tmp/_mono_preview.png  (them --write de ghi that)")
