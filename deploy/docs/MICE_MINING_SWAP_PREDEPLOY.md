# MICE · MINING · SWAP — Pre-Deploy Review
_Ngày 09/08/2026 · đọc trực tiếp từ source trên VPS `/opt/missionchain/deploy`_

## A. 7 contract sẽ deploy

| # | Contract | Constructor | Vai trò |
|---|---|---|---|
| 1 | `LiquidityPoolV6` | USDT, MIC, virtualReserve $500k, admin | Máy SWAP. AMM tích số không đổi + reserve ảo |
| 2 | `MICELicense` | USDT, MIC, ReferralRegistry, RevenueRouter, admin, pool | Bán 100.000 giấy phép khai thác |
| 3 | `MiningPool` | MIC, admin | Nhận 59% emission, chia theo điểm epoch |
| 4 | `NFTStaking` | MIC, admin | Nhận 25%, stake MIC khoá 30/90/180/360 ngày |
| 5 | `CommunityNFTRewardPool` | MIC, admin | Nhận 5% — Community NFT |
| 6 | `CommunityNFTRewardPool` (bản 2) | MIC, admin | Nhận 1% — MFP-NFT |
| 7 | `EmissionController` | MIC, MICE, mining, staking, DAO, cNFT, MFP, admin | Đúc MIC mỗi ngày, chia 5 hướng |

## B. Contract đã live, chỉ nối vào

`MICToken` · `RevenueRouter 0xf86b…9672` · `ReferralRegistry 0x2a8C…f0f9` · `DAOGovernor` · `ListingReserveVault 0x2EE1…8f16`

## C. Luồng

### C1. Mua MICE
Giá theo vòng: 20.000 giấy/vòng × 5 vòng = $100 / $200 / $300 / $400 / $500 → tối đa **$30.000.000**.

Mỗi giao dịch tách đôi:
- **50% trả bằng MIC** → burn. Giá quy đổi = `min(spot, TWAP7d)` đọc từ pool, **không có giá do admin đặt**.
- **50% trả bằng USDT** → `RevenueRouter.receiveAndDistribute` chia 6 nhánh, rồi `ReferralRegistry.distributeReferral` trả F1 7% + F2 3%; không có upline thì 10% chảy sang M&I.

Vì dùng chung registry và router với PreSale, doanh số MICE cộng vào **cùng một sổ Group Volume**.

### C2. Vòng đời giấy phép
Mua → chờ **72h** → `activate()` (ai gọi cũng được) → chạy **360 ngày** → hết hạn → `recycleLicense()` trả ghế về free-list cho người sau. `activeLicenses` chỉ đếm giấy đã kích hoạt — đây chính là biến `EmissionController` đọc.

### C3. Emission hàng ngày
`E = E₀ × D(t) × L(H) × G × W(t) × A(N)` — E₀ = 750.000 MIC/ngày, chu kỳ bán rã 8 năm.
Hai phanh cứng: trần ngày = 2× E_base; và không bao giờ vượt `remainingMiningPool`.

Chia 5 hướng: **59 / 25 / 10 / 5 / 1** (miners / staking / DAO / Community NFT / MFP-NFT).
90 ngày đầu có *Early Staking Boost*: miner nhường tối đa 10% sang staking, giảm tuyến tính về 0. DAO/cNFT/MFP không đổi. `setSplitRatios` bị chặn lệch quá ±10%.

### C4. Nhận thưởng mining
`startEpoch` → `submitScores` → `finalizeEpoch` → người đào `claimReward(epoch)`. Ba bước đầu đều `ORACLE_ROLE`.

### C5. SWAP — 3 giai đoạn
| Giai đoạn | Điều kiện vào | Mua | Bán |
|---|---|---|---|
| Bootstrap | từ lúc deploy | ✅ | ❌ |
| TwoWay | pool đủ **30 ngày tuổi** | ✅ | ✅ |
| Listed | reserve USDT ≥ **$10.000.000** | ✅ | ✅ |

`advancePhase()` không cần quyền — nó tự kiểm tra điều kiện on-chain, nên **không có công tắc thủ công nào**.

Chặn thao túng: phí mua 0,3%; phí bán 0,3%–**tối đa 10%** (trần là hằng số, không ai sửa được); 1 lệnh ≤ 1% reserve MIC; ra tối đa 5% reserve USDT/24h; cấm 2 lệnh cùng block cùng ví.

## D. Quyền được cấp khi deploy
1. `ReferralRegistry.CALLER_ROLE` → MICELicense
2. `RevenueRouter.DISTRIBUTOR_ROLE` → MICELicense
3. `RevenueRouter.setLiquidity(...)` → LiquidityPoolV6
4. `LiquidityPoolV6.DISTRIBUTOR_ROLE` → RevenueRouter
5. `LiquidityPoolV6.EMISSION_REPORTER_ROLE` → EmissionController
6. `EmissionController.setLiquidityPool(pool, $0.01)`
7. **`MICToken.MINTER_ROLE` → EmissionController** ← quyền nguy hiểm nhất hệ thống

## E. Vấn đề — xếp theo mức chặn

### 🔴 E1. MiningPool chia nhầm tiền giữa các epoch (đã tái hiện bằng test)
`finalizeEpoch` chốt phần thưởng bằng `balanceOf(this)`, `claimReward` trả từ chính số dư đó, **không có gì trừ phần đã trả và không có gì giữ lại phần còn nợ**. Chốt epoch 2 khi epoch 1 còn người chưa nhận → cùng một túi MIC được hứa hai lần.

Test `test/mining/MiningPoolSolvency.test.ts` — 3/3 xanh, chứng minh: epoch 1 phát 1.000, m1 nhận 500, m2 chưa nhận; epoch 2 phát thêm 1.000 nhưng `totalReward` = **1.500**; m1 rút sạch; m2 mất trắng.

Người đào chậm không làm gì sai — họ chỉ mất phần vì tới sau.

### 🔴 E2. Không có ai gọi các hàm định kỳ
`distributeDaily` · `startEpoch` · `submitScores` · `finalizeEpoch` · `advancePhase` · `poke` — grep toàn repo, **không có keeper/cron nào** trong `apps/api`. Deploy xong hệ thống đứng im: không đúc MIC, không có epoch, sell side không tự mở.

### 🟠 E3. 50.000.000 MIC chưa rút được
Cần để seed pool. Cooldown mở lúc **12/08 18:02 UTC** = 13/08 01:02 giờ VN. Không có đường tắt (xem phần trả lời riêng).

### 🟠 E4. `ORACLE_ROLE` nằm trên ví deployer
Constructor cấp cho admin. Ví EOA đó điều khiển được điểm số của mọi người đào. Cần chuyển sang ví keeper riêng, và `DEFAULT_ADMIN_ROLE` sang Safe/DAO.

### 🟡 E5. Thưởng mining không đi qua LockManager
Không có tham chiếu `LockManager` nào trong `contracts/mining/`. `claimReward` chuyển MIC thẳng cho người nhận. Nếu chủ trương là khoá thưởng thì phần này **chưa được cài**.

### 🟡 E6. Hai pool NFT có `emergencyWithdraw` không giới hạn
`DEFAULT_ADMIN_ROLE` rút được toàn bộ MIC bất cứ lúc nào, không timelock, không trần.

### 🟡 E7. MICE/MINING/SWAP đang tắt trong menu live — đúng
Đã kiểm tra API production: cả ba `disabled`. Nhưng URL trực tiếp vẫn trả 200 và trang không chặn địa chỉ `0x000…0`.

## F. Đã sửa hôm nay
- `PRESALE_SET` điền 2 địa chỉ thật + thêm `getCode()` chặn địa chỉ sai ngay ở pre-flight
- Nút EXECUTE: khoá + đếm ngược trên nút, một đồng hồ dùng chung cho cột và nút
