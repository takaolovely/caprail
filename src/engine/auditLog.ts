import type { Address, Hex } from "viem";
import type { ExecutionMode } from "../wallet/index.js";

export type AuditStatus = "APPROVED" | "BLOCKED" | "REVOKED";

export interface AuditEvent {
  timestamp: string;
  mode: ExecutionMode;
  engine: "AUTO_DCA" | "REVENUE_SPLITTER" | "SESSION_CONTROL";
  action: string;
  status: AuditStatus;
  reasonCode?: string | undefined;
  reason?: string | undefined;
  walletAddress: Address;
  targets: Address[];
  totalAmount: string;
  spentTotal: string;
  remainingCap: string;
  txHash?: Hex | undefined;
  callsId?: Hex | undefined;
  attributionCode?: string | undefined;
}

export class AuditLogger {
  private readonly events: AuditEvent[] = [];
  private readonly emitToStdout: boolean;

  constructor(options?: { emitToStdout?: boolean }) {
    this.emitToStdout = options?.emitToStdout ?? false;
  }

  public record(event: AuditEvent): AuditEvent {
    this.events.push(event);
    if (this.emitToStdout) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
    return event;
  }

  public getEvents(): readonly AuditEvent[] {
    return [...this.events];
  }

  public toJsonLines(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n");
  }
}
