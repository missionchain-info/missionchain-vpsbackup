# PreSale Phase 1 — Deploy Plan & Giải Thích

> **Trạng thái:** script SẴN SÀNG REVIEW — chưa chạy. Mainnet BSC (chainId 56).
> **Script:** `packages/contracts/scripts/deploy-presale-phase1.ts`
> **Admin toàn bộ contract:** ví Owner `0xD32e…D6c2` (Phase 1 Minimal; chuyển DAOGovernor sau).
> Model doanh thu = V2 (mọi % tính trên GROSS). Đã verify khớp source: 11 constructor + 20 role grant + 1 setter (`setIncentivePool`).

---

## 1. Deploy cái gì (11 instance / 9 loại contract mới)

| # | Contract | Vai trò | Nắm tiền? |
|---|----------|---------|-----------|
| 1 | **CommunityNFTv2** | NFT serial (ERC-721) — mint khi mua package Builder/Maker/Luminary | không |
| 2 | **ReferralRegistry** | Trả F1 7% / F2 3% tức thì; phần dư → M&I | giữ tạm 10% rồi chi ngay |
| 3 | **ClaimRewardsV2** | GV 9% (user **claim**) + M&I 1.5% (**DAO** chi) + hứng overflow | ✅ giữ tới khi claim/DAO chi |
| 4 | **NFTRewardPool (Weekly)** | Weekly Growth 5.5% (NFT 5% + MFP 0.5%) — user **claim** | ✅ |
| 5 | **NFTRewardPool (Monthly)** | Monthly 8% (NFT 7.5% + MFP 0.5%) — user **claim** | ✅ |
| 6 | **LuckyDraw** | Weekly Lucky 1% — user **claim** | ✅ |
| 7 | **RewardDistributorV2** | Bộ chia Marketing 25% → 4 pool trên | không (chia ngay) |
| 8 | **ListingReserve** | Listing Reserve 5% — **giữ lại để mở thị trường ngoài, rút phải chờ 24h** | ✅ khoá timelock |
| 9 | **ManagementPool** | Management 7.5% (6 ví leadership + 2.5% bonus DAO) | ✅ |
| 10 | **LiquidityPool** | Liquidity 40% — **buffer khoá** | ✅ khoá |
| 11 | **RevenueRouter** | Bộ chia gốc 6 ngả (nhận 100% gross từ PreSale) | không (chia ngay) |
| 12 | **PreSale** | Contract bán — nạp sẵn 315M MIC, `active=false` | giữ 315M MIC |

**Tái sử dụng (đã live, KHÔNG deploy lại):** USDT · MICToken · LockManager · TreasuryManager (DAO Treasury 12.5%).

---

## 2. Dòng tiền 1 giao dịch mua (ví dụ $100)

```
Người mua trả 100 USDT vào PreSale
        │
        ├─ 100% GROSS → RevenueRouter  ──chia 6 ngả──┐
        │     10%  Referral    → ReferralRegistry → F1 7% + F2 3% (tức thì); dư → ClaimRewardsV2 (M&I)
        │     25%  Marketing   → RewardDistributorV2 ─┬─ 9%   GV        → ClaimRewardsV2  (CLAIM)
        │                                             ├─ 1.5% M&I       → ClaimRewardsV2  (DAO chi)
        │                                             ├─ 5.5% Weekly    → NFTRewardPool   (CLAIM)
        │                                             ├─ 8%   Monthly   → NFTRewardPool   (CLAIM)
        │                                             └─ 1%   Lucky      → LuckyDraw       (CLAIM)
        │     7.5% Management  → ManagementPool   (leadership tự claim + bonus DAO)
        │     12.5% Treasury   → TreasuryManager  (DAO Treasury, đã live)
        │     5%   Staking     → StakingReserve   (KHOÁ, rút 24h timelock)
        │     40%  Liquidity   → LiquidityPool    (KHOÁ buffer)
        │
        └─ PreSale trả MIC cho người mua (khoá vesting qua LockManager) + mint Community NFT nếu mua package
```

**Cơ chế 4 loại:**
- **AUTO on-chain:** Referral F1/F2 — trả ngay khi mua, không cần thao tác.
- **CLAIM (pull):** GV, Weekly, Monthly, Lucky — hệ thống tính off-chain → **credit** on-chain (backend `CREDITOR_ROLE`) → **người hưởng bấm claim** rút về ví. Tiền nằm trong pool tới khi claim.
- **DAO chi:** M&I 1.5% + phần dư — `DEFAULT_ADMIN_ROLE` (giao DAOGovernor) quyết định phân bổ (hiện vật / chuyến đi).
- **LOCK:** Staking (rút phải request→24h→execute) và Liquidity (buffer khoá).

Sơ đồ trực quan: `nft-cards/presale-money-flow.{svg,png}` (đã có ở ~/Downloads).

---

## 3. Wiring quyền (21 grant) — script Phase 2 tự làm

| Cấp quyền trên | Role | Cho | Vì sao |
|---|---|---|---|
| CommunityNFTv2 | MINTER | PreSale, ClaimRewardsV2 | mint NFT package + NFT milestone |
| ReferralRegistry | CALLER | PreSale | PreSale gọi distributeReferral |
| ReferralRegistry | *setIncentivePool* | = ClaimRewardsV2 | nơi nhận referral dư |
| ClaimRewardsV2 | DISTRIBUTOR | RewardDistributorV2 | nạp GV+M&I |
| ClaimRewardsV2 | OVERFLOW | ReferralRegistry | nhận referral dư |
| ClaimRewardsV2 | CREDITOR | **OPERATOR** | credit GV + sweep + mint milestone |
| NFTRewardPool ×2 | DISTRIBUTOR / CREDITOR | RewardDistributorV2 / OPERATOR | nạp / credit người hưởng |
| LuckyDraw | DISTRIBUTOR / CREDITOR | RewardDistributorV2 / OPERATOR | nạp / chốt winner |
| RewardDistributorV2 | DISTRIBUTOR | RevenueRouter | nhận Marketing 25% |
| StakingReserve / ManagementPool / LiquidityPool | DISTRIBUTOR | RevenueRouter | nhận 5% / 7.5% / 40% |
| LiquidityPool | DEPOSITOR | **OPERATOR** | nạp MIC (mô hình cũ — xem ghi chú LiquidityPool) |
| RevenueRouter | DISTRIBUTOR | PreSale | PreSale đẩy gross vào |
| **TreasuryManager** (live) | DISTRIBUTOR | RevenueRouter | nhận Treasury 12.5% |
| **LockManager** (live) | SCHEDULE_CREATOR | PreSale | PreSale tạo lịch vesting |

---

## 4. Nạp tiền (Phase 3)

- **315M MIC → PreSale** — chuyển từ ví deployer (đang giữ đúng 315M). ✅ bắt buộc.
- **105M MIC → LiquidityPool** — *mặc định TẮT* (`FUND_LIQUIDITY_105M=false`). ⚠️ Cần anh xác nhận 105M listing đang ở đâu (có thể đã nằm trong LiquidityPoolV5 cũ) trước khi bật.

---

## 5. An toàn của script

1. **DRY-RUN mặc định** — chạy không tham số chỉ *in kế hoạch*, KHÔNG gửi giao dịch. Chỉ broadcast khi `EXECUTE=1`.
2. **Pre-flight tự chặn** nếu: sai mạng (không phải chid 56) · chưa set OPERATOR · ví mgmt còn 0x0 · deployer < 315M MIC · **deployer KHÔNG phải admin của TreasuryManager/LockManager** (nếu vậy không grant được → phải grant qua admin hiện tại/DAOGovernor).
3. **Không tự bật bán** — PreSale để `active=false`. Bật là bước tay riêng.
4. Lưu địa chỉ ra `deployments/presale-phase1-mainnet.json`.

---

## 6. Anh cần điền/chuẩn bị TRƯỚC khi EXECUTE

| Việc | Chi tiết |
|---|---|
| `CONFIG.OPERATOR` | 1 ví backend giữ CREDITOR (credit thưởng) + DEPOSITOR (nạp MIC liquidity) |
| `CONFIG.MGMT_ROLE_WALLETS` | 6 ví: Founder / Architect / CTO / Social / Training / Tech |
| **BNB gas** | nạp BNB cho ví deployer `0xD32e…` (đang ~0.046, cần ~0.1–0.2 cho ~35 tx) |
| Quyền admin | xác nhận deployer là admin TreasuryManager + LockManager (pre-flight sẽ báo) |
| 105M liquidity | xác nhận nguồn nếu muốn bật |

---

## 7. Cổng phải qua trước mainnet (deploy gate)

1. ⬜ Cập nhật/loại các test cũ (PreSale/integration off-top-flow) → full suite xanh (V2 set đã 126/126).
2. ⬜ Fork-test: chạy `EXECUTE=1` trên bản fork BSC mainnet, mua thử, kiểm 6 ngả chia đúng + claim chạy.
3. ⬜ Security review (nội bộ / audit) bộ V2.
4. ⬜ Owner GO chính thức.

## 8. Bước tay CUỐI (sau deploy, không nằm trong script)

1. Verify địa chỉ + role trên BSCScan.
2. `PreSale.setActive(true)` → **bật bán**.
3. Admin: bật menu-config `presale` → hiện trên frontend.
4. (Sau) chuyển admin các contract → DAOGovernor (DAO đầy đủ).

---

## 9. Lệnh chạy

```bash
cd packages/contracts

# XEM kế hoạch (an toàn, không gửi tx):
npx hardhat run scripts/deploy-presale-phase1.ts --network bsc

# THỰC THI (chỉ khi đã qua hết gate + Owner GO):
EXECUTE=1 npx hardhat run scripts/deploy-presale-phase1.ts --network bsc
```

*(mạng `bsc` cần `DEPLOYER_KEY` trong .env = PK ví Owner — không bao giờ in ra.)*
