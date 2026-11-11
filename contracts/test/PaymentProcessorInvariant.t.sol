// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { PaymentProcessor } from "../src/PaymentProcessor.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

/// @notice Randomised caller used by the invariant suite.
contract PaymentHandler is Test {
    PaymentProcessor public immutable processor;
    TestUSDC public immutable token;
    address public immutable merchant;

    address[] public payers;
    bytes32[] public refs;
    uint256 public counter;

    constructor(
        PaymentProcessor processor_,
        TestUSDC token_,
        address merchant_,
        address[] memory payers_
    ) {
        processor = processor_;
        token = token_;
        merchant = merchant_;
        payers = payers_;

        vm.prank(merchant);
        token.approve(address(processor), type(uint256).max);

        for (uint256 i = 0; i < payers_.length; i++) {
            token.mint(payers_[i], 1_000 * 10 ** 6);
            vm.prank(payers_[i]);
            token.approve(address(processor), type(uint256).max);
        }
    }

    function pay(uint256 amountSeed, uint256 payerSeed) external {
        address payer = payers[payerSeed % payers.length];
        uint256 amount = bound(amountSeed, 1, 1_000_000);
        if (token.balanceOf(payer) < amount) return;

        bytes32 salt = keccak256(abi.encode(counter++));
        bytes32 invoiceRef = processor.invoiceRefFor(salt, merchant, address(token), amount);
        vm.prank(payer);
        processor.pay(salt, merchant, address(token), amount);
        refs.push(invoiceRef);
    }

    function refund(uint256 amountSeed, uint256 refSeed) external {
        if (refs.length == 0) return;

        bytes32 invoiceRef = refs[refSeed % refs.length];
        uint256 remaining = processor.refundableAmount(invoiceRef);
        if (remaining == 0) return;

        uint256 amount = bound(amountSeed, 1, remaining);
        vm.prank(merchant);
        processor.refund(invoiceRef, amount);
    }

    function refsLength() external view returns (uint256) {
        return refs.length;
    }
}

contract PaymentProcessorInvariantTest is Test {
    PaymentProcessor internal processor;
    TestUSDC internal token;
    PaymentHandler internal handler;

    address internal treasury = address(0xBEEF);
    address internal merchant = address(0xB0B);

    function setUp() public {
        token = new TestUSDC();
        processor = new PaymentProcessor(address(this), treasury, 100);
        processor.setTokenAllowed(address(token), true);

        address[] memory payers = new address[](3);
        payers[0] = address(0xA11CE);
        payers[1] = address(0xB0B0);
        payers[2] = address(0xC0FFEE);

        handler = new PaymentHandler(processor, token, merchant, payers);

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = PaymentHandler.pay.selector;
        selectors[1] = PaymentHandler.refund.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));

        // Only the handler drives state changes: fuzzing the token directly could mint
        // balances to the processor and break SC-6 for reasons unrelated to its logic.
        targetContract(address(handler));
        excludeContract(address(token));
        excludeContract(address(processor));
    }

    /// @notice SC-6: the processor must never hold a token balance.
    function invariant_ContractHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(processor)), 0);
    }
}
