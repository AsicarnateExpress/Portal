/* admin.js - Administrator dashboard */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  collection, query, orderBy, limit, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (selector) => document.querySelector(selector);
const LOGIN_PAGE = "index1.html";
const COLLECTION = { student: "students", faculty: "faculty", admin: "admins" };
const ROLE_LABEL = { student: "Student", faculty: "Faculty", admin: "Administrator" };
const TITLES = {
  overview: "Overview",
  approvals: "Approvals",
  accounts: "Accounts",
  invites: "Admin invites"
};

let me = null;        // the signed-in administrator
let users = [];       // all accounts
let view = "overview";
const filters = { role: "all", status: "all", text: "" };


/* ---------- Helpers ---------- */

// Makes user-typed text safe to show on the page
function esc(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

function fmt(timestamp) {
  return timestamp?.toDate ? timestamp.toDate().toLocaleString() : "-";
}

function toast(message, type = "ok") {
  const box = $("#toast");
  box.textContent = message;
  box.className = "toast show " + (type === "error" ? "error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 3200);
}

// Confirmation pop-up: resolves true (Confirm) or false (Cancel)
function confirmBox(message) {
  return new Promise((resolve) => {
    const box = $("#confirmBox");
    $("#confirmText").textContent = message;
    const finish = (answer) => { resolve(answer); box.close(); };
    $("#confirmYes").onclick = () => finish(true);
    $("#confirmNo").onclick = () => finish(false);
    box.onclose = () => resolve(false);
    box.showModal();
  });
}

// Saves an entry in the activity log
async function logAction(action, target) {
  await setDoc(doc(collection(db, "auditLogs")), {
    actorUid: me.uid,
    actorName: me.name,
    action,
    target: target || "",
    at: serverTimestamp()
  }).catch(() => {});
}

const goLogin = () => location.replace(LOGIN_PAGE);

async function logout() {
  await signOut(auth).catch(() => {});
  goLogin();
}


/* ---------- Access check ---------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) return goLogin();
  if (me) return;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : null;
    const allowed = user.emailVerified && data &&
                    data.role === "admin" && data.status === "active";

    if (!allowed) {
      await signOut(auth);
      return goLogin();
    }
    me = { uid: user.uid, ...data };
    await start();
  } catch (error) {
    await signOut(auth).catch(() => {});
    goLogin();
  }
});

async function start() {
  $("#profileBtn").textContent = me.name.split(" ")[0];
  $("#profileInfo").textContent = `${me.name} (${me.email})`;
  await loadUsers();
  $("#loading").remove();
  $("#app").hidden = false;
  show("overview");
  watchIdle();
}

// Auto logout after 30 minutes without activity
function watchIdle() {
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(logout, 30 * 60 * 1000);
  };
  ["click", "keydown", "touchstart", "mousemove"].forEach((name) =>
    document.addEventListener(name, reset, { passive: true })
  );
  reset();
}


/* ---------- Data ---------- */

async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  users.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const pending = users.filter((u) => u.status === "pending").length;
  const badge = $("#pendingBadge");
  badge.textContent = pending;
  badge.hidden = !pending;
}


/* ---------- Pages ---------- */

async function show(name) {
  view = name;
  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === name)
  );
  $("#viewTitle").textContent = TITLES[name];
  $("#sidebar").classList.remove("open");
  $("#view").innerHTML = '<p class="muted">Loading...</p>';

  try {
    if (name === "overview") await renderOverview();
    if (name === "approvals") renderApprovals();
    if (name === "accounts") renderAccounts();
    if (name === "invites") await renderInvites();
  } catch (error) {
    $("#view").innerHTML =
      '<p class="muted">Could not load this page. Check your connection and try again.</p>';
  }
}

const card = (label, value) =>
  `<div class="card"><small>${label}</small><b>${value}</b></div>`;

async function renderOverview() {
  const active = (role) =>
    users.filter((u) => u.role === role && u.status === "active").length;
  const pending = users.filter((u) => u.status === "pending").length;

  const logSnap = await getDocs(
    query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(8))
  );
  const rows = logSnap.docs.map((d) => {
    const log = d.data();
    const who = log.actorName || `New ${log.role || "user"}`;
    return `<tr>
      <td>${esc(who)}</td>
      <td>${esc(log.action)} ${esc(log.target)}</td>
      <td>${esc(fmt(log.at))}</td>
    </tr>`;
  }).join("");

  $("#view").innerHTML = `
    <div class="cards">
      ${card("Students", active("student"))}
      ${card("Faculty", active("faculty"))}
      ${card("Administrators", active("admin"))}
      ${card("Pending approvals", pending)}
      ${card("Courses", "-")}
      ${card("Departments", "-")}
    </div>
    <div class="panel">
      <h3>Recent activity</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Who</th><th>Action</th><th>When</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">No activity yet.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

/* Accounts table rows (also used by Approvals) */
function accountRow(u) {
  const button = (act, label, cls = "") =>
    `<button type="button" class="btn sm ${cls}" data-act="${act}" data-uid="${esc(u.uid)}">${label}</button>`;

  let actions;
  if (u.uid === me.uid) {
    actions = '<span class="muted">You</span>';
  } else {
    const list = [];
    if (u.status === "pending" || u.status === "rejected") list.push(button("approve", "Approve"));
    if (u.status === "pending") list.push(button("reject", "Reject", "ghost"));
    if (u.status === "active") list.push(button("deactivate", "Deactivate", "ghost"));
    if (u.status === "deactivated") list.push(button("activate", "Activate"));
    list.push(button("remove", "Remove", "danger"));
    actions = `<div class="actions">${list.join("")}</div>`;
  }

  return `<tr>
    <td>${esc(u.name)}</td>
    <td>${esc(ROLE_LABEL[u.role] || u.role)}</td>
    <td>${esc(u.roleId)}</td>
    <td>${esc(u.email)}</td>
    <td><span class="pill ${esc(u.status)}">${esc(u.status)}</span></td>
    <td>${actions}</td>
  </tr>`;
}

const tableHead =
  "<thead><tr><th>Name</th><th>Role</th><th>ID</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>";

function renderApprovals() {
  const list = users.filter((u) => u.status === "pending");
  $("#view").innerHTML = `
    <div class="panel">
      <h3>Pending registrations</h3>
      ${list.length
        ? `<div class="table-wrap"><table>${tableHead}<tbody>${list.map(accountRow).join("")}</tbody></table></div>`
        : '<p class="muted">No pending registrations.</p>'}
    </div>`;
}

const options = (list, current) =>
  list.map(([value, label]) =>
    `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`
  ).join("");

function renderAccounts() {
  $("#view").innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="fText" type="search" placeholder="Search name, ID or email"
               value="${esc(filters.text)}">
        <select id="fRole">${options([
          ["all", "All roles"], ["student", "Students"],
          ["faculty", "Faculty"], ["admin", "Administrators"]
        ], filters.role)}</select>
        <select id="fStatus">${options([
          ["all", "All statuses"], ["active", "Active"], ["pending", "Pending"],
          ["rejected", "Rejected"], ["deactivated", "Deactivated"]
        ], filters.status)}</select>
      </div>
      <div class="table-wrap"><table>${tableHead}<tbody id="accountRows"></tbody></table></div>
    </div>`;
  drawAccountRows();
}

function drawAccountRows() {
  const text = filters.text.toLowerCase();
  const list = users.filter((u) =>
    (filters.role === "all" || u.role === filters.role) &&
    (filters.status === "all" || u.status === filters.status) &&
    (!text || [u.name, u.roleId, u.email].join(" ").toLowerCase().includes(text))
  );
  $("#accountRows").innerHTML = list.length
    ? list.map(accountRow).join("")
    : '<tr><td colspan="6" class="muted">No accounts found.</td></tr>';
}

async function renderInvites() {
  const snap = await getDocs(collection(db, "adminInvites"));
  const now = Date.now();
  const invites = snap.docs
    .map((d) => ({ code: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const rows = invites.map((i) => {
    const expired = i.expiresAt && i.expiresAt.toMillis() < now;
    const state = i.used ? "Used" : expired ? "Expired" : "Unused";
    const cls = i.used ? "pending" : expired ? "deactivated" : "active";
    const code = esc(i.code);
    const actions = i.used ? "" : `
      <div class="actions">
        <button type="button" class="btn sm" data-act="invite-copy" data-code="${code}">Copy</button>
        <button type="button" class="btn sm danger" data-act="invite-delete" data-code="${code}">Delete</button>
      </div>`;
    return `<tr>
      <td><b>${code}</b></td>
      <td><span class="pill ${cls}">${state}</span></td>
      <td>${esc(fmt(i.expiresAt))}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");

  $("#view").innerHTML = `
    <div class="panel">
      <h3>Administrator invitation codes</h3>
      <p class="muted">Each code works once and expires after 7 days. Share it only with a person who should become an administrator.</p>
      <p><button type="button" class="btn" data-act="invite-create">Generate invite code</button></p>
      <div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Status</th><th>Expires</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">No invite codes yet.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}


/* ---------- Actions ---------- */

async function setStatus(uid, status, label) {
  const u = users.find((x) => x.uid === uid);
  if (!u || u.uid === me.uid) return;
  if (!(await confirmBox(`${label} ${u.name}?`))) return;

  await updateDoc(doc(db, "users", uid), { status, updatedAt: serverTimestamp() });
  await logAction(`${status}:`, `${u.name} (${u.roleId})`);
  toast(`${u.name}: ${status}`);
  await loadUsers();
  show(view);
}

async function removeAccount(uid) {
  const u = users.find((x) => x.uid === uid);
  if (!u || u.uid === me.uid) return;
  const message = `Permanently remove ${u.name}? Their profile and ID record will be deleted. This cannot be undone.`;
  if (!(await confirmBox(message))) return;

  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid));
  batch.delete(doc(db, COLLECTION[u.role], uid));
  batch.delete(doc(db, "idIndex", `${u.role}_${u.roleId}`));
  await batch.commit();

  await logAction("removed", `${u.name} (${u.roleId})`);
  toast(`${u.name} was removed`);
  await loadUsers();
  show(view);
}

async function createInvite() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = "STG-" + Array.from(bytes, (b) => letters[b % letters.length]).join("");

  await setDoc(doc(db, "adminInvites", code), {
    used: false,
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdBy: me.uid,
    createdAt: serverTimestamp()
  });
  await logAction("created admin invite", code);
  toast(`Invite ${code} created`);
  renderInvites();
}

async function deleteInvite(code) {
  if (!(await confirmBox(`Delete invite code ${code}?`))) return;
  await deleteDoc(doc(db, "adminInvites", code));
  await logAction("deleted admin invite", code);
  toast("Invite deleted");
  renderInvites();
}


/* ---------- Events ---------- */

$("#nav").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) show(button.dataset.view);
});

$("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#profileBtn").addEventListener("click", () => {
  const menu = $("#profileMenu");
  menu.hidden = !menu.hidden;
});
$("#logoutBtn").addEventListener("click", logout);

// Search and filters on the Accounts page
$("#view").addEventListener("input", (event) => {
  if (event.target.id === "fText") {
    filters.text = event.target.value;
    drawAccountRows();
  }
});
$("#view").addEventListener("change", (event) => {
  if (event.target.id === "fRole") filters.role = event.target.value;
  if (event.target.id === "fStatus") filters.status = event.target.value;
  if (event.target.id === "fRole" || event.target.id === "fStatus") drawAccountRows();
});

// All buttons inside the pages
$("#view").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const { act, uid, code } = button.dataset;

  try {
    if (act === "approve") await setStatus(uid, "active", "Approve");
    if (act === "reject") await setStatus(uid, "rejected", "Reject");
    if (act === "deactivate") await setStatus(uid, "deactivated", "Deactivate");
    if (act === "activate") await setStatus(uid, "active", "Activate");
    if (act === "remove") await removeAccount(uid);
    if (act === "invite-create") await createInvite();
    if (act === "invite-delete") await deleteInvite(code);
    if (act === "invite-copy") {
      await navigator.clipboard.writeText(code).catch(() => {});
      toast("Code copied");
    }
  } catch (error) {
    toast("Action failed. Please try again.", "error");
  }
});
