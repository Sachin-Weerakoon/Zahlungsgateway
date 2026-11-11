// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { PaymentProcessor } from "../src/PaymentProcessor.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

/// @notice Hostile token that attempts to re-enter the processor during a transfer.
contract ReentrantERC20 is ERC20 {
    PaymentProcessor public processor;
    bytes32 public attackRef;
    address public attackMerchant;
    bool public reentered;
    bool public reentryReverted;

    constructor() ERC20("Reentrant Token", "REENT") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttack(PaymentProcessor processor_, bytes32 ref, address merchant_) external {
        processor = processor_;
        attackRef = ref;
        attackMerchant = merchant_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!reentered && address(processor) != address(0)) {
            reentered = true;
            try processor.pay(attackRef, attackMerchant, address(this), 1) {
            // Should never succeed while the outer call holds the guard.
            }
            catch {
                reentryReverted = true;
            }
        }
        super._update(from, to, value);
    }
}

contract PaymentProcessorTest is Test {
    PaymentProcessor internal processor;
    TestUSDC internal token;

    address internal treasury = address(0xBEEF);
    address internal merchant = address(0xB0B);
    address internal payer = address(0xA11CE);
    address internal stranger = address(0xBAD);

    uint256 internal constant AMOUNT = 25_000_000; // 25 tUSDC
    uint256 internal constant FEE = 250_000; // 1%
    uint256 internal constant NET = 24_750_000;
    uint256 internal constant FUNDING = 1_000 * 10 ** 6;

    bytes32 internal constant SALT = keccak256("ORDER-1042");
    bytes32 internal REF;

    function setUp() public {
        token = new TestUSDC();
        processor = new PaymentProcessor(address(this), treasury, 100);
        processor.setTokenAllowed(address(token), true);

        token.mint(payer, FUNDING);
        token.mint(merchant, FUNDING);

        vm.prank(payer);
        token.approve(address(processor), type(uint256).max);
        vm.prank(merchant);
        token.approve(address(processor), type(uint256).max);

        REF = processor.invoiceRefFor(SALT, merchant, address(token), AMOUNT);
    }

    function _pay() internal {
        vm.prank(payer);
        processor.pay(SALT, merchant, address(token), AMOUNT);
    }

    function test_PaySplitsFeeAndNet() public {
        _pay();

        assertEq(token.balanceOf(merchant), FUNDING + NET);
        assertEq(token.balanceOf(treasury), FEE);
        assertEq(token.balanceOf(payer), FUNDING - AMOUNT);
        assertEq(token.balanceOf(address(processor)), 0);
        assertTrue(processor.isPaid(REF));

        PaymentProcessor.Payment memory payment = processor.paymentOf(REF);
        assertEq(payment.merchant, merchant);
        assertEq(payment.payer, payer);
        assertEq(payment.token, address(token));
        assertEq(payment.gross, AMOUNT);
        assertEq(payment.fee, FEE);
        assertEq(payment.net, NET);
        assertEq(payment.refunded, 0);
    }

    function test_PayEmitsPaymentReceived() public {
        vm.expectEmit(true, true, true, true, address(processor));
        emit PaymentProcessor.PaymentReceived(REF, merchant, payer, address(token), AMOUNT, FEE);
        _pay();
    }

    function test_RevertWhen_TokenNotAllowed() public {
        processor.setTokenAllowed(address(token), false);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentProcessor.TokenNotAllowed.selector, address(token))
        );
        processor.pay(SALT, merchant, address(token), AMOUNT);
    }

    function test_RevertWhen_AlreadyPaid() public {
        _pay();

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PaymentProcessor.AlreadyPaid.selector, REF));
        processor.pay(SALT, merchant, address(token), AMOUNT);
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(PaymentProcessor.InvalidAmount.selector);
        processor.pay(SALT, merchant, address(token), 0);
    }

    function test_RevertWhen_ZeroMerchant() public {
        vm.prank(payer);
        vm.expectRevert(PaymentProcessor.ZeroAddress.selector);
        processor.pay(SALT, address(0), address(token), AMOUNT);
    }

    function test_RevertWhen_ZeroReference() public {
        vm.prank(payer);
        vm.expectRevert(PaymentProcessor.InvalidReference.selector);
        processor.pay(bytes32(0), merchant, address(token), AMOUNT);
    }

    function test_RevertWhen_Paused() public {
        processor.pause();
        vm.prank(payer);
        vm.expectRevert();
        processor.pay(SALT, merchant, address(token), AMOUNT);
    }

    function test_RefundPartialThenFull() public {
        _pay();

        vm.prank(merchant);
        processor.refund(REF, 10_000_000);
        assertEq(processor.refundableAmount(REF), NET - 10_000_000);
        assertEq(token.balanceOf(payer), FUNDING - AMOUNT + 10_000_000);

        vm.prank(merchant);
        processor.refund(REF, NET - 10_000_000);
        assertEq(processor.refundableAmount(REF), 0);
        // The platform fee is never refunded, so the payer ends down by exactly FEE.
        assertEq(token.balanceOf(payer), FUNDING - FEE);
        assertEq(token.balanceOf(merchant), FUNDING);
        assertEq(token.balanceOf(address(processor)), 0);
    }

    function test_RefundWorksWhilePaused() public {
        _pay();
        processor.pause();

        vm.prank(merchant);
        processor.refund(REF, 1_000_000);
        assertEq(processor.refundableAmount(REF), NET - 1_000_000);
    }

    function test_RevertWhen_RefundAboveNet() public {
        _pay();

        vm.prank(merchant);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentProcessor.RefundExceedsNet.selector, REF, NET + 1, NET)
        );
        processor.refund(REF, NET + 1);
    }

    function test_RevertWhen_RefundByNonMerchant() public {
        _pay();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentProcessor.NotMerchant.selector, REF, stranger)
        );
        processor.refund(REF, 1);
    }

    function test_RevertWhen_RefundUnknownPayment() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentProcessor.PaymentNotFound.selector, REF));
        processor.refund(REF, 1);
    }

    function test_FeeCapEnforced() public {
        processor.setFeeBps(500);
        assertEq(processor.feeBps(), 500);

        vm.expectRevert(abi.encodeWithSelector(PaymentProcessor.FeeTooHigh.selector, 501, 500));
        processor.setFeeBps(501);
    }

    function test_PayWithZeroFee() public {
        processor.setFeeBps(0);
        _pay();

        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(merchant), FUNDING + AMOUNT);
        assertEq(token.balanceOf(address(processor)), 0);
    }

    function test_SetTreasuryRejectsZero() public {
        vm.expectRevert(PaymentProcessor.ZeroAddress.selector);
        processor.setTreasury(address(0));
    }

    function test_OnlyOwnerCanConfigure() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        processor.setFeeBps(200);
        vm.expectRevert();
        processor.setTreasury(stranger);
        vm.expectRevert();
        processor.setTokenAllowed(address(token), false);
        vm.expectRevert();
        processor.pause();
        vm.stopPrank();
    }

    function test_PayGasUnder150k() public {
        vm.prank(payer);
        uint256 gasBefore = gasleft();
        processor.pay(SALT, merchant, address(token), AMOUNT);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("pay gas used", gasUsed);
        assertLt(gasUsed, 150_000);
    }

    function test_MaxAmountIsUint80() public view {
        assertEq(processor.MAX_AMOUNT(), type(uint80).max);
    }

    function test_RevertWhen_AmountAboveMax() public {
        uint256 tooLarge = processor.MAX_AMOUNT() + 1;

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PaymentProcessor.AmountTooLarge.selector, tooLarge, processor.MAX_AMOUNT()
            )
        );
        processor.pay(SALT, merchant, address(token), tooLarge);
    }

    function test_FeeChangeDoesNotAffectHistoricalPayment() public {
        _pay();
        processor.setFeeBps(500);

        PaymentProcessor.Payment memory payment = processor.paymentOf(REF);
        assertEq(payment.fee, FEE);
        assertEq(payment.net, NET);
        assertEq(processor.refundableAmount(REF), NET);
    }

    function test_RemovedTokenRemainsRefundable() public {
        _pay();
        processor.setTokenAllowed(address(token), false);

        // The payment keeps its token through the append-only registry.
        assertEq(processor.paymentOf(REF).token, address(token));

        vm.prank(merchant);
        processor.refund(REF, 1_000_000);
        assertEq(token.balanceOf(payer), FUNDING - AMOUNT + 1_000_000);
    }

    function test_ReAddingTokenKeepsRegistryIndex() public {
        processor.setTokenAllowed(address(token), false);
        processor.setTokenAllowed(address(token), true);

        assertEq(processor.tokenCount(), 1);
        assertEq(processor.tokenAt(1), address(token));

        _pay();
        assertEq(processor.paymentOf(REF).token, address(token));
    }

    function test_RegistryIsCappedAt255Tokens() public {
        // setUp already registered one token, so 254 more fill the registry.
        assertEq(processor.tokenCount(), 1);
        for (uint256 i = 1; i <= 254; i++) {
            processor.setTokenAllowed(address(uint160(i)), true);
        }
        assertEq(processor.tokenCount(), 255);

        vm.expectRevert(PaymentProcessor.TooManyTokens.selector);
        processor.setTokenAllowed(address(uint160(255)), true);
    }

    function test_ReentrantTokenCannotReenter() public {
        ReentrantERC20 hostile = new ReentrantERC20();
        processor.setTokenAllowed(address(hostile), true);
        hostile.mint(payer, AMOUNT);

        vm.prank(payer);
        hostile.approve(address(processor), type(uint256).max);

        hostile.setAttack(processor, keccak256("attack"), merchant);

        vm.prank(payer);
        processor.pay(SALT, merchant, address(hostile), AMOUNT);

        assertTrue(hostile.reentryReverted());
        assertTrue(
            processor.isPaid(processor.invoiceRefFor(SALT, merchant, address(hostile), AMOUNT))
        );
        assertEq(hostile.balanceOf(address(processor)), 0);
    }

    function test_RefIsBoundToTerms() public view {
        bytes32 expected = keccak256(abi.encode(merchant, address(token), AMOUNT, SALT));
        assertEq(REF, expected);
        assertTrue(processor.invoiceRefFor(SALT, stranger, address(token), AMOUNT) != REF);
        assertTrue(processor.invoiceRefFor(SALT, merchant, address(token), AMOUNT - 1) != REF);
    }

    /// @notice A front-runner reusing the salt with other terms cannot occupy the reference.
    function test_FrontRunWithOtherTermsDoesNotBlockInvoice() public {
        token.mint(stranger, FUNDING);
        vm.startPrank(stranger);
        token.approve(address(processor), type(uint256).max);
        // Attacker pays themselves 1 base unit with the victim invoice's salt.
        processor.pay(SALT, stranger, address(token), 1);
        vm.stopPrank();

        assertFalse(processor.isPaid(REF));
        _pay();
        assertTrue(processor.isPaid(REF));
        assertEq(processor.paymentOf(REF).merchant, merchant);
    }

    function testFuzz_FeeMath(uint256 amount, uint256 feeBps) public {
        amount = bound(amount, 1, FUNDING);
        feeBps = bound(feeBps, 0, processor.MAX_FEE_BPS());
        processor.setFeeBps(feeBps);

        uint256 expectedFee = (amount * feeBps) / processor.BPS_DENOMINATOR();
        uint256 expectedNet = amount - expectedFee;
        bytes32 salt = keccak256(abi.encode(amount, feeBps));
        bytes32 invoiceRef = processor.invoiceRefFor(salt, merchant, address(token), amount);

        vm.prank(payer);
        processor.pay(salt, merchant, address(token), amount);

        PaymentProcessor.Payment memory payment = processor.paymentOf(invoiceRef);
        assertEq(payment.fee, expectedFee);
        assertEq(payment.net, expectedNet);
        assertLe(payment.fee, payment.gross);
        assertEq(token.balanceOf(address(processor)), 0);
    }
}
