// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPoolReceiver {
    function receiveAndDistribute(uint256 amount) external;
}

/// @title SeedBudgetV5b — centralized USDT vault for SEED revenue
/// @notice
///   ARCHITECTURE: This contract holds ALL SEED USDT centrally. It splits
///   incoming amounts into 5 logical slots (Distribution / Operational /
///   Management Bonus / Liquidity / Reserved) per anh's spec (20+20+10+40+10).
///
///   - Liquidity slot (40%) is AUTO-FORWARDED to LiquidityPoolV5 (closed-loop).
///   - Other 4 slots ACCUMULATE in this contract — no auto-transfer.
///   - Pool contracts (Operational/MgmtBonus/Reserved/Distribution) are
///     POLICY ENGINES that hold member registries, votes, requests.
///   - When a claim/execute is authorized by a pool, that pool calls
///     `release(slot, recipient, amount)` on this vault. The vault checks
///     authorization (slotController[slot] == msg.sender), deducts a fee
///     (configurable BPS) and transfers net to recipient + fee to feeReceiver.
///
///   This design matches the existing /payment-requests fee config pattern
///   used by the Distributor payout flow.
contract SeedBudgetV5b is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Slot indices ────────────────────────────────────────────────────
    uint8 public constant SLOT_DISTRIBUTION = 0;
    uint8 public constant SLOT_OPERATIONAL  = 1;
    uint8 public constant SLOT_MGMT_BONUS   = 2;
    uint8 public constant SLOT_LIQUIDITY    = 3;
    uint8 public constant SLOT_RESERVED     = 4;

    // ─── Roles ────────────────────────────────────────────────────────────
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE"); // SeedSale

    // ─── BPS allocations ──────────────────────────────────────────────────
    uint256 public constant BPS_DISTRIBUTION = 2000; // 20%
    uint256 public constant BPS_OPERATIONAL  = 2000; // 20%
    uint256 public constant BPS_MGMT_BONUS   = 1000; // 10%
    uint256 public constant BPS_LIQUIDITY    = 4000; // 40%
    uint256 public constant BPS_RESERVED     = 1000; // 10%

    // ─── Storage ──────────────────────────────────────────────────────────
    IERC20 public immutable usdt;

    /// @notice Current USDT balance per slot (held in this contract)
    mapping(uint8 => uint256) public slotBalance;
    /// @notice Cumulative USDT received per slot (lifetime, never decreases)
    mapping(uint8 => uint256) public slotTotalReceived;
    /// @notice Cumulative USDT released per slot (lifetime)
    mapping(uint8 => uint256) public slotTotalReleased;

    /// @notice Address authorized to call release(slot, ...). Owner sets per slot.
    ///         Typically the corresponding pool contract.
    mapping(uint8 => address) public slotController;

    /// @notice Liquidity slot auto-forward target (LiquidityPoolV5)
    address public liquidityPool;

    /// @notice Fee config (consistent with /payment-requests pattern)
    uint16  public feeBps;       // 0-1000 (0%-10%)
    address public feeReceiver;

    // ─── Events ───────────────────────────────────────────────────────────
    event ReceivedAndDistributed(uint256 amount, uint256 d, uint256 o, uint256 m, uint256 l, uint256 r);
    event Released(uint8 indexed slot, address indexed recipient, uint256 amount, uint256 fee);
    event SlotControllerUpdated(uint8 indexed slot, address controller);
    event LiquidityPoolUpdated(address pool);
    event FeeUpdated(uint16 bps, address receiver);

    // ─── Constructor ──────────────────────────────────────────────────────
    constructor(address _usdt, address _admin) {
        require(_usdt  != address(0), "SBv5b: zero usdt");
        require(_admin != address(0), "SBv5b: zero admin");
        usdt = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        feeReceiver = _admin; // default — Owner can change
    }

    // ─── Receive USDT from SeedSale ───────────────────────────────────────

    /// @notice Called by SeedSale on each SEED purchase. Pulls USDT, splits
    ///         into 5 slots. Liquidity auto-forwards to LiquidityPoolV5.
    function receiveAndDistribute(uint256 amount)
        external
        onlyRole(CALLER_ROLE)
        nonReentrant
    {
        require(amount > 0, "SBv5b: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 d = (amount * BPS_DISTRIBUTION) / 10_000;
        uint256 o = (amount * BPS_OPERATIONAL)  / 10_000;
        uint256 m = (amount * BPS_MGMT_BONUS)   / 10_000;
        uint256 l = (amount * BPS_LIQUIDITY)    / 10_000;
        uint256 r = (amount * BPS_RESERVED)     / 10_000;

        slotBalance[SLOT_DISTRIBUTION] += d;
        slotBalance[SLOT_OPERATIONAL]  += o;
        slotBalance[SLOT_MGMT_BONUS]   += m;
        slotBalance[SLOT_RESERVED]     += r;

        slotTotalReceived[SLOT_DISTRIBUTION] += d;
        slotTotalReceived[SLOT_OPERATIONAL]  += o;
        slotTotalReceived[SLOT_MGMT_BONUS]   += m;
        slotTotalReceived[SLOT_LIQUIDITY]    += l;
        slotTotalReceived[SLOT_RESERVED]     += r;

        // Liquidity auto-forward (closed-loop)
        if (liquidityPool != address(0)) {
            usdt.forceApprove(liquidityPool, l);
            IPoolReceiver(liquidityPool).receiveAndDistribute(l);
        } else {
            // Hold if not yet configured
            slotBalance[SLOT_LIQUIDITY] += l;
        }

        emit ReceivedAndDistributed(amount, d, o, m, l, r);
    }

    // ─── Release USDT (called by authorized pool controllers) ─────────────

    /// @notice Pool controller releases USDT from a slot to a recipient.
    ///         Fee is deducted from the gross amount.
    /// @dev Caller must be slotController[slot]. The Liquidity slot (3)
    ///      cannot release directly — funds go to LiquidityPoolV5 on receive.
    /// @param slot      Slot index (0=Distribution, 1=Operational, 2=MgmtBonus, 4=Reserved)
    /// @param recipient Destination wallet
    /// @param amount    Gross USDT amount (before fee)
    function release(uint8 slot, address recipient, uint256 amount)
        external
        nonReentrant
    {
        require(msg.sender == slotController[slot], "SBv5b: not controller");
        require(slot != SLOT_LIQUIDITY, "SBv5b: liquidity auto-forward");
        require(recipient != address(0), "SBv5b: zero recipient");
        require(amount > 0, "SBv5b: zero amount");
        require(slotBalance[slot] >= amount, "SBv5b: insufficient slot balance");

        slotBalance[slot]        -= amount;
        slotTotalReleased[slot]  += amount;

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee;

        usdt.safeTransfer(recipient, net);
        if (fee > 0) {
            usdt.safeTransfer(feeReceiver, fee);
        }

        emit Released(slot, recipient, net, fee);
    }

    // ─── Owner config ─────────────────────────────────────────────────────

    function setSlotController(uint8 slot, address controller)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(slot != SLOT_LIQUIDITY, "SBv5b: liquidity has no controller");
        slotController[slot] = controller;
        emit SlotControllerUpdated(slot, controller);
    }

    function setLiquidityPool(address pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        liquidityPool = pool;
        emit LiquidityPoolUpdated(pool);
    }

    /// @notice Owner sets fee config. Mirrors /payment-requests pattern.
    /// @param bps      Fee in BPS, max 1000 (10%)
    /// @param receiver Single global fee receiver wallet
    function setFee(uint16 bps, address receiver)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(bps <= 1000, "SBv5b: max 10% fee");
        require(receiver != address(0), "SBv5b: zero receiver");
        feeBps = bps;
        feeReceiver = receiver;
        emit FeeUpdated(bps, receiver);
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function totalUsdtBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
