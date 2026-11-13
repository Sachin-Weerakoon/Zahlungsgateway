// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import {
    ReentrancyGuardTransient
} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @title PaymentProcessor
 * @notice Non-custodial payment splitter for allowlisted ERC-20 tokens.
 * @dev Each invoice reference accepts exactly one payment. The reference is derived on chain
 *      from the payment terms, `keccak256(abi.encode(merchant, token, amount, salt))`, so a
 *      third party cannot occupy an invoice's reference with a different merchant, token or
 *      amount (front-running or griefing). Paying with identical terms simply pays the
 *      merchant the full invoice amount. Funds move directly from the
 *      payer to the treasury (fee) and the merchant (net) in the same transaction, so the
 *      contract never holds a token balance. Refunds are pulled from the merchant and sent
 *      to the recorded payer. Fee-on-transfer and rebasing tokens are unsupported.
 *      The reentrancy guard uses EIP-1153 transient storage, which is available on Base
 *      Sepolia (Cancun) and saves gas versus a storage guard.
 */
contract PaymentProcessor is Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Fee denominator: 100 bps = 1%.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard cap on the platform fee (5%).
    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice Maximum payment amount, bounded so a payment record fits in two storage slots.
    /// @dev uint80 max is about 1.2e24 base units: unlimited for 6-decimal stablecoins and
    ///      about 1.2 million tokens for 18-decimal ones.
    uint256 public constant MAX_AMOUNT = type(uint80).max;

    /// @notice Recorded payment returned to callers.
    struct Payment {
        address merchant;
        address payer;
        address token;
        uint256 gross;
        uint256 fee;
        uint256 net;
        uint256 refunded;
    }

    /**
     * @dev Two-slot layout keeps `pay` under the SC-12 gas target.
     *      Slot 0: merchant (20) + feeBps (2) + refunded (10).
     *      Slot 1: payer (20) + gross (10) + tokenIndex (1).
     *      The fee is derived from the feeBps captured at payment time, so later fee changes
     *      never alter historical payments, and the token is resolved through the append-only
     *      registry so removed tokens remain refundable.
     */
    struct StoredPayment {
        address merchant;
        uint16 feeBps;
        uint80 refunded;
        address payer;
        uint80 gross;
        uint8 tokenIndex;
    }

    /// @notice Platform fee in basis points.
    uint256 public feeBps;

    /// @notice Recipient of the platform fee.
    address public treasury;

    /// @notice Token allowlist. Only standard ERC-20 tokens are supported.
    mapping(address token => bool allowed) public tokenAllowed;

    /// @dev Append-only token registry. Indices are 1-based and never reused, so a payment can
    ///      always resolve its token even after the token is removed from the allowlist.
    address[] private _tokenList;
    mapping(address token => uint8 index) private _tokenIndex;

    mapping(bytes32 invoiceRef => StoredPayment payment) private _payments;

    event PaymentReceived(
        bytes32 indexed invoiceRef,
        address indexed merchant,
        address indexed payer,
        address token,
        uint256 grossAmount,
        uint256 fee
    );

    event PaymentRefunded(
        bytes32 indexed invoiceRef, address indexed merchant, address payer, uint256 amount
    );

    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event TokenAllowed(address indexed token, bool allowed);

    error ZeroAddress();
    error InvalidReference();
    error InvalidAmount();
    error AmountTooLarge(uint256 amount, uint256 max);
    error TokenNotAllowed(address token);
    error TooManyTokens();
    error AlreadyPaid(bytes32 invoiceRef);
    error FeeTooHigh(uint256 requested, uint256 cap);
    error PaymentNotFound(bytes32 invoiceRef);
    error NotMerchant(bytes32 invoiceRef, address caller);
    error RefundExceedsNet(bytes32 invoiceRef, uint256 requested, uint256 remaining);

    /**
     * @param initialOwner Owner of the contract (multisig after deployment).
     * @param initialTreasury Recipient of platform fees.
     * @param initialFeeBps Initial fee in basis points (at most MAX_FEE_BPS).
     */
    constructor(address initialOwner, address initialTreasury, uint256 initialFeeBps)
        Ownable(initialOwner)
    {
        if (initialTreasury == address(0)) revert ZeroAddress();
        if (initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh(initialFeeBps, MAX_FEE_BPS);

        treasury = initialTreasury;
        feeBps = initialFeeBps;
    }

    /**
     * @notice Pay an invoice from the caller's wallet.
     * @dev The invoice reference is derived from the terms, see `invoiceRefFor`.
     * @param salt Random 32-byte salt issued by the platform for this invoice.
     * @param merchant Merchant payout address recorded for refunds.
     * @param token Allowlisted ERC-20 token address.
     * @param amount Gross amount in token base units.
     */
    function pay(bytes32 salt, address merchant, address token, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (salt == bytes32(0)) revert InvalidReference();
        if (merchant == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > MAX_AMOUNT) revert AmountTooLarge(amount, MAX_AMOUNT);
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);

        bytes32 invoiceRef = invoiceRefFor(salt, merchant, token, amount);
        if (_payments[invoiceRef].merchant != address(0)) revert AlreadyPaid(invoiceRef);

        uint256 fee = (amount * feeBps) / BPS_DENOMINATOR;
        uint256 net = amount - fee;

        // Checks-effects-interactions: record before any external call.
        _payments[invoiceRef] = StoredPayment({
            merchant: merchant,
            // Safe: feeBps is capped at MAX_FEE_BPS (500), so it always fits in uint16.
            // forge-lint: disable-next-line(unsafe-typecast)
            feeBps: uint16(feeBps),
            refunded: 0,
            payer: msg.sender,
            // Safe: amount was bounded by MAX_AMOUNT above.
            // forge-lint: disable-next-line(unsafe-typecast)
            gross: uint80(amount),
            // An allowlisted token always has a non-zero registry index.
            tokenIndex: _tokenIndex[token]
        });

        IERC20 tokenContract = IERC20(token);
        if (fee > 0) {
            tokenContract.safeTransferFrom(msg.sender, treasury, fee);
        }
        tokenContract.safeTransferFrom(msg.sender, merchant, net);

        emit PaymentReceived(invoiceRef, merchant, msg.sender, token, amount, fee);
    }

    /**
     * @notice Refund a payment from the merchant to the recorded payer.
     * @dev Works while the contract is paused. The platform fee is not refundable.
     * @param invoiceRef Invoice reference of the original payment.
     * @param amount Amount to refund in token base units.
     */
    function refund(bytes32 invoiceRef, uint256 amount) external nonReentrant {
        StoredPayment storage payment = _payments[invoiceRef];

        if (payment.merchant == address(0)) revert PaymentNotFound(invoiceRef);
        if (msg.sender != payment.merchant) revert NotMerchant(invoiceRef, msg.sender);
        if (amount == 0) revert InvalidAmount();

        uint256 remaining = _refundable(payment);
        if (amount > remaining) revert RefundExceedsNet(invoiceRef, amount, remaining);

        // Safe: the new total is at most gross - fee, which is bounded by MAX_AMOUNT.
        // forge-lint: disable-next-line(unsafe-typecast)
        payment.refunded = uint80(uint256(payment.refunded) + amount);
        IERC20(_tokenAt(payment.tokenIndex)).safeTransferFrom(msg.sender, payment.payer, amount);

        emit PaymentRefunded(invoiceRef, msg.sender, payment.payer, amount);
    }

    /// @notice Update the platform fee, bounded by MAX_FEE_BPS.
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        uint256 oldFeeBps = feeBps;
        feeBps = newFeeBps;
        emit FeeUpdated(oldFeeBps, newFeeBps);
    }

    /// @notice Update the fee recipient.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /// @notice Add or remove a token from the allowlist.
    /// @dev Registry indices are append-only and never reused; up to 255 tokens are supported.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (allowed && _tokenIndex[token] == 0) {
            uint256 nextIndex = _tokenList.length + 1;
            if (nextIndex > type(uint8).max) revert TooManyTokens();
            _tokenList.push(token);
            // Safe: nextIndex was bounded by type(uint8).max above.
            // forge-lint: disable-next-line(unsafe-typecast)
            _tokenIndex[token] = uint8(nextIndex);
        }
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @notice Pause new payments. Refunds remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume new payments.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Invoice reference that binds a salt to its merchant, token and amount.
    function invoiceRefFor(bytes32 salt, address merchant, address token, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(merchant, token, amount, salt));
    }

    /// @notice Whether an invoice reference has been paid.
    function isPaid(bytes32 invoiceRef) external view returns (bool) {
        return _payments[invoiceRef].merchant != address(0);
    }

    /// @notice Recorded payment for an invoice reference.
    function paymentOf(bytes32 invoiceRef) external view returns (Payment memory) {
        StoredPayment storage payment = _payments[invoiceRef];
        uint256 gross = payment.gross;
        uint256 fee = (gross * payment.feeBps) / BPS_DENOMINATOR;
        return Payment({
            merchant: payment.merchant,
            payer: payment.payer,
            token: payment.tokenIndex == 0 ? address(0) : _tokenAt(payment.tokenIndex),
            gross: gross,
            fee: fee,
            net: gross - fee,
            refunded: payment.refunded
        });
    }

    /// @notice Remaining amount the merchant may still refund.
    function refundableAmount(bytes32 invoiceRef) external view returns (uint256) {
        StoredPayment storage payment = _payments[invoiceRef];
        if (payment.merchant == address(0)) return 0;
        return _refundable(payment);
    }

    /// @notice Number of tokens ever registered (the allowlist is a subset).
    function tokenCount() external view returns (uint256) {
        return _tokenList.length;
    }

    /// @notice Token registered at a 1-based index, or the zero address when unknown.
    function tokenAt(uint256 index) external view returns (address) {
        if (index == 0 || index > _tokenList.length) return address(0);
        return _tokenList[index - 1];
    }

    /// @dev Refundable = gross - fee at the captured fee rate - already refunded.
    function _refundable(StoredPayment storage payment) private view returns (uint256) {
        uint256 gross = payment.gross;
        uint256 fee = (gross * payment.feeBps) / BPS_DENOMINATOR;
        return gross - fee - payment.refunded;
    }

    function _tokenAt(uint8 index) private view returns (address) {
        return _tokenList[index - 1];
    }
}
