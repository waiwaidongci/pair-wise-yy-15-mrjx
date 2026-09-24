// 费用规则：每场训放的费用登记、按实际装笼羽数平摊、退出/未归巢处理、账单快照核算

export interface SessionCosts {
  vehicle: number; // 车辆费（元）
  fuel: number; // 油费（元）
  toll: number; // 路桥费（元）
  release: number; // 放飞费（元）
}

/**
 * 装笼状态：
 * - caged     装笼待放（计费）
 * - returned  已归巢（计费）
 * - missing   未归巢（照样承担费用）
 * - withdrawn 出发前退出（不计费）
 */
export type CageStatus = "caged" | "returned" | "missing" | "withdrawn";

export const CAGE_STATUS_LABEL: Record<CageStatus, string> = {
  caged: "装笼待放",
  returned: "已归巢",
  missing: "未归巢",
  withdrawn: "出发前退出",
};

export const CAGE_STATUS_OPTIONS: CageStatus[] = ["caged", "returned", "missing", "withdrawn"];

export interface CageEntry {
  ring: string; // 足环号
  owner: string; // 鸽主
  status: CageStatus;
}

export interface TrainingSession {
  id: string;
  date: string; // 训放日期 YYYY-MM-DD
  location: string; // 放飞地点
  distanceKm: number; // 训放距离（km）
  costs: SessionCosts;
  entries: CageEntry[];
  locked: boolean; // 财务确认后锁定
  version: number; // 当前账单版本号，0 = 尚未出账
}

export interface BillLine {
  ring: string;
  owner: string;
  status: CageStatus;
  charged: boolean; // 出发前退出为 false，不计费
  amount: number; // 该羽分摊金额（元）
}

export interface Bill {
  id: string; // `${sessionId}-V${version}`
  sessionId: string;
  version: number;
  date: string;
  location: string;
  distanceKm: number;
  costs: SessionCosts;
  totalCost: number; // 费用合计
  shareCount: number; // 实际计费装笼羽数
  perShare: number; // 每羽平摊金额
  roundingDiff: number; // 每羽保留两位小数产生的尾差
  lines: BillLine[];
  state: "active" | "archived"; // 当前有效账单 / 旧版存档
  reason: string; // 出账原因：财务确认 / 修改距离或名单重新核算
  confirmedAt: string;
}

export const emptyCosts = (): SessionCosts => ({ vehicle: 0, fuel: 0, toll: 0, release: 0 });

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 费用合计 = 车辆 + 油费 + 路桥 + 放飞 */
export function totalCost(costs: SessionCosts): number {
  return round2(costs.vehicle + costs.fuel + costs.toll + costs.release);
}

/** 计费规则：出发前退出不计费；装笼、归巢、未归巢都按实际装笼平摊 */
export function isChargeable(status: CageStatus): boolean {
  return status !== "withdrawn";
}

export function chargeableEntries(entries: CageEntry[]): CageEntry[] {
  return entries.filter((entry) => isChargeable(entry.status));
}

export interface SharePreview {
  totalCost: number;
  shareCount: number;
  perShare: number;
  roundingDiff: number;
}

/** 平摊试算：费用合计按实际装笼羽数平摊 */
export function previewShare(costs: SessionCosts, entries: CageEntry[]): SharePreview {
  const total = totalCost(costs);
  const count = chargeableEntries(entries).length;
  if (count === 0) {
    return { totalCost: total, shareCount: 0, perShare: 0, roundingDiff: 0 };
  }
  const perShare = round2(total / count);
  return {
    totalCost: total,
    shareCount: count,
    perShare,
    roundingDiff: round2(total - perShare * count),
  };
}

/** 把场次当前工作副本快照成一版账单（首次出账 / 重新核算都走这里） */
export function settleSession(session: TrainingSession, reason: string, now: string): Bill {
  const preview = previewShare(session.costs, session.entries);
  const version = session.version + 1;
  return {
    id: `${session.id}-V${version}`,
    sessionId: session.id,
    version,
    date: session.date,
    location: session.location,
    distanceKm: session.distanceKm,
    costs: { ...session.costs },
    totalCost: preview.totalCost,
    shareCount: preview.shareCount,
    perShare: preview.perShare,
    roundingDiff: preview.roundingDiff,
    lines: session.entries.map((entry) => ({
      ring: entry.ring,
      owner: entry.owner,
      status: entry.status,
      charged: isChargeable(entry.status),
      amount: isChargeable(entry.status) ? preview.perShare : 0,
    })),
    state: "active",
    reason,
    confirmedAt: now,
  };
}

function statusMap(entries: CageEntry[]): Map<string, CageStatus> {
  return new Map(entries.map((entry) => [entry.ring.trim(), entry.status]));
}

/**
 * 锁定后判断工作副本相对当前账单是否有待重新核算的改动：
 * 训放距离、费用登记或装笼名单（足环/状态）任一变动即需要重新核算。
 */
export function needsRecalc(session: TrainingSession, bill: Bill | undefined): boolean {
  if (!bill || !session.locked) return false;
  if (session.distanceKm !== bill.distanceKm) return true;
  if (totalCost(session.costs) !== bill.totalCost) return true;

  const current = statusMap(session.entries);
  const billed = new Map(bill.lines.map((line) => [line.ring, line.status]));
  if (current.size !== billed.size) return true;
  for (const [ring, status] of current) {
    if (billed.get(ring) !== status) return true;
  }
  return false;
}

/** 列出锁定后改动项，作为重新核算账单的原因说明 */
export function diffReasons(session: TrainingSession, bill: Bill | undefined): string[] {
  if (!bill) return [];
  const reasons: string[] = [];
  if (session.distanceKm !== bill.distanceKm) {
    reasons.push(`修改训放距离 ${bill.distanceKm}→${session.distanceKm}km`);
  }
  if (totalCost(session.costs) !== bill.totalCost) {
    reasons.push("修改车辆/油费/路桥/放飞费用");
  }
  const current = statusMap(session.entries);
  const billed = new Map(bill.lines.map((line) => [line.ring, line.status]));
  if (current.size !== billed.size || [...current].some(([ring, status]) => billed.get(ring) !== status)) {
    reasons.push("修改装笼名单");
  }
  return reasons;
}
