# LiquidityPoolV8 — MICE-gated sell side

**Chốt 18/08/2026** · Trạng thái: contract viết xong, 13 test xanh, **chưa deploy**

---

## Vì sao cần contract mới

`LiquidityPoolV7` `0x70E28Abcce584e2B3423737Dc3497e3A278641aF` **không cưỡng chế được quota**:

- `swapMicToUsdt` là `external`, không kiểm `msg.sender`, không hook
- Không có `pause`, không phải proxy
- Mặt admin chỉ có `seedMic · receiveUSDT · reportDailyEmission` + bộ ba rút MIC

Đường vòng qua token cũng không có: `MICToken._update()` chỉ chặn theo `LockManager` + staking, `pause()` là toàn cục.

V7 lại **không đưa USDT ra được** — dòng duy nhất USDT rời contract là trả cho người bán. Kế hoạch "gom USDT rồi đẩy $1M vào V6" không có giao dịch nào thực hiện nổi. Đây đúng là bất biến đã làm kẹt 105M MIC trong TreasuryManager v1 và 31,5M trong LiquidityPool v5, lặp lại cho token kia.

23,5M MIC chuyển sang V8 được bằng `requestMicWithdraw` → 7 ngày → `executeMicWithdraw`.

---

## Quyết định của Owner

| # | Quyết định | Ngày |
|---|---|---|
| 1 | Chiều bán chỉ cho chủ MICE **khi pool còn mỏng** | 18/08 |
| 2 | Hàng rào **tự gỡ trên chain** khi backing đủ, không ai bấm | 18/08 |
| 3 | Quota **theo ngày**, không phải tổng số | 18/08 |
| 4 | Quota = **2× sản lượng** — để MICE có lợi thế, khuyến khích mua | 18/08 |
| 5 | Mọi chứng chỉ hạn mức **bằng nhau**, không theo giá đã trả | 18/08 |
| 6 | V6 là chợ mở cho tất cả, sau khi được nạp $1.000.000 | 18/08 |

---

## Cơ chế

| Thành phần | Quy tắc |
|---|---|
| Ai bán | Chủ chứng chỉ MICE đang hoạt động (`isActive`), khi `!micGateLifted()` |
| Đếm theo | **`licenceId`**, không theo ví — chứng chỉ chuyển nhượng được, đếm theo ví là rửa quota trong một block |
| Cửa sổ | 24h trượt kể từ lần bán gần nhất **của chính chứng chỉ đó** |
| Tích luỹ | **Không.** Tổng trọn đời xả được một cục ngày đầu; trần 1%/lệnh là 235.000 MIC nên không cản nổi |
| Gỡ hàng rào | `backingBps() >= liftBackingBps`, **chốt một chiều** |
| Giữ từ V7 | 1%/lệnh · 5%/ngày toàn pool · phí 15%→0% · 1 lệnh/ví/block · hai chốt cứng |

### Chốt một chiều — vì sao bắt buộc

`backingBps = reserveUsdt / effectiveUsdt`. Bán ra làm `reserveUsdt` giảm, còn `virtualReserve()` chỉ lùi theo mốc cao nhất nên không đổi. **Backing giảm khi người ta bán.** Không có chốt thì pool mở cho tất cả, hứng một đợt bán, rồi dựng lại hàng rào lên đầu những người chưa kịp bán. Rút USDT sang V6 cũng gây đúng chuyện đó.

`gateLiftedLatched` được đặt trong `_accrue()` — vốn chạy mỗi giao dịch và trong `poke()` (không cần quyền), nên không cần keeper.

---

## Tham số deploy

```
virtualReserve0        $235.000        = $0,01 × 23.500.000
sellGateUsdt           $25.000
emissionController     0x3CEaeB22…     EmissionControllerV2
quotaMultipleBps       20.000          = 2× phát hành, ĐỌC ĐỘNG
quotaFallbackMicPerDay 166,67 MIC      chỉ dùng khi không đọc nổi controller
MAX_QUOTA_MIC_PER_DAY  1.000 MIC       trần bất biến
liftBackingBps         ?               CHƯA CHỐT
```

Ở tỉ lệ 2× và rate hiện tại, hạn mức thực tế = **166,67 MIC/ngày/chứng chỉ**.

**Sản lượng nền, đọc chain 18/08/2026:** `micPerLicencePerDay` = **83,3333 MIC/ngày**, phẳng, không suy giảm.

> Bản nháp đầu của tài liệu này ghi 100,3 MIC/ngày, tự dẫn ra từ `dailyEmission × 59% ÷ 2`. Sai hai lần: `currentMinerBps` thực tế là **4900** (Early Staking Boost chuyển 1000 bps sang staking trong 90 ngày đầu), và không cần dẫn ngược khi contract ghi thẳng con số. Đọc `micPerLicencePerDay`, đừng dẫn.

**Không có chu kỳ bán rã.** `EmissionControllerV2` không có `HALF_LIFE`, `D(t)`, `L(H)`, ramp hay `E₀`. Hằng số 8 năm nằm trong `EmissionController` **v1** — đã deploy, đã bị thu vai, chưa từng trả đồng nào. Canonical: `MISSIONCHAIN_SPEC_EMISSION_V2.md`.

Hạn mức lưu dạng **tỉ lệ** (`quotaMultipleBps`), đọc `micPerLicencePerDay` sống mỗi lần tính. Lưu dạng số tuyệt đối thì nó là ảnh chụp của tỉ lệ tại một ngày, và sẽ âm thầm thôi là 2× ngay lần đầu ai đó gọi `setMicPerLicencePerDay`.

---

## Sức chứa — mốc phải theo dõi

Pool trả tối đa 5% `reserveUsdt` thật mỗi 24h, **dùng chung**. Ở $0,01/MIC, quota 166,67 MIC/ngày = **$1,667/ngày** mỗi chứng chỉ, nên pool cần **$33,3 USDT thật trên mỗi chứng chỉ đang chạy**.

| Chứng chỉ | USDT thật cần |
|---|---|
| 2 | $67 |
| 750 | $25.000 — vừa kín cổng mở bán |
| 20.000 | **$666.667** |

**Quá ~750 chứng chỉ** mà pool không dày lên tương ứng, người bán trượt ở `LP8: over daily limit` chứ không phải ở quota — lợi thế MICE tồn tại trên giấy. Đây là mốc gọi `setQuotaMultipleBps`, hoặc dấu hiệu pool cần doanh thu.

### Không cần rà định kỳ

Bản nháp trước dặn "chỉnh lại hàng quý vì emission suy giảm". **Sai** — không có gì suy giảm. Tỉ lệ 2× tự giữ, vì pool đọc rate sống. Chỉ phải động vào `setQuotaMultipleBps` khi Owner muốn đổi chính tỉ lệ đó.

Đường đọc dùng `staticcall` với dự phòng: nếu tầng Emission bị thay bằng thứ không có hàm này, pool lùi về `quotaFallbackMicPerDay` thay vì revert. Chiều bán là lối ra duy nhất khi hàng rào còn dựng — nó không được phụ thuộc vào việc một contract khác mãi mãi gọi được.

---

## Kiến trúc hai pool

| Pool | Vai | Trạng thái |
|---|---|---|
| **V8** (chưa deploy) | Làn MICE có quota, 23,5M MIC @ $0,01 | Contract xong |
| **V6** `0xf6AB…C98e` | Chợ mở cho tất cả, 50M MIC | Tự mở chiều bán **11/09/2026** theo đồng hồ 30 ngày |

V6 tính **giá mua sai 2,006×** cho tới khi có **$1.000.000 thật** — `_virtualFor` trả 0 khi highWater ≥ $1M, lúc đó 50M định giá đúng ở $0,02. Nạp từng phần chỉ đẩy nó lên $0,03–0,04 mà vẫn sai: **một lần $1M hoặc không gì cả**.

Cho tới lúc đó V6 phải ẩn khỏi giao diện mua, và **mọi chỗ hiển thị giá V6 phải tính từ `quoteBuy`, không bao giờ từ `spotPrice`**.

---

## Chưa xong

- [ ] `liftBackingBps` — chưa chốt số
- [ ] Script deploy V8 + chuyển 23,5M MIC từ V7 (7 ngày cooldown, bắt đầu sớm)
- [ ] Trỏ `RevenueRouter.liquidity` → V8; `MICELicense.setLiquidityPool(V8)`
- [ ] Frontend: chọn licenceId khi bán, hiện quota còn lại
- [ ] Lớp hiển thị giá thật cho V6
- [ ] `EmissionController` **không repoint được** — vẫn đọc coverage của V6 mãi mãi (Owner đã chấp nhận với V7, giữ nguyên với V8)
