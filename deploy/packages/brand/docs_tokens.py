#!/usr/bin/env python3
"""Ghim token cua cac trang TAI LIEU (White_Paper, Glossary, mc_*) ve mau kit.

Cac trang nay dung CUNG bo ten token voi DApp (--bg/--gold/--purple...), khong
phai --body-bg nhu trang chu, nen bo ghim cua landing khong cham toi chung.
"""
import re, sys, shutil, datetime, os
T = {
 "--bg":"#0E2148", "--bg2":"#142A57", "--bg3":"#1B3668", "--bg4":"#24457E",
 "--purple":"#1B5FA8", "--purple2":"#5C93CE",          # phu -> Globe Blue
 "--blue":"#6E1220",  "--blue2":"#C05A66",             # nhan do -> Covenant Crimson
 "--gold":"#D4A63C",  "--gold2":"#E8C874",
 "--green":"#2E9E6B", "--teal":"#1B5FA8",              # mau trang thai
 "--white":"#F3F2F2", "--gray":"#A8B4CC", "--gray2":"#7D8CA8",
 "--border":"rgba(212,166,60,.22)",
 "--glow-p":"rgba(27,95,168,.20)", "--glow-b":"rgba(212,166,60,.16)",
 "--langbar-bg":"rgba(14,33,72,.90)", "--sidebar-bg":"rgba(14,33,72,.97)",
 "--toggle-bg":"rgba(14,33,72,.90)",
}
def run(path, write):
    s=open(path).read(); o=s; n=0
    for k,v in T.items():
        s,c = re.subn(rf"({re.escape(k)}\s*:\s*)([^;]+)(;)",
                      lambda m: m.group(1)+v+m.group(3), s); n+=c
    rel="/".join(path.split("/")[-2:])
    print(f"  {rel:38s} {n:3d} token")
    if write and s!=o:
        shutil.copy(path, f"{path}.bakT-{datetime.date.today()}")
        open(path,"w").write(s)
if __name__=="__main__":
    for f in [a for a in sys.argv[1:] if not a.startswith("--")]:
        run(f, "--write" in sys.argv)
