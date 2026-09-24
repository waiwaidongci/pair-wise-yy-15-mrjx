// 业务文件三：页面操作
// 把费用规则和存档串成页面可直接调用的操作：登记、锁定、改单重算、收款、查账。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  currentLines,
  loadArchive,
  queryFees,
  resetArchive,
  saveArchive,
  type ArchiveState,
  type FeeQuery,
  type FeeRecord,
} from "./archive";
import { makeSnapshot, totalFee, validateForLock } from "./feeRules";
import type { BirdStatus, TrainingSession } from "../types";

export type SessionPatch = Partial<Omit<TrainingSession, "id" | "birds">>;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** 新建一场空白训放单（草稿） */
export function createDraft(): TrainingSession {
  return {
    id: `S-${today().replace(/-/g, "")}-${Date.now().toString(36).toUpperCase()}`,
    date: today(),
    venue: "",
    distanceKm: 0,
    vehicle: "",
    fuel: 0,
    toll: 0,
    releaseFee: 0,
    birds: [],
    status: "draft",
  };
}

export function useFeeDesk() {
  const [state, setState] = useState<ArchiveState>(loadArchive);

  useEffect(() => {
    saveArchive(state);
  }, [state]);

  const snapshotsOf = useCallback(
    (id: string) => state.snapshots[id] ?? [],
    [state.snapshots],
  );

  /** 新增一场训放登记，返回新单 id */
  const addSession = useCallback((): string => {
    const draft = createDraft();
    setState((prev) => ({
      ...prev,
      sessions: [draft, ...prev.sessions],
      snapshots: { ...prev.snapshots, [draft.id]: [] },
    }));
    return draft.id;
  }, []);

  /** 改训放单头信息（距离、费用等）。锁定单不允许直接改，必须先申请改单。 */
  const patchSession = useCallback((id: string, patch: SessionPatch) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id && s.status === "draft" ? { ...s, ...patch } : s)),
    }));
  }, []);

  const addBird = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === id && s.status === "draft"
          ? { ...s, birds: [...s.birds, { ringNo: "", owner: "", status: "loaded" }] }
          : s,
      ),
    }));
  }, []);

  const updateBird = useCallback(
    (id: string, index: number, patch: Partial<{ ringNo: string; owner: string; status: BirdStatus }>) => {
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => {
          if (s.id !== id || s.status !== "draft") return s;
          const birds = s.birds.map((b, i) => (i === index ? { ...b, ...patch } : b));
          return { ...s, birds };
        }),
      }));
    },
    [],
  );

  const removeBird = useCallback((id: string, index: number) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === id && s.status === "draft"
          ? { ...s, birds: s.birds.filter((_, i) => i !== index) }
          : s,
      ),
    }));
  }, []);

  /**
   * 财务确认：校验通过后生成锁定账单快照。
   * 改单后再次确认会生成新版本，旧版原样保留在存档里。
   * 返回 null 表示成功，否则为错误提示。
   */
  const lockSession = useCallback(
    (id: string): string | null => {
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return "训放单不存在";
      if (session.status === "locked") return "账单已锁定，请先申请改单";
      const error = validateForLock(session);
      if (error) return error;

      setState((prev) => {
        const snaps = prev.snapshots[id] ?? [];
        const previous = snaps[snaps.length - 1];
        const snapshot = makeSnapshot(session, snaps.length + 1, previous);

        // 重算后，仍在计费名单里的足环继承旧版已支付状态
        if (previous) {
          const paidRings = new Set(previous.lines.filter((l) => l.paid).map((l) => l.ringNo));
          snapshot.lines = snapshot.lines.map((l) => ({ ...l, paid: paidRings.has(l.ringNo) }));
        }
        const paidMap = Object.fromEntries(
          snapshot.lines.filter((l) => l.paid).map((l) => [l.ringNo, true]),
        );

        return {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === id
              ? { ...s, status: "locked", revising: false, confirmedAt: snapshot.generatedAt }
              : s,
          ),
          snapshots: { ...prev.snapshots, [id]: [...snaps, snapshot] },
          payments: { ...prev.payments, [id]: paidMap },
        };
      });
      return null;
    },
    [state.sessions],
  );

  /**
   * 财务确认后申请改单：账单回到可编辑的「重算中」状态，
   * 但已锁定的旧版账单仍留在存档；改完距离或名单后需再次确认生成新版。
   */
  const unlockForRevise = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === id && s.status === "locked" ? { ...s, status: "draft", revising: true } : s,
      ),
    }));
  }, []);

  /** 登记鸽主付款（只能针对锁定账单）；同步更新最新版快照 */
  const togglePaid = useCallback((id: string, ringNo: string) => {
    setState((prev) => {
      const session = prev.sessions.find((s) => s.id === id);
      if (!session || session.status !== "locked") return prev;

      const oldMap = prev.payments[id] ?? {};
      const next = !oldMap[ringNo];
      const paidMap = { ...oldMap, [ringNo]: next };

      const snaps = prev.snapshots[id] ?? [];
      let newSnaps = snaps;
      if (snaps.length) {
        const latest = snaps[snaps.length - 1];
        const replaced = {
          ...latest,
          lines: latest.lines.map((l) => (l.ringNo === ringNo ? { ...l, paid: next } : l)),
        };
        newSnaps = [...snaps.slice(0, -1), replaced];
      }

      return {
        ...prev,
        payments: { ...prev.payments, [id]: paidMap },
        snapshots: { ...prev.snapshots, [id]: newSnaps },
      };
    });
  }, []);

  /** 只能删除从未锁定过的草稿（有存档版本的场次不能删，保证账单可追溯） */
  const removeSession = useCallback((id: string): boolean => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return false;
    if (session.status !== "draft" || (state.snapshots[id] ?? []).length > 0) return false;
    setState((prev) => {
      const { [id]: _removed, ...restSnaps } = prev.snapshots;
      const { [id]: _p, ...restPay } = prev.payments;
      return {
        sessions: prev.sessions.filter((s) => s.id !== id),
        snapshots: restSnaps,
        payments: restPay,
      };
    });
    return true;
  }, [state.sessions, state.snapshots]);

  const resetAll = useCallback(() => setState(resetArchive()), []);

  /** 某场当前应展示的分摊行：锁定读存档支付状态，草稿实时试算 */
  const linesOf = useCallback(
    (id: string) => {
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return [];
      return currentLines(session, state.payments);
    },
    [state.sessions, state.payments],
  );

  const search = useCallback((query: FeeQuery): FeeRecord[] => queryFees(state, query), [state]);

  /** 顶部概览指标：只统计锁定账单的应收/已收 */
  const overview = useMemo(() => {
    let receivable = 0;
    let received = 0;
    let pendingSessions = 0;
    for (const s of state.sessions) {
      if (s.status === "locked") {
        for (const line of currentLines(s, state.payments)) {
          receivable += line.amount;
          if (line.paid) received += line.amount;
        }
      } else {
        pendingSessions += 1;
      }
    }
    return {
      receivable: Math.round(receivable * 100) / 100,
      received: Math.round(received * 100) / 100,
      outstanding: Math.round((receivable - received) * 100) / 100,
      pendingSessions,
      sessionCount: state.sessions.length,
    };
  }, [state]);

  return {
    state,
    overview,
    snapshotsOf,
    linesOf,
    addSession,
    patchSession,
    addBird,
    updateBird,
    removeBird,
    lockSession,
    unlockForRevise,
    togglePaid,
    removeSession,
    resetAll,
    search,
    totalFeeOf: totalFee,
  };
}
