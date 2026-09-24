// 业务文件二：存档
// 负责训放单、账单旧版、支付状态的本地持久化，以及鸽主查账所需的查询/导出。
import { computeBillLines, makeSnapshot, totalFee } from "./feeRules";
import type { BillSnapshot, BirdEntry, TrainingSession } from "../types";

const STORAGE_KEY = "xunfang-fee-desk-v1";

export interface PaymentMap {
  [sessionId: string]: { [ringNo: string]: boolean };
}

export interface ArchiveState {
  sessions: TrainingSession[];
  snapshots: Record<string, BillSnapshot[]>;
  payments: PaymentMap;
}

/** 查询结果中展开的一行费用（可能是当前账单，也可能是存档旧版） */
export interface FeeRecord {
  sessionId: string;
  date: string;
  venue: string;
  distanceKm: number;
  ringNo: string;
  owner: string;
  birdStatus: BirdEntry["status"];
  amount: number;
  paid: boolean;
  /** pending = 草稿/重算中尚未财务确认；locked = 当前有效账单；archived = 已被新版替换的旧版 */
  recordState: "pending" | "locked" | "archived";
  version: number;
  generatedAt?: string;
}

export interface FeeQuery {
  ringNo: string;
  owner: string;
  date: string; // YYYY-MM-DD，空表示不限
  payStatus: "all" | "paid" | "unpaid" | "pending";
  includeHistory: boolean;
}

function seed(): ArchiveState {
  const birdsA: BirdEntry[] = [
    { ringNo: "CHN-26-001839", owner: "王建军", status: "loaded" },
    { ringNo: "CHN-26-002114", owner: "李茂才", status: "loaded" },
    { ringNo: "CHN-26-003007", owner: "王建军", status: "lost" }, // 未归巢照样承担
    { ringNo: "CHN-26-004251", owner: "赵守根", status: "loaded" },
    { ringNo: "CHN-26-005662", owner: "李茂才", status: "loaded" },
    { ringNo: "CHN-26-006108", owner: "孙启明", status: "loaded" },
    { ringNo: "CHN-26-007330", owner: "王建军", status: "withdrawn" }, // 出发前退出不计费
  ];
  const sessionA: TrainingSession = {
    id: "S-20260920",
    date: "2026-09-20",
    venue: "武清放飞点",
    distanceKm: 120,
    vehicle: "鸽棚大巴",
    fuel: 360,
    toll: 120,
    releaseFee: 60,
    birds: birdsA,
    status: "locked",
    confirmedAt: "2026-09-20T19:40:00+08:00",
  };

  const birdsB: BirdEntry[] = [
    { ringNo: "CHN-26-001839", owner: "王建军", status: "loaded" },
    { ringNo: "CHN-26-002114", owner: "李茂才", status: "loaded" },
    { ringNo: "CHN-26-003007", owner: "王建军", status: "loaded" },
    { ringNo: "CHN-26-007330", owner: "王建军", status: "withdrawn" },
  ];
  const sessionB: TrainingSession = {
    id: "S-20260923",
    date: "2026-09-23",
    venue: "静海放飞点",
    distanceKm: 80,
    vehicle: "张师傅面包车",
    fuel: 200,
    toll: 60,
    releaseFee: 40,
    birds: birdsB,
    status: "draft",
  };

  const birdsC: BirdEntry[] = [
    { ringNo: "CHN-26-001839", owner: "王建军", status: "loaded" },
    { ringNo: "CHN-26-002114", owner: "李茂才", status: "loaded" },
    { ringNo: "CHN-26-003007", owner: "王建军", status: "loaded" },
    { ringNo: "CHN-26-004251", owner: "赵守根", status: "loaded" },
    { ringNo: "CHN-26-005662", owner: "李茂才", status: "loaded" },
    { ringNo: "CHN-26-006108", owner: "孙启明", status: "loaded" },
    { ringNo: "CHN-26-008001", owner: "周连海", status: "loaded" },
    { ringNo: "CHN-26-009214", owner: "周连海", status: "loaded" },
    { ringNo: "CHN-26-010775", owner: "孙启明", status: "withdrawn" },
  ];
  const sessionC: TrainingSession = {
    id: "S-20260914",
    date: "2026-09-14",
    venue: "霸州放飞点",
    distanceKm: 150,
    vehicle: "鸽棚大巴",
    fuel: 420,
    toll: 150,
    releaseFee: 70,
    birds: birdsC,
    status: "locked",
    confirmedAt: "2026-09-14T20:05:00+08:00",
  };

  // 霸州场经历过一次改单：v1 按 140km/600 元锁定，后来改正距离与油费重新核算为 v2
  const sessionCV1: TrainingSession = {
    ...sessionC,
    distanceKm: 140,
    fuel: 380,
  };
  const v1 = makeSnapshot(sessionCV1, 1);
  v1.generatedAt = "2026-09-14T19:10:00+08:00";
  const v2 = makeSnapshot(sessionC, 2, v1);
  v2.generatedAt = "2026-09-14T20:05:00+08:00";

  // 支付状态以快照为准同步写回
  const markPaid = (snap: BillSnapshot, rings: string[]) => {
    snap.lines = snap.lines.map((l) => ({ ...l, paid: rings.includes(l.ringNo) }));
  };
  const snapA = makeSnapshot(sessionA, 1);
  snapA.generatedAt = sessionA.confirmedAt!;
  markPaid(snapA, ["CHN-26-001839", "CHN-26-004251"]);
  markPaid(v2, ["CHN-26-008001"]);

  return {
    sessions: [sessionA, sessionB, sessionC],
    snapshots: {
      [sessionA.id]: [snapA],
      [sessionB.id]: [],
      [sessionC.id]: [v1, v2],
    },
    payments: {
      [sessionA.id]: { "CHN-26-001839": true, "CHN-26-004251": true },
      [sessionC.id]: { "CHN-26-008001": true },
    },
  };
}

export function loadArchive(): ArchiveState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ArchiveState;
      if (Array.isArray(parsed.sessions)) return parsed;
    }
  } catch {
    // 存档损坏时回退到种子数据
  }
  return seed();
}

export function saveArchive(state: ArchiveState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetArchive(): ArchiveState {
  const fresh = seed();
  saveArchive(fresh);
  return fresh;
}

/** 当前有效账单行：锁定场按登记数据实时核算，支付状态读存档 */
export function currentLines(session: TrainingSession, payments: PaymentMap) {
  const lines = computeBillLines(session.birds, totalFee(session));
  const paidMap = payments[session.id] ?? {};
  return lines.map((line) => ({ ...line, paid: !!paidMap[line.ringNo] }));
}

/** 鸽主查账：按足环、日期、支付状态把每笔费用展开成行 */
export function queryFees(state: ArchiveState, query: FeeQuery): FeeRecord[] {
  const records: FeeRecord[] = [];
  const ringKw = query.ringNo.trim().toUpperCase();
  const ownerKw = query.owner.trim();

  for (const session of state.sessions) {
    const snaps = state.snapshots[session.id] ?? [];
    const latestVersion = snaps.length ? snaps[snaps.length - 1].version : 0;
    const isLatestCurrent = session.status === "locked" && snaps.length > 0;

    if (session.status === "locked") {
      const lines = currentLines(session, state.payments);
      for (const line of lines) {
        records.push({
          sessionId: session.id,
          date: session.date,
          venue: session.venue,
          distanceKm: session.distanceKm,
          ringNo: line.ringNo,
          owner: line.owner,
          birdStatus: line.status,
          amount: line.amount,
          paid: line.paid,
          recordState: "locked",
          version: latestVersion,
          generatedAt: session.confirmedAt,
        });
      }
    } else {
      // 草稿 / 改单重算中：摊额可见但标记为待确认，不作应收
      const lines = computeBillLines(session.birds, totalFee(session));
      for (const line of lines) {
        records.push({
          sessionId: session.id,
          date: session.date,
          venue: session.venue,
          distanceKm: session.distanceKm,
          ringNo: line.ringNo,
          owner: line.owner,
          birdStatus: line.status,
          amount: line.amount,
          paid: false,
          recordState: "pending",
          version: latestVersion,
        });
      }
    }

    if (query.includeHistory) {
      for (const snap of snaps) {
        if (isLatestCurrent && snap.version === latestVersion) continue; // 当前版已在上面
        for (const line of snap.lines) {
          records.push({
            sessionId: session.id,
            date: session.date,
            venue: session.venue,
            distanceKm: snap.distanceKm,
            ringNo: line.ringNo,
            owner: line.owner,
            birdStatus: line.status,
            amount: line.amount,
            paid: line.paid,
            recordState: "archived",
            version: snap.version,
            generatedAt: snap.generatedAt,
          });
        }
      }
    }
  }

  const filtered = records.filter((r) => {
    if (ringKw && !r.ringNo.toUpperCase().includes(ringKw)) return false;
    if (ownerKw && !r.owner.includes(ownerKw)) return false;
    if (query.date && r.date !== query.date) return false;
    if (query.payStatus === "paid" && !(r.recordState !== "pending" && r.paid)) return false;
    if (query.payStatus === "unpaid") {
      if (r.recordState === "pending" || r.paid) return false;
    }
    if (query.payStatus === "pending" && r.recordState !== "pending") return false;
    return true;
  });

  return filtered.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    b.sessionId.localeCompare(a.sessionId) ||
    b.version - a.version ||
    a.ringNo.localeCompare(b.ringNo),
  );
}

export function exportCSV(records: FeeRecord[]): string {
  const header = ["训放日期", "地点", "距离(km)", "足环号", "鸽主", "状态", "分摊(元)", "支付状态", "账单版本"];
  const stateLabel: Record<FeeRecord["recordState"], string> = {
    locked: "当前账单",
    pending: "待财务确认",
    archived: "存档旧版",
  };
  const birdLabel: Record<BirdEntry["status"], string> = {
    loaded: "已装笼",
    withdrawn: "出发前退出",
    lost: "未归巢",
  };
  const rows = records.map((r) => [
    r.date,
    r.venue,
    String(r.distanceKm),
    r.ringNo,
    r.owner,
    birdLabel[r.birdStatus],
    r.amount.toFixed(2),
    r.recordState === "pending" ? "待确认" : r.paid ? "已支付" : "未支付",
    `v${r.version}（${stateLabel[r.recordState]}）`,
  ]);
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
