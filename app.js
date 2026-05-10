const STORAGE_KEY = "howmuchdoioweyou-cursor-test-v1";
const LEGACY_STORAGE_KEY = "split-expenses-v1";

/** @typedef {{ id: string, name: string }} Member */
/** @typedef {{ id: string, description: string, amount: number, paidById: string, participantIds: string[] }} Expense */

/** @type {{ members: Member[], expenses: Expense[] }} */
let state = { members: [], expenses: [] };

function uid() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function load() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.members) && Array.isArray(parsed.expenses)) {
        state = { members: parsed.members, expenses: parsed.expenses };
        return;
      }
    }
  } catch {
    /* ignore */
  }
  state = { members: [], expenses: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** @returns {Record<string, number>} */
function netBalances() {
  /** @type {Record<string, number>} */
  const bal = {};
  for (const m of state.members) bal[m.id] = 0;

  for (const e of state.expenses) {
    const n = e.participantIds.length;
    if (n === 0) continue;
    const share = e.amount / n;
    for (const pid of e.participantIds) {
      bal[pid] = (bal[pid] ?? 0) - share;
    }
    bal[e.paidById] = (bal[e.paidById] ?? 0) + e.amount;
  }
  return bal;
}

/**
 * Greedy settlement: match largest debtor with largest creditor.
 * @returns {{ from: string, to: string, amount: number }[]}
 */
function settlements() {
  const bal = netBalances();
  /** @type {{ id: string, amt: number }[]} */
  const debtors = [];
  /** @type {{ id: string, amt: number }[]} */
  const creditors = [];
  const round2 = (x) => Math.round(x * 100) / 100;

  for (const m of state.members) {
    const b = round2(bal[m.id] ?? 0);
    if (b < -0.005) debtors.push({ id: m.id, amt: -b });
    else if (b > 0.005) creditors.push({ id: m.id, amt: b });
  }

  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  /** @type {{ from: string, to: string, amount: number }[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const pay = round2(Math.min(d.amt, c.amt));
    if (pay > 0.005) out.push({ from: d.id, to: c.id, amount: pay });
    d.amt = round2(d.amt - pay);
    c.amt = round2(c.amt - pay);
    if (d.amt < 0.01) i++;
    if (c.amt < 0.01) j++;
  }
  return out;
}

function memberName(id) {
  return state.members.find((m) => m.id === id)?.name ?? "Unknown";
}

function formatMoney(n) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- DOM ---

const elMembers = document.getElementById("list-members");
const elFormMember = document.getElementById("form-member");
const elInputMember = document.getElementById("input-member-name");
const elFormExpense = document.getElementById("form-expense");
const elDesc = document.getElementById("input-expense-desc");
const elAmount = document.getElementById("input-expense-amount");
const elPayer = document.getElementById("select-payer");
const elSplit = document.getElementById("split-checkboxes");
const elExpenses = document.getElementById("list-expenses");
const elExpenseEmpty = document.getElementById("expense-empty");
const elBalances = document.getElementById("list-balances");
const elSettle = document.getElementById("list-settlements");
const elSettleEmpty = document.getElementById("settle-empty");
const elExport = document.getElementById("btn-export");
const elImport = document.getElementById("input-import");

function renderMembers() {
  elMembers.innerHTML = "";
  for (const m of state.members) {
    const li = document.createElement("li");
    li.className = "chip";
    li.innerHTML = `<span>${escapeHtml(m.name)}</span>`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn btn--danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      state.members = state.members.filter((x) => x.id !== m.id);
      state.expenses = state.expenses.filter(
        (e) => e.paidById !== m.id && !e.participantIds.includes(m.id)
      );
      save();
      render();
    });
    li.appendChild(rm);
    elMembers.appendChild(li);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderPayerAndSplit() {
  elPayer.innerHTML = "";
  elSplit.innerHTML = "";
  for (const m of state.members) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    elPayer.appendChild(opt);
  }
  for (const m of state.members) {
    const label = document.createElement("label");
    label.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = m.id;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(m.name));
    elSplit.appendChild(label);
  }
}

function renderExpenses() {
  elExpenses.innerHTML = "";
  const list = [...state.expenses].reverse();
  elExpenseEmpty.hidden = list.length > 0;
  for (const e of list) {
    const names = e.participantIds.map(memberName).join(", ");
    const li = document.createElement("li");
    li.className = "expense-item";
    const main = document.createElement("div");
    main.className = "expense-item__main";
    main.innerHTML = `
      <p class="expense-item__title">${escapeHtml(e.description)}</p>
      <p class="expense-item__meta">Paid by ${escapeHtml(memberName(e.paidById))} · Split: ${escapeHtml(names || "—")}</p>
    `;
    const aside = document.createElement("div");
    aside.className = "expense-item__aside";
    const amt = document.createElement("span");
    amt.className = "expense-item__amount";
    amt.textContent = formatMoney(e.amount);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn btn--danger";
    rm.textContent = "Delete";
    rm.addEventListener("click", () => {
      state.expenses = state.expenses.filter((x) => x.id !== e.id);
      save();
      render();
    });
    aside.appendChild(amt);
    aside.appendChild(rm);
    li.appendChild(main);
    li.appendChild(aside);
    elExpenses.appendChild(li);
  }
}

function renderBalances() {
  elBalances.innerHTML = "";
  const bal = netBalances();
  const round2 = (x) => Math.round(x * 100) / 100;
  for (const m of state.members) {
    const b = round2(bal[m.id] ?? 0);
    const li = document.createElement("li");
    li.className = "balance-row";
    const name = document.createElement("span");
    name.className = "balance-row__name";
    name.textContent = m.name;
    const amt = document.createElement("span");
    amt.className = "balance-row__amt";
    if (b > 0.005) {
      amt.classList.add("balance-row__amt--pos");
      amt.textContent = `+${formatMoney(b)}`;
    } else if (b < -0.005) {
      amt.classList.add("balance-row__amt--neg");
      amt.textContent = formatMoney(b);
    } else {
      amt.classList.add("balance-row__amt--zero");
      amt.textContent = "Even";
    }
    li.appendChild(name);
    li.appendChild(amt);
    elBalances.appendChild(li);
  }
}

function renderSettlements() {
  elSettle.innerHTML = "";
  const steps = settlements();
  elSettleEmpty.hidden = state.members.length > 0 && state.expenses.length > 0 && steps.length > 0;
  if (state.members.length === 0 || state.expenses.length === 0) {
    elSettleEmpty.hidden = false;
    elSettleEmpty.textContent = "Add people and expenses to see suggested payments.";
    return;
  }
  if (steps.length === 0) {
    elSettleEmpty.hidden = false;
    elSettleEmpty.textContent = "Everyone is settled up.";
    return;
  }
  elSettleEmpty.hidden = true;
  for (const s of steps) {
    const li = document.createElement("li");
    li.textContent = `${memberName(s.from)} pays ${memberName(s.to)} ${formatMoney(s.amount)}`;
    elSettle.appendChild(li);
  }
}

function render() {
  renderMembers();
  renderPayerAndSplit();
  renderExpenses();
  renderBalances();
  renderSettlements();
  elFormExpense.querySelector("button[type=submit]").disabled = state.members.length === 0;
}

elFormMember.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = elInputMember.value.trim();
  if (!name) return;
  state.members.push({ id: uid(), name });
  elInputMember.value = "";
  save();
  render();
});

elFormExpense.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (state.members.length === 0) return;
  const description = elDesc.value.trim();
  const amount = Number(elAmount.value);
  const paidById = elPayer.value;
  const participantIds = [...elSplit.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
  if (!description || !Number.isFinite(amount) || amount <= 0) return;
  if (participantIds.length === 0) {
    alert("Choose at least one person to split between.");
    return;
  }
  state.expenses.push({
    id: uid(),
    description,
    amount,
    paidById,
    participantIds,
  });
  elDesc.value = "";
  elAmount.value = "";
  save();
  render();
});

elExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `howmuchdoioweyou-cursor-test-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

elImport.addEventListener("change", async () => {
  const file = elImport.files?.[0];
  elImport.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.members) || !Array.isArray(parsed.expenses)) {
      throw new Error("Invalid file");
    }
    state = { members: parsed.members, expenses: parsed.expenses };
    save();
    render();
  } catch {
    alert("Could not import that file. Use a JSON export from this app.");
  }
});

load();
render();
