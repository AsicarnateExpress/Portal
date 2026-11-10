/* academics.js - Departments, courses, subjects, years, semesters,
   classes, and enrollment (admin only) */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (selector) => document.querySelector(selector);
const LOGIN_PAGE = "index1.html";

let me = null;
let view = "departments";
let editing = null;   // { key, id } while the form is open

// Data lists (faculty and students come from approved accounts)
const data = {
  departments: [], courses: [], subjects: [], years: [],
  semesters: [], classes: [], enrollments: [], faculty: [], students: []
};

// Firestore collection for each list
const COLLECTIONS = {
  departments: "departments", courses: "courses", subjects: "subjects",
  years: "academicYears", semesters: "semesters",
  classes: "classes", enrollments: "enrollments"
};


/* ---------- Helpers ---------- */

function esc(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

function toast(message, type = "ok") {
  const box = $("#toast");
  box.textContent = message;
  box.className = "toast show " + (type === "error" ? "error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 3200);
}

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


/* ---------- Labels and lookups ---------- */

const find = (key, id) => data[key].find((r) => r.id === id);
const lookup = (key, id) => {
  const record = find(key, id);
  return record ? LABEL[key](record) : "(deleted)";
};

const LABEL = {
  departments: (r) => `${r.code} - ${r.name}`,
  courses: (r) => `${r.code} - ${r.name}`,
  subjects: (r) => `${r.code} - ${r.name}`,
  years: (r) => r.name,
  semesters: (r) => `${r.name} (${lookup("years", r.academicYearId)})`,
  classes: (r) => {
    const subject = find("subjects", r.subjectId);
    return `${subject ? subject.code : "?"} ${r.section} - ${lookup("semesters", r.semesterId)}`;
  },
  faculty: (r) => `${r.name} (${r.roleId})`,
  students: (r) => `${r.name} (${r.roleId})`
};

const NEEDS = {
  departments: "a department", courses: "a course", subjects: "a subject",
  years: "an academic year", semesters: "a semester", classes: "a class",
  faculty: "an approved faculty account", students: "an approved student account"
};


/* ---------- What each page manages ---------- */

const field = (key, label, type = "text", extra = {}) => ({ key, label, type, ...extra });
const SEMESTER_NAMES = ["1st Semester", "2nd Semester", "Summer"];

const MODELS = {
  departments: {
    title: "Departments",
    fields: [field("code", "Code"), field("name", "Name")],
    columns: [["Code", (r) => r.code], ["Name", (r) => r.name]],
    unique: "code",
    refs: [["courses", "departmentId"]]
  },
  courses: {
    title: "Courses",
    fields: [
      field("code", "Code"), field("name", "Name"),
      field("departmentId", "Department", "select", { source: "departments" })
    ],
    columns: [
      ["Code", (r) => r.code], ["Name", (r) => r.name],
      ["Department", (r) => lookup("departments", r.departmentId)]
    ],
    unique: "code",
    refs: [["subjects", "courseId"]]
  },
  subjects: {
    title: "Subjects",
    fields: [
      field("code", "Code"), field("name", "Name"),
      field("units", "Units", "number"),
      field("courseId", "Course", "select", { source: "courses" })
    ],
    columns: [
      ["Code", (r) => r.code], ["Name", (r) => r.name],
      ["Units", (r) => r.units], ["Course", (r) => lookup("courses", r.courseId)]
    ],
    unique: "code",
    refs: [["classes", "subjectId"]]
  },
  years: {
    title: "Academic years",
    fields: [field("name", "Academic year (example: 2026-2027)")],
    columns: [["Academic year", (r) => r.name]],
    unique: "name",
    refs: [["semesters", "academicYearId"]]
  },
  semesters: {
    title: "Semesters",
    fields: [
      field("name", "Semester", "select", { options: SEMESTER_NAMES }),
      field("academicYearId", "Academic year", "select", { source: "years" })
    ],
    columns: [
      ["Semester", (r) => r.name],
      ["Academic year", (r) => lookup("years", r.academicYearId)]
    ],
    check: (rec, id) =>
      data.semesters.some((s) => s.id !== id && s.name === rec.name &&
        s.academicYearId === rec.academicYearId)
        ? "That semester already exists for this academic year." : "",
    refs: [["classes", "semesterId"]]
  },
  classes: {
    title: "Classes",
    fields: [
      field("subjectId", "Subject", "select", { source: "subjects" }),
      field("facultyId", "Faculty", "select", { source: "faculty" }),
      field("semesterId", "Semester", "select", { source: "semesters" }),
      field("section", "Section"),
      field("schedule", "Schedule (example: MWF 8:00-9:00 AM)"),
      field("room", "Room", "text", { optional: true })
    ],
    columns: [
      ["Subject", (r) => lookup("subjects", r.subjectId)],
      ["Faculty", (r) => lookup("faculty", r.facultyId)],
      ["Semester", (r) => lookup("semesters", r.semesterId)],
      ["Section", (r) => r.section],
      ["Schedule", (r) => r.schedule],
      ["Room", (r) => r.room || "-"]
    ],
    check: (rec, id) =>
      data.classes.some((c) => c.id !== id && c.subjectId === rec.subjectId &&
        c.semesterId === rec.semesterId &&
        c.section.toLowerCase() === rec.section.toLowerCase())
        ? "That class (subject, section, semester) already exists." : "",
    refs: [["enrollments", "classId"]]
  },
  enrollments: {
    title: "Enrollment",
    noEdit: true,
    fields: [
      field("studentId", "Student", "select", { source: "students" }),
      field("classId", "Class", "select", { source: "classes" })
    ],
    columns: [
      ["Student", (r) => lookup("students", r.studentId)],
      ["Class", (r) => lookup("classes", r.classId)],
      ["Schedule", (r) => find("classes", r.classId)?.schedule || "-"]
    ],
    check: (rec) =>
      data.enrollments.some((e) => e.studentId === rec.studentId && e.classId === rec.classId)
        ? "This student is already enrolled in that class." : "",
    refs: []
  }
};


/* ---------- Access check ---------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) return goLogin();
  if (me) return;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const info = snap.exists() ? snap.data() : null;
    const allowed = user.emailVerified && info &&
                    info.role === "admin" && info.status === "active";
    if (!allowed) {
      await signOut(auth);
      return goLogin();
    }
    me = { uid: user.uid, ...info };
    await start();
  } catch (error) {
    await signOut(auth).catch(() => {});
    goLogin();
  }
});

async function start() {
  $("#profileBtn").textContent = me.name.split(" ")[0];
  $("#profileInfo").textContent = `${me.name} (${me.email})`;
  await loadAll();
  $("#loading").remove();
  $("#app").hidden = false;
  show("departments");
  watchIdle();
}

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


/* ---------- Loading data ---------- */

async function loadAll() {
  const lists = await Promise.all(
    Object.entries(COLLECTIONS).map(async ([key, col]) => {
      const snap = await getDocs(collection(db, col));
      return [key, snap.docs.map((d) => ({ id: d.id, ...d.data() }))];
    })
  );
  lists.forEach(([key, list]) => { data[key] = list; });

  const usersSnap = await getDocs(collection(db, "users"));
  const active = usersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.status === "active");
  data.faculty = active.filter((u) => u.role === "faculty");
  data.students = active.filter((u) => u.role === "student");

  // Sort every list by its label
  for (const key of Object.keys(LABEL)) {
    data[key].sort((a, b) => LABEL[key](a).localeCompare(LABEL[key](b)));
  }
}


/* ---------- Pages ---------- */

function show(name) {
  view = name === "enrollment" ? "enrollments" : name;
  const model = MODELS[view];

  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === name)
  );
  $("#viewTitle").textContent = model.title;
  $("#sidebar").classList.remove("open");

  const head = model.columns.map(([label]) => `<th>${label}</th>`).join("");
  const rows = data[view].map((record) => {
    const cells = model.columns
      .map(([, get]) => `<td>${esc(get(record))}</td>`).join("");
    const edit = model.noEdit ? "" :
      `<button type="button" class="btn sm ghost" data-act="edit" data-id="${esc(record.id)}">Edit</button>`;
    return `<tr>${cells}<td><div class="actions">${edit}
      <button type="button" class="btn sm danger" data-act="delete" data-id="${esc(record.id)}">Delete</button>
    </div></td></tr>`;
  }).join("");

  const empty = `<tr><td colspan="${model.columns.length + 1}" class="muted">Nothing here yet.</td></tr>`;

  $("#view").innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3>${model.title}</h3>
        <button type="button" class="btn sm" data-act="add">+ Add</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>${head}<th>Actions</th></tr></thead>
        <tbody>${rows || empty}</tbody>
      </table></div>
    </div>`;
}


/* ---------- Add / edit form ---------- */

function fieldHTML(fd, value) {
  let input;
  if (fd.type === "select") {
    const choices = fd.options
      ? fd.options.map((o) => [o, o])
      : data[fd.source].map((r) => [r.id, LABEL[fd.source](r)]);
    input = `<select name="${fd.key}"><option value="">Select...</option>` +
      choices.map(([v, l]) =>
        `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`
      ).join("") + "</select>";
  } else {
    const range = fd.type === "number" ? 'min="1" max="12"' : "";
    input = `<input name="${fd.key}" type="${fd.type}" value="${esc(value ?? "")}" ${range}>`;
  }
  const optional = fd.optional ? " (optional)" : "";
  return `<div><label>${fd.label}${optional}</label>${input}</div>`;
}

function openForm(id = null) {
  const model = MODELS[view];

  // A dropdown with no choices means a parent record is missing
  const missing = model.fields.find((f) => f.source && !data[f.source].length);
  if (missing) {
    return toast(`Add ${NEEDS[missing.source]} first.`, "error");
  }

  const record = id ? find(view, id) : null;
  editing = { key: view, id };
  $("#formTitle").textContent = `${record ? "Edit" : "Add"} - ${model.title}`;
  $("#formFields").innerHTML =
    model.fields.map((f) => fieldHTML(f, record ? record[f.key] : "")).join("");
  $("#formError").textContent = "";
  $("#formBox").showModal();
}

async function saveForm(event) {
  event.preventDefault();
  const model = MODELS[editing.key];
  const form = new FormData(event.target);
  const record = {};
  const fail = (message) => { $("#formError").textContent = message; };

  for (const fd of model.fields) {
    let value = String(form.get(fd.key) ?? "").trim();
    if (!value && !fd.optional) return fail(`${fd.label} is required.`);
    if (fd.type === "number") {
      value = Number(value);
      if (!(value >= 1 && value <= 12)) return fail("Units must be from 1 to 12.");
    }
    record[fd.key] = value;
  }

  if (model.unique) {
    const same = data[editing.key].some((r) => r.id !== editing.id &&
      String(r[model.unique]).toLowerCase() === String(record[model.unique]).toLowerCase());
    if (same) return fail(`That ${model.unique} is already used.`);
  }
  if (model.check) {
    const problem = model.check(record, editing.id);
    if (problem) return fail(problem);
  }

  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const col = COLLECTIONS[editing.key];
    if (editing.id) {
      await updateDoc(doc(db, col, editing.id), { ...record, updatedAt: serverTimestamp() });
    } else {
      await setDoc(doc(collection(db, col)), { ...record, createdAt: serverTimestamp() });
    }
    await logAction(editing.id ? "updated" : "added", `${model.title}: ${Object.values(record)[0]}`);
    $("#formBox").close();
    toast("Saved");
    await loadAll();
    show(view === "enrollments" ? "enrollment" : view);
  } catch (error) {
    fail("Could not save. Check your connection and try again.");
  } finally {
    button.disabled = false;
  }
}

async function deleteRecord(id) {
  const model = MODELS[view];
  const record = find(view, id);
  if (!record) return;

  // Block deleting records that are still in use
  for (const [listKey, fieldName] of model.refs) {
    const count = data[listKey].filter((r) => r[fieldName] === id).length;
    if (count) {
      return toast(`Cannot delete: still used by ${count} ${listKey}.`, "error");
    }
  }

  if (!(await confirmBox(`Delete ${LABEL[view] ? LABEL[view](record) : "this record"}?`))) return;
  await deleteDoc(doc(db, COLLECTIONS[view], id));
  await logAction("deleted", `${model.title}: ${Object.values(record).find((v) => typeof v === "string") || id}`);
  toast("Deleted");
  await loadAll();
  show(view === "enrollments" ? "enrollment" : view);
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
$("#formCancel").addEventListener("click", () => $("#formBox").close());
$("#recordForm").addEventListener("submit", saveForm);

$("#view").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const { act, id } = button.dataset;

  try {
    if (act === "add") openForm();
    if (act === "edit") openForm(id);
    if (act === "delete") await deleteRecord(id);
  } catch (error) {
    toast("Action failed. Please try again.", "error");
  }
});
/* ---------- Subjects by course, year level and semester ---------- */

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];
const TERMS = ["1st Semester", "2nd Semester", "Summer"];

// The label also sorts the list: course, then year, then semester, then code
LABEL.subjects = (r) => {
  const course = find("courses", r.courseId);
  return `${course ? course.code : "?"} | ${r.yearLevel || "-"} | ${r.term || "-"} | ${r.code} - ${r.name}`;
};

MODELS.subjects = {
  title: "Subjects",
  fields: [
    field("courseId", "Course", "select", { source: "courses" }),
    field("yearLevel", "Year level", "select", { options: YEAR_LEVELS }),
    field("term", "Semester", "select", { options: TERMS }),
    field("code", "Code"),
    field("name", "Name"),
    field("units", "Units", "number")
  ],
  columns: [
    ["Course", (r) => find("courses", r.courseId)?.code || "?"],
    ["Year", (r) => r.yearLevel || "-"],
    ["Semester", (r) => r.term || "-"],
    ["Code", (r) => r.code],
    ["Name", (r) => r.name],
    ["Units", (r) => r.units]
  ],
  // The same code is allowed in different courses, but not twice in one course
  check: (rec, id) =>
    data.subjects.some((s) => s.id !== id && s.courseId === rec.courseId &&
      s.code.toLowerCase() === rec.code.toLowerCase())
      ? "That subject code already exists in this course." : "",
  refs: [["classes", "subjectId"]]
};
