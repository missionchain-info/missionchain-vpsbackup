# MISSIONCHAIN — HANDOFF 12/08/2026 (ca P2P · admin · SWAP)

> Dán nguyên khối này vào cửa sổ Claude Code mới.

---

## 0. Đọc trước khi làm gì

1. `CLAUDE.md` ở gốc repo, rồi `missionchain/deploy/CLAUDE.md`.
2. File này.
3. **Không tin tài liệu hơn chain.** Mọi khẳng định về contract phải đọc từ source hoặc gọi thẳng on-chain. Hôm 11/08 đã sai vì tin doc.

---

## 1. Việc cần làm, theo thứ tự

### (A) ƯU TIÊN CAO — `executeWithdraw(1)` 50M MIC rồi kích hoạt SWAP
Hết thời gian khoá từ 12/08. Sau khi rút:
```bash
POOL=0xf6AB7103d1072416366D34Ce5E8A41074feCC98e EXECUTE=1 \
  npx hardhat run scripts/activate-swap.ts --network bsc
```
`LiquidityPoolV6` hiện `isSeeded=false` → SWAP đang khoá. Đây là việc lớn nhất còn treo.

### (B) Rank bonus phải để NGƯỜI DÙNG tự mint
Owner đã chốt: **đạt rank → hiện thông báo trên frontend của họ → họ bấm MINT** (contract mint vào ví họ).
Hiện trang admin `/nft-rewards` làm ngược: admin gõ ví rồi mint hộ.
- Nút admin đó **giữ lại**, nhưng chỉ dùng cho **tặng thêm ngoài KPI** (Owner phân biệt rõ: tự động = đạt KPI; admin mint = thưởng thêm).
- Contract đã có `mintRankBonus(user, tier, quantity)` trên `ClaimRewardsV2`. Keeper đã có `CREDITOR_ROLE`.
- Bảng rank (White Paper §B.5.1): Builder→3×Builder · Connector→3×Maker · Champion→3×Luminary · Ambassador→5×Luminary · Legend→10×Luminary. Phân biệt bằng cặp **(tier, quantity)**, vì Champion/Ambassador/Legend đều ra Luminary.

### (C) "Failed to fetch" ở khối Referral Milestones (admin `/nft-rewards`)
Lỗi thật, chưa điều tra.

### (D) Trang admin `/p2p` — còn 3 việc (1 và 2 đã xong)
3. Thêm **P2PEscrowMIC** vào trang. Hiện trang chỉ biết MFP, trong khi tiền thật chảy qua MIC.
4. **Xoá hoặc đánh dấu rõ** các tham số không nối vào đâu: "Partial Fill ENABLED", "KYC REQUIRED", "Escrow timeout 60 phút", MIN/MAX ORDER, 5 nút bật tài sản — **không contract nào đọc chúng**. Một ô cho chỉnh mà không có tác dụng còn tệ hơn không có ô.
5. Ô phí hiện **"1,5"** (dấu phẩy) — sẽ hỏng nếu gửi vào `setFee`.

### (E) `P2PEscrowMFP` PHẢI DEPLOY LẠI
`0xcff25169c783B84eFBa746eF4A51271764f24b8B` có `MAX_PRICE_USDT = 1_000_000e6` = **$0,000001**. Là `constant`, **không setter nào sửa được**. `nextOrderId = 0` vì **không ai đăng bán được**, không phải vì không ai thử. Menu đang tắt nên chưa ai gặp.
Deploy lại theo khuôn `P2PEscrowMIC` (đã đúng 18 decimals, bounds chỉnh được).

### (F) Community NFT P2P (ERC-1155) — chưa có, Owner đã yêu cầu

### (G) White Paper — 4 bản dịch sai cơ chế giá
ES · PT · KO mô tả *"giá động theo dải TWAP do DAO quản"* — **cơ chế này không tồn tại**. Giá MICE thật là **5 vòng cố định** (mục C.3 bản Anh). VI thiếu hẳn phần này. Bản Anh đã sửa 11/08.

---

## 2. Trạng thái hệ thống (đã verify on-chain 11-12/08)

| Contract | Địa chỉ | Trạng thái |
|---|---|---|
| **P2PEscrowMIC** | `0x7388ed77c06A917B572C1429B2a323a171c3c5ea` | 🟢 LIVE, có lệnh mua+bán, sàn $0,005, phí 1,5% |
| P2PEscrowMFP | `0xcff25169c783B84eFBa746eF4A51271764f24b8B` | 🔴 HỎNG, phải deploy lại |
| PreSale | `0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23` | 🟢 ĐANG BÁN, đã bán 5.000 MIC |
| SeedSaleV9 | `0x5216c5C69FB899CC3De8Aa94165363153B5B589d` | 🟡 active nhưng `whitelistRequired=true`, 0 ví duyệt |
| MICELicense | `0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c` | 🟡 giá bootstrap $0,01, chưa bán |
| LiquidityPoolV6 (SWAP) | `0xf6AB7103d1072416366D34Ce5E8A41074feCC98e` | 🔴 `isSeeded=false` — chờ 50M MIC |
| StewardCouncil | `0x87723621D50fcc6f6db25d73031E44Bee4081B19` | 🟢 5/5 thành viên |
| DAOGovernor | `0xDCD65DC97b0A147BeCf542E22a5C218C006231cC` | 🟢 5/5 ghế (đồng bộ 11/08) |
| MICToken | `0xf27ec0c311728b923b22828002c992c799326182` | totalSupply 1.018.500.000 (đã đốt 31,5M) |
| BSC-USD | `0x55d398326f99059fF775485246999027B3197955` | **18 decimals** |

**Git:** nhánh `vps-snapshot-20260811-mice-swap`, đã push. `origin/main` **sau ~35 commit** — chưa merge, cần Owner quyết.
**Local** (`~/Documents/Mission Chain Fullstack/missionchain`): ở `main`, **cũ hơn VPS** và có **247 file sửa chưa commit**. KHÔNG đẩy local đè VPS.

---

## 3. BẪY — đọc kỹ, hôm qua vấp 5 lần

### Build "thành công" mà không đổi gì
- `mc-api`, `mc-app`: `cd /opt/missionchain/deploy && docker compose build <svc> && docker compose up -d --force-recreate <svc>` ✅
- **`mc-admin` và `mc-world`: KHÔNG có mục `build:`** trong compose. `docker compose build` báo *"No services to build"* rồi đi tiếp im lặng. Phải:
  ```bash
  cd /opt/missionchain/deploy/apps/admin   # hoặc /opt/missionchain/missionchain_world
  npx next build                            # Dockerfile chép .next DỰNG SẴN từ host
  docker build -t mc-admin:latest .         # hoặc mc-world:latest
  cd /opt/missionchain && docker compose up -d --force-recreate mc-admin
  ```
- **Luôn verify chuỗi thật trong container đang chạy**, không tin dòng "Built".
- `mc-landing` gắn thư mục trực tiếp → sửa file là ăn ngay, không cần build.

### RPC
Mọi lượt đọc on-chain phải ưu tiên `INDEXER_RPC_URL` (Alchemy). RPC công cộng trả lời `eth_blockNumber` trong 1 giây rồi **504 sau 90 giây** trên `eth_call` thật — cơ chế kiểm tra sức khoẻ không phát hiện được.
⚠️ **Khoá Alchemy đã kịch hạn mức tháng hôm 09/08.** Toàn hệ giờ phụ thuộc nó. Nên nâng gói hoặc làm chuỗi dự phòng — nhưng phải kiểm bằng **lệnh đọc thật**, không phải `eth_blockNumber`.

### 18 decimals
BSC-USD là **18**, không phải 6. Đã sai **6 lần** trong repo này. Contract mới phải có `require(IERC20Metadata(x).decimals() == 18)` trong constructor, và test phải deploy với `MockUSDT6` **bắt buộc revert**. Bộ test mù với lớp lỗi này: nó đúc bằng chính đơn vị sai mà nó kiểm tra.

### Hằng số vs tham số
Đừng viết giới hạn giá/số lượng là `constant`. Owner sẽ muốn chỉnh, và `constant` nghĩa là **deploy lại**. Đó là lý do MFP chết. `P2PEscrowMIC` đã làm đúng: biến + setter + hàng rào cứng.

### Shell qua ssh
Dấu `` ` `` và `$` trong chuỗi ssh **bị shell máy local thực thi**. Viết script ra file rồi `scp` sang, đừng dùng heredoc trong chuỗi ngoặc kép.

---

## 4. Cách làm việc Owner mong đợi

- **Kiểm chứng trước khi nói xong.** Verify bằng chuỗi thật trong container / quét sự kiện on-chain, không tin log build.
- **Rà đồng bộ MỌI NƠI**, không chỉ chỗ vừa sửa. Owner đã nhắc nhiều lần. Quét theo **ngày deploy**, không chỉ grep mã hôm nay — contract cũ nằm ngoài tầm quét.
- **Thông báo lỗi phải nói đúng thứ hỏng.** Một thông báo đoán bừa nguyên nhân dẫn người sửa đi sai hướng một cách tự tin.
- **Không giấu việc chưa làm.** Báo rõ phần nào xong, phần nào chưa, vì sao.
- UI/CSS phải **nhìn tận mắt** trước khi báo xong. Trang sau cổng ví thì phải nhờ Owner xem.
- Tiếng Việt xưng "em", gọi Owner là "anh". Thuật ngữ kỹ thuật giữ tiếng Anh.

---

## 5. Ngữ cảnh gần nhất

Ca 11-12/08 đã làm: sửa RPC toàn API (11 chỗ) · khối "My NFT Rewards" (accumulated/claimed/unclaimed tách theo loại NFT) · khẩu hiệu chuẩn trên DApp + world + landing ES · badge HOT sang MICE · nối StewardCouncil→DAOGovernor · sửa giá MICE trong White Paper · **dựng P2PEscrowMIC từ đầu** (contract + 36 test + API + UI, có lệnh mua và lệnh bán) · sửa trang admin P2P (1,2).
