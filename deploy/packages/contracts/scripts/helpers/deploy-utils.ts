import { ethers } from "hardhat";
import { BaseContract } from "ethers";

/**
 * Deploy a named contract with optional constructor arguments.
 * Logs progress and waits for deployment confirmation.
 */
export async function deployContract<T extends BaseContract>(
  name: string,
  args: unknown[] = []
): Promise<T> {
  console.log(`Deploying ${name}...`);
  const Factory = await ethers.getContractFactory(name);
  const contract = await Factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ${name} deployed at: ${address}`);
  return contract as T;
}

/**
 * Print a titled section separator to the console.
 */
export function logSection(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

/**
 * Wait for a transaction to be mined and log a confirmation message.
 */
export async function execTx(
  description: string,
  txPromise: Promise<{ wait: () => Promise<unknown> }>
): Promise<void> {
  const tx = await txPromise;
  await tx.wait();
  console.log(`  ✓ ${description}`);
}
