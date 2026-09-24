// 存档：账单版本锁定与旧版留存、支付状态登记、按足环/日期/支付状态查询、本地持久化

import type { Bill, CageStatus, TrainingSession } from "./billing";
import { settleSession } from "./billing";

export type PaymentStatus = "unpaid" | "paid";

export interface PaymentRecord {
  billId: string;
  ring: string;
  status: PaymentStatus;
  paidAt?: string;
}

export interface Archive {
  sessions: TrainingSession[];
  bills: Bill[]; // 所有版本，旧版以 state: "archived" 留存
  payments: PaymentRecord[];
}

const STORAGE_KEY = "hxyfront-62014-fee-archive-v1";

export function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function loadArchive(): Archive {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Archive;
      if (Array.isArray(parsed.sessions) && Array.isArray(parsed.bills) && Array.isArray(parsed.payments)) {
        return parsed;
      }
    }
  } catch {
    // 本地存档损坏时回退到演示数据
  }
  return seedArchive();
}

export function saveArchive(archive: Archive): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
  } catch {
    // 存储不可用时静默失败，页面内状态仍可继续操作
  }
}

export function activeBillOf(archive: Archive, sessionId: string): Bill | undefined {
  return archive.bills.find((bill) => bill.sessionId === sessionId && bill.state === "active");
}

export function billsOf(archive: Archive, sessionId: string): Bill[] {
  return archive.bills
    .filter((bill) => bill.sessionId === sessionId)
    .sort((a, b) => b.version - a.version);
}

export function paymentOf(archive: Archive, billId: string, ring: string): PaymentStatus {
  return archive.payments.find((p) => p.billId === billId && p.ring === ring)?.status ?? "unpaid";
}

function unpaidRecordsFor(bill: Bill): PaymentRecord[] {
  return bill.lines
    .filter((line) => line.charged)
    .map((line) => ({ billId: bill.id, ring: line.ring, status: "unpaid" as const }));
}

/** 财务确认：场次账单锁定，生成第一版账单 */
export function confirmSession(archive: Archive, sessionId: string, now: string = nowStr()): Archive {
  const session = archive.sessions.find((s) => s.id === sessionId);
  if (!session || session.locked) return archive;

  const bill = settleSession(session, "财务确认出账", now);
  return {
    sessions: archive.sessions.map((s) =>
      s.id === sessionId ? { ...s, locked: true, version: bill.version } : s,
    ),
    bills: [...archive.bills, bill],
    payments: [...archive.payments, ...unpaidRecordsFor(bill)],
  };
}

/**
 * 重新核算：锁定后修改训放距离或装笼名单时调用。
 * 当前账单转为 archived 旧版存档，按工作副本生成新版本；已支付状态按足环继承。
 */
export function reBill(
  archive: Archive,
  sessionId: string,
  reason: string,
  now: string = nowStr(),
): Archive {
  const session = archive.sessions.find((s) => s.id === sessionId);
  if (!session || !session.locked) return archive;

  const previous = activeBillOf(archive, sessionId);
  const bill = settleSession(session, reason, now);

  const carried: PaymentRecord[] = bill.lines
    .filter((line) => line.charged)
    .map((line) => {
      const old = previous
        ? archive.payments.find((p) => p.billId === previous.id && p.ring === line.ring)
        : undefined;
      return {
        billId: bill.id,
        ring: line.ring,
        status: old?.status ?? ("unpaid" as PaymentStatus),
        paidAt: old?.paidAt,
      };
    });

  return {
    sessions: archive.sessions.map((s) =>
      s.id === sessionId ? { ...s, version: bill.version } : s,
    ),
    bills: [
      ...archive.bills.map((b) =>
        b.sessionId === sessionId && b.state === "active" ? { ...b, state: "archived" as const } : b,
      ),
      bill,
    ],
    payments: [...archive.payments, ...carried],
  };
}

/** 登记/撤销一笔费用的支付 */
export function setPayment(
  archive: Archive,
  billId: string,
  ring: string,
  status: PaymentStatus,
  now: string = nowStr(),
): Archive {
  const rest = archive.payments.filter((p) => !(p.billId === billId && p.ring === ring));
  return {
    ...archive,
    payments: [
      ...rest,
      { billId, ring, status, paidAt: status === "paid" ? now : undefined },
    ],
  };
}

/** 费用查询条件：足环号（模糊）、日期区间、支付状态、是否包含旧版账单 */
export interface FeeQuery {
  ring: string;
  dateFrom: string;
  dateTo: string;
  payment: PaymentStatus | "all";
  includeArchived: boolean;
}

export interface FeeRecord {
  billId: string;
  version: number;
  billState: Bill["state"];
  date: string;
  location: string;
  distanceKm: number;
  ring: string;
  owner: string;
  status: CageStatus;
  charged: boolean;
  amount: number;
  payment: PaymentStatus;
  paidAt?: string;
}

/** 查询每笔费用：可按足环、日期、支付状态过滤 */
export function queryFees(archive: Archive, q: FeeQuery): FeeRecord[] {
  const ringKeyword = q.ring.trim().toLowerCase();
  const rows: FeeRecord[] = [];

  for (const bill of archive.bills) {
    if (!q.includeArchived && bill.state !== "active") continue;
    if (q.dateFrom && bill.date < q.dateFrom) continue;
    if (q.dateTo && bill.date > q.dateTo) continue;

    for (const line of bill.lines) {
      if (ringKeyword && !line.ring.toLowerCase().includes(ringKeyword)) continue;
      const record = archive.payments.find(
        (p) => p.billId === bill.id && p.ring === line.ring,
      );
      const payment: PaymentStatus = record?.status ?? "unpaid";
      // 出发前退出不计费，仅在“全部”支付状态下展示
      if (!line.charged && q.payment !== "all") continue;
      if (line.charged && q.payment !== "all" && payment !== q.payment) continue;

      rows.push({
        billId: bill.id,
        version: bill.version,
        billState: bill.state,
        date: bill.date,
        location: bill.location,
        distanceKm: bill.distanceKm,
        ring: line.ring,
        owner: line.owner,
        status: line.status,
        charged: line.charged,
        amount: line.amount,
        payment,
        paidAt: record?.paidAt,
      });
    }
  }

  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.version < b.version ? 1 : -1;
  });
}

/** 演示数据：通过出账/重新核算流程生成，含一版旧版存档 */
function seedArchive(): Archive {
  const sessionA: TrainingSession = {
    id: "S-0912",
    date: "2026-09-12",
    location: "石家庄",
    distanceKm: 120,
    costs: { vehicle: 300, fuel: 260, toll: 120, release: 200 },
    entries: [
      { ring: "CHN-26-011023", owner: "王建军", status: "returned" },
      { ring: "CHN-26-011088", owner: "李秀兰", status: "returned" },
      { ring: "CHN-25-098771", owner: "赵宏伟", status: "missing" },
      { ring: "CHN-26-012350", owner: "陈志强", status: "returned" },
      { ring: "CHN-26-012617", owner: "刘桂香", status: "returned" },
      { ring: "CHN-25-097304", owner: "孙立新", status: "withdrawn" },
    ],
    locked: false,
    version: 0,
  };

  const sessionB: TrainingSession = {
    id: "S-0919",
    date: "2026-09-19",
    location: "保定",
    distanceKm: 80,
    costs: { vehicle: 300, fuel: 240, toll: 120, release: 200 },
    entries: [
      { ring: "CHN-26-011023", owner: "王建军", status: "returned" },
      { ring: "CHN-26-011088", owner: "李秀兰", status: "missing" },
      { ring: "CHN-25-098771", owner: "赵宏伟", status: "returned" },
      { ring: "CHN-26-012350", owner: "陈志强", status: "returned" },
      { ring: "CHN-26-012617", owner: "刘桂香", status: "returned" },
    ],
    locked: false,
    version: 0,
  };

  const sessionC: TrainingSession = {
    id: "S-0926",
    date: "2026-09-26",
    location: "衡水",
    distanceKm: 150,
    costs: { vehicle: 350, fuel: 320, toll: 160, release: 300 },
    entries: [
      { ring: "CHN-26-011023", owner: "王建军", status: "caged" },
      { ring: "CHN-26-011088", owner: "李秀兰", status: "caged" },
      { ring: "CHN-25-098771", owner: "赵宏伟", status: "caged" },
      { ring: "CHN-26-012350", owner: "陈志强", status: "caged" },
    ],
    locked: false,
    version: 0,
  };

  let archive: Archive = { sessions: [sessionA, sessionB, sessionC], bills: [], payments: [] };

  archive = confirmSession(archive, "S-0912", "2026-09-12 20:40");
  archive = confirmSession(archive, "S-0919", "2026-09-19 19:05");

  archive = setPayment(archive, "S-0912-V1", "CHN-26-011023", "paid", "2026-09-13 09:20");
  archive = setPayment(archive, "S-0912-V1", "CHN-26-012350", "paid", "2026-09-14 11:02");
  archive = setPayment(archive, "S-0919-V1", "CHN-26-011023", "paid", "2026-09-20 08:15");

  // 第二场实际放飞距离从 80km 调整为 100km，油费随之上调 → 重新核算，V1 留为旧版
  archive = {
    ...archive,
    sessions: archive.sessions.map((s) =>
      s.id === "S-0919"
        ? { ...s, distanceKm: 100, costs: { vehicle: 300, fuel: 300, toll: 140, release: 260 } }
        : s,
    ),
  };
  archive = reBill(archive, "S-0919", "修改训放距离 80→100km，修改费用登记，重新核算", "2026-09-20 08:40");

  return archive;
}
