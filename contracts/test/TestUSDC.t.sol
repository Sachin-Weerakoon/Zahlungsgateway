// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

contract TestUSDCTest is Test {
    TestUSDC internal token;
    address internal alice = address(0xA11CE);

    function setUp() public {
        token = new TestUSDC();
    }

    function test_DecimalsAreSix() public view {
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "tUSDC");
    }

    function test_MintUpToCap() public {
        token.mint(alice, token.MINT_CAP());
        assertEq(token.balanceOf(alice), 1_000 * 10 ** 6);
    }

    function test_RevertWhen_MintAboveCap() public {
        uint256 requested = token.MINT_CAP() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(TestUSDC.MintCapExceeded.selector, requested, token.MINT_CAP())
        );
        token.mint(alice, requested);
    }

    function test_RevertWhen_MintToZeroAddress() public {
        vm.expectRevert();
        token.mint(address(0), 1);
    }
}
