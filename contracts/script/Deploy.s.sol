// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script } from "forge-std/Script.sol";
import { PaymentProcessor } from "../src/PaymentProcessor.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

/**
 * @notice Deploy TestUSDC and PaymentProcessor, allowlist tUSDC and write a versioned
 *         deployment manifest to contracts/deployments/<chainId>.json.
 *
 * Required environment:
 *   DEPLOYER_PRIVATE_KEY  testnet deployer key (never a mainnet key)
 *   TREASURY_ADDRESS      fee recipient
 *   PLATFORM_FEE_BPS      optional, defaults to 100
 */
contract Deploy is Script {
    function run() external returns (address processorAddress, address tokenAddress) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 feeBps = vm.envOr("PLATFORM_FEE_BPS", uint256(100));

        vm.startBroadcast(deployerPrivateKey);

        TestUSDC token = new TestUSDC();
        PaymentProcessor processor = new PaymentProcessor(deployer, treasury, feeBps);
        processor.setTokenAllowed(address(token), true);

        vm.stopBroadcast();

        processorAddress = address(processor);
        tokenAddress = address(token);

        string memory objectKey = "deployment";
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeUint(objectKey, "blockNumber", block.number);
        vm.serializeAddress(objectKey, "deployer", deployer);
        vm.serializeAddress(objectKey, "treasury", treasury);
        vm.serializeUint(objectKey, "feeBps", feeBps);
        vm.serializeAddress(objectKey, "testUsdc", tokenAddress);
        string memory json = vm.serializeAddress(objectKey, "paymentProcessor", processorAddress);

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
    }
}
