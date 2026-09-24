// 训放费用分摊台的数据模型

/** 鸽子在本场训放中的状态：装笼 / 出发前退出（不计费）/ 未归巢（照样分摊） */
export type BirdStatus = "loaded" | "withdrawn" | "lost";

/** 装笼名单里的一羽赛鸽 */
export interface BirdEntry {
  ringNo: string;
  owner: string;
  status: BirdStatus;
}

/** 一场训放登记的费用与名单（编辑态数据） */
export interface TrainingSession {
  id: string;
  date: string; // YYYY-MM-DD
  venue: string; // 训放地点
  distanceKm: number; // 放飞距离（公里）
  vehicle: string; // 车辆
  fuel: number; // 油费（元）
  toll: number; // 路桥费（元）
  releaseFee: number; // 放飞费（元）
  birds: BirdEntry[];
  status: "draft" | "locked"; // 财务确认后锁定
  confirmedAt?: string;
  /** 锁定账单被改后进入重算态：此时已是草稿，等待财务再次确认生成新版 */
  revising?: boolean;
}

/** 账单上的一行：某羽鸽该场应承担的费用 */
export interface BillLine {
  ringNo: string;
  owner: string;
  status: BirdStatus;
  amount: number; // 元
  paid: boolean;
}

/** 账单快照（存档的旧版本，不再随编辑变化） */
export interface BillSnapshot {
  version: number; // 1, 2, 3 ...
  generatedAt: string;
  distanceKm: number;
  total: number;
  billableCount: number;
  lines: BillLine[];
  archivedReason: "财务确认" | "改单重算替换";
  /** 本次重算相对上一版的变化说明 */
  changeNote?: string;
}
