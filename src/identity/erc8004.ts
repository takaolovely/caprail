import {
  buildErc8004RegisterCall,
  CELO,
  decodeErc8004AgentUri,
  encodeErc8004AgentUri,
  ERC8004_ADDRESSES,
  erc8004AgentCount,
  erc8004RegisterPermissions,
  erc8004Registry,
  getErc8004Agent,
  registerErc8004Agent,
  setErc8004AgentUri,
  withErc8004Registration,
  type Erc8004RegistrationFile,
  type RegisterAgentResult,
  type Signer,
  type Wallet,
} from "@altananetwork/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CELO_ERC8004_REGISTRY: Address = erc8004Registry(CELO.chainId);

/**
 * Loads the repository-confined `src/identity/agent-card.json` template safely.
 */
export async function loadAgentCardTemplate(): Promise<Erc8004RegistrationFile> {
  const cardPath = path.resolve(THIS_DIR, "agent-card.json");
  const relative = path.relative(THIS_DIR, cardPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path confinement violation while reading agent-card.json");
  }
  const raw = await readFile(cardPath, "utf8");
  return JSON.parse(raw) as Erc8004RegistrationFile;
}

export function encodeAgentCardDataUri(file: Erc8004RegistrationFile): string {
  return encodeErc8004AgentUri(file);
}

export function decodeAgentCardDataUri(uri: string): Erc8004RegistrationFile {
  return decodeErc8004AgentUri(uri);
}

export function getCeloErc8004RegisterPermissions() {
  return erc8004RegisterPermissions(CELO.chainId);
}

export function buildCeloErc8004RegisterCall(file: Erc8004RegistrationFile) {
  const uri = encodeErc8004AgentUri(file);
  return buildErc8004RegisterCall(CELO.chainId, uri);
}

export async function readCeloAgentCount(owner: Address): Promise<bigint> {
  return erc8004AgentCount(CELO, owner);
}

export async function readCeloAgentRecord(agentId: bigint) {
  return getErc8004Agent(CELO, agentId);
}

/**
 * Two-phase ERC-8004 mainnet registration using `@altananetwork/sdk`:
 *  1) Mint identity token with `registrations: []`
 *  2) Patch minted `agentId` into the registration file and call `setErc8004AgentUri`
 */
export async function registerCeloAgentTwoPhase(opts: {
  wallet: Wallet;
  adminSigner: Signer;
  card: Erc8004RegistrationFile;
  feeToken?: Address | readonly Address[] | undefined;
}): Promise<{
  mintResult: RegisterAgentResult;
  completedCard: Erc8004RegistrationFile;
  updateTxHash?: `0x${string}` | undefined;
}> {
  const initialUri = encodeErc8004AgentUri(opts.card);
  const execOpts = {
    network: CELO,
    ...(opts.feeToken !== undefined ? { feeToken: opts.feeToken } : {}),
  };

  const mintResult = await registerErc8004Agent(
    opts.wallet,
    opts.adminSigner,
    { agentUri: initialUri },
    execOpts,
  );

  const completedCard = withErc8004Registration(
    opts.card,
    mintResult.agentId,
    CELO.chainId,
  );
  const finalUri = encodeErc8004AgentUri(completedCard);

  const updateResult = await setErc8004AgentUri(
    opts.wallet,
    opts.adminSigner,
    { agentId: mintResult.agentId, agentUri: finalUri },
    execOpts,
  );

  return {
    mintResult,
    completedCard,
    updateTxHash: updateResult.transactionHash,
  };
}

export { ERC8004_ADDRESSES, withErc8004Registration };
