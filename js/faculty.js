/* faculty.js - Faculty dashboard (profile, classes, class lists) */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut, EmailAuthProvider,
  reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, collection, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (selector) => document.querySelector(selector);
const LOGIN_PAGE = "index1.html";

let me = null;        // the signed-in faculty account
let profile = {};     // faculty profile details
let myClasses = [];   // assigned classes with subject, semester, student ids

const TITLES = {
  profile: "My profile",
  classes: "My classes",
  roster: "Class list",
  grades: "Grades",
  attendance: "Attendance",
  announcements: "Announcements",
  account: "Account"
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
    const info = snap.exists() ? snap.data() : null;
    const allowed = user.emailVerified && info &&
                    info.role === "faculty" && info.status === "active";
    if (!allowed) {
      await signOut(auth);
      return goLogin();
    }
    me = { uid: user.uid, ...info };
    await start();
  } catch (error) {
    $("#loading").textContent =
      "Error: " + (error.code || error.message) + " - send a photo.";
  }
});

async function start() {
  await loadData();
  $("#profileBtn").textContent = profile.firstName || me.name.split(" ")[0];
  $("#profileInfo").textContent = `${me.name} (${me.email})`;
  $("#loading").remove();
  $("#app").hidden = false;
  show("profile");
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

async function loadData() {
  const asMap = (snap) =>
    Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  const [profileSnap, classSnap, subjectSnap, semesterSnap, yearSnap] =
    await Promise.all([
      getDoc(doc(db, "faculty", me.uid)),
      getDocs(query(collection(db, "classes"), where("facultyId", "==", me.uid))),
      getDocs(collection(db, "subjects")),
      getDocs(collection(db, "semesters")),
      getDocs(collection(db, "academicYears"))
    ]);

  profile = profileSnap.exists() ? profileSnap.data() : {};
  const subjects = asMap(subjectSnap);
  const semesters = asMap(semesterSnap);
  const years = asMap(yearSnap);

  myClasses = await Promise.all(classSnap.docs.map(async (d) => {
    const c = d.data();
    const subject = subjects[c.subjectId] || {};
    const semester = semesters[c.semesterId] || {};
    const year = years[semester.academicYearId] || {};

    // Students enrolled in this class
    const enrolled = await getDocs(
      query(collection(db, "enrollments"), where("classId", "==", d.id))
    );

    return {
      id: d.id,
      code: subject.code || "?",
      name: subject.name || "(deleted subject)",
      units: subject.units ?? "-",
      section: c.section,
      schedule: c.schedule,
      room: c.room || "-",
      term: semester.name ? `${semester.name} ${year.name || ""}`.trim() : "-",
      studentIds: enrolled.docs.map((e) => e.data().studentId)
    };
  }));

  myClasses.sort((a, b) => a.term.localeCompare(b.term) || a.code.localeCompare(b.code));
}


/* ---------- Pages ---------- */

function show(name, extra) {
  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === (name === "roster" ? "classes" : name))
  );
  $("#viewTitle").textContent = TITLES[name];
  $("#sidebar").classList.remove("open");
  if (name === "roster") return showRoster(extra);
  $("#view").innerHTML = render[name]();
}

const item = (label, value) =>
  `<div><small>${label}</small><b>${esc(value || "-")}</b></div>`;

const empty = (text) => `<div class="panel"><p class="muted">${text}</p></div>`;

const render = {
  profile() {
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || me.name;
    const photo = String(profile.photo || "").startsWith("data:image/")
      ? `<img class="avatar" src="${esc(profile.photo)}" alt="Profile picture">`
      : "";
    return `
      <div class="panel">
        ${photo}
        <div class="profile-grid">
          ${item("Full name", fullName)}
          ${item("Faculty ID", profile.facultyId || me.roleId)}
          ${item("Department", profile.department)}
          ${item("Position", profile.position)}
          ${item("Email", me.email)}
          ${item("Contact number", profile.contact)}
          ${item("Account status", me.status)}
        </div>
      </div>`;
  },

  classes() {
    if (!myClasses.length) {
      return empty("No classes are assigned to you yet. The administrator assigns classes in the Academics page.");
    }
    const rows = myClasses.map((c) => `<tr>
      <td>${esc(c.code)}</td>
      <td>${esc(c.name)}</td>
      <td>${esc(c.section)}</td>
      <td>${esc(c.schedule)}</td>
      <td>${esc(c.room)}</td>
      <td>${esc(c.term)}</td>
      <td>${c.studentIds.length}</td>
      <td><button type="button" class="btn sm" data-act="roster" data-id="${esc(c.id)}">Students</button></td>
    </tr>`).join("");
    return `
      <div class="panel">
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Subject</th><th>Section</th><th>Schedule</th><th>Room</th><th>Semester</th><th>Students</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  },

  grades() {
    return empty("Grade encoding comes in the next update.");
  },

  attendance() {
    return empty("Attendance management comes in a later update.");
  },

  announcements() {
    return empty("Announcements come in a later update.");
  },

  account() {
    return `
      <div class="panel">
        <h3>Change password</h3>
        <form id="pwForm" class="pw-form" novalidate>
          <div><label for="pwOld">Current password</label>
            <input id="pwOld" type="password" autocomplete="current-password"></div>
          <div><label for="pwNew">New password</label>
            <input id="pwNew" type="password" autocomplete="new-password"></div>
          <div><label for="pwNew2">Confirm new password</label>
            <input id="pwNew2" type="password" autocomplete="new-password"></div>
          <p id="pwError" style="color:var(--danger);min-height:1.2em;margin:0"></p>
          <button type="submit" class="btn">Update password</button>
        </form>
      </div>`;
  }
};


/* ---------- Class list ---------- */

async function showRoster(classId) {
  const c = myClasses.find((x) => x.id === classId);
  if (!c) return show("classes");

  $("#view").innerHTML = '<p class="muted">Loading students...</p>';

  try {
    const students = await Promise.all(c.studentIds.map(async (id) => {
      const snap = await getDoc(doc(db, "students", id));
      return snap.exists() ? { id, ...snap.data() } : { id, firstName: "(removed account)" };
    }));
    students.sort((a, b) => String(a.lastName || "").localeCompare(String(b.lastName || "")));

    const rows = students.map((s) => `<tr>
      <td>${esc(s.studentId)}</td>
      <td>${esc([s.lastName, s.firstName].filter(Boolean).join(", "))}</td>
      <td>${esc(s.course)}</td>
      <td>${esc(s.yearLevel)}</td>
      <td>${esc(s.section)}</td>
      <td>${esc(s.email)}</td>
    </tr>`).join("");

    $("#view").innerHTML = `
      <div class="panel">
        <p><button type="button" class="btn sm ghost" data-act="back">&larr; My classes</button></p>
        <h3>${esc(c.code)} - ${esc(c.name)}</h3>
        <p class="muted">Section ${esc(c.section)} | ${esc(c.schedule)} | ${esc(c.term)} | ${students.length} student(s)</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Student ID</th><th>Name</th><th>Course</th><th>Year</th><th>Section</th><th>Email</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="muted">No students enrolled yet.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  } catch (error) {
    $("#view").innerHTML = '<p class="muted">Could not load the class list. Try again.</p>';
  }
}


/* ---------- Change password ---------- */

async function changePassword(event) {
  event.preventDefault();
  const oldPass = $("#pwOld").value;
  const newPass = $("#pwNew").value;
  const confirmPass = $("#pwNew2").value;
  const fail = (message) => { $("#pwError").textContent = message; };
  fail("");

  if (!oldPass || !newPass) return fail("Fill in all the fields.");
  const strong = newPass.length >= 8 && /[A-Za-z]/.test(newPass) && /\d/.test(newPass);
  if (!strong) return fail("Use at least 8 characters with a letter and a number.");
  if (newPass !== confirmPass) return fail("The new passwords do not match.");
  if (newPass === oldPass) return fail("Choose a different password.");

  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, oldPass));
    await updatePassword(user, newPass);
    event.target.reset();
    toast("Password updated");
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Your current password is incorrect.",
      "auth/wrong-password": "Your current password is incorrect.",
      "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
      "auth/weak-password": "Choose a stronger password."
    };
    fail(messages[error.code] || "Could not update the password. Try again.");
  } finally {
    button.disabled = false;
  }
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

$("#view").addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  if (button.dataset.act === "roster") show("roster", button.dataset.id);
  if (button.dataset.act === "back") show("classes");
});
$("#view").addEventListener("submit", (event) => {
  if (event.target.id === "pwForm") changePassword(event);
});
/* ---------- Grades (Module 4B) ---------- */

const { writeBatch, setDoc, serverTimestamp } = await import(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
);

const PASSING = 75;

document.head.append(Object.assign(document.createElement("style"), {
  textContent:
    ".gin{width:84px;padding:7px;border:1.5px solid var(--line);border-radius:8px;font:inherit}" +
    ".gin.bad{border-color:var(--danger)}"
}));

// The Grades page: a class picker and an empty sheet
render.grades = () => {
  if (!myClasses.length) return empty("No classes are assigned to you yet.");
  const options = myClasses.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.code)} - ${esc(c.name)} (${esc(c.section)}, ${esc(c.term)})</option>`
  ).join("");
  return `
    <div class="panel">
      <div class="toolbar">
        <select id="gradeClass"><option value="">Choose a class...</option>${options}</select>
      </div>
      <p class="muted">Enter grades from 0 to 100. Passing is ${PASSING}. The average and remarks are computed automatically.</p>
      <div id="gradeSheet"></div>
    </div>`;
};

// Reads one grade box: null if empty, NaN if invalid, otherwise the number
function gradeValue(input) {
  const text = input.value.trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : NaN;
}

// Updates the average and remarks of one row
function updateRow(row) {
  const boxes = [...row.querySelectorAll(".gin")];
  const values = boxes.map(gradeValue);
  boxes.forEach((box, i) => box.classList.toggle("bad", Number.isNaN(values[i])));

  let average = "-";
  let remarks = "-";
  if (values.some(Number.isNaN)) {
    remarks = "Invalid";
  } else if (values.some((v) => v === null)) {
    remarks = values.every((v) => v === null) ? "-" : "Incomplete";
  } else {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    average = mean.toFixed(2);
    remarks = mean >= PASSING ? "Passed" : "Failed";
  }
  row.querySelector(".avg").textContent = average;
  row.querySelector(".rem").textContent = remarks;
}

// Shows the grade sheet of the chosen class
async function loadSheet(classId) {
  const box = $("#gradeSheet");
  const c = myClasses.find((x) => x.id === classId);
  if (!c) { box.innerHTML = ""; return; }
  box.innerHTML = '<p class="muted">Loading...</p>';

  try {
    const [gradeSnap, students] = await Promise.all([
      getDocs(query(
        collection(db, "grades"),
        where("classId", "==", classId),
        where("facultyId", "==", me.uid)
      )),
      Promise.all(c.studentIds.map(async (id) => {
        const snap = await getDoc(doc(db, "students", id));
        return { id, ...(snap.exists() ? snap.data() : { firstName: "(removed account)" }) };
      }))
    ]);

    const saved = {};
    gradeSnap.docs.forEach((d) => { saved[d.data().studentId] = d.data(); });
    students.sort((a, b) => String(a.lastName || "").localeCompare(String(b.lastName || "")));

    if (!students.length) {
      box.innerHTML = '<p class="muted">No students are enrolled in this class yet.</p>';
      return;
    }

    const input = (key, grade) =>
      `<td><input class="gin" data-k="${key}" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(grade?.[key] ?? "")}"></td>`;

    const rows = students.map((s) => {
      const name = [s.lastName, s.firstName].filter(Boolean).join(", ");
      const grade = saved[s.id];
      return `<tr data-student="${esc(s.id)}">
        <td>${esc(s.studentId)}</td>
        <td>${esc(name)}</td>
        ${input("prelim", grade)}${input("midterm", grade)}${input("final", grade)}
        <td class="avg">-</td>
        <td class="rem">-</td>
      </tr>`;
    }).join("");

    box.dataset.classId = classId;
    box.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Prelim</th><th>Midterm</th><th>Final</th><th>Average</th><th>Remarks</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p><button type="button" class="btn" data-act="save-grades">Save grades</button></p>`;
    box.querySelectorAll("tr[data-student]").forEach(updateRow);
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load the grade sheet. Try again.</p>';
  }
}

// Saves the whole class in one go
async function saveGrades(button) {
  const box = $("#gradeSheet");
  const classId = box.dataset.classId;
  const c = myClasses.find((x) => x.id === classId);
  if (!c) return;

  const batch = writeBatch(db);
  for (const row of box.querySelectorAll("tr[data-student]")) {
    const [prelim, midterm, fin] = [...row.querySelectorAll(".gin")].map(gradeValue);
    if ([prelim, midterm, fin].some(Number.isNaN)) {
      return toast("Grades must be numbers from 0 to 100.", "error");
    }
    batch.set(doc(db, "grades", `${classId}_${row.dataset.student}`), {
      classId,
      studentId: row.dataset.student,
      facultyId: me.uid,
      prelim,
      midterm,
      final: fin,
      updatedAt: serverTimestamp()
    });
  }

  button.disabled = true;
  try {
    await batch.commit();
    await setDoc(doc(collection(db, "auditLogs")), {
      actorUid: me.uid,
      actorName: me.name,
      action: "saved grades",
      target: `${c.code} ${c.section}`,
      at: serverTimestamp()
    }).catch(() => {});
    toast("Grades saved");
  } catch (error) {
    toast("Could not save the grades. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

// Events for the grade sheet
$("#view").addEventListener("change", (event) => {
  if (event.target.id === "gradeClass") loadSheet(event.target.value);
});
$("#view").addEventListener("input", (event) => {
  if (event.target.classList.contains("gin")) updateRow(event.target.closest("tr"));
});
$("#view").addEventListener("click", (event) => {
  const button = event.target.closest('[data-act="save-grades"]');
  if (button) saveGrades(button);
});
