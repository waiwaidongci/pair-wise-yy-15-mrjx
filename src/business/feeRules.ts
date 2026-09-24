// 业务文件一：费用规则
// 只管「一场训放怎么算钱」，不关心存档和页面。
import type { BillLine, BillSnapshot, BirdEntry, BirdStatus, TrainingSession } from "../types";

/** 页面上需要登记的四项费用 */
export const FEE_FIELDS = [
  { key: "fuel", label: "油费" },
  { key: "toll", label: "路桥费" },
  { key: "releaseFee", label: "放飞费" },
] as const;

/** 装笼状态的中文口径说明 */
export const STATUS_LABEL: Record<BirdStatus, string> = {
  loaded: "已装笼",
  withdrawn: "出发前退出 · 不计费",
  lost: "未归巢 · 照常分摊",
};

/** 参与分摊的状态：装笼与未归巢都要承担，出发前退出不计费 */
export const BILLABLE_STATUS: BirdStatus[] = ["loaded", "lost"];

export function isBillable(bird: BirdEntry): boolean {
  return BILLABLE_STATUS.includes(bird.status);
}

export function totalFee(session: Pick<TrainingSession, "fuel" | "toll" | "releaseFee">): number {
  return round2(session.fuel + session.toll + session.releaseFee);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 按实际装笼鸽子平摊本场费用。
 * 规则：总费用（油费 + 路桥费 + 放飞费）÷ 计费羽数；
 * 除不尽产生的分币，按足环排序补给前几只，保证合计一分不差。
 */
export function computeBillLines(birds: BirdEntry[], total: number): BillLine[] {
  const billable = birds.filter(isBillable).sort((a, b) => a.ringNo.localeCompare(b.ringNo));
  if (billable.length === 0) return [];

  const cents = Math.round(total * 100);
  const base = Math.floor(cents / billable.length);
  let remainder = cents - base * billable.length;

  return billable.map((bird) => {
    const share = base + (remainder-- > 0 ? 1 : 0);
    return {
      ringNo: bird.ringNo,
      owner: bird.owner,
      status: bird.status,
      amount: share / 100,
      paid: false,
    };
  });
}

/** 财务确认 / 重新确认时，由一场训放生成账单快照 */
export function makeSnapshot(
  session: TrainingSession,
  version: number,
  previous?: BillSnapshot,
): BillSnapshot {
  const total = totalFee(session);
  const lines = computeBillLines(session.birds, total);
  return {
    version,
    generatedAt: new Date().toISOString(),
    distanceKm: session.distanceKm,
    total,
    billableCount: lines.length,
    lines,
    archivedReason: previous ? "改单重算替换" : "财务确认",
    changeNote: previous ? describeChanges(previous, session, lines) : undefined,
  };
}

/** 重算后对照旧版，给出变化说明（改距离 / 改名单都会重新核算） */
export function describeChanges(prev: BillSnapshot, session: TrainingSession, lines: BillLine[]): string {
  const notes: string[] = [];
  if (prev.distanceKm !== session.distanceKm) {
    notes.push(`放飞距离 ${prev.distanceKm}km → ${session.distanceKm}km`);
  }
  if (prev.total !== totalFee(session)) {
    notes.push(`费用合计 ${money(prev.total)}元 → ${money(totalFee(session))}元`);
  }
  const prevMap = new Map(prev.lines.map((l) => [l.ringNo, l.amount]));
  const nowMap = new Map(lines.map((l) => [l.ringNo, l.amount]));

  const added = [...nowMap.keys()].filter((r) => !prevMap.has(r));
  const removed = [...prevMap.keys()].filter((r) => !nowMap.has(r));
  const changed = [...nowMap.keys()].filter(
    (r) => prevMap.has(r) && prevMap.get(r) !== nowMap.get(r),
  );

  if (added.length) notes.push(`新增计费：${added.join("、")}`);
  if (removed.length) notes.push(`移出计费：${removed.join("、")}`);
  if (changed.length) {
    notes.push(
      `分摊变动：${changed.map((r) => `${r} ${money(prevMap.get(r)!)}→${money(nowMap.get(r)!)}元`).join("，")}`,
    );
  }
  if (notes.length === 0) notes.push("内容无变化，重新生成版本");
  return notes.join("；");
}

/** 财务确认前的硬性校验 */
export function validateForLock(session: TrainingSession): string | null {
  if (!session.date) return "请先选择训放日期";
  if (!session.venue.trim()) return "请填写训放地点";
  if (!session.vehicle.trim()) return "请登记车辆";
  if ([session.fuel, session.toll, session.releaseFee].some((n) => Number.isNaN(n) || n < 0)) {
    return "油费、路桥费、放飞费需为不小于 0 的数字";
  }
  if (session.birds.length === 0) return "请先登记装笼名单";
  if (session.birds.some((b) => !b.ringNo.trim())) return "存在没有足环号的鸽子";
  if (session.birds.some((b) => !b.owner.trim())) return "存在没有鸽主的鸽子";
  if (session.birds.filter(isBillable).length === 0) {
    return "没有可计费的鸽子（出发前退出不计费，至少要有一羽装笼或未归巢）";
  }
  return null;
}

export function money(n: number): string {
  return n.toFixed(2);
}
