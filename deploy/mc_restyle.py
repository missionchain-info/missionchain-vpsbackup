# -*- coding: utf-8 -*-
import re,sys
IMPORT_NEW="@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600&family=Marcellus&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Noto+Serif+KR:wght@400;600&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');"

def anchored(text, varname, old, new):
    # replace value after "--varname:" preserving whitespace/alignment; only where old value matches
    pat=re.compile(r'(--'+re.escape(varname)+r':\s*)'+re.escape(old)+r'(?=[;\s])')
    return pat.subn(lambda m:m.group(1)+new, text)

def apply(path, colors, fonts):
    s=open(path,encoding='utf-8').read(); orig=s; n=0
    for varname,old,new in colors:
        s,c=anchored(s,varname,old,new); n+=c
        if c==0: print("  !! NO MATCH:",varname,old)
    # fonts
    s2=s.replace("--font-d: 'Montserrat', sans-serif;","--font-d: 'Marcellus', 'Noto Serif KR', Georgia, serif;")
    s2=s2.replace('--font-d:   "Montserrat", sans-serif;','--font-d:   "Marcellus", "Noto Serif KR", Georgia, serif;')
    s2=s2.replace("--font-b: 'Inter', sans-serif;","--font-b: 'Manrope', 'Noto Sans KR', system-ui, sans-serif;")
    s2=s2.replace('--font-b:   "Inter", sans-serif;','--font-b:   "Manrope", "Noto Sans KR", system-ui, sans-serif;')
    fc = (s2!=s); s=s2
    # import
    if "family=Montserrat:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');" in s:
        s=re.sub(r"@import url\('https://fonts\.googleapis\.com/css2\?family=Montserrat[^\n]*display=swap'\);", IMPORT_NEW, s, count=1)
        imp="replaced"
    else:
        # admin: no @import -> prepend
        s=IMPORT_NEW+"\n"+s; imp="prepended"
    open(path,'w',encoding='utf-8').write(s)
    print(f"{path}: colors changed={n}, fonts={'yes' if fc else 'NO'}, import={imp}, bytes {len(orig)}->{len(s)}")

WEB=[
("bg","#0F0A18","#140A1C"),("bg2","#1A1228","#1E1130"),("bg3","#2A1B3F","#2A1740"),("bg4","#34234F","#3A2352"),
("purple","#9B5BC9","#6A3A7E"),("purple2","#D4A4E8","#A878BC"),("blue","#8B2A4C","#7A1E38"),("blue2","#C9526B","#A64158"),
("gold","#E8C96A","#C99A52"),("gold2","#F5D56E","#E7CE9E"),("cream","#F5E8CC","#F4EFE9"),("white","#F5E8CC","#F4EFE9"),
("muted","#D4C098","#C4B6C7"),("gray","#C9B0E0","#C4B6C7"),("gray2","#B89BC8","#A796A9"),
("success","#66BB6A","#4FA97F"),("warning","#FFB347","#D9A441"),("error","#EF5350","#C9607A"),("info","#29B6F6","#6FA8C9"),("cyan","#4DD0E1","#5FB6B0"),
("border","rgba(212, 160, 23, 0.30)","rgba(201,154,82,0.22)"),("glow-p","rgba(123, 45, 139, 0.3)","rgba(201,154,82,0.14)"),("glow-b","rgba(107, 20, 40, 0.2)","rgba(122,30,56,0.20)"),
# light (body.light)
("bg","#F8F5F0","#F4EEE6"),("bg2","#F0EBE3","#FBF7F1"),("bg3","#E8E2D8","#ECE2D4"),("bg4","#DDD6CA","#E3D8C8"),
("purple","#7B2D8B","#5A2A6E"),("purple2","#9B4DB5","#7A4A8E"),("blue","#6B1428","#6C1830"),("blue2","#8B2A3E","#8A2A44"),
("gold","#9A7B2E","#A9803C"),("gold2","#B8942E","#8A6A2C"),("cream","#1C1008","#241426"),("white","#1A1208","#241426"),
("muted","#5A4E42","#6A5A6A"),("gray","#7A6E62","#6A5A6A"),("gray2","#A09488","#8A7A8A"),
("success","#2E7D32","#2E8B5E"),("warning","#E67700","#B87500"),("error","#C62828","#B0405C"),
]
ADMIN=[
("bg","#14102A","#140A1C"),("bg2","#221636","#1E1130"),("bg3","#2E1F45","#2A1740"),("bg4","#3A2858","#3A2352"),
("purple","#9B5BC9","#6A3A7E"),("purple2","#E0B0F0","#A878BC"),("crimson","#8B2A4C","#7A1E38"),("crimson2","#D4566B","#A64158"),
("gold","#E8C96A","#C99A52"),("gold2","#F5D56E","#E7CE9E"),("copper","#D4A270","#C79A6A"),
("white","#F5EDE0","#F4EFE9"),("gray","#D4C098","#C4B6C7"),("gray2","#C9B0E0","#A796A9"),
("border","rgba(212, 160, 23, 0.28)","rgba(201,154,82,0.22)"),("border2","rgba(212, 160, 23, 0.40)","rgba(201,154,82,0.42)"),
("glow-p","rgba(123,45,139,.35)","rgba(201,154,82,.14)"),("glow-c","rgba(107,20,40,.25)","rgba(122,30,56,.20)"),
("grad-p","linear-gradient(135deg, #7B2D8B, #6B1428)","linear-gradient(135deg, #3A2352, #7A1E38)"),
("grad-g","linear-gradient(135deg, #C9A84C, #E8C96A)","linear-gradient(135deg, #C99A52, #E7CE9E)"),
("grad-full","linear-gradient(90deg, #7B2D8B, #6B1428, #C9A84C)","linear-gradient(90deg, #3A2352, #7A1E38, #C99A52)"),
# light [data-theme="light"]
("bg","#F2ECE2","#F4EEE6"),("bg2","#E8E0D2","#ECE2D4"),("bg3","#FFFFFF","#FBF7F1"),("bg4","#ECE5D8","#E3D8C8"),
("purple","#6A1F7A","#5A2A6E"),("purple2","#8B3A9C","#7A4A8E"),("crimson","#5A0E20","#6C1830"),
("gold","#9A7A28","#A9803C"),("gold2","#B8922E","#8A6A2C"),
("white","#0E0618","#241426"),("gray","#2A1A30","#3A2A40"),("gray2","#5A4860","#6A5A6A"),
("border","rgba(90,50,100,.18)","rgba(42,23,64,.16)"),("border2","rgba(90,50,100,.25)","rgba(42,23,64,.28)"),
("glow-p","rgba(123,45,139,.12)","rgba(122,30,56,.10)"),("glow-c","rgba(107,20,40,.1)","rgba(201,154,82,.10)"),
]
which=sys.argv[1]
if which=="web": apply("apps/web/styles/globals.css",WEB,True)
else: apply("apps/admin/styles/globals.css",ADMIN,True)
