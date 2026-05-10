import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ============ SUPABASE CLIENT ============
const SUPABASE_URL = "https://nhlhlpvbbniwvupeiyws.supabase.co";
const SUPABASE_KEY = "sb_publishable_NFMTt_pwHDByF9DJ_7emAQ_YgtJzm72";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ DB HELPERS ============
// Convert DB row (snake_case) to App format (camelCase)
function dbToApp(nominee, companies = [], accounts = []) {
  const nomineeCompanies = companies
    .filter(c => c.nominee_id === nominee.id)
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map(c => ({
      id: c.id,
      name: c.name,
      dbdSubmitDate: c.dbd_submit_date || "",
      dbdApproveDate: c.dbd_approve_date || "",
      status: c.status,
      accounts: accounts.filter(a => a.company_id === c.id).map(a => ({
        id: a.id,
        bank: a.bank,
        status: a.status,
        openDate: a.open_date || "",
        blownDate: a.blown_date || "",
        monthlyFee: Number(a.monthly_fee) || 0,
        payout: Number(a.payout) || 0,
        contractMonths: Number(a.contract_months) || 6,
        guaranteedMonths: Number(a.guaranteed_months) || 6,
        compensationPrice: Number(a.compensation_price) || 15000,
        contractEnd: a.contract_end || "",
        notes: a.notes || "",
        monthlyNetPrice: a.monthly_net_price || {},
        prorateClaimedMonths: a.prorate_claimed_months || {},
      })),
    }));

  return {
    id: nominee.id,
    name: nominee.name,
    ic: nominee.ic,
    phone: nominee.phone || "",
    agentId: nominee.agent_id,
    customerGroup: nominee.customer_group,
    region: nominee.region || "",
    nomineeType: nominee.nominee_type,
    group: nominee.group_type,
    submitDate: nominee.submit_date || "",
    docs: nominee.docs || {},
    status: nominee.status,
    notes: nominee.notes || "",
    companies: nomineeCompanies,
  };
}

async function loadAllNominees() {
  const [nomRes, compRes, acctRes] = await Promise.all([
    supabase.from("nominees").select("*").order("created_at", { ascending: false }),
    supabase.from("companies").select("*"),
    supabase.from("accounts").select("*"),
  ]);
  if (nomRes.error) throw nomRes.error;
  if (compRes.error) throw compRes.error;
  if (acctRes.error) throw acctRes.error;
  return nomRes.data.map(n => dbToApp(n, compRes.data, acctRes.data));
}

async function saveNomineeFields(id, updates) {
  // Map camelCase → snake_case for nominees table
  const map = {
    name: "name", ic: "ic", phone: "phone",
    agentId: "agent_id", customerGroup: "customer_group",
    region: "region",
    nomineeType: "nominee_type", group: "group_type",
    submitDate: "submit_date", docs: "docs", status: "status", notes: "notes",
  };
  const dbUpdates = {};
  Object.keys(updates).forEach(k => {
    if (k === "companies") return; // handled separately
    if (map[k]) dbUpdates[map[k]] = updates[k];
  });
  if (Object.keys(dbUpdates).length > 0) {
    dbUpdates.updated_at = new Date().toISOString();
    const { error } = await supabase.from("nominees").update(dbUpdates).eq("id", id);
    if (error) throw error;
  }
}

async function syncCompanies(nomineeId, companies) {
  // Get existing companies in DB
  const { data: existing, error: fetchErr } = await supabase
    .from("companies").select("id").eq("nominee_id", nomineeId);
  if (fetchErr) throw fetchErr;
  const existingIds = new Set((existing || []).map(c => c.id));
  const newIds = new Set(companies.map(c => c.id));

  // Delete removed companies
  const toDelete = [...existingIds].filter(id => !newIds.has(id));
  if (toDelete.length > 0) {
    await supabase.from("companies").delete().in("id", toDelete);
  }

  // Upsert all current companies
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    const row = {
      id: c.id, nominee_id: nomineeId, name: c.name,
      dbd_submit_date: c.dbdSubmitDate || null,
      dbd_approve_date: c.dbdApproveDate || null,
      status: c.status, position: i,
    };
    await supabase.from("companies").upsert(row);

    // Sync accounts for this company
    const { data: existingAccs } = await supabase
      .from("accounts").select("id").eq("company_id", c.id);
    const existingAccIds = new Set((existingAccs || []).map(a => a.id));
    const newAccIds = new Set((c.accounts || []).map(a => a.id));
    const accsToDelete = [...existingAccIds].filter(id => !newAccIds.has(id));
    if (accsToDelete.length > 0) {
      await supabase.from("accounts").delete().in("id", accsToDelete);
    }
    for (const a of (c.accounts || [])) {
      const accRow = {
        id: a.id, company_id: c.id, bank: a.bank, status: a.status,
        open_date: a.openDate || null,
        blown_date: a.blownDate || null,
        monthly_fee: a.monthlyFee || 0,
        payout: a.payout || 0,
        contract_months: a.contractMonths || 6,
        guaranteed_months: a.guaranteedMonths || 6,
        compensation_price: a.compensationPrice || 15000,
        contract_end: a.contractEnd || null,
        notes: a.notes || "",
        monthly_net_price: a.monthlyNetPrice || {},
        prorate_claimed_months: a.prorateClaimedMonths || {},
      };
      await supabase.from("accounts").upsert(accRow);
    }
  }
}

async function insertNominee(n) {
  const row = {
    id: n.id, name: n.name, ic: n.ic, phone: n.phone || null,
    agent_id: n.agentId, customer_group: n.customerGroup,
    region: n.region || null,
    nominee_type: n.nomineeType, group_type: n.group,
    submit_date: n.submitDate || null,
    docs: n.docs || {}, status: n.status, notes: n.notes || "",
  };
  const { error } = await supabase.from("nominees").insert(row);
  if (error) throw error;
}

// ============ MOCK DATA ============
const mockAgents = [
  { id: "a1", name: "Davix", phone: "" },
  { id: "a2", name: "Natchaniya", phone: "" },
];

const customerGroups = [
  { id: "e6", name: "E6 Fintech", color: "#D4AF37" },
  { id: "lucifer", name: "Lucifer", color: "#c97a7a" },
];

const regions = [
  { id: "bangkok", name: "Bangkok", color: "#7aa6c9" },
  { id: "udon", name: "Udon", color: "#7cb87c" },
  { id: "chiang_mai", name: "Chiang Mai", color: "#c9a87a" },
];

const emptyDocs = {
  icFrontOri: false, icBackOri: false, houseRegOri: false,
  icCopySign: false, houseRegCopySign: false, videoSelfie: false, scbDoc: false,
};

// Nominee fields:
// - nomineeType: "old" (6/4 split) | "new" (5/5 split)
// - group: "A" (fixed monthly fee) | "B" (flow-based)
// Account fields:
// - For Group A: monthlyFee + prorate logic
// - For Group B: monthlyVolumes = { "2026-04": { volume: 30000000, commissionPct: 0.001, fixedPayout: 20000 }, ... }

const mockNominees = [
  {
    id: "n1", name: "Suda Charoenrat", ic: "1-1234-56789-12-3",
    agentId: "a1", phone: "+66 85-111-2222", submitDate: "2026-04-15",
    docs: { icFrontOri: true, icBackOri: true, houseRegOri: true, icCopySign: true, houseRegCopySign: true, videoSelfie: true, scbDoc: true },
    status: "complete",
    nomineeType: "new", group: "A", customerGroup: "e6",
    notes: "VIP nominee, fast response. Already has SCB account experience.",
    companies: [
      {
        id: "c1", name: "Suda Trading Co., Ltd", dbdSubmitDate: "2026-04-20", dbdApproveDate: "2026-04-27", status: "approved",
        accounts: [
          { id: "ac1", bank: "KBank", status: "open", openDate: "2026-05-28", monthlyFee: 20000, payout: 13000, contractEnd: "2026-11-28", notes: "", blownDate: "", prorateClaimedMonths: {} },
          { id: "ac2", bank: "SCB", status: "open", openDate: "2026-05-30", monthlyFee: 28000, payout: 13000, contractEnd: "2026-11-30", notes: "", blownDate: "", prorateClaimedMonths: {} },
          { id: "ac3", bank: "KTB", status: "pending", openDate: "", monthlyFee: 28000, payout: 13000, contractEnd: "", notes: "Waiting for branch appointment", blownDate: "", prorateClaimedMonths: {} },
        ],
      },
      {
        id: "c2", name: "Suda Logistics Co., Ltd", dbdSubmitDate: "2026-04-22", dbdApproveDate: "2026-04-29", status: "approved",
        accounts: [
          { id: "ac4", bank: "KBank", status: "open", openDate: "2026-06-01", monthlyFee: 20000, payout: 13000, contractEnd: "2026-12-01", notes: "", blownDate: "", prorateClaimedMonths: {} },
          { id: "ac5", bank: "SCB", status: "pending", openDate: "", monthlyFee: 28000, payout: 13000, contractEnd: "", notes: "", blownDate: "", prorateClaimedMonths: {} },
        ],
      },
    ],
  },
  {
    id: "n2", name: "Anan Pongsiri", ic: "1-2345-67890-23-4",
    agentId: "a1", phone: "+66 86-333-4444", submitDate: "2026-04-20",
    docs: { icFrontOri: true, icBackOri: true, houseRegOri: true, icCopySign: true, houseRegCopySign: false, videoSelfie: false, scbDoc: false },
    status: "incomplete",
    nomineeType: "new", group: "A", customerGroup: "e6",
    notes: "Waiting for video selfie. Agent following up.",
    companies: [],
  },
  {
    id: "n3", name: "Kanya Wongwan", ic: "1-3456-78901-34-5",
    agentId: "a2", phone: "+66 87-555-6666", submitDate: "2026-05-01",
    docs: { icFrontOri: true, icBackOri: true, houseRegOri: false, icCopySign: false, houseRegCopySign: false, videoSelfie: false, scbDoc: false },
    status: "incomplete",
    nomineeType: "new", group: "A", customerGroup: "lucifer",
    notes: "",
    companies: [],
  },
  {
    id: "n4", name: "Prasert Thaksin", ic: "1-4567-89012-45-6",
    agentId: "a2", phone: "+66 88-777-8888", submitDate: "2026-05-03",
    docs: { icFrontOri: true, icBackOri: true, houseRegOri: true, icCopySign: true, houseRegCopySign: true, videoSelfie: true, scbDoc: true },
    status: "complete",
    nomineeType: "old", group: "A", customerGroup: "lucifer",
    notes: "Old nominee — 6/4 split.",
    companies: [
      {
        id: "c3", name: "Prasert Holdings Co., Ltd", dbdSubmitDate: "2026-05-08", dbdApproveDate: "2026-05-15", status: "approved",
        accounts: [
          { id: "ac6", bank: "KBank", status: "open", openDate: "2026-06-15", monthlyFee: 20000, payout: 7500, contractEnd: "2026-12-15", notes: "", blownDate: "", prorateClaimedMonths: {} },
          { id: "ac7", bank: "SCB", status: "open", openDate: "2026-06-18", monthlyFee: 28000, payout: 7500, contractEnd: "2026-12-18", notes: "", blownDate: "", prorateClaimedMonths: {} },
        ],
      },
      {
        id: "c4", name: "Prasert Trading Co., Ltd", dbdSubmitDate: "2026-05-10", dbdApproveDate: "", status: "pending",
        accounts: [],
      },
    ],
  },
  {
    id: "n5", name: "Malee Suksawat", ic: "1-5678-90123-56-7",
    agentId: "a3", phone: "+66 92-999-0000", submitDate: "2026-05-05",
    docs: { ...emptyDocs },
    status: "not_started",
    nomineeType: "new", group: "A", customerGroup: "e6",
    notes: "",
    companies: [],
  },
  {
    id: "n6", name: "Wichai Group B Demo", ic: "1-6789-01234-67-8",
    agentId: "a3", phone: "+66 93-888-7777", submitDate: "2026-04-10",
    docs: { icFrontOri: true, icBackOri: true, houseRegOri: true, icCopySign: true, houseRegCopySign: true, videoSelfie: true, scbDoc: true },
    status: "complete",
    nomineeType: "new", group: "B", customerGroup: "lucifer",
    notes: "Group B — flow-based commission.",
    companies: [
      {
        id: "c5", name: "Wichai Flow Co., Ltd", dbdSubmitDate: "2026-04-15", dbdApproveDate: "2026-04-22", status: "approved",
        accounts: [
          {
            id: "ac8", bank: "KBank", status: "open", openDate: "2026-05-01", monthlyFee: 20000, payout: 8000, contractEnd: "2026-11-01", notes: "", blownDate: "",
            monthlyNetPrice: {
              "2026-05": 50000,
              "2026-06": 65000,
            },
            prorateClaimedMonths: {},
          },
        ],
      },
    ],
  },
];

// ============ DESIGN TOKENS — PURE BLACK ============
const C = {
  bg: "#000000",
  bgGrad: "#000000",
  card: "#0a0a0a",
  cardHover: "#141414",
  border: "#1a1a1a",
  borderLight: "#262626",
  text: "#ededed",
  textDim: "#888888",
  textMuted: "#555555",
  gold: "#D4AF37",
  blue: "#7aa6c9",
  green: "#7cb87c",
  red: "#c97a7a",
  orange: "#c9a87a",
};

// ============ COMPONENTS ============
function StatusBadge({ status }) {
  const config = {
    complete: { label: "✓ 完成", color: C.green, bg: "rgba(102,187,106,0.15)" },
    incomplete: { label: "⏳ 待补", color: C.orange, bg: "rgba(255,167,38,0.15)" },
    not_started: { label: "✗ 未开始", color: C.red, bg: "rgba(239,83,80,0.15)" },
  }[status];
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      color: config.color,
      background: config.bg,
      border: `1px solid ${config.color}33`,
    }}>{config.label}</span>
  );
}

function DocCheck({ filled, label, optional }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 12px",
      background: filled ? "rgba(124,184,124,0.08)" : "rgba(110,110,115,0.04)",
      border: `1px solid ${filled ? "#3a4d3a" : C.border}`,
      borderRadius: 6,
    }}>
      <span style={{ fontSize: 16, color: filled ? C.green : C.textMuted }}>
        {filled ? "✓" : "○"}
      </span>
      <span style={{ fontSize: 12, color: filled ? C.text : C.textDim, flex: 1 }}>
        {label}
      </span>
      {optional && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: C.gold,
          background: "rgba(212,175,55,0.12)",
          padding: "2px 6px", borderRadius: 3,
          letterSpacing: 0.5,
        }}>
          BONUS
        </span>
      )}
    </div>
  );
}

// ============ DASHBOARD PAGE ============
function Dashboard({ nominees, onNavigate }) {
  const total = nominees.length;
  const complete = nominees.filter(n => n.status === "complete").length;
  const incomplete = nominees.filter(n => n.status === "incomplete").length;
  const notStarted = nominees.filter(n => n.status === "not_started").length;

  // Bank/account stats across all nominees
  const allAccounts = nominees.flatMap(n => (n.companies || []).flatMap(c => c.accounts || []));
  const accountsByBank = ["KBank", "SCB", "KTB"].map(bank => ({
    bank,
    open: allAccounts.filter(a => a.bank === bank && a.status === "open").length,
    pending: allAccounts.filter(a => a.bank === bank && a.status === "pending").length,
    failed: allAccounts.filter(a => a.bank === bank && a.status === "failed").length,
  }));
  const totalOpen = accountsByBank.reduce((s, b) => s + b.open, 0);
  const totalPending = accountsByBank.reduce((s, b) => s + b.pending, 0);

  // Companies stats
  const allCompanies = nominees.flatMap(n => n.companies || []);
  const companiesPending = allCompanies.filter(c => c.status === "pending").length;
  const companiesApproved = allCompanies.filter(c => c.status === "approved").length;

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Dashboard
      </h2>
      <p style={{ fontSize: 13, color: C.textDim, marginBottom: 24 }}>
        Overview · {new Date().toLocaleDateString("en-GB")}
      </p>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Nominees" value={total} color={C.blue} icon="👥" />
        <StatCard label="Active Accounts" value={totalOpen} color={C.gold} icon="🏦" />
        <StatCard label="Pending Accounts" value={totalPending} color={C.orange} icon="⏳" />
        <StatCard label="Companies (DBD)" value={`${companiesApproved}/${companiesPending + companiesApproved}`} color={C.green} icon="🏢" />
      </div>

      {/* Bank Summary */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 16,
      }}>
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
          Bank Summary
        </div>
        {accountsByBank.map(b => {
          const total = b.open + b.pending + b.failed;
          return (
            <div key={b.bank} style={{
              padding: "12px 0", borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>{b.bank}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  {b.open} of {total} open
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, fontSize: 10 }}>
                <span style={{ color: C.green }}>✓ {b.open} Open</span>
                <span style={{ color: C.textMuted }}>·</span>
                <span style={{ color: C.orange }}>⏳ {b.pending} Pending</span>
                {b.failed > 0 && (
                  <>
                    <span style={{ color: C.textMuted }}>·</span>
                    <span style={{ color: C.red }}>✗ {b.failed} Failed</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent nominees */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" }}>
            Recent Nominees
          </span>
          <button onClick={() => onNavigate("nominees")}
            style={{ background: "transparent", border: "none", color: C.blue, fontSize: 12, cursor: "pointer" }}>
            View all →
          </button>
        </div>
        {nominees.slice(0, 4).map(n => (
          <div key={n.id} onClick={() => onNavigate("detail", n.id)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer",
            }}>
            <div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{n.name}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                {mockAgents.find(a => a.id === n.agentId)?.name} · {n.submitDate}
              </div>
            </div>
            <StatusBadge status={n.status} />
          </div>
        ))}
      </div>

      {/* Agent leaderboard */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
          Agent Leaderboard
        </div>
        {mockAgents.map(a => {
          const count = nominees.filter(n => n.agentId === a.id).length;
          const completeCount = nominees.filter(n => n.agentId === a.id && n.status === "complete").length;
          const accs = nominees
            .filter(n => n.agentId === a.id)
            .flatMap(n => (n.companies || []).flatMap(c => c.accounts || []))
            .filter(ac => ac.status === "open").length;
          return (
            <div key={a.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderBottom: `1px solid ${C.border}`,
            }}>
              <div>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{a.phone}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.gold }}>{count}</div>
                <div style={{ fontSize: 10, color: C.green }}>{accs} accounts open</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div style={{
      background: C.card, borderRadius: 12, padding: "14px 16px",
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 18, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: "'Courier New', monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ============ NOMINEES LIST PAGE ============
function NomineesList({ nominees, onNavigate }) {
  const [filter, setFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = nominees.filter(n => {
    if (filter !== "all" && n.status !== filter) return false;
    if (groupFilter !== "all" && n.customerGroup !== groupFilter) return false;
    if (regionFilter !== "all" && n.region !== regionFilter) return false;
    if (search && !n.name.toLowerCase().includes(search.toLowerCase()) && !n.ic.includes(search)) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Nominees</h2>
          <p style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
            {filtered.length} of {nominees.length}
          </p>
        </div>
        <button onClick={() => onNavigate("add")}
          style={{
            background: C.gold, color: C.bg, border: "none",
            padding: "8px 16px", borderRadius: 6, fontSize: 12,
            fontWeight: 700, cursor: "pointer",
          }}>
          + Add
        </button>
      </div>

      {/* Search */}
      <input
        type="text" placeholder="Search name or IC..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{
          width: "100%", padding: "10px 14px", borderRadius: 8,
          background: C.bg, border: `1px solid ${C.borderLight}`,
          color: C.text, fontSize: 13, marginBottom: 12, outline: "none",
        }}
      />

      {/* Customer Group Filter */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
          Customer
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          <button onClick={() => setGroupFilter("all")}
            style={{
              padding: "5px 12px", borderRadius: 16,
              background: groupFilter === "all" ? C.text : C.card,
              color: groupFilter === "all" ? C.bg : C.textDim,
              border: `1px solid ${groupFilter === "all" ? C.text : C.border}`,
              fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            All
          </button>
          {customerGroups.map(g => (
            <button key={g.id} onClick={() => setGroupFilter(g.id)}
              style={{
                padding: "5px 12px", borderRadius: 16,
                background: groupFilter === g.id ? g.color : C.card,
                color: groupFilter === g.id ? C.bg : C.textDim,
                border: `1px solid ${groupFilter === g.id ? g.color : C.border}`,
                fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}>
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Region Filter */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
          Region
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          <button onClick={() => setRegionFilter("all")}
            style={{
              padding: "5px 12px", borderRadius: 16,
              background: regionFilter === "all" ? C.text : C.card,
              color: regionFilter === "all" ? C.bg : C.textDim,
              border: `1px solid ${regionFilter === "all" ? C.text : C.border}`,
              fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            All
          </button>
          {regions.map(r => (
            <button key={r.id} onClick={() => setRegionFilter(r.id)}
              style={{
                padding: "5px 12px", borderRadius: 16,
                background: regionFilter === r.id ? r.color : C.card,
                color: regionFilter === r.id ? C.bg : C.textDim,
                border: `1px solid ${regionFilter === r.id ? r.color : C.border}`,
                fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}>
              📍 {r.name}
            </button>
          ))}
        </div>
      </div>

      {/* Status Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
        {[
          { v: "all", label: "All" },
          { v: "complete", label: "✓ Complete" },
          { v: "incomplete", label: "⏳ Pending" },
          { v: "not_started", label: "✗ Not Started" },
        ].map(f => (
          <button key={f.v} onClick={() => setFilter(f.v)}
            style={{
              padding: "5px 12px", borderRadius: 16,
              background: filter === f.v ? C.gold : C.card,
              color: filter === f.v ? C.bg : C.textDim,
              border: `1px solid ${filter === f.v ? C.gold : C.border}`,
              fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.map(n => {
        const agent = mockAgents.find(a => a.id === n.agentId);
        const requiredKeys = ["icFrontOri", "icBackOri", "houseRegOri", "icCopySign", "houseRegCopySign", "videoSelfie"];
        const docCount = requiredKeys.filter(k => n.docs[k]).length;
        const hasSCB = n.docs.scbDoc === true;
        const allAccs = (n.companies || []).flatMap(c => c.accounts || []);
        const openAccs = allAccs.filter(a => a.status === "open").length;
        const totalAccs = allAccs.length;
        const companyCount = (n.companies || []).length;
        const cg = customerGroups.find(g => g.id === n.customerGroup);
        const rg = regions.find(r => r.id === n.region);
        return (
          <div key={n.id} onClick={() => onNavigate("detail", n.id)}
            style={{
              background: C.card, borderRadius: 10, padding: 14,
              border: `1px solid ${C.border}`, marginBottom: 10, cursor: "pointer",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, flex: 1 }}>{n.name}</div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <StatusBadge status={n.status} />
                <span style={{
                  fontSize: 8, fontWeight: 700,
                  padding: "3px 6px", borderRadius: 3, letterSpacing: 0.5,
                  color: hasSCB ? C.gold : C.textMuted,
                  background: hasSCB ? "rgba(212,175,55,0.15)" : "transparent",
                  border: `1px solid ${hasSCB ? C.gold : C.border}`,
                  opacity: hasSCB ? 1 : 0.5,
                }}>
                  SCB
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 6 }}>
              <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>
                {n.ic}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {rg && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: rg.color,
                    background: rg.color + "22",
                    padding: "2px 6px", borderRadius: 3,
                  }}>
                    📍 {rg.name}
                  </span>
                )}
                {cg && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: cg.color,
                    background: cg.color + "22",
                    padding: "2px 6px", borderRadius: 3,
                  }}>
                    {cg.name}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textDim }}>
              <span>👤 {agent?.name || "—"}</span>
              <span>📄 {docCount}/6</span>
              <span>🏢 {companyCount} co.</span>
              <span>🏦 {openAccs}/{totalAccs}</span>
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: C.textMuted, fontSize: 12 }}>
          No nominees found
        </div>
      )}
    </div>
  );
}

// ============ NOMINEE DETAIL PAGE ============
function NomineeDetail({ nomineeId, nominees, onNavigate, onUpdate }) {
  const n = nominees.find(x => x.id === nomineeId);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(n?.notes || "");
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(null); // companyId
  const [editingAccount, setEditingAccount] = useState(null); // { companyId, accountId }
  const [showEditNominee, setShowEditNominee] = useState(false);

  if (!n) return null;
  const agent = mockAgents.find(a => a.id === n.agentId);

  const docLabels = {
    icFrontOri: { label: "IC Front (Original)", optional: false },
    icBackOri: { label: "IC Back (Original)", optional: false },
    houseRegOri: { label: "House Reg (Original)", optional: false },
    icCopySign: { label: "IC Copy + Sign", optional: false },
    houseRegCopySign: { label: "House Reg Copy + Sign", optional: false },
    videoSelfie: { label: "Video Selfie + Sign", optional: false },
    scbDoc: { label: "SCB Document", optional: true },
  };

  const requiredDocs = Object.keys(docLabels).filter(k => !docLabels[k].optional);
  const totalDocs = requiredDocs.length; // Only count required docs for completion
  const filledCount = requiredDocs.filter(k => n.docs[k]).length;
  const companies = n.companies || [];

  const toggleDoc = (key) => {
    const newDocs = { ...n.docs, [key]: !n.docs[key] };
    const cnt = requiredDocs.filter(k => newDocs[k]).length;
    let newStatus = "not_started";
    if (cnt === totalDocs) newStatus = "complete";
    else if (cnt > 0) newStatus = "incomplete";

    const updates = { docs: newDocs, status: newStatus };

    // Auto-create 2 default companies with 3 bank accounts each when docs complete
    if (newStatus === "complete" && (!n.companies || n.companies.length === 0)) {
      const today = new Date().toISOString().split("T")[0];
      const defaultPayout = n.nomineeType === "old" ? 7500 : 13000;
      const defaultAccounts = (companyNum) => [
        { id: `ac_${Date.now()}_${companyNum}_1`, bank: "KBank", status: "pending", openDate: "", monthlyFee: 8000, payout: defaultPayout, contractMonths: 6, guaranteedMonths: 6, compensationPrice: 15000, contractEnd: "", notes: "", blownDate: "", prorateClaimedMonths: {} },
        { id: `ac_${Date.now()}_${companyNum}_2`, bank: "SCB", status: "pending", openDate: "", monthlyFee: 8000, payout: defaultPayout, contractMonths: 6, guaranteedMonths: 6, compensationPrice: 15000, contractEnd: "", notes: "", blownDate: "", prorateClaimedMonths: {} },
        { id: `ac_${Date.now()}_${companyNum}_3`, bank: "KTB", status: "pending", openDate: "", monthlyFee: 8000, payout: defaultPayout, contractMonths: 6, guaranteedMonths: 6, compensationPrice: 15000, contractEnd: "", notes: "", blownDate: "", prorateClaimedMonths: {} },
      ];
      updates.companies = [
        {
          id: `c_${Date.now()}_1`, name: "Company 1", dbdSubmitDate: today,
          dbdApproveDate: "", status: "pending", accounts: defaultAccounts(1),
        },
        {
          id: `c_${Date.now()}_2`, name: "Company 2", dbdSubmitDate: today,
          dbdApproveDate: "", status: "pending", accounts: defaultAccounts(2),
        },
      ];
    }

    onUpdate(n.id, updates);
  };

  const saveNotes = () => {
    onUpdate(n.id, { notes: notesDraft });
    setEditingNotes(false);
  };

  const addCompany = (name) => {
    const newCompany = {
      id: "c" + Date.now(),
      name: name || `Company ${companies.length + 1}`,
      dbdSubmitDate: new Date().toISOString().split("T")[0],
      dbdApproveDate: "",
      status: "pending",
      accounts: [],
    };
    onUpdate(n.id, { companies: [...companies, newCompany] });
    setShowAddCompany(false);
  };

  const removeCompany = (companyId) => {
    if (!confirm("Remove this company and all its accounts?")) return;
    onUpdate(n.id, { companies: companies.filter(c => c.id !== companyId) });
  };

  const updateCompany = (companyId, updates) => {
    onUpdate(n.id, {
      companies: companies.map(c => c.id === companyId ? { ...c, ...updates } : c)
    });
  };

  const addAccount = (companyId, account) => {
    onUpdate(n.id, {
      companies: companies.map(c => c.id === companyId
        ? { ...c, accounts: [...(c.accounts || []), { id: "ac" + Date.now(), ...account }] }
        : c
      )
    });
    setShowAddAccount(null);
  };

  const updateAccount = (companyId, accountId, updates) => {
    onUpdate(n.id, {
      companies: companies.map(c => c.id === companyId
        ? { ...c, accounts: c.accounts.map(a => a.id === accountId ? { ...a, ...updates } : a) }
        : c
      )
    });
  };

  const removeAccount = (companyId, accountId) => {
    onUpdate(n.id, {
      companies: companies.map(c => c.id === companyId
        ? { ...c, accounts: c.accounts.filter(a => a.id !== accountId) }
        : c
      )
    });
  };

  // Aggregated stats for this nominee
  const allAccs = companies.flatMap(c => c.accounts || []);
  const openCount = allAccs.filter(a => a.status === "open").length;
  const pendingCount = allAccs.filter(a => a.status === "pending").length;

  return (
    <div>
      <button onClick={() => onNavigate("nominees")}
        style={{
          background: "transparent", border: "none", color: C.blue,
          fontSize: 12, cursor: "pointer", marginBottom: 16, padding: 0,
        }}>
        ← Back
      </button>

      {/* Header card */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 20,
        border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{n.name}</div>
            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "monospace", marginTop: 4 }}>
              IC: {n.ic}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <StatusBadge status={n.status} />
            <button onClick={() => setShowEditNominee(true)}
              style={{
                background: "transparent", border: `1px solid ${C.border}`,
                color: C.textDim, fontSize: 9, padding: "3px 8px",
                borderRadius: 4, cursor: "pointer",
              }}>
              ✎ Edit Info
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {(() => {
            const cg = customerGroups.find(g => g.id === n.customerGroup);
            return cg ? (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                color: cg.color,
                background: cg.color + "22",
                border: `1px solid ${cg.color}55`,
              }}>
                {cg.name}
              </span>
            ) : null;
          })()}
          {(() => {
            const rg = regions.find(r => r.id === n.region);
            return rg ? (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                color: rg.color,
                background: rg.color + "22",
                border: `1px solid ${rg.color}55`,
              }}>
                📍 {rg.name}
              </span>
            ) : null;
          })()}
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
            color: n.nomineeType === "old" ? C.orange : C.green,
            background: n.nomineeType === "old" ? "rgba(201,168,122,0.15)" : "rgba(124,184,124,0.15)",
            border: `1px solid ${n.nomineeType === "old" ? C.orange : C.green}55`,
          }}>
            {n.nomineeType === "old" ? "OLD · 6/4" : "NEW · 5/5"}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
            color: n.group === "A" ? C.gold : C.text,
            background: n.group === "A" ? "rgba(212,175,55,0.15)" : "rgba(237,237,237,0.1)",
            border: `1px solid ${n.group === "A" ? C.gold : C.borderLight}55`,
          }}>
            Group {n.group}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <div>
            <div style={{ color: C.textDim, marginBottom: 2 }}>Agent</div>
            <div style={{ color: C.text }}>{agent?.name}</div>
          </div>
          <div>
            <div style={{ color: C.textDim, marginBottom: 2 }}>Phone</div>
            <div style={{ color: C.text }}>{n.phone}</div>
          </div>
          <div>
            <div style={{ color: C.textDim, marginBottom: 2 }}>Submit Date</div>
            <div style={{ color: C.text }}>{n.submitDate}</div>
          </div>
          <div>
            <div style={{ color: C.textDim, marginBottom: 2 }}>Accounts</div>
            <div>
              <span style={{ color: C.green, fontWeight: 700 }}>{openCount} open</span>
              {pendingCount > 0 && (
                <span style={{ color: C.orange, marginLeft: 8 }}>· {pendingCount} pending</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Notes */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" }}>
            📝 Agent Notes
          </span>
          {!editingNotes && (
            <button onClick={() => { setNotesDraft(n.notes || ""); setEditingNotes(true); }}
              style={{ background: "transparent", border: "none", color: C.blue, fontSize: 11, cursor: "pointer" }}>
              {n.notes ? "Edit" : "+ Add"}
            </button>
          )}
        </div>

        {editingNotes ? (
          <div>
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="Add special notes about this nominee..."
              style={{
                width: "100%", minHeight: 80, padding: "10px 12px",
                borderRadius: 8, background: C.bg,
                border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 12, outline: "none",
                resize: "vertical", fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={saveNotes} style={{
                flex: 1, padding: "8px", borderRadius: 6, border: "none",
                background: C.gold, color: C.bg, fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>Save</button>
              <button onClick={() => setEditingNotes(false)} style={{
                flex: 1, padding: "8px", borderRadius: 6,
                background: "transparent", border: `1px solid ${C.border}`,
                color: C.textDim, fontSize: 12, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{
            fontSize: 12, color: n.notes ? C.text : C.textMuted,
            fontStyle: n.notes ? "normal" : "italic",
            lineHeight: 1.5,
            padding: n.notes ? "8px 0" : "16px 0",
            textAlign: n.notes ? "left" : "center",
          }}>
            {n.notes || "No notes yet"}
          </div>
        )}
      </div>

      {/* Documents */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
          Documents · {filledCount}/{totalDocs} required
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(docLabels).map(([key, info]) => (
            <div key={key} onClick={() => toggleDoc(key)} style={{ cursor: "pointer", position: "relative" }}>
              <DocCheck filled={n.docs[key]} label={info.label} optional={info.optional} />
            </div>
          ))}
        </div>
      </div>

      {/* Companies & Accounts Section */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 14,
        opacity: n.status !== "complete" ? 0.5 : 1,
        position: "relative",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" }}>
            🏢 Companies & Accounts
          </span>
          {n.status === "complete" && companies.length < 2 && (
            <button onClick={() => setShowAddCompany(true)}
              style={{ background: "transparent", border: "none", color: C.gold, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
              + Add Company
            </button>
          )}
        </div>

        {n.status !== "complete" ? (
          <div style={{
            textAlign: "center", padding: "30px 0",
            color: C.textMuted, fontSize: 12,
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
            <div style={{ marginBottom: 4, color: C.textDim }}>Locked</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>
              Complete all {totalDocs} documents to unlock<br/>
              ({filledCount}/{totalDocs} done)
            </div>
          </div>
        ) : companies.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.textMuted, fontSize: 12, fontStyle: "italic" }}>
            No companies registered yet
          </div>
        ) : (
          companies.map((company, idx) => (
            <CompanyCard
              key={company.id}
              company={company}
              index={idx + 1}
              onUpdate={(updates) => updateCompany(company.id, updates)}
              onRemove={() => removeCompany(company.id)}
              onAddAccount={() => setShowAddAccount(company.id)}
              onUpdateAccount={(accId, updates) => updateAccount(company.id, accId, updates)}
              onRemoveAccount={(accId) => removeAccount(company.id, accId)}
              onEditAccount={(accId) => setEditingAccount({ companyId: company.id, accountId: accId })}
            />
          ))
        )}
      </div>

      {/* Add Company Modal */}
      {showAddCompany && (
        <AddCompanyModal
          onClose={() => setShowAddCompany(false)}
          onSave={addCompany}
          nomineeName={n.name}
        />
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <AddAccountModal
          companyId={showAddAccount}
          existingAccounts={(companies.find(c => c.id === showAddAccount)?.accounts) || []}
          nomineeGroup={n.group}
          onClose={() => setShowAddAccount(null)}
          onSave={(account) => addAccount(showAddAccount, account)}
        />
      )}

      {/* Edit Account Modal */}
      {editingAccount && (() => {
        const company = companies.find(c => c.id === editingAccount.companyId);
        const account = company?.accounts.find(a => a.id === editingAccount.accountId);
        if (!account) return null;
        return (
          <EditAccountModal
            account={account}
            nomineeGroup={n.group}
            onClose={() => setEditingAccount(null)}
            onSave={(updates) => {
              updateAccount(editingAccount.companyId, editingAccount.accountId, updates);
              setEditingAccount(null);
            }}
          />
        );
      })()}

      {/* Edit Nominee Modal */}
      {showEditNominee && (
        <EditNomineeModal
          nominee={n}
          onClose={() => setShowEditNominee(false)}
          onSave={(updates) => {
            onUpdate(n.id, updates);
            setShowEditNominee(false);
          }}
        />
      )}
    </div>
  );
}

// ============ COMPANY CARD ============
function CompanyCard({ company, index, onUpdate, onRemove, onAddAccount, onEditAccount, onRemoveAccount }) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(company.name);
  const [showApproveDate, setShowApproveDate] = useState(false);
  const [approveDateDraft, setApproveDateDraft] = useState(new Date().toISOString().split("T")[0]);
  const [editingDbdSubmit, setEditingDbdSubmit] = useState(false);

  const accs = company.accounts || [];
  const openCount = accs.filter(a => a.status === "open").length;

  return (
    <div style={{
      background: C.bg, borderRadius: 10,
      border: `1px solid ${C.borderLight}`,
      marginBottom: 10, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px",
        background: company.status === "approved" ? "rgba(102,187,106,0.06)" : "rgba(255,167,38,0.06)",
        borderBottom: expanded ? `1px solid ${C.borderLight}` : "none",
      }}>
        {editingName ? (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>Edit Company Name</div>
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              autoFocus
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 6,
                background: C.bg, border: `1px solid ${C.gold}`,
                color: C.text, fontSize: 13, fontWeight: 700, outline: "none",
                fontFamily: "inherit", marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => {
                if (nameDraft.trim()) {
                  onUpdate({ name: nameDraft.trim() });
                  setEditingName(false);
                }
              }}
                style={{
                  flex: 1, padding: "6px", borderRadius: 4, border: "none",
                  background: C.gold, color: C.bg, fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                ✓ Confirm
              </button>
              <button onClick={() => { setNameDraft(company.name); setEditingName(false); }}
                style={{
                  flex: 1, padding: "6px", borderRadius: 4,
                  background: "transparent", border: `1px solid ${C.border}`,
                  color: C.textDim, fontSize: 11, cursor: "pointer",
                }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: C.gold,
                background: "rgba(212,175,55,0.1)", padding: "2px 6px", borderRadius: 4,
              }}>
                CO. {index}
              </span>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, flex: 1 }}>
                {company.name}
              </div>
              <button onClick={() => { setNameDraft(company.name); setEditingName(true); }}
                style={{
                  background: "transparent", border: `1px solid ${C.border}`,
                  color: C.textDim, fontSize: 9, padding: "3px 8px",
                  borderRadius: 4, cursor: "pointer",
                }}>
                ✎ Edit
              </button>
            </div>
            <button onClick={onRemove} style={{
              background: "transparent", border: "none", color: C.red,
              fontSize: 14, cursor: "pointer", padding: "0 4px", marginLeft: 4,
            }}>×</button>
          </div>
        )}

        {/* DBD info */}
        <div style={{ display: "flex", gap: 12, fontSize: 10, color: C.textDim, marginTop: 4, flexWrap: "wrap" }}>
          <span>📅 Submit: <span style={{ color: C.text }}>{company.dbdSubmitDate || "—"} 🔒</span></span>
          {company.status === "approved" && (
            <span>✓ Approved:
              {editingDbdSubmit ? (
                <input type="date" value={company.dbdApproveDate || ""}
                  onChange={e => onUpdate({ dbdApproveDate: e.target.value })}
                  onBlur={() => setEditingDbdSubmit(false)}
                  autoFocus
                  style={{
                    marginLeft: 4, background: C.bg, border: `1px solid ${C.green}`,
                    color: C.text, fontSize: 10, padding: "1px 4px", borderRadius: 3,
                  }}
                />
              ) : (
                <span onClick={() => setEditingDbdSubmit(true)}
                  style={{ color: C.green, marginLeft: 4, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                  {company.dbdApproveDate || "—"}
                </span>
              )}
            </span>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <button onClick={() => setExpanded(!expanded)}
            style={{
              background: "transparent", border: "none", color: C.textDim,
              fontSize: 11, cursor: "pointer", padding: 0,
            }}>
            {expanded ? "▾" : "▸"} {accs.length} account{accs.length !== 1 ? "s" : ""} · {openCount} open
          </button>
          {company.status === "pending" && !showApproveDate && (
            <button onClick={() => setShowApproveDate(true)}
              style={{
                background: C.green, border: "none", color: "white",
                fontSize: 10, padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontWeight: 700,
              }}>
              Mark Approved
            </button>
          )}
          {company.status === "pending" && showApproveDate && (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="date" value={approveDateDraft}
                onChange={e => setApproveDateDraft(e.target.value)}
                style={{
                  background: C.bg, border: `1px solid ${C.green}`,
                  color: C.text, fontSize: 10, padding: "3px 6px", borderRadius: 4,
                }}
              />
              <button onClick={() => {
                onUpdate({ status: "approved", dbdApproveDate: approveDateDraft });
                setShowApproveDate(false);
              }}
                style={{
                  background: C.green, border: "none", color: "white",
                  fontSize: 10, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontWeight: 700,
                }}>
                ✓ OK
              </button>
              <button onClick={() => setShowApproveDate(false)}
                style={{
                  background: "transparent", border: `1px solid ${C.border}`, color: C.textDim,
                  fontSize: 10, padding: "3px 6px", borderRadius: 4, cursor: "pointer",
                }}>
                ×
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Accounts */}
      {expanded && (
        <div style={{ padding: "10px 14px" }}>
          {accs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "8px 0", color: C.textMuted, fontSize: 11, fontStyle: "italic" }}>
              No accounts yet
            </div>
          ) : (
            accs.map(acc => (
              <AccountRow
                key={acc.id}
                account={acc}
                onEdit={() => onEditAccount(acc.id)}
                onRemove={() => onRemoveAccount(acc.id)}
              />
            ))
          )}
          {company.status === "approved" && accs.length < 3 && (
            <button onClick={onAddAccount} style={{
              width: "100%", padding: "8px", marginTop: 6,
              background: "transparent", border: `1px dashed ${C.gold}`,
              color: C.gold, fontSize: 11, fontWeight: 700,
              borderRadius: 6, cursor: "pointer",
            }}>
              + Add Bank Account
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============ ACCOUNT ROW ============
function AccountRow({ account, onEdit, onRemove }) {
  const bankColors = { KBank: "#7cb87c", SCB: "#a87cb8", KTB: "#7aa6c9" };

  // Calculate days running for open accounts
  let daysRunning = null;
  if (account.status === "open" && account.openDate) {
    const open = new Date(account.openDate);
    const now = new Date();
    daysRunning = Math.floor((now - open) / (1000 * 60 * 60 * 24));
  }

  const statusConfig = {
    open: { label: daysRunning !== null ? `OPEN · Day ${daysRunning}` : "OPEN", color: C.green },
    pending: { label: "PENDING", color: C.orange },
    failed: { label: "FAILED", color: C.red },
    blown: { label: "BLOWN", color: C.red },
  }[account.status];

  return (
    <div onClick={onEdit} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", marginBottom: 6,
      background: C.card, borderRadius: 6,
      border: `1px solid ${C.border}`, cursor: "pointer",
    }}>
      <div style={{ width: 6, height: 24, background: bankColors[account.bank] || C.gold, borderRadius: 3 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{account.bank}</span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: statusConfig.color,
            background: `${statusConfig.color}22`, padding: "2px 6px", borderRadius: 3,
          }}>
            {statusConfig.label}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 9.5, color: C.textMuted, marginTop: 3, flexWrap: "wrap" }}>
          {account.openDate && <span>📅 Open: {account.openDate}</span>}
          {account.blownDate && <span style={{ color: C.red }}>💥 Blown: {account.blownDate}</span>}
          {account.monthlyFee > 0 && <span style={{ color: C.gold }}>฿{account.monthlyFee.toLocaleString()}/mo</span>}
          {account.payout > 0 && <span style={{ color: C.orange }}>Payout ฿{account.payout.toLocaleString()}</span>}
          {(account.contractMonths || account.guaranteedMonths) && (
            <span style={{ color: C.textDim }}>
              📋 {account.contractMonths || 6}mo · 保{account.guaranteedMonths || 6}mo
            </span>
          )}
        </div>
        {account.notes && (
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 3, fontStyle: "italic" }}>
            {account.notes}
          </div>
        )}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{
        background: "transparent", border: "none", color: C.textMuted,
        fontSize: 14, cursor: "pointer", padding: "0 4px",
      }}>×</button>
    </div>
  );
}

// ============ ADD COMPANY MODAL ============
function AddCompanyModal({ onClose, onSave, nomineeName }) {
  const [name, setName] = useState("");

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16, padding: 24,
        border: `1px solid ${C.borderLight}`,
        maxWidth: 360, width: "100%",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
          Add Company
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 16 }}>
          For nominee: {nomineeName}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Company Name</div>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Suda Trading Co., Ltd"
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 8,
              background: C.bg, border: `1px solid ${C.borderLight}`,
              color: C.text, fontSize: 13, outline: "none",
            }}
          />
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
            DBD submit date will be set to today. Approval status starts as pending.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px", borderRadius: 8,
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.textDim, fontSize: 12, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={() => onSave(name)} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none",
            background: C.gold, color: C.bg, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Add Company</button>
        </div>
      </div>
    </div>
  );
}

// ============ ADD ACCOUNT MODAL ============
function AddAccountModal({ companyId, existingAccounts, nomineeGroup, onClose, onSave }) {
  const isGroupB = nomineeGroup === "B";
  const allBanks = ["KBank", "SCB", "KTB"];
  const usedBanks = (existingAccounts || []).map(a => a.bank);
  const availableBanks = allBanks.filter(b => !usedBanks.includes(b));

  const [bank, setBank] = useState(availableBanks[0] || "KBank");
  const [status, setStatus] = useState("pending");
  const [openDate, setOpenDate] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("8000");
  const [payout, setPayout] = useState("8000");
  const [contractMonths, setContractMonths] = useState("6");
  const [guaranteedMonths, setGuaranteedMonths] = useState("6");
  const [compensationPrice, setCompensationPrice] = useState("15000");
  const [notes, setNotes] = useState("");

  const handleBank = (b) => setBank(b);

  const handleSave = () => {
    onSave({
      bank,
      status,
      openDate: status === "open" ? (openDate || new Date().toISOString().split("T")[0]) : "",
      monthlyFee: Number(monthlyFee) || 0,
      payout: Number(payout) || 0,
      contractMonths: Number(contractMonths) || 6,
      guaranteedMonths: Number(guaranteedMonths) || 6,
      compensationPrice: Number(compensationPrice) || 15000,
      contractEnd: "",
      notes,
      blownDate: "",
      prorateClaimedMonths: {},
    });
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16, padding: 24,
        border: `1px solid ${C.borderLight}`,
        maxWidth: 360, width: "100%", maxHeight: "85vh", overflow: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }}>
          Add Bank Account
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Bank</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {allBanks.map(b => {
              const used = usedBanks.includes(b);
              return (
                <button key={b} onClick={() => !used && handleBank(b)}
                  disabled={used}
                  style={{
                    padding: "10px 8px", borderRadius: 6,
                    background: bank === b ? C.gold : C.bg,
                    border: `1px solid ${bank === b ? C.gold : C.border}`,
                    color: bank === b ? C.bg : (used ? C.textMuted : C.text),
                    fontSize: 12, fontWeight: 700,
                    cursor: used ? "not-allowed" : "pointer",
                    opacity: used ? 0.4 : 1,
                  }}>
                  {b}{used && " ✓"}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Status</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
            {[
              { v: "pending", label: "⏳ Pending", color: C.orange },
              { v: "open", label: "✓ Open", color: C.green },
            ].map(s => (
              <button key={s.v} onClick={() => setStatus(s.v)}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: status === s.v ? `${s.color}22` : C.bg,
                  border: `1px solid ${status === s.v ? s.color : C.border}`,
                  color: status === s.v ? s.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {status === "open" && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Open Date</div>
            <input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 13, outline: "none",
              }}
            />
          </div>
        )}

        {!isGroupB && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Monthly Fee (฿) — 客户付的月费</div>
            <div style={{
              display: "flex", alignItems: "center",
              background: C.bg, borderRadius: 8,
              border: `1px solid ${C.borderLight}`,
            }}>
              <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
              <input type="text" inputMode="numeric" value={monthlyFee}
                onChange={e => setMonthlyFee(e.target.value.replace(/[^0-9]/g, ""))}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: C.gold, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                  fontFamily: "'Courier New', monospace",
                }}
              />
            </div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Nominee Payout (฿) — 给人头的钱</div>
          <div style={{
            display: "flex", alignItems: "center",
            background: C.bg, borderRadius: 8,
            border: `1px solid ${C.borderLight}`,
          }}>
            <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
            <input type="text" inputMode="numeric" value={payout}
              onChange={e => setPayout(e.target.value.replace(/[^0-9]/g, ""))}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: C.orange, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                fontFamily: "'Courier New', monospace",
              }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Contract (mo)</div>
            <input type="text" inputMode="numeric" value={contractMonths}
              onChange={e => setContractMonths(e.target.value.replace(/[^0-9]/g, ""))}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 14, fontWeight: 700, outline: "none",
                textAlign: "center",
              }}
            />
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>合约几个月</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Payout保 (mo)</div>
            <input type="text" inputMode="numeric" value={guaranteedMonths}
              onChange={e => setGuaranteedMonths(e.target.value.replace(/[^0-9]/g, ""))}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.orange, fontSize: 14, fontWeight: 700, outline: "none",
                textAlign: "center",
              }}
            />
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>人头保几个月</div>
          </div>
        </div>

        {isGroupB && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>
              Compensation Price (฿) — 爆户补偿价
            </div>
            <div style={{
              display: "flex", alignItems: "center",
              background: C.bg, borderRadius: 8,
              border: `1px solid ${C.borderLight}`,
            }}>
              <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
              <input type="text" inputMode="numeric" value={compensationPrice}
                onChange={e => setCompensationPrice(e.target.value.replace(/[^0-9]/g, ""))}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: C.red, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                  fontFamily: "'Courier New', monospace",
                }}
              />
            </div>
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>
              爆户后每月补偿
            </div>
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Notes (optional)</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Waiting for branch appointment"
            style={{
              width: "100%", minHeight: 60, padding: "10px 12px",
              borderRadius: 8, background: C.bg,
              border: `1px solid ${C.borderLight}`,
              color: C.text, fontSize: 12, outline: "none",
              resize: "vertical", fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px", borderRadius: 8,
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.textDim, fontSize: 12, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none",
            background: C.gold, color: C.bg, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Save Account</button>
        </div>
      </div>
    </div>
  );
}

// ============ EDIT ACCOUNT MODAL ============
function EditAccountModal({ account, nomineeGroup, onClose, onSave }) {
  const isGroupB = nomineeGroup === "B";
  const [status, setStatus] = useState(account.status);
  const [openDate, setOpenDate] = useState(account.openDate || "");
  const [blownDate, setBlownDate] = useState(account.blownDate || "");
  const [monthlyFee, setMonthlyFee] = useState(String(account.monthlyFee || 0));
  const [payout, setPayout] = useState(String(account.payout || 0));
  const [contractMonths, setContractMonths] = useState(String(account.contractMonths || 6));
  const [guaranteedMonths, setGuaranteedMonths] = useState(String(account.guaranteedMonths || 6));
  const [compensationPrice, setCompensationPrice] = useState(String(account.compensationPrice || 15000));
  const [notes, setNotes] = useState(account.notes || "");

  const handleSave = () => {
    const today = new Date().toISOString().split("T")[0];
    onSave({
      status,
      openDate: status === "open" || status === "blown" ? (openDate || today) : "",
      blownDate: status === "blown" ? (blownDate || today) : "",
      monthlyFee: Number(monthlyFee) || 0,
      payout: Number(payout) || 0,
      contractMonths: Number(contractMonths) || 6,
      guaranteedMonths: Number(guaranteedMonths) || 6,
      compensationPrice: Number(compensationPrice) || 15000,
      notes,
    });
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16, padding: 24,
        border: `1px solid ${C.borderLight}`,
        maxWidth: 360, width: "100%", maxHeight: "85vh", overflow: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>
          Edit {account.bank} Account
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 16 }}>
          Update account details
        </div>

        {/* Status */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Status</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
            {[
              { v: "pending", label: "⏳ Pending", color: C.orange },
              { v: "open", label: "✓ Open", color: C.green },
              { v: "failed", label: "✗ Failed", color: C.red },
              { v: "blown", label: "💥 Blown", color: C.red },
            ].map(s => (
              <button key={s.v} onClick={() => setStatus(s.v)}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: status === s.v ? `${s.color}22` : C.bg,
                  border: `1px solid ${status === s.v ? s.color : C.border}`,
                  color: status === s.v ? s.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {(status === "open" || status === "blown") && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Open Date</div>
            <input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 13, outline: "none",
              }}
            />
          </div>
        )}

        {status === "blown" && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.red, marginBottom: 6 }}>💥 Blown Date</div>
            <input type="date" value={blownDate} onChange={e => setBlownDate(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.red}`,
                color: C.text, fontSize: 13, outline: "none",
              }}
            />
          </div>
        )}

        {!isGroupB && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Monthly Fee (฿) — 客户付的月费</div>
            <div style={{
              display: "flex", alignItems: "center",
              background: C.bg, borderRadius: 8,
              border: `1px solid ${C.borderLight}`,
            }}>
              <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
              <input type="text" inputMode="numeric" value={monthlyFee}
                onChange={e => setMonthlyFee(e.target.value.replace(/[^0-9]/g, ""))}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: C.gold, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                  fontFamily: "'Courier New', monospace",
                }}
              />
            </div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Nominee Payout (฿) — 给人头的钱</div>
          <div style={{
            display: "flex", alignItems: "center",
            background: C.bg, borderRadius: 8,
            border: `1px solid ${C.borderLight}`,
          }}>
            <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
            <input type="text" inputMode="numeric" value={payout}
              onChange={e => setPayout(e.target.value.replace(/[^0-9]/g, ""))}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: C.orange, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                fontFamily: "'Courier New', monospace",
              }}
            />
          </div>
          <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>
            Will be prorated by days when account opens mid-month
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Contract (mo)</div>
            <input type="text" inputMode="numeric" value={contractMonths}
              onChange={e => setContractMonths(e.target.value.replace(/[^0-9]/g, ""))}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 14, fontWeight: 700, outline: "none",
                textAlign: "center",
              }}
            />
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>合约多少个月</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Payout保 (mo)</div>
            <input type="text" inputMode="numeric" value={guaranteedMonths}
              onChange={e => setGuaranteedMonths(e.target.value.replace(/[^0-9]/g, ""))}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.orange, fontSize: 14, fontWeight: 700, outline: "none",
                textAlign: "center",
              }}
            />
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>人头保几个月</div>
          </div>
        </div>

        {isGroupB && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>
              Compensation Price (฿) — 爆户补偿价
            </div>
            <div style={{
              display: "flex", alignItems: "center",
              background: C.bg, borderRadius: 8,
              border: `1px solid ${C.borderLight}`,
            }}>
              <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
              <input type="text" inputMode="numeric" value={compensationPrice}
                onChange={e => setCompensationPrice(e.target.value.replace(/[^0-9]/g, ""))}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: C.red, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                  fontFamily: "'Courier New', monospace",
                }}
              />
            </div>
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>
              爆户后每月补偿
            </div>
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            style={{
              width: "100%", minHeight: 60, padding: "10px 12px",
              borderRadius: 8, background: C.bg,
              border: `1px solid ${C.borderLight}`,
              color: C.text, fontSize: 12, outline: "none",
              resize: "vertical", fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px", borderRadius: 8,
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.textDim, fontSize: 12, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none",
            background: C.gold, color: C.bg, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ============ EDIT NOMINEE MODAL ============
function EditNomineeModal({ nominee, onClose, onSave }) {
  const [form, setForm] = useState({
    name: nominee.name || "",
    ic: nominee.ic || "",
    phone: nominee.phone || "",
    agentId: nominee.agentId || "a1",
    customerGroup: nominee.customerGroup || "e6",
    region: nominee.region || "bangkok",
    nomineeType: nominee.nomineeType || "new",
    group: nominee.group || "A",
  });

  const handleSave = () => {
    if (!form.name || !form.ic) {
      alert("Name and IC required");
      return;
    }
    onSave(form);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16, padding: 24,
        border: `1px solid ${C.borderLight}`,
        maxWidth: 360, width: "100%", maxHeight: "85vh", overflow: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>
          Edit Nominee Info
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 16 }}>
          Update nominee details
        </div>

        <FormField label="Name" value={form.name} onChange={v => setForm({...form, name: v})} />
        <FormField label="IC Number" value={form.ic} onChange={v => setForm({...form, ic: v})} placeholder="x-xxxx-xxxxx-xx-x" />
        <FormField label="Phone" value={form.phone} onChange={v => setForm({...form, phone: v})} />

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Agent</div>
          <select value={form.agentId} onChange={e => setForm({...form, agentId: e.target.value})}
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 8,
              background: C.bg, border: `1px solid ${C.borderLight}`,
              color: C.text, fontSize: 13, outline: "none",
            }}>
            {mockAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Customer Group</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {customerGroups.map(g => (
              <button key={g.id} onClick={() => setForm({...form, customerGroup: g.id})}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: form.customerGroup === g.id ? g.color + "22" : C.bg,
                  border: `1px solid ${form.customerGroup === g.id ? g.color : C.border}`,
                  color: form.customerGroup === g.id ? g.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {g.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Region</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {regions.map(r => (
              <button key={r.id} onClick={() => setForm({...form, region: r.id})}
                style={{
                  padding: "10px 6px", borderRadius: 6,
                  background: form.region === r.id ? r.color + "22" : C.bg,
                  border: `1px solid ${form.region === r.id ? r.color : C.border}`,
                  color: form.region === r.id ? r.color : C.textDim,
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                }}>
                📍 {r.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Nominee Type</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              { v: "new", label: "NEW (5/5 split)", color: C.green },
              { v: "old", label: "OLD (6/4 split)", color: C.orange },
            ].map(t => (
              <button key={t.v} onClick={() => setForm({...form, nomineeType: t.v})}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: form.nomineeType === t.v ? `${t.color}22` : C.bg,
                  border: `1px solid ${form.nomineeType === t.v ? t.color : C.border}`,
                  color: form.nomineeType === t.v ? t.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Payout Group</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              { v: "A", label: "A · Fixed Fee", color: C.gold },
              { v: "B", label: "B · Net Price", color: C.text },
            ].map(g => (
              <button key={g.v} onClick={() => setForm({...form, group: g.v})}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: form.group === g.v ? `${g.color}22` : C.bg,
                  border: `1px solid ${form.group === g.v ? g.color : C.border}`,
                  color: form.group === g.v ? g.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px", borderRadius: 8,
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.textDim, fontSize: 12, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none",
            background: C.gold, color: C.bg, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ============ ADD NOMINEE PAGE ============
function AddNominee({ onNavigate, onAdd }) {
  const [form, setForm] = useState({
    name: "", ic: "", phone: "", agentId: "a1",
    nomineeType: "new", group: "A", customerGroup: "e6",
    region: "bangkok",
  });

  const handleSubmit = () => {
    if (!form.name || !form.ic) {
      alert("Please fill name and IC");
      return;
    }
    onAdd({
      id: "n" + Date.now(),
      ...form,
      submitDate: new Date().toISOString().split("T")[0],
      docs: { ...emptyDocs },
      status: "not_started",
      companies: [],
      notes: "",
    });
    onNavigate("nominees");
  };

  return (
    <div>
      <button onClick={() => onNavigate("nominees")}
        style={{
          background: "transparent", border: "none", color: C.gold,
          fontSize: 12, cursor: "pointer", marginBottom: 16, padding: 0,
        }}>
        ← Back
      </button>

      <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 20 }}>
        Add Nominee
      </h2>

      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <FormField label="Name" value={form.name} onChange={v => setForm({...form, name: v})} />
        <FormField label="IC Number" value={form.ic} onChange={v => setForm({...form, ic: v})} placeholder="x-xxxx-xxxxx-xx-x" />
        <FormField label="Phone" value={form.phone} onChange={v => setForm({...form, phone: v})} />

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Agent</div>
          <select value={form.agentId} onChange={e => setForm({...form, agentId: e.target.value})}
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 8,
              background: C.bg, border: `1px solid ${C.borderLight}`,
              color: C.text, fontSize: 13, outline: "none",
            }}>
            {mockAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Customer Group</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {customerGroups.map(g => (
              <button key={g.id} onClick={() => setForm({...form, customerGroup: g.id})}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: form.customerGroup === g.id ? g.color + "22" : C.bg,
                  border: `1px solid ${form.customerGroup === g.id ? g.color : C.border}`,
                  color: form.customerGroup === g.id ? g.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {g.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Region</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {regions.map(r => (
              <button key={r.id} onClick={() => setForm({...form, region: r.id})}
                style={{
                  padding: "10px 6px", borderRadius: 6,
                  background: form.region === r.id ? r.color + "22" : C.bg,
                  border: `1px solid ${form.region === r.id ? r.color : C.border}`,
                  color: form.region === r.id ? r.color : C.textDim,
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                }}>
                📍 {r.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Nominee Type</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              { v: "new", label: "NEW (5/5 split)", color: C.green },
              { v: "old", label: "OLD (6/4 split)", color: C.orange },
            ].map(t => (
              <button key={t.v} onClick={() => setForm({...form, nomineeType: t.v})}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: form.nomineeType === t.v ? `${t.color}22` : C.bg,
                  border: `1px solid ${form.nomineeType === t.v ? t.color : C.border}`,
                  color: form.nomineeType === t.v ? t.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Payout Group</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              { v: "A", label: "A · Fixed Fee", color: C.gold },
              { v: "B", label: "B · Net Price", color: C.text },
            ].map(g => (
              <button key={g.v} onClick={() => setForm({...form, group: g.v})}
                style={{
                  padding: "10px", borderRadius: 6,
                  background: form.group === g.v ? `${g.color}22` : C.bg,
                  border: `1px solid ${form.group === g.v ? g.color : C.border}`,
                  color: form.group === g.v ? g.color : C.textDim,
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={handleSubmit} style={{
        width: "100%", padding: "14px", borderRadius: 8, border: "none",
        background: C.gold, color: C.bg, fontSize: 14, fontWeight: 700, cursor: "pointer",
      }}>
        Save Nominee
      </button>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder = "" }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>{label}</div>
      <input type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 8,
          background: C.bg, border: `1px solid ${C.borderLight}`,
          color: C.text, fontSize: 13, outline: "none",
        }}
      />
    </div>
  );
}

// ============ PAYOUT HELPERS ============
function daysInMonth(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function getMonth(dateStr) {
  if (!dateStr) return "";
  return dateStr.substring(0, 7);
}

function getDayOfMonth(dateStr) {
  if (!dateStr) return 0;
  return Number(dateStr.split("-")[2]);
}

function nextMonth(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m, 1); // m is already next month (0-indexed) since input m is 1-indexed
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// New logic (matches Chester's sheet):
// "Month X income" = (prorate of month X if exists) + (full month of month X+1)
// If prorate of month X is claimed in same month X, it's part of month X income
// If not claimed, it carries into month X+1's income
//
// Wait — Chester's logic is:
// Month X income = prorate of X + full of X+1 (always paired this way)
// Because the owner pays you on X+1: they pay (prorate days from X) + (X+1 full month)
//
// For Group A:
//   First month (open month): if claimed in same month, income = prorate; else income = 0
//   Following months (X >= open_month + 1):
//     If X == open_month + 1: income = full_X + (carryforward from X-1 if not claimed)
//     If X > open_month + 1: income = full_X (no carry)
//   Wait but Chester wants: Month X = prorate(X) + full(X+1)
//   So for owner who opened on 21/3:
//     - "March" row in sheet shows: prorate of March + full of April = 8,870 + 25,000 = 33,870
//     - "April" row: full of May = 25,000
//     - "May" row: full of June = 25,000
//
// This means we shift the "label" — each row represents what was earned for that month period
// but received in the following month.
//
// So for the Payout page when user selects a month:
// "March" view → shows: March prorate (claimed-in-March or carryforward) + April full
// "April" view → shows: May full (since April→May is one full month for an open in March)
//
// Actually simpler interpretation: Each "month label" represents the BILLING period
// March = 21-31 of March (11 days) + April full (1-30) — but the first months work differently
// Actually no — Chester just groups it as: my income FOR that month period
//
// Simplest approach matching the sheet:
// For an account opened on date D in month M:
//   Month M row shows: prorate(M) + full(M+1)  -- "first cycle"
//   Month M+1 row shows: full(M+2)             -- continues
//   Month M+2 row shows: full(M+3)
//   etc.
// So month X (where X > M) shows full(X+1)
// Wait that doesn't match — if month M shows prorate+full(M+1), then month M+1 would also show full(M+1)? Double counting!
//
// Re-reading Chester's sheet:
// Looking at his March row: 33,870.97 = 25,000 + 8,870.97
// Looking at his April row would be: 25,000 (just full)
//
// So:
// Month M (open month) row: prorate(M) + full(M+1)
// Month M+1 row: full(M+2)
// Month M+2 row: full(M+3)
// ...
// In other words: each "month label" displays what's collected during/around that month
// The shift is: month X row = full(X+1), except month M which adds the prorate

// Helper: Get how many "month rows" since open date
// Open month = row 1, next month = row 2, etc.
function getMonthIndex(openDate, viewMonth) {
  if (!openDate || !viewMonth) return 0;
  const [oy, om] = openDate.substring(0, 7).split("-").map(Number);
  const [vy, vm] = viewMonth.split("-").map(Number);
  return (vy - oy) * 12 + (vm - om) + 1; // 1-indexed
}

function calcAccountIncome(account, viewMonth, group) {
  if (!account.openDate) return null;
  const openMonth = getMonth(account.openDate);

  // Account must have been opened by viewMonth
  if (viewMonth < openMonth) return null;

  // Contract / guarantee config
  const contractMonths = account.contractMonths || 6;
  const guaranteedMonths = account.guaranteedMonths || 6;
  const monthIndex = getMonthIndex(account.openDate, viewMonth);

  // After contract ended → no more income
  if (monthIndex > contractMonths) return null;

  const isBlown = account.status === "blown" && account.blownDate;
  const blownMonth = isBlown ? getMonth(account.blownDate) : null;

  // Compensation = blown month or after
  const isCompensation = isBlown && viewMonth >= blownMonth;

  // Within guaranteed payout period?
  const inGuarantee = monthIndex <= guaranteedMonths;

  if (group === "B") {
    const dim = daysInMonth(viewMonth);
    const openDay = getDayOfMonth(account.openDate);
    const isOpenMonth = (viewMonth === openMonth);

    // If account is blown and viewMonth >= blown month → compensation mode
    if (isBlown && viewMonth >= blownMonth) {
      const compPrice = account.compensationPrice || 15000;
      const fullPayout = inGuarantee ? (account.payout || 0) : 0;

      return {
        income: compPrice,
        isProrate: false,
        payout: fullPayout,
        viewMonth,
        netPrice: compPrice,
        fullPayout,
        isOpenMonth: false,
        prorateDays: 0,
        daysInMonth: dim,
        isCompensation: true,
        compensationPrice: compPrice,
        inGuarantee,
        monthIndex,
        contractMonths,
        guaranteedMonths,
      };
    }

    // Normal Group B logic (not blown)
    const netPrice = account.monthlyNetPrice?.[viewMonth];
    if (netPrice === undefined || netPrice === null) {
      return { income: 0, isProrate: false, fullPrice: 0, payout: 0, missingData: true, viewMonth, isCompensation: false };
    }

    const fullPayout = inGuarantee ? (account.payout || 0) : 0;
    let proratedPayout = fullPayout;
    let prorateDays = 0;
    if (isOpenMonth) {
      prorateDays = dim - openDay + 1;
      proratedPayout = (fullPayout * prorateDays) / dim;
    }

    return {
      income: netPrice,
      isProrate: false,
      payout: proratedPayout,
      viewMonth,
      netPrice,
      fullPayout,
      isOpenMonth,
      prorateDays,
      daysInMonth: dim,
      isCompensation: false,
      inGuarantee,
      monthIndex,
      contractMonths,
      guaranteedMonths,
    };
  }

  // Group A logic
  const dim = daysInMonth(viewMonth);
  const openDay = getDayOfMonth(account.openDate);
  const isOpenMonth = (viewMonth === openMonth);

  // Prorate days in current view month
  const prorateDays = isOpenMonth ? (dim - openDay + 1) : 0;
  const prorateAmount = isOpenMonth ? (account.monthlyFee * prorateDays) / dim : 0;
  const proratePayout = (isOpenMonth && inGuarantee) ? ((account.payout || 0) * prorateDays) / dim : 0;

  // For the LAST month of contract (month index = contractMonths),
  // only collect the prorate portion of next month (until contract day)
  const isLastMonth = monthIndex === contractMonths;

  let fullAmount = 0;
  let fullPayout = 0;

  if (isLastMonth) {
    // Last month: next month's full = open day's prorate
    // e.g. open 3/5, contract 6 mo → last is 10月, next month full = 11月 prorate (1-3 = 3 days)
    const nm = nextMonth(viewMonth);
    const nmDays = daysInMonth(nm);
    const partialDays = openDay - 1; // e.g. open day 3 → days 1-2 = 2 days... but we want 3 days for full coverage
    // Actually: open date 3/5 → contract ends 3/11 → next month full row covers 1-3 of 11月 (3 days)
    fullAmount = (account.monthlyFee * (openDay - 1)) / nmDays;
    fullPayout = inGuarantee ? ((account.payout || 0) * (openDay - 1)) / nmDays : 0;
  } else {
    // Normal month: full next month
    fullAmount = account.monthlyFee;
    fullPayout = inGuarantee ? (account.payout || 0) : 0;
  }

  const totalIncome = prorateAmount + fullAmount;
  const totalPayout = proratePayout + fullPayout;
  const nm = nextMonth(viewMonth);

  return {
    income: totalIncome,
    payout: totalPayout,
    isOpenMonth,
    prorateDays,
    prorateAmount,
    proratePayout,
    fullAmount,
    fullPayout,
    daysInMonth: dim,
    monthlyFee: account.monthlyFee,
    nomineePayout: account.payout || 0,
    viewMonth,
    nextMonthLabel: nm,
    isCompensation,
    inGuarantee,
    monthIndex,
    contractMonths,
    guaranteedMonths,
    isLastMonth,
  };
}

// ============ PAYOUT PAGE ============
function PayoutPage({ nominees, onUpdate }) {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const groupARows = [];
  const groupBRows = [];

  nominees.forEach(n => {
    if (!n.companies) return;
    n.companies.forEach(company => {
      if (!company.accounts) return;
      company.accounts.forEach(account => {
        const result = calcAccountIncome(account, selectedMonth, n.group);
        if (result === null) return;

        const splitRatio = n.nomineeType === "old" ? 0.6 : 0.5;
        const incomeAfterPayout = result.income - result.payout;
        const daxix = result.income > 0 ? (result.payout + incomeAfterPayout * splitRatio) : 0;
        const chester = result.income > 0 ? (incomeAfterPayout * (1 - splitRatio)) : 0;

        const row = {
          nomineeId: n.id,
          nomineeName: n.name,
          companyName: company.name,
          accountId: account.id,
          bank: account.bank,
          nomineeType: n.nomineeType,
          group: n.group,
          status: account.status,
          ...result,
          daxix, chester,
        };

        if (n.group === "A") groupARows.push(row);
        else groupBRows.push(row);
      });
    });
  });

  const groupATotalIncome = groupARows.reduce((s, r) => s + r.income, 0);
  const groupATotalDaxix = groupARows.reduce((s, r) => s + r.daxix, 0);
  const groupATotalChester = groupARows.reduce((s, r) => s + r.chester, 0);

  const groupBTotalIncome = groupBRows.reduce((s, r) => s + r.income, 0);
  const groupBTotalDaxix = groupBRows.reduce((s, r) => s + r.daxix, 0);
  const groupBTotalChester = groupBRows.reduce((s, r) => s + r.chester, 0);

  const grandTotal = groupATotalIncome + groupBTotalIncome;
  const grandDaxix = groupATotalDaxix + groupBTotalDaxix;
  const grandChester = groupATotalChester + groupBTotalChester;

  const fmt = (n) => "฿" + Math.round(n).toLocaleString("en-US");

  const monthOptions = [];
  for (let i = -11; i <= 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthOptions.push(mStr);
  }

  const updateNetPrice = (nomineeId, accountId, monthKey, value) => {
    const nominee = nominees.find(n => n.id === nomineeId);
    if (!nominee) return;
    const newCompanies = nominee.companies.map(c => ({
      ...c,
      accounts: c.accounts.map(a => {
        if (a.id !== accountId) return a;
        const monthlyNetPrice = { ...(a.monthlyNetPrice || {}) };
        monthlyNetPrice[monthKey] = value;
        return { ...a, monthlyNetPrice };
      }),
    }));
    onUpdate(nomineeId, { companies: newCompanies });
  };

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Payout
      </h2>
      <p style={{ fontSize: 13, color: C.textDim, marginBottom: 16 }}>
        Each row = month's prorate + next month's full
      </p>

      {/* Month selector */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 16,
        border: `1px solid ${C.border}`, marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>Select Month</div>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8,
            background: C.bg, border: `1px solid ${C.borderLight}`,
            color: C.text, fontSize: 14, fontWeight: 700, outline: "none",
          }}>
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Grand Summary */}
      <div style={{
        background: "linear-gradient(135deg, #1a2a3a, #16203a)",
        borderRadius: 12, padding: 18,
        border: `1px solid ${C.gold}66`, marginBottom: 16,
      }}>
        <div style={{ fontSize: 10, color: C.gold, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>
          {selectedMonth} · Grand Total
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Total Income</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>{fmt(grandTotal)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>DAXIX</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.red }}>{fmt(grandDaxix)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Chester</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>{fmt(grandChester)}</div>
          </div>
        </div>
      </div>

      {/* Group A */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" }}>
            Group A · Fixed Fee
          </span>
          <span style={{ fontSize: 11, color: C.gold }}>{groupARows.length} accounts</span>
        </div>

        {groupARows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.textMuted, fontSize: 12, fontStyle: "italic" }}>
            No active Group A accounts in {selectedMonth}
          </div>
        ) : (
          groupARows.map(r => <PayoutRowA key={r.accountId} row={r} fmt={fmt} />)
        )}

        {groupARows.length > 0 && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "rgba(212,175,55,0.06)", borderRadius: 6,
            border: `1px solid ${C.gold}33`,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11 }}>
              <div>
                <div style={{ color: C.textDim, fontSize: 9 }}>Income</div>
                <div style={{ color: C.gold, fontWeight: 700 }}>{fmt(groupATotalIncome)}</div>
              </div>
              <div>
                <div style={{ color: C.textDim, fontSize: 9 }}>DAXIX</div>
                <div style={{ color: C.red, fontWeight: 700 }}>{fmt(groupATotalDaxix)}</div>
              </div>
              <div>
                <div style={{ color: C.textDim, fontSize: 9 }}>Chester</div>
                <div style={{ color: C.blue, fontWeight: 700 }}>{fmt(groupATotalChester)}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Group B */}
      <div style={{
        background: C.card, borderRadius: 12, padding: 18,
        border: `1px solid ${C.border}`, marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" }}>
            Group B · Flow-Based
          </span>
          <span style={{ fontSize: 11, color: C.gold }}>{groupBRows.length} accounts</span>
        </div>

        {groupBRows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.textMuted, fontSize: 12, fontStyle: "italic" }}>
            No active Group B accounts in {selectedMonth}
          </div>
        ) : (
          groupBRows.map(r => (
            <PayoutRowB key={r.accountId} row={r}
              selectedMonth={selectedMonth}
              onUpdateNetPrice={(value) => updateNetPrice(r.nomineeId, r.accountId, selectedMonth, value)}
              fmt={fmt}
            />
          ))
        )}

        {groupBRows.length > 0 && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "rgba(212,175,55,0.06)", borderRadius: 6,
            border: `1px solid ${C.gold}33`,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11 }}>
              <div>
                <div style={{ color: C.textDim, fontSize: 9 }}>Income</div>
                <div style={{ color: C.gold, fontWeight: 700 }}>{fmt(groupBTotalIncome)}</div>
              </div>
              <div>
                <div style={{ color: C.textDim, fontSize: 9 }}>DAXIX</div>
                <div style={{ color: C.red, fontWeight: 700 }}>{fmt(groupBTotalDaxix)}</div>
              </div>
              <div>
                <div style={{ color: C.textDim, fontSize: 9 }}>Chester</div>
                <div style={{ color: C.blue, fontWeight: 700 }}>{fmt(groupBTotalChester)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ PAYOUT ROW (GROUP A) ============
function PayoutRowA({ row, fmt }) {
  const bankColors = { KBank: "#7cb87c", SCB: "#a87cb8", KTB: "#7aa6c9" };

  return (
    <div style={{
      padding: "12px",
      background: row.isCompensation ? "rgba(201,122,122,0.05)" : C.bg,
      borderRadius: 8,
      border: `1px solid ${row.isCompensation ? C.red + "44" : C.border}`,
      marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ width: 4, height: 24, background: bankColors[row.bank], borderRadius: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            {row.nomineeName} · {row.bank}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{row.companyName}</div>
        </div>
        {row.isCompensation && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: C.red,
            background: "rgba(201,122,122,0.15)",
            padding: "2px 6px", borderRadius: 3,
          }}>
            💥 爆户补偿
          </span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: row.nomineeType === "old" ? C.orange : C.green,
          background: row.nomineeType === "old" ? "rgba(201,168,122,0.15)" : "rgba(124,184,124,0.15)",
          padding: "2px 6px", borderRadius: 3,
        }}>
          {row.nomineeType === "old" ? "OLD 6/4" : "NEW 5/5"}
        </span>
      </div>

      {/* Breakdown */}
      <div style={{
        padding: "8px 10px", marginBottom: 8,
        background: row.isCompensation ? "rgba(201,122,122,0.05)" : "rgba(122,166,201,0.05)",
        borderRadius: 6,
        fontSize: 10, color: C.textDim,
      }}>
        {row.isOpenMonth && row.prorateAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>📅 {row.viewMonth} prorate ({row.prorateDays}/{row.daysInMonth}d)</span>
            <span style={{ color: C.text }}>{fmt(row.prorateAmount)}</span>
          </div>
        )}
        {row.fullAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>
              📅 {row.nextMonthLabel} {row.isLastMonth ? "(contract end prorate)" : "full month"}
            </span>
            <span style={{ color: C.text }}>{fmt(row.fullAmount)}</span>
          </div>
        )}
        {row.fullAmount === 0 && row.prorateAmount === 0 && (
          <div style={{ color: C.textMuted, fontStyle: "italic" }}>No income this period</div>
        )}
        {(row.proratePayout + row.fullPayout) > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
            <span>− Nominee payout {row.inGuarantee ? "" : "(out of guarantee)"}</span>
            <span style={{ color: C.red }}>-{fmt(row.proratePayout + row.fullPayout)}</span>
          </div>
        )}
        {row.monthIndex > 0 && (
          <div style={{ marginTop: 4, fontSize: 9, color: C.textMuted, textAlign: "right" }}>
            Month {row.monthIndex}/{row.contractMonths} · Guaranteed {row.guaranteedMonths}mo
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, fontSize: 10 }}>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>Income</div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: 12 }}>{fmt(row.income)}</div>
        </div>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>Net</div>
          <div style={{ color: C.text, fontSize: 11 }}>{fmt(row.income - row.payout)}</div>
        </div>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>DAXIX</div>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{fmt(row.daxix)}</div>
        </div>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>Chester</div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: 12 }}>{fmt(row.chester)}</div>
        </div>
      </div>
    </div>
  );
}

// ============ PAYOUT ROW (GROUP B) ============
function PayoutRowB({ row, selectedMonth, onUpdateNetPrice, fmt }) {
  const bankColors = { KBank: "#7cb87c", SCB: "#a87cb8", KTB: "#7aa6c9" };
  const [editing, setEditing] = useState(row.missingData || false);
  const netPrice = row.netPrice || 0;

  return (
    <div style={{
      padding: "12px",
      background: row.isCompensation ? "rgba(201,122,122,0.05)" : C.bg,
      borderRadius: 8,
      border: `1px solid ${row.isCompensation ? C.red + "44" : C.border}`,
      marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ width: 4, height: 24, background: bankColors[row.bank], borderRadius: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            {row.nomineeName} · {row.bank}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{row.companyName}</div>
        </div>
        {row.isCompensation && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: C.red,
            background: "rgba(201,122,122,0.15)",
            padding: "2px 6px", borderRadius: 3,
          }}>
            💥 爆户补偿
          </span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 700, color: C.gold,
          background: "rgba(212,175,55,0.15)",
          padding: "2px 6px", borderRadius: 3,
        }}>
          Group B
        </span>
      </div>

      {row.isCompensation ? (
        <div style={{
          padding: "8px 10px", marginBottom: 8,
          background: "rgba(201,122,122,0.06)", borderRadius: 6,
          fontSize: 10, border: `1px solid ${C.red}33`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: row.payout > 0 ? 4 : 0 }}>
            <span style={{ color: C.textMuted }}>
              💥 爆户补偿: <span style={{ color: C.red, fontWeight: 700 }}>{fmt(row.compensationPrice)}</span>
            </span>
            <span style={{ fontSize: 9, color: C.textMuted }}>
              Month {row.monthIndex}/{row.contractMonths}
            </span>
          </div>
          {row.payout > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
              <span style={{ color: C.textMuted }}>− Nominee payout</span>
              <span style={{ color: C.red }}>-{fmt(row.payout)}</span>
            </div>
          )}
        </div>
      ) : editing || row.missingData ? (
        <div style={{
          padding: "10px", marginBottom: 8,
          background: "rgba(212,175,55,0.06)", borderRadius: 6,
          border: `1px solid ${C.gold}33`,
        }}>
          <div style={{ fontSize: 10, color: C.gold, marginBottom: 8, fontWeight: 700 }}>
            Net price for {selectedMonth}
          </div>
          <div style={{
            display: "flex", alignItems: "center",
            background: C.bg, borderRadius: 6,
            border: `1px solid ${C.border}`,
          }}>
            <span style={{ padding: "10px 0 10px 12px", color: C.textMuted, fontSize: 13 }}>฿</span>
            <input type="text" inputMode="numeric" value={netPrice}
              onChange={e => onUpdateNetPrice(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
              placeholder="e.g. 50000"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: C.gold, fontSize: 16, fontWeight: 700, padding: "10px 8px",
                fontFamily: "'Courier New', monospace",
              }}
            />
          </div>
          <div style={{ fontSize: 9, color: C.textMuted, marginTop: 6 }}>
            到手价格（fixed payout + commission 已经算好）
          </div>
          {!row.missingData && (
            <button onClick={() => setEditing(false)}
              style={{
                marginTop: 8, padding: "6px 10px", borderRadius: 4, border: "none",
                background: C.gold, color: C.bg, fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}>
              Done
            </button>
          )}
        </div>
      ) : (
        <div style={{
          padding: "8px 10px", marginBottom: 8,
          background: "rgba(212,175,55,0.04)", borderRadius: 6,
          fontSize: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: row.payout > 0 ? 4 : 0 }}>
            <span style={{ color: C.textMuted }}>
              Net price: <span style={{ color: C.gold, fontWeight: 700 }}>{fmt(netPrice)}</span>
            </span>
            <button onClick={() => setEditing(true)}
              style={{
                background: "transparent", border: "none",
                color: C.gold, fontSize: 10, cursor: "pointer", padding: 0,
              }}>
              Edit
            </button>
          </div>
          {row.payout > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
              <span style={{ color: C.textMuted }}>
                − Nominee payout
                {row.isOpenMonth && row.prorateDays < row.daysInMonth && (
                  <span style={{ color: C.orange, marginLeft: 4 }}>
                    ({row.prorateDays}/{row.daysInMonth}d prorate)
                  </span>
                )}
              </span>
              <span style={{ color: C.red }}>-{fmt(row.payout)}</span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 10 }}>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>Income</div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: 12 }}>{fmt(row.income)}</div>
        </div>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>DAXIX</div>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{fmt(row.daxix)}</div>
        </div>
        <div>
          <div style={{ color: C.textMuted, fontSize: 9 }}>Chester</div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: 12 }}>{fmt(row.chester)}</div>
        </div>
      </div>
    </div>
  );
}

// ============ MAIN APP ============
// ============ LOGIN PAGE ============
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    onLogin(data.user);
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, letterSpacing: 6, color: C.gold, textTransform: "uppercase", marginBottom: 6 }}>
            Kraton Flow
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
            Admin Panel
          </div>
        </div>

        <div style={{
          background: C.card, borderRadius: 12, padding: 24,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Email</div>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              autoFocus
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 13, outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Password</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: C.bg, border: `1px solid ${C.borderLight}`,
                color: C.text, fontSize: 13, outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: "8px 10px", marginBottom: 12,
              background: "rgba(201,122,122,0.1)", borderRadius: 6,
              border: `1px solid ${C.red}33`,
              fontSize: 11, color: C.red,
            }}>
              {error}
            </div>
          )}

          <button onClick={handleLogin} disabled={loading || !email || !password}
            style={{
              width: "100%", padding: "12px", borderRadius: 8, border: "none",
              background: loading ? C.borderLight : C.gold,
              color: C.bg, fontSize: 13, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: (!email || !password) ? 0.5 : 1,
            }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ MAIN APP ============
export default function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [nomineeId, setNomineeId] = useState(null);
  const [nominees, setNominees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Check session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAuthChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load nominees when user logged in
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadAllNominees()
      .then(data => { setNominees(data); setError(""); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  const reloadNominees = async () => {
    try {
      const data = await loadAllNominees();
      setNominees(data);
    } catch (e) { setError(e.message); }
  };

  const navigate = (p, id) => {
    setPage(p);
    if (id) setNomineeId(id);
  };

  const updateNominee = async (id, updates) => {
    // Optimistic update locally
    setNominees(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    // Save to Supabase
    try {
      await saveNomineeFields(id, updates);
      if (updates.companies) {
        await syncCompanies(id, updates.companies);
      }
    } catch (e) {
      setError("Save failed: " + e.message);
      reloadNominees();
    }
  };

  const addNominee = async (n) => {
    setNominees(prev => [n, ...prev]);
    try {
      await insertNominee(n);
    } catch (e) {
      setError("Add failed: " + e.message);
      reloadNominees();
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setNominees([]);
  };

  if (authChecking) {
    return (
      <div style={{
        minHeight: "100vh", background: C.bg, color: C.textDim,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontFamily: "system-ui",
      }}>
        Loading...
      </div>
    );
  }

  if (!user) return <LoginPage onLogin={setUser} />;

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bgGrad,
      color: C.text,
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "rgba(0,0,0,0.95)", backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.borderLight}`,
        padding: "16px 20px",
      }}>
        <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 4, color: C.gold, textTransform: "uppercase" }}>
              Kraton Flow
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginTop: 2 }}>
              Admin Panel
            </div>
          </div>
          <div onClick={handleLogout} style={{
            width: 32, height: 32, borderRadius: "50%",
            background: C.gold, color: C.bg,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }} title="Click to logout">
            {(user.email || "C").charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          maxWidth: 520, margin: "12px auto 0", padding: "10px 14px",
          background: "rgba(201,122,122,0.1)",
          border: `1px solid ${C.red}33`,
          borderRadius: 8, fontSize: 11, color: C.red,
        }}>
          ⚠️ {error}
          <button onClick={() => setError("")} style={{
            float: "right", background: "transparent", border: "none",
            color: C.red, cursor: "pointer", fontSize: 14,
          }}>×</button>
        </div>
      )}

      {loading && (
        <div style={{
          maxWidth: 520, margin: "12px auto 0", padding: "10px",
          textAlign: "center", color: C.textDim, fontSize: 11,
        }}>
          Loading data...
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 16px 80px" }}>
        {page === "dashboard" && <Dashboard nominees={nominees} onNavigate={navigate} />}
        {page === "nominees" && <NomineesList nominees={nominees} onNavigate={navigate} />}
        {page === "detail" && <NomineeDetail nomineeId={nomineeId} nominees={nominees} onNavigate={navigate} onUpdate={updateNominee} />}
        {page === "add" && <AddNominee onNavigate={navigate} onAdd={addNominee} />}
        {page === "payout" && <PayoutPage nominees={nominees} onUpdate={updateNominee} />}
      </div>

      {/* Bottom Nav */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "rgba(0,0,0,0.95)", backdropFilter: "blur(10px)",
        borderTop: `1px solid ${C.borderLight}`,
        padding: "10px 0", zIndex: 10,
      }}>
        <div style={{ maxWidth: 520, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
          <NavBtn active={page === "dashboard"} icon="📊" label="Dashboard" onClick={() => navigate("dashboard")} />
          <NavBtn active={page === "nominees" || page === "detail" || page === "add"} icon="👥" label="Nominees" onClick={() => navigate("nominees")} />
          <NavBtn active={page === "payout"} icon="💰" label="Payout" onClick={() => navigate("payout")} />
        </div>
      </div>
    </div>
  );
}

function NavBtn({ active, icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "transparent", border: "none", padding: "8px",
      color: active ? C.gold : C.textMuted, cursor: "pointer",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
    </button>
  );
}
