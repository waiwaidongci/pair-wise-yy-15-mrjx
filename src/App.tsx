import { useMemo, useState } from "react";
import "./styles.css";
import { useFeeDesk } from "./business/pageOps";
import { exportCSV, type FeeRecord, type FeeQuery } from "./business/archive";
import { FEE_FIELDS, money, STATUS_LABEL, totalFee } from "./business/feeRules";
import type { BirdStatus, TrainingSession } from "./types";

const STATUS_OPTIONS: { value: BirdStatus; label: string }[] = [
  { value: "loaded", label: "已装笼 · 计费" },
  { value: "lost", label: "未归巢 · 照常分摊" },
  { value: "withdrawn", label: "出发前退出 · 不计费" },
];

function num(text: string): number {
  if (text.trim() === "") return 0;
  const n = Number(text);
  return Number.isNaN(n) ? 0 : n;
}

function Badge({ session }: { session: TrainingSession }) {
  if (session.status === "locked") return <em className="badge locked">已锁定</em>;
  return (
    <em className={`badge ${session.revising ? "revising" : "draft"}`}>
      {session.revising ? "改单重算中" : "草稿待确认"}
    </em>
  );
}

function App() {
  const desk = useFeeDesk();
  const { state } = desk;
  const [selectedId, setSelectedId] = useState<string | null>(state.sessions[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const selected = state.sessions.find((s) => s.id === selectedId) ?? null;
  const selectedSnaps = selectedId ? desk.snapshotsOf(selectedId) : [];
  const selectedLines = selectedId ? desk.linesOf(selectedId) : [];

  const handleLock = () => {
    if (!selectedId) return;
    const err = desk.lockSession(selectedId);
    setError(err);
  };

  return (
    <main className="app">
      <section className="hero">
        <p>训放费用分摊台 · 鸽棚财务</p>
        <h1>训放开销，按实际装笼平摊</h1>
        <span>
          每场登记车辆、油费、路桥费和放飞费；总费用按实际装笼羽数平摊，出发前退出不计费，未归巢照样承担。
          财务确认后账单锁定，再改距离或名单须重新核算，旧版账单永久留档。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>应收合计（已锁定账单）</small>
          <strong>{money(desk.overview.receivable)} 元</strong>
        </article>
        <article>
          <small>已收金额</small>
          <strong>{money(desk.overview.received)} 元</strong>
        </article>
        <article>
          <small>未收余额</small>
          <strong>{money(desk.overview.outstanding)} 元</strong>
        </article>
        <article>
          <small>待财务确认场次</small>
          <strong>{desk.overview.pendingSessions} 场</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <div className="heading">
            <div>
              <p>训放场次</p>
              <h2>账单列表</h2>
            </div>
            <button className="primary" onClick={() => setSelectedId(desk.addSession())}>
              登记新场次
            </button>
          </div>
          <div className="session-list">
            {state.sessions.map((s) => (
              <button
                key={s.id}
                className={`session-item ${s.id === selectedId ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(s.id);
                  setError(null);
                }}
              >
                <span className="session-head">
                  <b>
                    {s.date} · {s.venue || "未命名训放"}
                  </b>
                  <Badge session={s} />
                </span>
                <span className="session-meta">
                  {s.distanceKm}km · {s.vehicle || "车辆未登记"} · 费用 {money(totalFee(s))} 元 ·{" "}
                  {s.birds.length} 羽装笼
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          {!selected ? (
            <div className="empty">
              <h2>还没有选中的场次</h2>
              <p>点左侧「登记新场次」开始记账。</p>
            </div>
          ) : (
            <SessionEditor
              key={selected.id}
              session={selected}
              snaps={selectedSnaps}
              lines={selectedLines}
              error={error}
              desk={desk}
              onLock={handleLock}
            />
          )}
        </section>
      </section>

      <QueryDesk desk={desk} />

      <footer className="footnote">
        数据保存在本机浏览器（localStorage），不上传服务器。
        <button onClick={desk.resetAll}>恢复演示数据</button>
      </footer>
    </main>
  );
}

function SessionEditor({
  session,
  snaps,
  lines,
  error,
  desk,
  onLock,
}: {
  session: TrainingSession;
  snaps: ReturnType<ReturnType<typeof useFeeDesk>["snapshotsOf"]>;
  lines: ReturnType<ReturnType<typeof useFeeDesk>["linesOf"]>;
  error: string | null;
  desk: ReturnType<typeof useFeeDesk>;
  onLock: () => void;
}) {
  const locked = session.status === "locked";
  const billableCount = lines.length;
  const total = totalFee(session);
  const perHead = billableCount ? total / billableCount : 0;

  return (
    <div>
      <div className="heading">
        <div>
          <p>{session.revising ? "已申请改单 · 修改后重新核算" : "训放登记"}</p>
          <h2>
            {session.date} {session.venue || "新场次"} <Badge session={session} />
          </h2>
        </div>
        <div className="actions">
          {locked ? (
            <button className="warn" onClick={() => desk.unlockForRevise(session.id)}>
              申请改单（重新核算）
            </button>
          ) : (
            <>
              {snaps.length === 0 && (
                <button
                  onClick={() => desk.removeSession(session.id)}
                  title="未锁定的草稿可删除"
                >
                  删除草稿
                </button>
              )}
              <button className="primary" onClick={onLock}>
                {session.revising ? "重新核算并锁定新版" : "财务确认并锁定账单"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="error-tip">{error}</p>}
      {session.revising && (
        <p className="warn-tip">
          当前账单（v{snaps.length}）仍存档有效；修改距离或名单后点「重新核算并锁定新版」，旧版会原样保留。
        </p>
      )}

      <div className="field-grid">
        <label>
          <span>训放日期</span>
          <input
            type="date"
            disabled={locked}
            value={session.date}
            onChange={(e) => desk.patchSession(session.id, { date: e.target.value })}
          />
        </label>
        <label>
          <span>放飞地点</span>
          <input
            disabled={locked}
            value={session.venue}
            placeholder="如：武清放飞点"
            onChange={(e) => desk.patchSession(session.id, { venue: e.target.value })}
          />
        </label>
        <label>
          <span>放飞距离（公里）</span>
          <input
            type="number"
            min={0}
            disabled={locked}
            value={session.distanceKm === 0 ? "" : session.distanceKm}
            onChange={(e) => desk.patchSession(session.id, { distanceKm: num(e.target.value) })}
          />
        </label>
        <label>
          <span>车辆</span>
          <input
            disabled={locked}
            value={session.vehicle}
            placeholder="如：鸽棚大巴 / 张师傅面包车"
            onChange={(e) => desk.patchSession(session.id, { vehicle: e.target.value })}
          />
        </label>
        {FEE_FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}（元）</span>
            <input
              type="number"
              min={0}
              step="0.01"
              disabled={locked}
              value={session[f.key] === 0 ? "" : session[f.key]}
              onChange={(e) => desk.patchSession(session.id, { [f.key]: num(e.target.value) })}
            />
          </label>
        ))}
      </div>

      <div className="subheading">
        <h3>装笼名单</h3>
        <button disabled={locked} onClick={() => desk.addBird(session.id)}>
          添加鸽子
        </button>
      </div>
      <div className="bird-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>足环号</th>
              <th>鸽主</th>
              <th style={{ width: 210 }}>本场状态</th>
              <th style={{ width: 70 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {session.birds.map((bird, i) => (
              <tr key={i} className={bird.status === "withdrawn" ? "row-out" : ""}>
                <td>{i + 1}</td>
                <td>
                  <input
                    disabled={locked}
                    value={bird.ringNo}
                    placeholder="CHN-26-xxxxxx"
                    onChange={(e) => desk.updateBird(session.id, i, { ringNo: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    disabled={locked}
                    value={bird.owner}
                    placeholder="鸽主姓名"
                    onChange={(e) => desk.updateBird(session.id, i, { owner: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    disabled={locked}
                    value={bird.status}
                    onChange={(e) =>
                      desk.updateBird(session.id, i, { status: e.target.value as BirdStatus })
                    }
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="link-btn"
                    disabled={locked}
                    onClick={() => desk.removeBird(session.id, i)}
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
            {session.birds.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  还没有装笼记录，点「添加鸽子」登记足环
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BillPanel
        session={session}
        locked={locked}
        lines={lines}
        total={total}
        billableCount={billableCount}
        perHead={perHead}
        onTogglePaid={(ring) => desk.togglePaid(session.id, ring)}
      />

      {snaps.length > 0 && <ArchivePanel snaps={snaps} />}
    </div>
  );
}

function BillPanel({
  session,
  locked,
  lines,
  total,
  billableCount,
  perHead,
  onTogglePaid,
}: {
  session: TrainingSession;
  locked: boolean;
  lines: ReturnType<ReturnType<typeof useFeeDesk>["linesOf"]>;
  total: number;
  billableCount: number;
  perHead: number;
  onTogglePaid: (ring: string) => void;
}) {
  return (
    <div className="bill">
      <div className="subheading">
        <h3>{locked ? "锁定账单 · 分摊明细" : "分摊试算（财务确认前不作应收）"}</h3>
        <span className="calc">
          油费 {money(session.fuel)} + 路桥 {money(session.toll)} + 放飞 {money(session.releaseFee)}{" "}
          = {money(total)} 元 ÷ {billableCount} 羽 ≈ {money(perHead)} 元/羽
        </span>
      </div>
      <div className="bird-table">
        <table>
          <thead>
            <tr>
              <th>足环号</th>
              <th>鸽主</th>
              <th>状态</th>
              <th style={{ width: 120 }}>应摊金额</th>
              <th style={{ width: 110 }}>支付状态</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.ringNo} className={line.status === "lost" ? "row-lost" : ""}>
                <td>{line.ringNo}</td>
                <td>{line.owner}</td>
                <td className="muted">{STATUS_LABEL[line.status]}</td>
                <td className="amount">{money(line.amount)} 元</td>
                <td>
                  {locked ? (
                    <label className="pay-check">
                      <input
                        type="checkbox"
                        checked={line.paid}
                        onChange={() => onTogglePaid(line.ringNo)}
                      />
                      {line.paid ? "已支付" : "未支付"}
                    </label>
                  ) : (
                    <span className="tag">待确认</span>
                  )}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  没有可计费的鸽子（全部出发前退出则本场无人分摊）
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>合计（{billableCount} 羽计费）</td>
                <td className="amount">{money(total)} 元</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function ArchivePanel({
  snaps,
}: {
  snaps: ReturnType<ReturnType<typeof useFeeDesk>["snapshotsOf"]>;
}) {
  const latest = snaps[snaps.length - 1];
  return (
    <div className="archive">
      <div className="subheading">
        <h3>账单存档（{snaps.length} 个版本）</h3>
        <span className="muted">改距离或名单重新核算后，旧版原样保留，可追溯差异</span>
      </div>
      <div className="snap-list">
        {[...snaps].reverse().map((snap) => (
          <details key={snap.version} className={snap.version === latest.version ? "snap-current" : "snap-old"}>
            <summary>
              <b>v{snap.version}</b>
              <span className="muted">{new Date(snap.generatedAt).toLocaleString("zh-CN")}</span>
              <span>{snap.archivedReason}</span>
              <span className="amount">{money(snap.total)} 元 / {snap.billableCount} 羽</span>
              {snap.version === latest.version && <em className="badge locked">当前有效</em>}
            </summary>
            {snap.changeNote && <p className="change-note">与上一版差异：{snap.changeNote}</p>}
            <div className="bird-table">
              <table>
                <thead>
                  <tr>
                    <th>足环号</th>
                    <th>鸽主</th>
                    <th>状态</th>
                    <th style={{ width: 120 }}>应摊金额</th>
                    <th style={{ width: 90 }}>支付</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.lines.map((l) => (
                    <tr key={l.ringNo}>
                      <td>{l.ringNo}</td>
                      <td>{l.owner}</td>
                      <td className="muted">{STATUS_LABEL[l.status]}</td>
                      <td className="amount">{money(l.amount)} 元</td>
                      <td>{l.paid ? "已支付" : "未支付"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

const EMPTY_QUERY: FeeQuery = {
  ringNo: "",
  owner: "",
  date: "",
  payStatus: "all",
  includeHistory: false,
};

function QueryDesk({ desk }: { desk: ReturnType<typeof useFeeDesk> }) {
  const [query, setQuery] = useState<FeeQuery>(EMPTY_QUERY);
  const [submitted, setSubmitted] = useState<FeeQuery>(EMPTY_QUERY);

  const records: FeeRecord[] = useMemo(() => desk.search(submitted), [desk, submitted]);
  const sum = records
    .filter((r) => r.recordState !== "pending")
    .reduce((acc, r) => acc + r.amount, 0);

  const downloadCSV = () => {
    const csv = exportCSV(records);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `训放费用查询-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel query-panel">
      <div className="heading">
        <div>
          <p>鸽主查账</p>
          <h2>按足环 / 日期 / 支付状态查每笔费用</h2>
        </div>
        <button onClick={downloadCSV} disabled={records.length === 0}>
          导出CSV
        </button>
      </div>

      <div className="query-grid">
        <label>
          <span>足环号</span>
          <input
            placeholder="支持部分匹配，如 001839"
            value={query.ringNo}
            onChange={(e) => setQuery({ ...query, ringNo: e.target.value })}
          />
        </label>
        <label>
          <span>鸽主</span>
          <input
            placeholder="鸽主姓名"
            value={query.owner}
            onChange={(e) => setQuery({ ...query, owner: e.target.value })}
          />
        </label>
        <label>
          <span>训放日期</span>
          <input
            type="date"
            value={query.date}
            onChange={(e) => setQuery({ ...query, date: e.target.value })}
          />
        </label>
        <label>
          <span>支付状态</span>
          <select
            value={query.payStatus}
            onChange={(e) => setQuery({ ...query, payStatus: e.target.value as FeeQuery["payStatus"] })}
          >
            <option value="all">全部</option>
            <option value="paid">已支付</option>
            <option value="unpaid">未支付</option>
            <option value="pending">待财务确认</option>
          </select>
        </label>
      </div>

      <div className="query-actions">
        <label className="check-line">
          <input
            type="checkbox"
            checked={query.includeHistory}
            onChange={(e) => setQuery({ ...query, includeHistory: e.target.checked })}
          />
          连同存档旧版账单一起查（改单前的历史分摊）
        </label>
        <div className="actions">
          <button onClick={() => setQuery(EMPTY_QUERY)}>清空条件</button>
          <button className="primary" onClick={() => setSubmitted(query)}>
            查询
          </button>
        </div>
      </div>

      <div className="bird-table result-table">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>场次</th>
              <th>足环号</th>
              <th>鸽主</th>
              <th>装笼状态</th>
              <th style={{ width: 110 }}>分摊金额</th>
              <th style={{ width: 110 }}>支付状态</th>
              <th style={{ width: 130 }}>账单版本</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr
                key={`${r.sessionId}-v${r.version}-${r.ringNo}-${r.recordState}`}
                className={r.recordState === "archived" ? "row-archived" : r.recordState === "pending" ? "row-pending" : ""}
              >
                <td>{r.date}</td>
                <td>
                  {r.venue} · {r.distanceKm}km
                </td>
                <td>{r.ringNo}</td>
                <td>{r.owner}</td>
                <td className="muted">{STATUS_LABEL[r.birdStatus]}</td>
                <td className="amount">{money(r.amount)} 元</td>
                <td>
                  {r.recordState === "pending" ? (
                    <span className="tag">待确认</span>
                  ) : r.paid ? (
                    <span className="tag tag-paid">已支付</span>
                  ) : (
                    <span className="tag tag-unpaid">未支付</span>
                  )}
                </td>
                <td>
                  v{r.version}
                  {r.recordState === "archived" && <em className="mini-tag">旧版存档</em>}
                  {r.recordState === "locked" && <em className="mini-tag mini-current">当前</em>}
                  {r.recordState === "pending" && <em className="mini-tag">草稿试算</em>}
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-row">
                  没有符合条件的费用记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="result-sum">
        共 {records.length} 笔；其中确认账单合计 <b>{money(sum)} 元</b>
        {records.some((r) => r.recordState === "archived") && "（含存档旧版金额）"}
      </p>
    </section>
  );
}

export default App;
