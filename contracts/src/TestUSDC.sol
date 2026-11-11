// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestUSDC
 * @notice Mock 6-decimal stablecoin for public test networks only.
 * @dev Test tokens have no monetary value. The public mint is capped per call.
 */
contract TestUSDC is ERC20 {
    /// @notice Maximum amount mintable in a single call (1,000 tUSDC).
    uint256 public constant MINT_CAP = 1_000 * 10 ** 6;

    error MintCapExceeded(uint256 requested, uint256 cap);

    constructor() ERC20("Test USD Coin", "tUSDC") { }

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Mint test tokens to an address.
     * @param to Recipient.
     * @param amount Amount in base units (6 decimals), at most MINT_CAP.
     */
    function mint(address to, uint256 amount) external {
        if (amount > MINT_CAP) revert MintCapExceeded(amount, MINT_CAP);
        _mint(to, amount);
    }
}
