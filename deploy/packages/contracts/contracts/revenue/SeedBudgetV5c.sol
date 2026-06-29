// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SeedBudgetV5c — 4-slot centralized USDT vault for SEED revenue
/// @notice Replaces SeedBudgetV5b. Liquidity slot removed; Reserved expanded to 50%.
///         Reserved spending is gated by ReservedExpensesPoolV3 Council vote.
contract SeedBudgetV5c is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant SLOT_DISTRIBUTION = 0;
    uint8 public constant SLOT_OPERATIONAL  = 1;
    uint8 public constant SLOT_MGMT_BONUS   = 2;
    uint8 public constant SLOT_RESERVED     = 3;

    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");

    uint256 public constant BPS_DISTRIBUTION = 2000; // 20%
    uint256 public constant BPS_OPERATIONAL  = 2000; // 20%
    uint256 public constant BPS_MGMT_BONUS   = 1000; // 10%
    uint256 public constant BPS_RESERVED     = 5000; // 50%

    IERC20 public immutable usdt;

    mapping(uint8 => uint256) public slotBalance;
    mapping(uint8 => uint256) public slotTotalReceived;
    mapping(uint8 => uint256) public slotTotalReleased;
    mapping(uint8 => address) public slotController;

    uint16  public feeBps;
    address public feeReceiver;

    event ReceivedAndDistributed(uint256 amount, uint256 d, uint256 o, uint256 m, uint256 r);
    event Released(uint8 indexed slot, address indexed recipient, uint256 net, uint256 fee);
    event SlotControllerUpdated(uint8 indexed slot, address controller);
    event FeeUpdated(uint16 bps, address receiver);

    constructor(address _usdt, address _admin) {
        require(_usdt  != address(0), "SBv5c: zero usdt");
        require(_admin != address(0), "SBv5c: zero admin");
        usdt = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        feeReceiver = _admin;
    }

    function receiveAndDistribute(uint256 amount)
        external
        onlyRole(CALLER_ROLE)
        nonReentrant
    {
        require(amount > 0, "SBv5c: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 d = (amount * BPS_DISTRIBUTION) / 10_000;
        uint256 o = (amount * BPS_OPERATIONAL)  / 10_000;
        uint256 m = (amount * BPS_MGMT_BONUS)   / 10_000;
        uint256 r = (amount * BPS_RESERVED)     / 10_000;

        slotBalance[SLOT_DISTRIBUTION] += d;
        slotBalance[SLOT_OPERATIONAL]  += o;
        slotBalance[SLOT_MGMT_BONUS]   += m;
        slotBalance[SLOT_RESERVED]     += r;

        slotTotalReceived[SLOT_DISTRIBUTION] += d;
        slotTotalReceived[SLOT_OPERATIONAL]  += o;
        slotTotalReceived[SLOT_MGMT_BONUS]   += m;
        slotTotalReceived[SLOT_RESERVED]     += r;

        emit ReceivedAndDistributed(amount, d, o, m, r);
    }

    function release(uint8 slot, address recipient, uint256 amount)
        external
        nonReentrant
    {
        require(slot < 4, "SBv5c: invalid slot");
        require(msg.sender == slotController[slot], "SBv5c: not controller");
        require(recipient != address(0), "SBv5c: zero recipient");
        require(amount > 0, "SBv5c: zero amount");
        require(slotBalance[slot] >= amount, "SBv5c: insufficient slot balance");

        slotBalance[slot]        -= amount;
        slotTotalReleased[slot]  += amount;

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee;
        if (fee > 0 && feeReceiver != address(0)) {
            usdt.safeTransfer(feeReceiver, fee);
        }
        usdt.safeTransfer(recipient, net);

        emit Released(slot, recipient, net, fee);
    }

    function setSlotController(uint8 slot, address controller)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(slot < 4, "SBv5c: invalid slot");
        slotController[slot] = controller;
        emit SlotControllerUpdated(slot, controller);
    }

    function setFee(uint16 bps, address receiver)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(bps <= 1000, "SBv5c: fee too high");
        require(receiver != address(0), "SBv5c: zero receiver");
        feeBps = bps;
        feeReceiver = receiver;
        emit FeeUpdated(bps, receiver);
    }
}
