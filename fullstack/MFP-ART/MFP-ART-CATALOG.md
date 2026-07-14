# MFP-ART · Genesis Collection

**MissionChain · Inspired by Faith. Built for People.**

A 100-piece sacred-art NFT collection. Each piece carries a unique title, a soul-line, and a Scripture verse — randomly paired at mint to give every collector a one-of-a-kind covenant.

---

## DESIGN SPECIFICATIONS

### Card Format (Option A)

```
┌────────────────────────────────────┐
│   ✦  MISSIONCHAIN  ✦               │   ← HEADER (deep purple)
│   MFP #0001 · GENESIS SERIES       │   Logo + Serial (gold)
│                                    │
│   ┌──────────────────────────┐    │
│   │                            │    │
│   │      [ NFT  ARTWORK ]      │    │   ← IMAGE 1024 × 1024
│   │                            │    │   Thin gold border (2px)
│   │                            │    │
│   └──────────────────────────┘    │
│                                    │
│   ────────  ✦  ────────           │   ← Gold divider
│                                    │
│   "DOVE OF GENESIS"                │   ← TITLE (Playfair, bold)
│                                    │
│   A white dove ascends through     │   ← SOUL LINE (Crimson, italic)
│   sacred orbit rings, carrying     │
│   the first spark of life.         │
│                                    │
│   ────────                         │
│                                    │
│   "And the Spirit of God moved     │   ← VERSE (italic, gold accent)
│    upon the face of the waters."   │
│             — Genesis 1:2          │
│                                    │
│   missionchain.io · 2026           │   ← FOOTER
└────────────────────────────────────┘
```

### Specifications

| Element            | Value                                   |
|--------------------|-----------------------------------------|
| Canvas width       | 1080 px (portrait, height auto)         |
| Image area         | 1024 × 1024 px (1:1 square, preserved)  |
| Image border       | 1.5 px gold, radius 6 px                |
| Background         | Gradient #1A0B2E → #0A0514               |
| Accent gold        | Classic Gold #D4A017 / #F5D56E           |
| Brand font         | Montserrat 900 (gradient: purple → gold) |
| Title font         | Playfair Display (serif, bold)          |
| Verse font         | Crimson Text (italic)                   |
| Body font          | Inter (sans, regular)                   |
| Serial format      | `MFP #0001` (zero-padded, 4 digits)     |
| Series tag         | `Genesis Series`                        |
| Watermark          | Flower of Life SVG (4% opacity) + star field (6%) |

### Metadata JSON (ERC-721 standard)

```json
{
  "name": "Dove of Genesis",
  "serial": "MFP-0001",
  "series": "Genesis",
  "description": "A white dove ascends through sacred orbit rings, carrying the first spark of life — every journey of faith begins here, in light.",
  "scripture": {
    "verse": "And the Spirit of God moved upon the face of the waters.",
    "reference": "Genesis 1:2"
  },
  "image": "ipfs://.../MFP-ART-001.png",
  "image_card": "ipfs://.../MFP-CARD-001.png",
  "attributes": [
    { "trait_type": "Theme", "value": "Holy Spirit" },
    { "trait_type": "Group", "value": "Sacred Symbols" },
    { "trait_type": "Palette", "value": "Gold-Purple" },
    { "trait_type": "Collection", "value": "MFP Genesis" }
  ],
  "external_url": "https://missionchain.io/nft/MFP-0001",
  "creator": "MissionChain"
}
```

---

## THE 100 PIECES

### I. SACRED SYMBOLS · 001-006

**MFP #001 — "Dove of Genesis"**
*A white dove ascends through sacred orbit rings, carrying the first spark of life — where every journey of faith begins, in light.*
> *"And the Spirit of God moved upon the face of the waters."* — **Genesis 1:2**

**MFP #002 — "Star of Bethlehem"**
*A golden star pierces the violet nebula, marking the cosmos with eternal hope — light has come to those who walk in darkness.*
> *"We have seen his star in the east, and are come to worship him."* — **Matthew 2:2**

**MFP #003 — "Book of the Stars"**
*An open book breathes pages of light into the night sky, where every word becomes a constellation — Scripture is not ink on paper, but stars in the soul.*
> *"Thy word is a lamp unto my feet, and a light unto my path."* — **Psalm 119:105**

**MFP #004 — "Eternal Chalice"**
*A golden cup burns without ever being consumed, holding the unceasing pour of grace through every generation.*
> *"My cup runneth over."* — **Psalm 23:5**

**MFP #005 — "City Beneath the Stars"**
*In the rush of the modern city, the heavens still bloom — faith does not sleep in the rhythm of the metropolis.*
> *"Ye are the light of the world. A city that is set on an hill cannot be hid."* — **Matthew 5:14**

**MFP #006 — "Mosaic of Peace"**
*A dove of peace inlaid in gold and gem — the breath of a thousand years of sacred art still rises in this single bird.*
> *"Blessed are the peacemakers: for they shall be called the children of God."* — **Matthew 5:9**

---

### II. STARRY NIGHT CHAPELS · 007-010

**MFP #007 — "Starry Night Chapel"**
*A small chapel glows beneath a swirling cosmos — faith is small, yet never extinguished.*
> *"The light shineth in darkness; and the darkness comprehended it not."* — **John 1:5**

**MFP #008 — "Chapel on the Hill"**
*The white sanctuary stands firm above the ocean of time — prayers lift higher than the swirling stars.*
> *"How amiable are thy tabernacles, O LORD of hosts!"* — **Psalm 84:1**

**MFP #009 — "House of Light"**
*A simple home beneath whirlpools of stars — every lit window is an invitation to come home.*
> *"In my Father's house are many mansions."* — **John 14:2**

**MFP #010 — "The Way Home"**
*A winding golden path leads up to the chapel on the hill — to walk toward God is to walk toward yourself.*
> *"I am the way, the truth, and the life."* — **John 14:6**

---

### III. ANGELS & MOTHERHOOD · 011-015

**MFP #011 — "Marble Seraph"**
*A marble angel stands serene beneath violet lightning — divine stillness conceals the storm of cosmic power.*
> *"Are they not all ministering spirits, sent forth to minister?"* — **Hebrews 1:14**

**MFP #012 — "Light of Motherhood"**
*Beside a sunlit window, a mother cradles her child in golden warmth — the most peaceful moment the human heart will ever know.*
> *"Behold, children are a heritage of the LORD."* — **Psalm 127:3**

**MFP #013 — "Modern Madonna"**
*A halo of gold behind her head, an angel asleep in her arms — the beauty of the Sacred Mother never grows old.*
> *"Blessed art thou among women, and blessed is the fruit of thy womb."* — **Luke 1:42**

**MFP #014 — "Eternal Warmth"**
*Cheek touches cheek, heart touches heart — the first and final language of love, spoken without words.*
> *"As one whom his mother comforteth, so will I comfort you."* — **Isaiah 66:13**

**MFP #015 — "Garden of Love"**
*Among flowers of sunlight, a mother gently holds her child — life blooms inside arms that hold gently.*
> *"And now abideth faith, hope, charity, these three; but the greatest of these is charity."* — **1 Corinthians 13:13**

---

### IV. NATURE & COVENANT · 016-020

**MFP #016 — "Rainbow Covenant"**
*A pastel rainbow arches over a violet cascade — Heaven's promise that peace will return after every storm.*
> *"I do set my bow in the cloud, and it shall be for a token of a covenant."* — **Genesis 9:13**

**MFP #017 — "Falls of Mercy"**
*A great cascade glows in the last light of day, a rainbow embraces the rushing water — nature is a temple without walls or doors.*
> *"His mercies are new every morning."* — **Lamentations 3:23**

**MFP #018 — "Rose of the Sanctuary"**
*Looking up from within the cathedral, a rose of glass blooms in the dark — light always finds its way through the smallest cracks.*
> *"The LORD is in his holy temple."* — **Habakkuk 2:20**

**MFP #019 — "Cosmic Rose Window"**
*A Gothic rose floats among the stars — sacred architecture meets the boundless cosmos. Faith needs no walls to exist.*
> *"The Lord shall reign for ever and ever."* — **Exodus 15:18**

**MFP #020 — "Sacred Mountain of Light"**
*A pure snow-capped peak, a cascade of liquid gold — grace never runs dry; it waits only for those who lift their eyes.*
> *"I will lift up mine eyes unto the hills, from whence cometh my help."* — **Psalm 121:1**

---

### V. DOVES, FEATHER & QUILL · 021-024

**MFP #021 — "City of Liberation"**
*Thousands of doves break their chains and rise above the sunset city — every freed soul is a new star in the heavens.*
> *"If the Son therefore shall make you free, ye shall be free indeed."* — **John 8:36**

**MFP #022 — "Wings of Glory"**
*A great dove tears through the wind, feathers shimmering in golden light — a moment of absolute freedom, absolute holiness.*
> *"They that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles."* — **Isaiah 40:31**

**MFP #023 — "Galaxy Feather"**
*A golden feather drifts above a spiral galaxy — Heaven's poetry, written in light.*
> *"He shall cover thee with his feathers, and under his wings shalt thou trust."* — **Psalm 91:4**

**MFP #024 — "Divine Quill"**
*A quill flies through the cosmos, scattering sparks like unwritten verses — every soul is a page still being written.*
> *"Ye are our epistle written in our hearts."* — **2 Corinthians 3:2**

---

### VI. MUSIC OF HEAVEN · 025-026

**MFP #025 — "Harp of David"**
*The golden harp of King David hovers among the stars — every trembling string sends a prayer into infinity.*
> *"Sing unto him with the psaltery and an instrument of ten strings."* — **Psalm 33:2**

**MFP #026 — "Music of the Doves"**
*A chord rises, and the notes themselves become doves taking flight — true worship is when our prayers become living things.*
> *"Let every thing that hath breath praise the LORD."* — **Psalm 150:6**

---

### VII. GUIDANCE & DESTINATION · 027-033

**MFP #027 — "Cosmic Madonna"**
*A silhouette of mother and child cradled by orbital halos — the eternal Madonna and Child, transcending every age.*
> *"Mary kept all these things, and pondered them in her heart."* — **Luke 2:19**

**MFP #028 — "Lighthouse of Glory"**
*A golden lighthouse stands firm in the storm, its beam piercing the darkest cloud — faith is the lamp no wind can quench.*
> *"The LORD is my light and my salvation; whom shall I fear?"* — **Psalm 27:1**

**MFP #029 — "Jacob's Ladder"**
*White-robed souls climb a golden stair into the galaxy — no journey is ever solitary; one always walks before, one always after.*
> *"Behold a ladder set up on the earth, and the top of it reached to heaven."* — **Genesis 28:12**

**MFP #030 — "Tree of Covenant"**
*An ancient tree sends roots like a network into the earth, branches blooming with stars above — where ancient faith meets the new age.*
> *"He shall be like a tree planted by the rivers of water."* — **Psalm 1:3**

**MFP #031 — "Cross Over the City"**
*A cross of light tears through the metropolitan sky — even in the rhythm of modern life, He still abides.*
> *"And I, if I be lifted up from the earth, will draw all men unto me."* — **John 12:32**

**MFP #032 — "The Good Shepherd"**
*The shepherd carries the lamb home, the flock following beneath the sacred sun — "I know my sheep, and am known of mine."*
> *"I am the good shepherd: the good shepherd giveth his life for the sheep."* — **John 10:11**

**MFP #033 — "New Jerusalem"**
*A golden city floats in the cosmos, a river of light pouring upon the earth — "Behold, I make all things new."*
> *"And I John saw the holy city, new Jerusalem, coming down from God out of heaven."* — **Revelation 21:2**

---

### VIII. KINTSUGI SOULS · 034-035, 038, 041-042, 046

**MFP #034 — "Kintsugi Soul"**
*A marble bust glows from its broken cracks — every wound becomes the very place where the light enters.*
> *"He healeth the broken in heart, and bindeth up their wounds."* — **Psalm 147:3**

**MFP #035 — "Healed Wounds"**
*Where the marble has broken, gold now flows — what was shattered becomes the source of beauty.*
> *"He hath sent me to bind up the brokenhearted."* — **Isaiah 61:1**

**MFP #038 — "Vessel of Light"**
*A marble body filled with rivers of gold — we are clay vessels carrying treasure not our own.*
> *"We have this treasure in earthen vessels, that the excellency of the power may be of God."* — **2 Corinthians 4:7**

**MFP #041 — "Stone of Promise"**
*A great rock of marble cracks open with golden lightning — the foundation of faith does not break under storm; it shines.*
> *"Upon this rock I will build my church."* — **Matthew 16:18**

**MFP #042 — "Resurrection"**
*A marble form rises through the clouds, pierced by divine light — death has no more dominion; the dust remembers its glory.*
> *"I am the resurrection, and the life."* — **John 11:25**

**MFP #046 — "Living Stone"**
*From cold marble, golden veins pulse with life — even stone may breathe when grace flows through it.*
> *"Ye also, as lively stones, are built up a spiritual house."* — **1 Peter 2:5**

---

### IX. PORTALS & THRESHOLDS · 036, 037, 039, 040, 043, 096-097

**MFP #036 — "The Pilgrim's Portal"**
*A traveler stands at the threshold of a golden vortex — every soul must one day step through into the unknown.*
> *"Strait is the gate, and narrow is the way, which leadeth unto life."* — **Matthew 7:14**

**MFP #037 — "Awakened Spirit"**
*A figure of pure light stands amid the violet cosmos — when the spirit awakens, the body itself becomes a temple of stars.*
> *"Know ye not that ye are the temple of God?"* — **1 Corinthians 3:16**

**MFP #039 — "Fire of the Spirit"**
*A robed figure stands within rings of holy fire — to be filled with the Spirit is to burn without being consumed.*
> *"Our God is a consuming fire."* — **Hebrews 12:29**

**MFP #040 — "Gate of Wonder"**
*A small soul stands beneath a vast cosmic gate — sometimes faith is simply daring to look up.*
> *"Lift up your heads, O ye gates; and be ye lift up, ye everlasting doors."* — **Psalm 24:7**

**MFP #043 — "Soul Ascending"**
*A silhouette burns in concentric rings of holy flame — the soul ascends through fire and is not destroyed.*
> *"When thou walkest through the fire, thou shalt not be burned."* — **Isaiah 43:2**

**MFP #096 — "Halo of the Horizon"**
*A great ring of golden fire rises over the landscape at sunset — the gates of glory open at the edges of the visible world.*
> *"This is the gate of the LORD."* — **Psalm 118:20**

**MFP #097 — "Threshold of Heaven"**
*A wanderer approaches a ring of golden flame above a vast valley — not every passage is fearful when light marks the way.*
> *"I am the door: by me if any man enter in, he shall be saved."* — **John 10:9**

---

### X. THE CREATOR'S ART · 044-045, 064

**MFP #044 — "The Creator's Brush"**
*An artist paints galaxies with strokes of gold — every act of creation is a small echo of the first.*
> *"In the beginning God created the heaven and the earth."* — **Genesis 1:1**

**MFP #045 — "Wonder of Creation"**
*A figure stands before a cosmic canvas, dwarfed by infinite swirls — to behold is also to worship.*
> *"The heavens declare the glory of God; and the firmament sheweth his handywork."* — **Psalm 19:1**

**MFP #064 — "Spiral of Creation"**
*A swirling nebula of violet and gold — the cosmos still turns by the breath of the Creator.*
> *"By him were all things created, that are in heaven, and that are in earth."* — **Colossians 1:16**

---

### XI. MUSIC & WORSHIP · 047-050, 070-071, 081-082, 098-099

**MFP #047 — "Strings of the Cosmos"**
*The violinist plays, and the universe swirls around him in ribbons of gold — music is the secret language of creation.*
> *"Praise him with stringed instruments and organs."* — **Psalm 150:4**

**MFP #048 — "Song of Innocence"**
*A small musician draws the bow, and the heavens light up with golden particles — out of the mouth of babes comes praise.*
> *"Out of the mouth of babes and sucklings hast thou ordained strength."* — **Psalm 8:2**

**MFP #049 — "Burning Anthem"**
*His violin burns with sacred fire — when worship rises from the heart, even flame becomes a melody.*
> *"My heart was hot within me, while I was musing the fire burned."* — **Psalm 39:3**

**MFP #050 — "Symphony of Light"**
*A musician at the center of an exploding cosmos — every note is a star being born.*
> *"When the morning stars sang together, and all the sons of God shouted for joy."* — **Job 38:7**

**MFP #070 — "Song at the Edge"**
*A violinist plays at the edge of the world — even at the brink, the song does not falter.*
> *"I will sing of the mercies of the LORD for ever."* — **Psalm 89:1**

**MFP #071 — "Stone and Strings"**
*She plays on stone, and the cosmos answers in golden sparks — God hears every instrument, and every tongue.*
> *"Make a joyful noise unto the LORD, all ye lands."* — **Psalm 100:1**

**MFP #081 — "Water Sonata"**
*He plays his violin in shallow water beneath a sky of falling sparks — every reflection is a worship doubled.*
> *"Deep calleth unto deep at the noise of thy waterspouts."* — **Psalm 42:7**

**MFP #082 — "Ribbons of Praise"**
*A violinist stands in still water as golden ribbons unfurl around him — praise weaves the world into song.*
> *"Praise ye the LORD: for it is good to sing praises unto our God."* — **Psalm 147:1**

**MFP #098 — "Bride of the Song"**
*A woman in a golden gown plays her violin beneath a sky of light — the soul dressed in praise is a bride awaiting the groom.*
> *"I will greatly rejoice in the LORD, my soul shall be joyful in my God."* — **Isaiah 61:10**

**MFP #099 — "Spirals of Joy"**
*Golden ribbons of music coil around her — joy is the music we did not know we knew until it played.*
> *"The joy of the LORD is your strength."* — **Nehemiah 8:10**

---

### XII. CONTEMPLATION · 051-052, 062-063, 068

**MFP #051 — "Standing in Awe"**
*A small silhouette before the swirling vastness — to stand still before God is its own kind of worship.*
> *"Be still, and know that I am God."* — **Psalm 46:10**

**MFP #052 — "Moonlit Reflection"**
*A pilgrim sits on a cliff, watching the golden moon rise — peace is the gift given to those who pause and look.*
> *"When I consider thy heavens, the work of thy fingers, the moon and the stars."* — **Psalm 8:3**

**MFP #062 — "Morning Prayer"**
*She kneels in the warmth of dawn, hands gathered in silent reverence — every morning begins again with one whispered yes.*
> *"My voice shalt thou hear in the morning, O LORD."* — **Psalm 5:3**

**MFP #063 — "The Beloved"**
*A Renaissance portrait, eyes lifted in quiet hope — every soul is the Beloved of God, gazing toward more.*
> *"I am my beloved's, and my beloved is mine."* — **Song of Solomon 6:3**

**MFP #068 — "Inner Flame"**
*She sits in stillness as golden energy rises around her — the inner fire is fed not by noise, but by silence.*
> *"Commune with your own heart upon your bed, and be still."* — **Psalm 4:4**

---

### XIII. FAMILY & LOVE · 053, 065-067

**MFP #053 — "Father's Embrace"**
*A father holds his sleeping child close — love wraps the heart with the same warmth God wraps the soul.*
> *"Like as a father pitieth his children, so the LORD pitieth them that fear him."* — **Psalm 103:13**

**MFP #065 — "Love Eternal"**
*Two hearts gathered in soft golden light — love is the only language all souls speak fluently.*
> *"Love is strong as death."* — **Song of Solomon 8:6**

**MFP #066 — "Whispered Vow"**
*A man and woman lean into each other beneath the window's soft glow — the holiest vows are spoken without sound.*
> *"Therefore shall a man leave his father and his mother, and shall cleave unto his wife."* — **Genesis 2:24**

**MFP #067 — "Hands Joined"**
*Hands clasp, hearts lean inward — what God has joined together, time cannot unbind.*
> *"What therefore God hath joined together, let not man put asunder."* — **Mark 10:9**

---

### XIV. STAINED GLASS · 054-055

**MFP #054 — "Glass of Eternity"**
*An abstract mosaic of stained glass, each pane a universe of light — every fragment matters in the design of grace.*
> *"We see through a glass, darkly; but then face to face."* — **1 Corinthians 13:12**

**MFP #055 — "Window of the Soul"**
*A stained-glass window of glowing orbs and quiet crosses — the light of God filters through every careful pattern of life.*
> *"Thou hast covered me in my mother's womb."* — **Psalm 139:13**

---

### XV. THE READING SOUL · 056-059, 072-073, 092-093

**MFP #056 — "Reader of Wisdom"**
*A woman reads by a window of light — the soul that turns its pages in silence will hear what the world cannot say.*
> *"Search the scriptures; for in them ye think ye have eternal life."* — **John 5:39**

**MFP #057 — "Quiet Devotion"**
*Sunlight falls upon her open book — devotion is rarely loud; it is simply the heart held still toward God.*
> *"Study to shew thyself approved unto God."* — **2 Timothy 2:15**

**MFP #058 — "Living Word"**
*Light pours upon the open page, golden particles dancing in the air — the Word is alive and active in those who read.*
> *"For the word of God is quick, and powerful, and sharper than any twoedged sword."* — **Hebrews 4:12**

**MFP #059 — "Window of Truth"**
*She reads beside the stained-glass window, the light coloring her soul as much as her face.*
> *"Sanctify them through thy truth: thy word is truth."* — **John 17:17**

**MFP #072 — "Book of Wonders"**
*A book opens, and the world becomes light — the Word is a wonder still, fresh as the first reading.*
> *"Open thou mine eyes, that I may behold wondrous things out of thy law."* — **Psalm 119:18**

**MFP #073 — "Hand of the Scribe"**
*She writes, and golden words rise from her hand — to write truth is to participate in creation itself.*
> *"Write the vision, and make it plain upon tables."* — **Habakkuk 2:2**

**MFP #092 — "Library of Light"**
*She bends over a glowing book, the library shining around her — wisdom is the gentlest fire that ever warmed a heart.*
> *"Wisdom is the principal thing; therefore get wisdom."* — **Proverbs 4:7**

**MFP #093 — "Reading the Cosmos"**
*Light from the book traces galaxies upon her face — those who read the Word read also the heavens.*
> *"The unfolding of thy words giveth light."* — **Psalm 119:130**

---

### XVI. STAIRWAYS & PATHS · 060

**MFP #060 — "Stairway of the Saints"**
*A celestial pathway winds through clouds and golden orbs — the road home is brighter than we imagine.*
> *"And an highway shall be there, and a way, and it shall be called The way of holiness."* — **Isaiah 35:8**

---

### XVII. NATURE'S TEMPLE · 061, 079-080

**MFP #061 — "Pond of Peace"**
*Water lilies float on a sunset pond — beauty needs no audience to bloom, only the courage to open.*
> *"Consider the lilies of the field, how they grow."* — **Matthew 6:28**

**MFP #079 — "Heaven on Earth"**
*Stars reflected upon the lake's surface, the cosmos fallen onto a quiet shore — Heaven touches earth in places we forget to look.*
> *"The earth is the LORD's, and the fulness thereof."* — **Psalm 24:1**

**MFP #080 — "Mountain Vision"**
*A great spiral of stars turns above mountains and lake — to dwell in nature is to read the Creator's first book.*
> *"Before the mountains were brought forth, even from everlasting to everlasting, thou art God."* — **Psalm 90:2**

---

### XVIII. SOUL & STARS · 069, 094-095

**MFP #069 — "Soul Among Stars"**
*Her profile dissolves into a galaxy — every soul carries a universe within.*
> *"He telleth the number of the stars; he calleth them all by their names."* — **Psalm 147:4**

**MFP #094 — "Face of Light"**
*Her face is mapped with constellations of gold — the soul that loves God carries stars on its skin.*
> *"We all, with open face beholding as in a glass the glory of the Lord, are changed into the same image."* — **2 Corinthians 3:18**

**MFP #095 — "Glory Within"**
*A face dissolves into golden cosmos — what we love most begins to look like us, and we begin to look like it.*
> *"Christ in you, the hope of glory."* — **Colossians 1:27**

---

### XIX. WATERS OF GRACE · 074-078, 085, 088-091

**MFP #074 — "Echoes of Eternity"**
*A single touch upon water sends rings into the night sky — every small act echoes outward, into eternity.*
> *"Cast thy bread upon the waters: for thou shalt find it after many days."* — **Ecclesiastes 11:1**

**MFP #075 — "Touch of Grace"**
*A finger meets the surface, and light spreads outward in waves — the smallest gesture of grace can alter the whole sea.*
> *"He shall come down like rain upon the mown grass."* — **Psalm 72:6**

**MFP #076 — "Standing in the Light"**
*A figure stands waist-deep in golden water — to be still in the light is itself a prayer.*
> *"And the light shineth in darkness."* — **John 1:5**

**MFP #077 — "Baptism of Light"**
*Concentric ripples spread from the body, golden under starlight — every step into faith disturbs the surface of the world.*
> *"Buried with him in baptism, wherein also ye are risen with him through the faith."* — **Colossians 2:12**

**MFP #078 — "Stillness at Dusk"**
*A solitary figure rests in the still lake at dusk — peace is the silent music of an emptied heart.*
> *"He maketh me to lie down in green pastures: he leadeth me beside the still waters."* — **Psalm 23:2**

**MFP #085 — "Beneath the Vortex"**
*A small figure faces the great spiral — sometimes faith is simply staying still while the cosmos turns.*
> *"Be still, and know that I am God."* — **Psalm 46:10**

**MFP #088 — "Pilgrim at Sunset"**
*A pilgrim wades into glowing water as twilight burns above — every ending is also a beginning, in another light.*
> *"Weeping may endure for a night, but joy cometh in the morning."* — **Psalm 30:5**

**MFP #089 — "Sky of Fire"**
*A figure stands in a lake beneath an immense cosmic flame — to be small before the holy is to be made whole.*
> *"The LORD thy God is a consuming fire."* — **Deuteronomy 4:24**

**MFP #090 — "Star Vortex"**
*Beneath a vortex of stars, a soul stands still — the cosmos turns; the heart finds anchor.*
> *"He hath made every thing beautiful in his time."* — **Ecclesiastes 3:11**

**MFP #091 — "Threshold of Dawn"**
*A solitary soul faces the rising sun across the waters — every dawn is a quiet resurrection.*
> *"Truly the light is sweet, and a pleasant thing it is for the eyes to behold the sun."* — **Ecclesiastes 11:7**

---

### XX. THE LIVING WORD · 083-084, 086-087

**MFP #083 — "Living Book"**
*A book lifts off the table, glowing with the breath of the Spirit — Scripture is alive in every age that opens it.*
> *"All scripture is given by inspiration of God."* — **2 Timothy 3:16**

**MFP #084 — "Galaxies in the Pages"**
*From the open book, a spiral galaxy rises — Scripture is not contained by paper; it births universes.*
> *"By the word of the LORD were the heavens made."* — **Psalm 33:6**

**MFP #086 — "Word Above Worlds"**
*An open book floats among orbiting planets — the Word holds the worlds together, even now.*
> *"Upholding all things by the word of his power."* — **Hebrews 1:3**

**MFP #087 — "Whirlwind of the Word"**
*From an open book a whirlwind of fire rises — when truth speaks, it never speaks softly.*
> *"Then the LORD answered Job out of the whirlwind."* — **Job 38:1**

---

### XXI. ETERNAL CENTER · 100

**MFP #100 — "Eternal Sun"**
*A great sun pulses in concentric rings — the source of every dawn, the heart of every flame, the center to which all returns.*
> *"Thy sun shall no more go down... for the LORD shall be thine everlasting light."* — **Isaiah 60:20**

---

## RANDOM-MINT PROTOCOL

When a collector mints, the smart contract / backend will:

1. Pick one of the 100 artworks (uniformly at random, no replacement until pool refills)
2. Auto-assign serial number `MFP-NNNN` (zero-padded, globally unique)
3. Pull title, soul-line, and Bible verse from this catalog
4. Render the Card image (1080 × 1440) using the template
5. Upload both `clean.png` and `card.png` to IPFS
6. Mint ERC-721 token with `tokenURI` pointing to JSON metadata

**Each NFT is unique by serial.** All 100 artworks share equal status — no rarity tiers, no hierarchy. Every piece is sacred.

---

*Catalog compiled · MissionChain · 2026*
*Inspired by Faith. Built for People.*
