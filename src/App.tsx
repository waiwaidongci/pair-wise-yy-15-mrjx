import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  CAGE_STATUS_LABEL,
  CAGE_STATUS_OPTIONS,
  chargeableEntries,
  diffReasons,
  needsRecalc,
  previewShare,
  totalCost,
  type CageStatus,
  type SessionCosts,
  type TrainingSession,
} from "./domain/billing";
import {
  activeBillOf,
  billsOf,
  confirmSession,
  loadArchive,
  nowStr,
  paymentOf,
  queryFees,
  reBill,
  saveArchive,
  setPayment,
  type Archive,
  type FeeQuery,
  type PaymentStatus,
} from "./domain/archive";

const fmtMoney = (n: number) => `¥${n.toFixed(2)}`;
const num = (raw: string) => Math.max(0, Number(raw) || 0);

const COST_FIELDS: Array<{ key: keyof SessionCosts; label: string }> = [
  { key: "vehicle", label: "车辆费" },
  { key: "fuel", label: "油费" },
  { key: "toll", label: "路桥费" },
  { key: "release", label: "放飞费" },
];

function App() {
  const [archive, setArchive] = useState<Archive>(loadArchive);
  const [selectedId, setSelectedId] = useState<string>(() => archive.sessions[0]?.id ?? "");
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState<FeeQuery>({
    ring: "",
    dateFrom: "",
    dateTo: "",
    payment: "all",
    includeArchived: false,
  });

  useEffect(() => {
    saveArchive(archive);
  }, [archive]);

  const session = archive.sessions.find((s) => s.id === selectedId) ?? archive.sessions[0];
  const activeBill = session ? activeBillOf(archive, session.id) : undefined;
  const versionBills = session ? billsOf(archive, session.id) : [];
  const preview = session
    ? previewShare(session.costs, session.entries)
    : { totalCost: 0, shareCount: 0, perShare: 0, roundingDiff: 0 };
  const dirty = session ? needsRecalc(session, activeBill) : false;
  const feeRows = useMemo(() => queryFees(archive, query), [archive, query]);

  // 财务汇总（只统计当前有效账单）
  const summary = useMemo(() => {
    let receivable = 0;
    let received = 0;
    for (const bill of archive.bills.filter((b) => b.state === "active")) {
      receivable += bill.totalCost;
      for (const line of bill.lines.filter((l) => l.charged)) {
        if (paymentOf(archive, bill.id, line.ring) === "paid") received += line.amount;
      }
    }
    return {
      sessions: archive.sessions.length,
      receivable,
      received,
      unpaid: receivable - received,
      missing: archive.sessions.reduce(
        (n, s) => n + s.entries.filter((e) => e.status === "missing").length,
        0,
      ),
    };
  }, [archive]);

  // ---- 页面操作：场次工作副本编辑 ----
  const patchSession = (id: string, patch: Partial<TrainingSession>) =>
    setArchive((a) => ({
      ...a,
      sessions: a.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const patchCost = (id: string, key: keyof SessionCosts, value: number) =>
    setArchive((a) => ({
      ...a,
      sessions: a.sessions.map((s) =>
        s.id === id ? { ...s, costs: { ...s.costs, [key]: value } } : s,
      ),
    }));

  const patchEntry = (id: string, index: number, patch: Partial<{ ring: string; owner: string; status: CageStatus }>) =>
    setArchive((a) => ({
      ...a,
      sessions: a.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              entries: s.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
            }
          : s,
      ),
    }));

  const removeEntry = (id: string, index: number) =>
    setArchive((a) => ({
      ...a,
      sessions: a.sessions.map((s) =>
        s.id === id ? { ...s, entries: s.entries.filter((_, i) => i !== index) } : s,
      ),
    }));

  const [newRing, setNewRing] = useState("");
  const [newOwner, setNewOwner] = useState("");

  const addEntry = (id: string) => {
    const ring = newRing.trim();
    const owner = newOwner.trim();
    const target = archive.sessions.find((s) => s.id === id);
    if (!ring || !owner || !target) return;
    if (target.entries.some((e) => e.ring === ring)) {
      window.alert(`足环 ${ring} 已在本场装笼名单中`);
      return;
    }
    patchSession(id, { entries: [...target.entries, { ring, owner, status: "caged" }] });
    setNewRing("");
    setNewOwner("");
  };

  // ---- 页面操作：财务确认锁定 / 修改后重新核算 ----
  const handleConfirm = (id: string) => setArchive((a) => confirmSession(a, id));

  const handleRebill = (id: string) => {
    const current = archive.sessions.find((s) => s.id === id);
    const bill = activeBillOf(archive, id);
    if (!current || !bill) return;
    const reason = diffReasons(current, bill).join("，") || "重新核算";
    setArchive((a) => reBill(a, id, `${reason}，重新核算`));
  };

  return (
    <main className="app">
      <section className="hero">
        <p>训放费用分摊台 · 群里接龙不如一本明白账</p>
        <h1>训放开销 · 按笼平摊</h1>
        <span>
          每场登记车辆、油费、路桥费和放飞费，按实际装笼羽数平摊；出发前退出不计费，未归巢照样承担。
          财务确认后账单锁定，再改训放距离或装笼名单需重新核算并留存旧版，鸽主可按足环、日期和支付状态查每笔费用。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>训放场次</small>
          <strong>{summary.sessions}</strong>
        </article>
        <article>
          <small>应收总额（当前账单）</small>
          <strong>{fmtMoney(summary.receivable)}</strong>
        </article>
        <article>
          <small>已收金额</small>
          <strong className="ok">{fmtMoney(summary.received)}</strong>
        </article>
        <article>
          <small>待收 / 未归巢</small>
          <strong>
            {fmtMoney(summary.unpaid)}
            <em> · {summary.missing} 羽</em>
          </strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <div className="heading">
            <div>
              <p>训放场次</p>
              <h2>选择一场登记</h2>
            </div>
            <button className="primary" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "收起" : "＋ 新建场次"}
            </button>
          </div>

          {showNew && <NewSessionForm onCreate={(s) => {
            setArchive((a) => ({ ...a, sessions: [...a.sessions, s] }));
            setSelectedId(s.id);
            setShowNew(false);
          }} />}

          <div className="session-list">
            {archive.sessions.map((s) => (
              <button
                key={s.id}
                className={`session-item ${session?.id === s.id ? "active" : ""}`}
                onClick={() => setSelectedId(s.id)}
              >
                <span className="session-date">{s.date}</span>
                <strong>{s.location} · {s.distanceKm}km</strong>
                <span className={`badge ${s.locked ? "badge-lock" : "badge-draft"}`}>
                  {s.locked ? `已锁定 V${s.version}` : "草稿"}
                </span>
                <small>
                  {chargeableEntries(s.entries).length} 羽计费 · {fmtMoney(totalCost(s.costs))}
                </small>
              </button>
            ))}
          </div>
        </aside>

        {session && (
          <section className="panel form-panel">
            <div className="heading">
              <div>
                <p>场次登记</p>
                <h2>
                  {session.location}训放
                  {session.locked && <span className="badge badge-lock">账单已锁定 V{session.version}</span>}
                  {dirty && <span className="badge badge-warn">有改动待重新核算</span>}
                </h2>
              </div>
              {!session.locked ? (
                <button
                  className="primary"
                  disabled={preview.shareCount === 0}
                  onClick={() => handleConfirm(session.id)}
                  title={preview.shareCount === 0 ? "至少要有一羽实际装笼的鸽子才能出账" : ""}
                >
                  财务确认锁定
                </button>
              ) : (
                <button className="primary warn" disabled={!dirty} onClick={() => handleRebill(session.id)}>
                  重新核算（留存 V{session.version} 旧版）
                </button>
              )}
            </div>

            {session.locked && (
              <p className="lock-tip">
                {dirty
                  ? "训放距离、费用或装笼名单已修改：点击重新核算生成新版账单，旧版自动归档保留。"
                  : "账单已经财务确认锁定。如需修改训放距离或装笼名单，直接改动后再点重新核算。"}
              </p>
            )}

            <div className="field-grid">
              <label>
                <span>训放日期</span>
                <input
                  type="date"
                  value={session.date}
                  onChange={(e) => patchSession(session.id, { date: e.target.value })}
                />
              </label>
              <label>
                <span>放飞地点</span>
                <input
                  value={session.location}
                  onChange={(e) => patchSession(session.id, { location: e.target.value })}
                />
              </label>
              <label>
                <span>训放距离（km）</span>
                <input
                  type="number"
                  min={0}
                  value={session.distanceKm}
                  onChange={(e) => patchSession(session.id, { distanceKm: num(e.target.value) })}
                />
              </label>
              {COST_FIELDS.map((f) => (
                <label key={f.key}>
                  <span>{f.label}（元）</span>
                  <input
                    type="number"
                    min={0}
                    value={session.costs[f.key]}
                    onChange={(e) => patchCost(session.id, f.key, num(e.target.value))}
                  />
                </label>
              ))}
            </div>

            <div className="preview-bar">
              <span>费用合计 <b>{fmtMoney(preview.totalCost)}</b></span>
              <span>实际装笼计费 <b>{preview.shareCount} 羽</b></span>
              <span>出发前退出 <b>{session.entries.length - preview.shareCount} 羽（不计费）</b></span>
              <span>每羽平摊 <b className="accent">{fmtMoney(preview.perShare)}</b></span>
              {preview.roundingDiff !== 0 && <span className="diff">尾差 {fmtMoney(preview.roundingDiff)} 计入本场</span>}
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>足环号</th>
                    <th>鸽主</th>
                    <th>装笼状态</th>
                    <th className="num">分摊金额</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {session.entries.map((entry, i) => (
                    <tr key={`${entry.ring}-${i}`} className={entry.status === "withdrawn" ? "muted-row" : entry.status === "missing" ? "missing-row" : ""}>
                      <td>
                        <input
                          value={entry.ring}
                          onChange={(e) => patchEntry(session.id, i, { ring: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          value={entry.owner}
                          onChange={(e) => patchEntry(session.id, i, { owner: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          value={entry.status}
                          onChange={(e) => patchEntry(session.id, i, { status: e.target.value as CageStatus })}
                        >
                          {CAGE_STATUS_OPTIONS.map((st) => (
                            <option key={st} value={st}>{CAGE_STATUS_LABEL[st]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        {entry.status === "withdrawn" ? "不计费" : fmtMoney(preview.perShare)}
                      </td>
                      <td>
                        <button className="link-danger" onClick={() => removeEntry(session.id, i)}>移除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="add-row">
              <input placeholder="足环号，如 CHN-26-011023" value={newRing} onChange={(e) => setNewRing(e.target.value)} />
              <input placeholder="鸽主姓名" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
              <button onClick={() => addEntry(session.id)} disabled={!newRing.trim() || !newOwner.trim()}>
                加入装笼名单
              </button>
            </div>
          </section>
        )}
      </section>

      {session && versionBills.length > 0 && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>账单存档</p>
              <h2>{session.location} · 历版账单（共 {versionBills.length} 版）</h2>
            </div>
          </div>
          <div className="bill-versions">
            {versionBills.map((bill) => (
              <article key={bill.id} className={`bill-card ${bill.state === "active" ? "current" : "archived"}`}>
                <header>
                  <strong>V{bill.version}</strong>
                  <span className={`badge ${bill.state === "active" ? "badge-lock" : "badge-old"}`}>
                    {bill.state === "active" ? "当前账单" : "旧版存档"}
                  </span>
                  <span>{bill.distanceKm}km · {bill.shareCount} 羽平摊 · 每羽 {fmtMoney(bill.perShare)}</span>
                  <span className="bill-total">{fmtMoney(bill.totalCost)}</span>
                </header>
                <p className="bill-reason">{bill.reason} · 确认于 {bill.confirmedAt}</p>
                <div className="bill-lines">
                  {bill.lines.map((line) => (
                    <span key={line.ring} className={line.charged ? "" : "muted"}>
                      {line.ring}（{CAGE_STATUS_LABEL[line.status]}）
                      <b>{line.charged ? fmtMoney(line.amount) : "不计费"}</b>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>鸽主费用查询</p>
            <h2>按足环、日期、支付状态查每笔费用</h2>
          </div>
        </div>

        <div className="query-bar">
          <label>
            <span>足环号</span>
            <input
              placeholder="支持模糊查询"
              value={query.ring}
              onChange={(e) => setQuery((q) => ({ ...q, ring: e.target.value }))}
            />
          </label>
          <label>
            <span>日期从</span>
            <input
              type="date"
              value={query.dateFrom}
              onChange={(e) => setQuery((q) => ({ ...q, dateFrom: e.target.value }))}
            />
          </label>
          <label>
            <span>日期到</span>
            <input
              type="date"
              value={query.dateTo}
              onChange={(e) => setQuery((q) => ({ ...q, dateTo: e.target.value }))}
            />
          </label>
          <label>
            <span>支付状态</span>
            <select
              value={query.payment}
              onChange={(e) => setQuery((q) => ({ ...q, payment: e.target.value as PaymentStatus | "all" }))}
            >
              <option value="all">全部</option>
              <option value="unpaid">未支付</option>
              <option value="paid">已支付</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={query.includeArchived}
              onChange={(e) => setQuery((q) => ({ ...q, includeArchived: e.target.checked }))}
            />
            <span>含旧版账单</span>
          </label>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>场次</th>
                <th>账单版本</th>
                <th>足环号</th>
                <th>鸽主</th>
                <th>归巢状态</th>
                <th className="num">分摊金额</th>
                <th>支付状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {feeRows.map((row) => {
                const isActiveRow = row.billState === "active" && row.charged;
                return (
                  <tr key={`${row.billId}-${row.ring}`} className={!row.charged ? "muted-row" : row.status === "missing" ? "missing-row" : ""}>
                    <td>{row.date}</td>
                    <td>{row.location} · {row.distanceKm}km</td>
                    <td>
                      V{row.version}
                      {row.billState === "archived" && <span className="badge badge-old">旧版</span>}
                    </td>
                    <td>{row.ring}</td>
                    <td>{row.owner}</td>
                    <td>{CAGE_STATUS_LABEL[row.status]}</td>
                    <td className="num">{row.charged ? fmtMoney(row.amount) : "不计费"}</td>
                    <td>
                      {!row.charged ? (
                        <span className="muted">—</span>
                      ) : row.payment === "paid" ? (
                        <span className="pay-paid">已支付{row.paidAt ? ` ${row.paidAt}` : ""}</span>
                      ) : (
                        <span className="pay-unpaid">未支付</span>
                      )}
                    </td>
                    <td>
                      {isActiveRow &&
                        (row.payment === "paid" ? (
                          <button
                            className="link-danger"
                            onClick={() => setArchive((a) => setPayment(a, row.billId, row.ring, "unpaid"))}
                          >
                            撤销收款
                          </button>
                        ) : (
                          <button
                            className="primary small"
                            onClick={() => setArchive((a) => setPayment(a, row.billId, row.ring, "paid", nowStr()))}
                          >
                            标记已付
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
              {feeRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">没有符合条件的费用记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="query-summary">
          共 {feeRows.filter((r) => r.charged).length} 笔记费费用，合计{" "}
          <b>{fmtMoney(feeRows.filter((r) => r.charged).reduce((sum, r) => sum + r.amount, 0))}</b>
          {query.includeArchived ? "（含旧版账单）" : "（仅当前账单，旧版可勾选“含旧版账单”查看）"}
        </p>
      </section>
    </main>
  );
}

function NewSessionForm({ onCreate }: { onCreate: (s: TrainingSession) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [location, setLocation] = useState("");
  const [distanceKm, setDistanceKm] = useState(0);
  const [costs, setCosts] = useState<SessionCosts>({ vehicle: 0, fuel: 0, toll: 0, release: 0 });

  const submit = () => {
    if (!location.trim()) {
      window.alert("请填写放飞地点");
      return;
    }
    onCreate({
      id: `S-${Date.now().toString(36)}`,
      date,
      location: location.trim(),
      distanceKm,
      costs,
      entries: [],
      locked: false,
      version: 0,
    });
  };

  return (
    <div className="new-session">
      <label>
        <span>训放日期</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span>放飞地点</span>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如 石家庄" />
      </label>
      <label>
        <span>训放距离（km）</span>
        <input type="number" min={0} value={distanceKm} onChange={(e) => setDistanceKm(num(e.target.value))} />
      </label>
      {COST_FIELDS.map((f) => (
        <label key={f.key}>
          <span>{f.label}（元）</span>
          <input
            type="number"
            min={0}
            value={costs[f.key]}
            onChange={(e) => setCosts((c) => ({ ...c, [f.key]: num(e.target.value) }))}
          />
        </label>
      ))}
      <button className="primary" onClick={submit}>创建草稿场次</button>
    </div>
  );
}

export default App;
