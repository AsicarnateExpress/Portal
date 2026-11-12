/* student.js - Student dashboard */

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

let me = null;        // the signed-in student's account
let profile = {};     // the student's profile details
let myClasses = [];   // enrolled classes with subject and semester details
let view = "profile";

const TITLES = {
  profile: "My profile",
  classes: "My classes",
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
                    info.role === "student" && info.status === "active";
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
  $("#profileBtn").textContent = (profile.firstName || me.name.split(" ")[0]);
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

  const [profileSnap, enrollSnap, classSnap, subjectSnap, semesterSnap, yearSnap] =
    await Promise.all([
      getDoc(doc(db, "students", me.uid)),
      getDocs(query(collection(db, "enrollments"), where("studentId", "==", me.uid))),
      getDocs(collection(db, "classes")),
      getDocs(collection(db, "subjects")),
      getDocs(collection(db, "semesters")),
      getDocs(collection(db, "academicYears"))
    ]);

  profile = profileSnap.exists() ? profileSnap.data() : {};

  const classes = asMap(classSnap);
  const subjects = asMap(subjectSnap);
  const semesters = asMap(semesterSnap);
  const years = asMap(yearSnap);

  myClasses = enrollSnap.docs
    .map((d) => classes[d.data().classId])
    .filter(Boolean)
    .map((c) => {
      const subject = subjects[c.subjectId] || {};
      const semester = semesters[c.semesterId] || {};
      const year = years[semester.academicYearId] || {};
      return {
        code: subject.code || "?",
        name: subject.name || "(deleted subject)",
        units: subject.units ?? "-",
        section: c.section,
        schedule: c.schedule,
        room: c.room || "-",
        term: semester.name ? `${semester.name} ${year.name || ""}`.trim() : "-"
      };
    })
    .sort((a, b) => a.term.localeCompare(b.term) || a.code.localeCompare(b.code));
}


/* ---------- Pages ---------- */

function show(name) {
  view = name;
  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === name)
  );
  $("#viewTitle").textContent = TITLES[name];
  $("#sidebar").classList.remove("open");
  $("#view").innerHTML = render[name]();
}

const item = (label, value) =>
  `<div><small>${label}</small><b>${esc(value || "-")}</b></div>`;

const empty = (text) => `<div class="panel"><p class="muted">${text}</p></div>`;

const render = {
  profile() {
    const fullName = [profile.firstName, profile.middleName, profile.lastName]
      .filter(Boolean).join(" ") || me.name;
    const photo = String(profile.photo || "").startsWith("data:image/")
      ? `<img class="avatar" src="${esc(profile.photo)}" alt="Profile picture">`
      : "";
    return `
      <div class="panel">
        ${photo}
        <div class="profile-grid">
          ${item("Full name", fullName)}
          ${item("Student ID", profile.studentId || me.roleId)}
          ${item("Course / Program", profile.course)}
          ${item("Year level", profile.yearLevel)}
          ${item("Section", profile.section)}
          ${item("Username", profile.username)}
          ${item("Email", me.email)}
          ${item("Birthday", profile.birthday)}
          ${item("Gender", profile.gender)}
          ${item("Account status", me.status)}
        </div>
      </div>`;
  },

  classes() {
    if (!myClasses.length) {
      return empty("You are not enrolled in any class yet. Your classes appear here after the administrator enrolls you.");
    }
    const units = myClasses.reduce((sum, c) => sum + (Number(c.units) || 0), 0);
    const rows = myClasses.map((c) => `<tr>
      <td>${esc(c.code)}</td>
      <td>${esc(c.name)}</td>
      <td>${esc(c.units)}</td>
      <td>${esc(c.section)}</td>
      <td>${esc(c.schedule)}</td>
      <td>${esc(c.room)}</td>
      <td>${esc(c.term)}</td>
    </tr>`).join("");
    return `
      <div class="panel">
        <p class="muted">${myClasses.length} class(es), ${units} total units</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Section</th><th>Schedule</th><th>Room</th><th>Semester</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  },

  grades() {
    return empty("No grades yet. Your grades appear here once your faculty encodes them.");
  },

  attendance() {
    return empty("No attendance records yet.");
  },

  announcements() {
    return empty("No announcements yet.");
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
          <p id="pwError" class="form-error" style="color:var(--danger);min-height:1.2em;margin:0"></p>
          <button type="submit" class="btn">Update password</button>
        </form>
      </div>`;
  }
};


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
    const credential = EmailAuthProvider.credential(user.email, oldPass);
    await reauthenticateWithCredential(user, credential);
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
$("#view").addEventListener("submit", (event) => {
  if (event.target.id === "pwForm") changePassword(event);
});
/* ---------- Grades (Module 4B) ---------- */

const PASSING = 75;

// The Grades page: shows a loading box, then fills it in
render.grades = () => {
  setTimeout(loadGrades, 0);
  return '<div id="gradeBox" class="panel"><p class="muted">Loading grades...</p></div>';
};

const shown = (value) =>
  value === null || value === undefined ? "-" : String(value);

async function loadGrades() {
  const box = $("#gradeBox");
  if (!box) return;

  const asMap = (snap) =>
    Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  try {
    const [gradeSnap, classSnap, subjectSnap, semesterSnap, yearSnap] =
      await Promise.all([
        getDocs(query(collection(db, "grades"), where("studentId", "==", me.uid))),
        getDocs(collection(db, "classes")),
        getDocs(collection(db, "subjects")),
        getDocs(collection(db, "semesters")),
        getDocs(collection(db, "academicYears"))
      ]);

    const classes = asMap(classSnap);
    const subjects = asMap(subjectSnap);
    const semesters = asMap(semesterSnap);
    const years = asMap(yearSnap);

    const grades = gradeSnap.docs.map((d) => {
      const g = d.data();
      const c = classes[g.classId] || {};
      const subject = subjects[c.subjectId] || {};
      const semester = semesters[c.semesterId] || {};
      const year = years[semester.academicYearId] || {};
      const values = [g.prelim, g.midterm, g.final];
      const numbers = values.filter((v) => typeof v === "number");

      let average = "-";
      let remarks = numbers.length ? "Incomplete" : "-";
      if (numbers.length === 3) {
        const mean = numbers.reduce((sum, v) => sum + v, 0) / 3;
        average = mean.toFixed(2);
        remarks = mean >= PASSING ? "Passed" : "Failed";
      }

      return {
        subject: `${subject.code || "?"} - ${subject.name || "(deleted subject)"}`,
        term: semester.name ? `${semester.name} ${year.name || ""}`.trim() : "-",
        prelim: g.prelim,
        midterm: g.midterm,
        final: g.final,
        average,
        remarks,
        hasAny: numbers.length > 0
      };
    }).filter((g) => g.hasAny)
      .sort((a, b) => a.term.localeCompare(b.term) || a.subject.localeCompare(b.subject));

    if (!grades.length) {
      box.innerHTML = '<p class="muted">No grades yet. Your grades appear here once your faculty encodes them.</p>';
      return;
    }

    const pill = { Passed: "active", Failed: "deactivated", Incomplete: "pending" };
    const rows = grades.map((g) => `<tr>
      <td>${esc(g.subject)}</td>
      <td>${esc(g.term)}</td>
      <td>${esc(shown(g.prelim))}</td>
      <td>${esc(shown(g.midterm))}</td>
      <td>${esc(shown(g.final))}</td>
      <td><b>${esc(g.average)}</b></td>
      <td><span class="pill ${pill[g.remarks] || ""}">${esc(g.remarks)}</span></td>
    </tr>`).join("");

    box.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th>Semester</th><th>Prelim</th><th>Midterm</th><th>Final</th><th>Average</th><th>Remarks</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="muted">Passing average: ${PASSING}</p>`;
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load your grades. Try again.</p>';
  }
}
/* ---------- Attendance (Module 4C) ---------- */

render.attendance = () => {
  setTimeout(loadAttendance, 0);
  return '<div id="attBox" class="panel"><p class="muted">Loading attendance...</p></div>';
};

const STATUS_PILL = {
  present: "active", late: "pending", excused: "pending", absent: "deactivated"
};
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

async function loadAttendance() {
  const box = $("#attBox");
  if (!box) return;

  const asMap = (snap) =>
    Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  try {
    const [attSnap, classSnap, subjectSnap] = await Promise.all([
      getDocs(query(collection(db, "attendance"), where("studentId", "==", me.uid))),
      getDocs(collection(db, "classes")),
      getDocs(collection(db, "subjects"))
    ]);
    const classes = asMap(classSnap);
    const subjects = asMap(subjectSnap);

    const records = attSnap.docs.map((d) => {
      const a = d.data();
      const subject = subjects[(classes[a.classId] || {}).subjectId] || {};
      return {
        key: a.classId,
        date: a.date,
        status: a.status,
        subject: `${subject.code || "?"} - ${subject.name || "(deleted subject)"}`
      };
    });

    if (!records.length) {
      box.innerHTML = '<p class="muted">No attendance records yet. They appear here once your faculty marks attendance.</p>';
      return;
    }

    // Totals for each subject
    const summary = {};
    records.forEach((r) => {
      const row = summary[r.key] || (summary[r.key] =
        { subject: r.subject, present: 0, late: 0, absent: 0, excused: 0 });
      row[r.status] = (row[r.status] || 0) + 1;
    });

    const summaryRows = Object.values(summary).map((s) => {
      const counted = s.present + s.late + s.absent;
      const rate = counted ? Math.round(((s.present + s.late) / counted) * 100) + "%" : "-";
      return `<tr>
        <td>${esc(s.subject)}</td>
        <td>${s.present}</td><td>${s.late}</td><td>${s.absent}</td><td>${s.excused}</td>
        <td><b>${rate}</b></td>
      </tr>`;
    }).join("");

    const recentRows = records
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30)
      .map((r) => `<tr>
        <td>${esc(r.date)}</td>
        <td>${esc(r.subject)}</td>
        <td><span class="pill ${STATUS_PILL[r.status] || ""}">${esc(capitalize(r.status))}</span></td>
      </tr>`).join("");

    box.innerHTML = `
      <h3>Summary</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Rate</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table></div>
      <p class="muted">Rate counts present and late days; excused days are left out.</p>
      <h3>Recent records</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table></div>`;
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load your attendance. Try again.</p>';
  }
}
/* ---------- Announcements and materials (Module 4D) ---------- */

TITLES.materials = "Learning materials";

// Add the "Learning materials" button to the menu
{
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.dataset.view = "materials";
  menuButton.textContent = "Learning materials";
  $("#nav").insertBefore(menuButton, $('#nav [data-view="announcements"]'));
}

const whenText = (stamp) => (stamp?.toDate ? stamp.toDate().toLocaleString() : "-");
const newestFirst = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);


/* ----- Announcements ----- */

render.announcements = () => {
  setTimeout(loadAnnouncements, 0);
  return '<div id="annBox"><p class="muted">Loading announcements...</p></div>';
};

async function loadAnnouncements() {
  const box = $("#annBox");
  if (!box) return;

  try {
    const snap = await getDocs(query(
      collection(db, "announcements"),
      where("audience", "in", ["all", "students"])
    ));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst);

    if (!list.length) {
      box.innerHTML = '<div class="panel"><p class="muted">No announcements yet.</p></div>';
      return;
    }

    box.innerHTML = list.map((a) => `
      <div class="panel" style="margin-bottom:12px">
        <h3 style="margin-bottom:4px">${esc(a.title)}</h3>
        <p class="muted" style="margin:0 0 8px">
          ${esc(a.authorName)} (${esc(a.authorRole)}) | ${esc(whenText(a.createdAt))}
        </p>
        <p style="white-space:pre-wrap;margin:0">${esc(a.body)}</p>
      </div>`).join("");
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load announcements. Try again.</p>';
  }
}


/* ----- Learning materials ----- */

render.materials = () => {
  setTimeout(loadMaterials, 0);
  return '<div id="matBox" class="panel"><p class="muted">Loading materials...</p></div>';
};

async function loadMaterials() {
  const box = $("#matBox");
  if (!box) return;

  try {
    const [enrollSnap, classSnap, subjectSnap, materialSnap] = await Promise.all([
      getDocs(query(collection(db, "enrollments"), where("studentId", "==", me.uid))),
      getDocs(collection(db, "classes")),
      getDocs(collection(db, "subjects")),
      getDocs(collection(db, "materials"))
    ]);

    const mine = new Set(enrollSnap.docs.map((d) => d.data().classId));
    const classes = Object.fromEntries(classSnap.docs.map((d) => [d.id, d.data()]));
    const subjects = Object.fromEntries(subjectSnap.docs.map((d) => [d.id, d.data()]));

    const items = materialSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => mine.has(m.classId))
      .sort(newestFirst);

    if (!items.length) {
      box.innerHTML = '<p class="muted">No learning materials yet. Links your faculty adds for your classes appear here.</p>';
      return;
    }

    const rows = items.map((m) => {
      const subject = subjects[(classes[m.classId] || {}).subjectId] || {};
      return `<tr>
        <td>${esc(subject.code || "?")} - ${esc(subject.name || "(deleted subject)")}</td>
        <td><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.title)}</a></td>
        <td>${esc(m.description)}</td>
        <td>${esc(whenText(m.createdAt))}</td>
      </tr>`;
    }).join("");

    box.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th>Material</th><th>Description</th><th>Added</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load the materials. Try again.</p>';
  }
}
/* ---------- Professor's enhancements ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/student.js */

import { updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

TITLES.schedule = "Schedule";

// Add the "Schedule" button to the menu
{
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.view = "schedule";
  button.textContent = "Schedule";
  $("#nav").insertBefore(button, $('#nav [data-view="grades"]'));
}


const SCALE = [
  [97, "1.00", "Excellent", "97 - 100"],
  [94, "1.25", "Superior", "94 - 96"],
  [91, "1.50", "Very Good", "91 - 93"],
  [88, "1.75", "Good", "88 - 90"],
  [85, "2.00", "Meritorious", "85 - 87"],
  [82, "2.25", "Very Satisfactory", "82 - 84"],
  [79, "2.50", "Satisfactory", "79 - 81"],
  [76, "2.75", "Fairly Satisfactory", "76 - 78"],
  [75, "3.00", "Passing", "75"]
];

// Drops the decimals (the tiny extra only protects against 89.9999999 style errors)
const cut = (number) => Math.floor(number + 1e-9);

function equivalentOf(grade) {
  const whole = cut(grade);
  const row = SCALE.find((r) => whole >= r[0]);
  return row ? { eq: row[1], meaning: row[2] } : { eq: "5.00", meaning: "Failed" };
}


/* ----- Shared data: enrolled classes with teacher, semester and year ----- */

let termData = null;

async function loadTermData() {
  if (termData) return termData;
  const asMap = (snap) =>
    Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  const [enrollSnap, classSnap, subjectSnap, semesterSnap, yearSnap] = await Promise.all([
    getDocs(query(collection(db, "enrollments"), where("studentId", "==", me.uid))),
    getDocs(collection(db, "classes")),
    getDocs(collection(db, "subjects")),
    getDocs(collection(db, "semesters")),
    getDocs(collection(db, "academicYears"))
  ]);
  const classes = asMap(classSnap);
  const subjects = asMap(subjectSnap);
  const semesters = asMap(semesterSnap);
  const years = asMap(yearSnap);

  termData = enrollSnap.docs
    .map((d) => classes[d.data().classId])
    .filter(Boolean)
    .map((c) => {
      const subject = subjects[c.subjectId] || {};
      const semester = semesters[c.semesterId] || {};
      const year = years[semester.academicYearId] || {};
      return {
        classId: c.id,
        code: subject.code || "?",
        name: subject.name || "(deleted subject)",
        units: Number(subject.units) || 0,
        schedule: c.schedule,
        room: c.room || "-",
        teacher: c.facultyName || "-",
        sem: semester.name || "-",
        yearId: semester.academicYearId || "",
        yearName: year.name || "-"
      };
    });
  return termData;
}

// Chosen academic year and semester (shared by Schedule and Grades)
const SEMS = ["1st Semester", "2nd Semester", "Summer"];
const pick = { year: "", sem: "1st Semester" };
let redraw = () => {};

function controls(rows) {
  const years = [...new Map(rows.map((r) => [r.yearId, r.yearName])).entries()]
    .sort((a, b) => b[1].localeCompare(a[1]));
  if (!years.some((y) => y[0] === pick.year)) pick.year = years[0] ? years[0][0] : "";

  const yearBox = `<select id="termYear">${years.map(([id, name]) =>
    `<option value="${esc(id)}" ${id === pick.year ? "selected" : ""}>Academic Year ${esc(name)}</option>`
  ).join("")}</select>`;
  const semButtons = SEMS.map((s) =>
    `<button type="button" class="btn sm ${s === pick.sem ? "" : "ghost"}" data-sem="${esc(s)}">${esc(s)}</button>`
  ).join(" ");
  return `<div class="toolbar">${yearBox}<span class="actions">${semButtons}</span></div>`;
}


/* ----- Schedule (table) ----- */

// "MWF 8:00-9:00 AM" -> days "Mon, Wed, Fri" and time "8:00-9:00 AM"
function splitSchedule(text) {
  const match = String(text || "").trim().match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match) return { days: "-", time: String(text || "-") };
  const names = { M: "Mon", T: "Tue", W: "Wed", H: "Thu", F: "Fri", S: "Sat", U: "Sun" };
  const days = match[1].replace(/th/gi, "H").split("")
    .map((c) => names[c.toUpperCase()] || c).join(", ");
  return { days, time: match[2] };
}

render.schedule = () => {
  setTimeout(loadSchedule, 0);
  return '<div id="schBox" class="panel"><p class="muted">Loading schedule...</p></div>';
};

async function loadSchedule() {
  const box = $("#schBox");
  if (!box) return;
  try {
    const rows = await loadTermData();
    redraw = () => {
      const bar = controls(rows);
      const list = rows.filter((r) => r.yearId === pick.year && r.sem === pick.sem);
      const body = list.map((r) => {
        const s = splitSchedule(r.schedule);
        return `<tr>
          <td>${esc(s.time)}</td><td>${esc(s.days)}</td>
          <td>${esc(r.code)}</td><td>${esc(r.name)}</td>
          <td>${esc(r.room)}</td><td>${esc(r.teacher)}</td>
        </tr>`;
      }).join("");
      box.innerHTML = `${bar}
        <div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Days</th><th>Course code</th><th>Subject</th><th>Room</th><th>Teacher</th></tr></thead>
          <tbody>${body || '<tr><td colspan="6" class="muted">No classes for this semester.</td></tr>'}</tbody>
        </table></div>`;
    };
    redraw();
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load your schedule. Try again.</p>';
  }
}


/* ----- Grades: semester buttons, equivalent, GWA, grade scale ----- */

render.grades = () => {
  setTimeout(loadMyGrades, 0);
  return '<div id="gradeBox" class="panel"><p class="muted">Loading grades...</p></div>';
};

async function loadMyGrades() {
  const box = $("#gradeBox");
  if (!box) return;
  try {
    const [rows, gradeSnap] = await Promise.all([
      loadTermData(),
      getDocs(query(collection(db, "grades"), where("studentId", "==", me.uid)))
    ]);
    const saved = {};
    gradeSnap.docs.forEach((d) => { saved[d.data().classId] = d.data(); });

    // Only subjects with all three grades count; raw = exact average (not rounded)
    const scored = rows.map((r) => {
      const g = saved[r.classId];
      const parts = g ? [g.prelim, g.midterm, g.final] : [];
      const done = parts.length === 3 && parts.every((v) => typeof v === "number");
      return { ...r, raw: done ? parts.reduce((a, b) => a + b, 0) / 3 : null };
    });

    // GWA = average weighted by units, then decimals cut off
    const gwa = (list) => {
      const graded = list.filter((r) => r.raw !== null && r.units > 0);
      const units = graded.reduce((s, r) => s + r.units, 0);
      return units ? graded.reduce((s, r) => s + r.raw * r.units, 0) / units : null;
    };
    const gwaText = (value) =>
      value === null ? "-" : `${cut(value)} (${equivalentOf(value).eq})`;

    const scaleRows = SCALE.map((s) =>
      `<tr><td>${s[1]}</td><td>${s[3]}</td><td>${s[2]}</td></tr>`).join("") +
      "<tr><td>5.00</td><td>Below 75</td><td>Failed</td></tr>";

    redraw = () => {
      const bar = controls(scored);
      const inYear = scored.filter((r) => r.yearId === pick.year);
      const list = inYear.filter((r) => r.sem === pick.sem && r.raw !== null);

      const body = list.map((r) => {
        const eq = equivalentOf(r.raw);
        const passed = cut(r.raw) >= 75;
        return `<tr>
          <td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${r.units}</td>
          <td>${esc(r.teacher)}</td>
          <td><b>${cut(r.raw)}</b></td><td>${eq.eq}</td>
          <td><span class="pill ${passed ? "active" : "deactivated"}">${passed ? "Passed" : "Failed"}</span></td>
        </tr>`;
      }).join("");

      box.innerHTML = `${bar}
        <div class="table-wrap"><table>
          <thead><tr><th>Course code</th><th>Subject</th><th>Units</th><th>Professor</th><th>Grade</th><th>Equivalent</th><th>Remarks</th></tr></thead>
          <tbody>${body || '<tr><td colspan="7" class="muted">No grades yet for this semester.</td></tr>'}</tbody>
        </table></div>
        <p><b>${esc(pick.sem)} GWA:</b> ${gwaText(gwa(inYear.filter((r) => r.sem === pick.sem)))}<br>
        <b>Overall GWA (whole academic year):</b> ${gwaText(gwa(inYear))}</p>
        <p class="muted">Decimals are not rounded: 86.66 is shown as 86. Passing grade: ${PASSING}.</p>
        <h3>Grade scale</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Equivalent</th><th>Grade</th><th>Meaning</th></tr></thead>
          <tbody>${scaleRows}</tbody>
        </table></div>`;
    };
    redraw();
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load your grades. Try again.</p>';
  }
}


/* ----- Attendance: now shows the professor ----- */

render.attendance = () => {
  setTimeout(loadMyAttendance, 0);
  return '<div id="attBox" class="panel"><p class="muted">Loading attendance...</p></div>';
};

async function loadMyAttendance() {
  const box = $("#attBox");
  if (!box) return;
  try {
    const [rows, attSnap] = await Promise.all([
      loadTermData(),
      getDocs(query(collection(db, "attendance"), where("studentId", "==", me.uid)))
    ]);
    const info = Object.fromEntries(rows.map((r) => [r.classId, r]));
    const records = attSnap.docs.map((d) => {
      const a = d.data();
      const c = info[a.classId] || {};
      return {
        key: a.classId,
        date: a.date,
        status: a.status,
        subject: `${c.code || "?"} - ${c.name || "(deleted subject)"}`,
        teacher: c.teacher || "-"
      };
    });

    if (!records.length) {
      box.innerHTML = '<p class="muted">No attendance records yet. They appear here once your faculty marks attendance.</p>';
      return;
    }

    const summary = {};
    records.forEach((r) => {
      const row = summary[r.key] || (summary[r.key] =
        { subject: r.subject, teacher: r.teacher, present: 0, late: 0, absent: 0, excused: 0 });
      row[r.status] = (row[r.status] || 0) + 1;
    });
    const summaryRows = Object.values(summary).map((s) => {
      const counted = s.present + s.late + s.absent;
      const rate = counted ? Math.floor(((s.present + s.late) / counted) * 100) + "%" : "-";
      return `<tr>
        <td>${esc(s.subject)}</td><td>${esc(s.teacher)}</td>
        <td>${s.present}</td><td>${s.late}</td><td>${s.absent}</td><td>${s.excused}</td>
        <td><b>${rate}</b></td>
      </tr>`;
    }).join("");

    const recentRows = records
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30)
      .map((r) => `<tr>
        <td>${esc(r.date)}</td><td>${esc(r.subject)}</td><td>${esc(r.teacher)}</td>
        <td><span class="pill ${STATUS_PILL[r.status] || ""}">${esc(capitalize(r.status))}</span></td>
      </tr>`).join("");

    box.innerHTML = `
      <h3>Summary</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th>Professor</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Rate</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table></div>
      <p class="muted">Rate counts present and late days; excused days are left out.</p>
      <h3>Recent records</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Subject</th><th>Professor</th><th>Status</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table></div>`;
  } catch (error) {
    box.innerHTML = '<p class="muted">Could not load your attendance. Try again.</p>';
  }
}


/* ----- Profile: shows everything from registration, editable (except ID and name) ----- */

let editingProfile = false;
const PF_GENDERS = ["Female", "Male", "Prefer not to say"];
const PF_YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

render.profile = () => {
  const fullName = [profile.firstName, profile.middleName, profile.lastName]
    .filter(Boolean).join(" ") || me.name;
  const photo = String(profile.photo || "").startsWith("data:image/")
    ? `<img class="avatar" src="${esc(profile.photo)}" alt="Profile picture">`
    : "";

  if (!editingProfile) {
    return `
      <div class="panel">
        ${photo}
        <div class="profile-grid">
          ${item("Full name", fullName)}
          ${item("Student ID", profile.studentId || me.roleId)}
          ${item("Course / Program", profile.course)}
          ${item("Year level", profile.yearLevel)}
          ${item("Section", profile.section)}
          ${item("Username", profile.username)}
          ${item("Email", me.email)}
          ${item("Birthday", profile.birthday)}
          ${item("Gender", profile.gender)}
          ${item("Address", profile.address)}
          ${item("Contact number", profile.contact)}
          ${item("Emergency contact number", profile.emergencyContact)}
          ${item("Account status", me.status)}
        </div>
        <p><button type="button" class="btn" data-act="p-edit">Edit profile</button></p>
      </div>`;
  }

  const text = (id, label, value, extra = "") =>
    `<div><label for="${id}">${label}</label><input id="${id}" type="text" value="${esc(value || "")}" ${extra}></div>`;
  const choice = (id, label, value, options) =>
    `<div><label for="${id}">${label}</label><select id="${id}">${options.map((o) =>
      `<option ${o === value ? "selected" : ""}>${o}</option>`).join("")}</select></div>`;

  return `
    <div class="panel">
      ${photo}
      <div class="profile-grid" style="margin-bottom:14px">
        ${item("Full name (cannot be edited)", fullName)}
        ${item("Student ID (cannot be edited)", profile.studentId || me.roleId)}
      </div>
      <form id="profForm" class="pw-form" novalidate>
        ${text("pf_course", "Course / Program", profile.course)}
        ${choice("pf_year", "Year level", profile.yearLevel, PF_YEARS)}
        ${text("pf_section", "Section", profile.section)}
        ${text("pf_username", "Username", profile.username)}
        <div><label for="pf_birthday">Birthday</label>
          <input id="pf_birthday" type="date" value="${esc(profile.birthday || "")}"></div>
        ${choice("pf_gender", "Gender", profile.gender, PF_GENDERS)}
        ${text("pf_address", "Address", profile.address)}
        ${text("pf_contact", "Contact number", profile.contact, 'inputmode="numeric" maxlength="11"')}
        ${text("pf_emergency", "Emergency contact number", profile.emergencyContact, 'inputmode="numeric" maxlength="11"')}
        <p id="pfError" style="color:var(--danger);min-height:1.2em;margin:0"></p>
        <div class="actions">
          <button type="submit" class="btn">Save</button>
          <button type="button" class="btn ghost" data-act="p-cancel">Cancel</button>
        </div>
      </form>
    </div>`;
};

async function saveProfile(event) {
  event.preventDefault();
  const value = (id) => $("#" + id).value.trim();
  const updates = {
    course: value("pf_course"),
    yearLevel: value("pf_year"),
    section: value("pf_section"),
    username: value("pf_username"),
    birthday: value("pf_birthday"),
    gender: value("pf_gender"),
    address: value("pf_address"),
    contact: value("pf_contact"),
    emergencyContact: value("pf_emergency")
  };
  const fail = (message) => { $("#pfError").textContent = message; };
  fail("");

  if (Object.values(updates).some((v) => !v)) return fail("Fill in all the fields.");
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(updates.username)) {
    return fail("Username: 3-20 letters, numbers, dots, or underscores.");
  }
  if (new Date(updates.birthday) >= new Date()) return fail("Birthday must be in the past.");
  if (!/^\d{11}$/.test(updates.contact)) return fail("Contact number must be exactly 11 digits.");
  if (!/^\d{11}$/.test(updates.emergencyContact)) {
    return fail("Emergency contact number must be exactly 11 digits.");
  }

  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await updateDoc(doc(db, "students", me.uid), updates);
    Object.assign(profile, updates);
    editingProfile = false;
    toast("Profile updated");
    show("profile");
  } catch (error) {
    fail("Could not save. Try again.");
    button.disabled = false;
  }
}


/* ----- Events ----- */

$("#view").addEventListener("click", (event) => {
  const sem = event.target.closest("[data-sem]");
  if (sem) {
    pick.sem = sem.dataset.sem;
    redraw();
    return;
  }
  const button = event.target.closest("[data-act]");
  if (!button) return;
  if (button.dataset.act === "p-edit") { editingProfile = true; show("profile"); }
  if (button.dataset.act === "p-cancel") { editingProfile = false; show("profile"); }
});

$("#view").addEventListener("change", (event) => {
  if (event.target.id === "termYear") {
    pick.year = event.target.value;
    redraw();
  }
});

$("#view").addEventListener("input", (event) => {
  if (event.target.id === "pf_contact" || event.target.id === "pf_emergency") {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 11);
  }
});

$("#view").addEventListener("submit", (event) => {
  if (event.target.id === "profForm") saveProfile(event);
});
/* ---------- New design (glass cards like ScholarPen, St. Gabriel green and gold) ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/student.js, AFTER 3_student_additions.js */

document.head.append(Object.assign(document.createElement("style"), {
  textContent: `
  body.dash-body{background:linear-gradient(135deg,#04301c 0%,#06532f 50%,#0a6b3f 100%) fixed;color:#fff}
  body.dash-body .sidebar{background:rgba(255,255,255,.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.18);border-radius:0 24px 24px 0;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  body.dash-body .sidebar nav button{background:transparent;border:1px solid transparent;border-radius:14px;color:#fff;text-align:left}
  body.dash-body .sidebar nav button.on{background:rgba(215,181,64,.30);border-color:rgba(255,255,255,.35);color:#fff}
  body.dash-body .topbar{background:rgba(255,255,255,.10);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.18);border-radius:22px;box-shadow:0 8px 24px rgba(0,0,0,.2);color:#fff;display:flex;align-items:center;gap:12px}
  body.dash-body .topbar h2{margin:0;color:#fff}
  .title-wrap{flex:1;min-width:0}
  .title-wrap small{display:block;color:rgba(255,255,255,.75)}
  .mini-avatar{width:26px;height:26px;margin-right:6px;border-radius:50%;object-fit:cover;vertical-align:middle;border:2px solid var(--gold)}
  body.dash-body #profileMenu{background:#0b4a2c;color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:16px}
  body.dash-body .panel{background:rgba(255,255,255,.10);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.2);border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.22);color:#fff;margin-bottom:16px}
  body.dash-body .panel h3,body.dash-body .panel b,body.dash-body .profile-grid b,body.dash-body .pw-form label{color:#fff}
  body.dash-body .muted,body.dash-body .profile-grid small{color:rgba(255,255,255,.72)}
  body.dash-body .panel-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
  body.dash-body .panel-head h3{margin:0}
  body.dash-body .strip{margin-bottom:14px;padding:12px 16px;border-radius:16px;background:rgba(255,255,255,.10);color:#fff;line-height:1.5}
  body.dash-body .toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0}
  body.dash-body select,body.dash-body .pw-form input,body.dash-body .toolbar input{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:14px;padding:9px 12px}
  body.dash-body select option{color:#000}
  body.dash-body .btn.ghost{background:rgba(255,255,255,.10);color:#fff;border:1px solid rgba(255,255,255,.35)}
  body.dash-body .table-wrap table{border-collapse:separate;border-spacing:0;width:100%}
  body.dash-body th{background:rgba(255,255,255,.16);color:#fff;text-align:left}
  body.dash-body th:first-child{border-radius:14px 0 0 14px}
  body.dash-body th:last-child{border-radius:0 14px 14px 0}
  body.dash-body td{color:#fff;border-bottom:1px solid rgba(255,255,255,.14)}
  body.dash-body .pill.active{background:rgba(120,230,150,.25);color:#c6ffd9}
  body.dash-body .pill.deactivated{background:rgba(255,120,120,.28);color:#ffd2d2}
  body.dash-body .pill.pending{background:rgba(215,181,64,.30);color:#fff1b8}
  .stats{display:flex;flex-wrap:wrap;gap:6px 24px;margin-top:14px}
  .stats span{color:rgba(255,255,255,.75)}
  .stats b{margin-left:4px;font-size:1.05rem}
  `
}));


/* ----- Top bar: name under the title, avatar, visible Logout ----- */

function decorateTopbar() {
  const title = $("#viewTitle");
  if (!title || $("#subTitle")) return;

  const wrap = document.createElement("div");
  wrap.className = "title-wrap";
  title.before(wrap);
  const sub = document.createElement("small");
  sub.id = "subTitle";
  sub.textContent = `${me.name} · ${profile.studentId || me.roleId}`;
  wrap.append(title, sub);

  const out = document.createElement("button");
  out.type = "button";
  out.id = "topLogout";
  out.className = "btn sm ghost";
  out.textContent = "Logout";
  out.addEventListener("click", logout);
  $(".topbar .profile").before(out);

  if (String(profile.photo || "").startsWith("data:image/")) {
    $("#profileBtn").insertAdjacentHTML("afterbegin",
      `<img class="mini-avatar" src="${esc(profile.photo)}" alt="">`);
  }
}

const startBeforeDesign = start;
start = async function () {
  await startBeforeDesign();
  decorateTopbar();
};


/* ----- Shared: info strip under the title ----- */

function infoStrip(rows) {
  const year = (rows.find((r) => r.yearId === pick.year) || {}).yearName || "-";
  const fullName = [profile.firstName, profile.middleName, profile.lastName]
    .filter(Boolean).join(" ") || me.name;
  return `<div class="strip"><b>${esc(fullName)} · ${esc(profile.studentId || me.roleId)}</b><br>
    ${esc(profile.course || "-")} · ${esc(profile.yearLevel || "-")} · Section ${esc(profile.section || "-")} · ${esc(year)} · ${esc(pick.sem)}</div>`;
}


/* ----- Schedule (new look) ----- */

render.schedule = () => {
  setTimeout(loadSchedule2, 0);
  return '<div id="schBox"><div class="panel"><p class="muted">Loading schedule...</p></div></div>';
};

async function loadSchedule2() {
  const box = $("#schBox");
  if (!box) return;
  try {
    const rows = await loadTermData();
    redraw = () => {
      const bar = controls(rows);
      const strip = infoStrip(rows);
      const list = rows.filter((r) => r.yearId === pick.year && r.sem === pick.sem);
      const body = list.map((r) => {
        const s = splitSchedule(r.schedule);
        return `<tr><td>${esc(s.time)}</td><td>${esc(s.days)}</td><td>${esc(r.code)}</td>
          <td>${esc(r.name)}</td><td>${esc(r.room)}</td><td>${esc(r.teacher)}</td></tr>`;
      }).join("");
      box.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h3>My Class Schedule</h3>${bar}</div>
          ${strip}
          <div class="table-wrap"><table>
            <thead><tr><th>Time</th><th>Days</th><th>Course code</th><th>Subject</th><th>Room</th><th>Teacher</th></tr></thead>
            <tbody>${body || '<tr><td colspan="6" class="muted">No classes for this semester.</td></tr>'}</tbody>
          </table></div>
        </div>`;
    };
    redraw();
  } catch (error) {
    box.innerHTML = '<div class="panel"><p class="muted">Could not load your schedule. Try again.</p></div>';
  }
}


/* ----- Grades (new look: My Grades card + Grade Notes card) ----- */

render.grades = () => {
  setTimeout(loadMyGrades2, 0);
  return '<div id="gradeBox"><div class="panel"><p class="muted">Loading grades...</p></div></div>';
};

async function loadMyGrades2() {
  const box = $("#gradeBox");
  if (!box) return;
  try {
    const [rows, gradeSnap] = await Promise.all([
      loadTermData(),
      getDocs(query(collection(db, "grades"), where("studentId", "==", me.uid)))
    ]);
    const saved = {};
    gradeSnap.docs.forEach((d) => { saved[d.data().classId] = d.data(); });

    const scored = rows.map((r) => {
      const g = saved[r.classId];
      const parts = g ? [g.prelim, g.midterm, g.final] : [];
      const done = parts.length === 3 && parts.every((v) => typeof v === "number");
      return { ...r, raw: done ? parts.reduce((a, b) => a + b, 0) / 3 : null };
    });

    // GWA: weighted by units, decimals cut off (no rounding)
    const gwa = (list) => {
      const graded = list.filter((r) => r.raw !== null && r.units > 0);
      const units = graded.reduce((s, r) => s + r.units, 0);
      return units ? graded.reduce((s, r) => s + r.raw * r.units, 0) / units : null;
    };
    const gwaText = (v) => (v === null ? "-" : `${cut(v)} (${equivalentOf(v).eq})`);

    const scaleRows = SCALE.map((s) =>
      `<tr><td>${s[1]}</td><td>${s[3]}</td><td>${s[2]}</td></tr>`).join("") +
      "<tr><td>5.00</td><td>Below 75</td><td>Failed</td></tr>";

    redraw = () => {
      const bar = controls(scored);
      const strip = infoStrip(scored);
      const inYear = scored.filter((r) => r.yearId === pick.year);
      const inSem = inYear.filter((r) => r.sem === pick.sem);
      const list = inSem.filter((r) => r.raw !== null);

      const body = list.map((r) => {
        const passed = cut(r.raw) >= PASSING;
        return `<tr>
          <td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.teacher)}</td>
          <td>${r.units}</td><td><b>${cut(r.raw)}</b></td><td>${equivalentOf(r.raw).eq}</td>
          <td><span class="pill ${passed ? "active" : "deactivated"}">${passed ? "Passed" : "Failed"}</span></td>
          <td>${passed ? r.units : "—"}</td>
        </tr>`;
      }).join("");

      const totalUnits = inSem.reduce((s, r) => s + r.units, 0);
      const earned = list.filter((r) => cut(r.raw) >= PASSING).reduce((s, r) => s + r.units, 0);

      box.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h3>My Grades</h3>${bar}</div>
          ${strip}
          <div class="table-wrap"><table>
            <thead><tr><th>Course code</th><th>Subject</th><th>Professor</th><th>Units</th><th>Grade</th><th>Equivalent</th><th>Remarks</th><th>Units earned</th></tr></thead>
            <tbody>${body || '<tr><td colspan="8" class="muted">No grades yet for this semester.</td></tr>'}</tbody>
          </table></div>
          <div class="stats">
            <span>Subjects:<b>${inSem.length}</b></span>
            <span>Total units:<b>${totalUnits}</b></span>
            <span>Units earned:<b>${earned}</b></span>
            <span>${esc(pick.sem)} GWA:<b>${gwaText(gwa(inSem))}</b></span>
            <span>Overall GWA (academic year):<b>${gwaText(gwa(inYear))}</b></span>
            <span>Passing grade:<b>${PASSING}</b></span>
          </div>
        </div>
        <div class="panel">
          <h3>Grade Notes</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Equivalent</th><th>Grade</th><th>Meaning</th></tr></thead>
            <tbody>${scaleRows}</tbody>
          </table></div>
          <p class="muted">The passing grade is ${PASSING}. Remarks show only Passed or Failed. Decimals are not rounded (86.66 is 86).</p>
        </div>`;
    };
    redraw();
  } catch (error) {
    box.innerHTML = '<div class="panel"><p class="muted">Could not load your grades. Try again.</p></div>';
  }
}
/* ---------- Profile page + avatar popup + Logout in the menu (ScholarPen style) ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/student.js, AFTER 4_student_design.js */
/* Only fields from your own Create Account form are shown (no College, Nationality, Guardian). */

document.head.append(Object.assign(document.createElement("style"), {
  textContent: `
  .pf-top{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center}
  .pf-top h3{margin:0}
  .pf-head{display:flex;align-items:center;gap:16px;margin:18px 0 8px}
  .pf-head h2{margin:0;color:#fff}
  .pf-head p{margin:4px 0 0;color:rgba(255,255,255,.8)}
  .pf-avatar,.menu-avatar{display:flex;align-items:center;justify-content:center;width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid var(--gold);background:rgba(255,255,255,.18);color:#fff;font-size:2rem;font-weight:700;flex:none}
  .pf-rows .row{display:grid;grid-template-columns:minmax(120px,200px) 1fr;gap:12px;padding:13px 4px;border-bottom:1px solid rgba(255,255,255,.18)}
  .pf-rows .row span{color:rgba(255,255,255,.75)}
  .pf-rows .row b{color:#fff;font-weight:600;word-break:break-word}
  body.dash-body #profileMenu{width:min(330px,92vw);max-height:82vh;overflow:auto;padding:18px;text-align:center;border-radius:22px;box-shadow:0 16px 40px rgba(0,0,0,.4)}
  #profileMenu .menu-avatar{width:96px;height:96px;margin:6px auto 10px}
  #profileMenu h4{margin:0;color:#fff;font-size:1.15rem}
  #profileMenu .menu-id{margin:2px 0 12px;color:rgba(255,255,255,.75)}
  #profileMenu .actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0}
  #profileMenu .menu-rows{text-align:left;border-top:1px solid rgba(255,255,255,.2);margin-top:10px}
  #profileMenu .menu-rows div{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid rgba(255,255,255,.14)}
  #profileMenu .menu-rows span{color:rgba(255,255,255,.75)}
  #profileMenu .menu-rows b{color:#fff;text-align:right;word-break:break-word}
  #profileMenu .menu-x{position:absolute;top:10px;right:14px;background:none;border:0;color:#fff;font-size:1.4rem;cursor:pointer}
  .btn.logout-solid{background:#e0675a;color:#fff;border:0}
  `
}));

// Logout button at the bottom of the side menu
TITLES.logout = "Logout";
render.logout = () => { logout(); return ""; };
{
  const out = document.createElement("button");
  out.type = "button";
  out.dataset.view = "logout";
  out.textContent = "Logout";
  $("#nav").append(out);
}

// Hidden file box used by "Change photo"
const photoPick = document.createElement("input");
photoPick.type = "file";
photoPick.accept = "image/*";
photoPick.hidden = true;
photoPick.id = "photoPick";
document.body.append(photoPick);


/* ----- Helpers ----- */

const hasPhoto = () => String(profile.photo || "").startsWith("data:image/");
const nameOf = () => [profile.firstName, profile.middleName, profile.lastName]
  .filter(Boolean).join(" ") || me.name;

function avatarHTML(cls) {
  return hasPhoto()
    ? `<img class="${cls}" src="${esc(profile.photo)}" alt="Profile picture">`
    : `<div class="${cls}">${esc((nameOf()[0] || "?").toUpperCase())}</div>`;
}

// "2005-11-26" -> "Nov 26, 2005 (20 years old)"
function birthdayText(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "-";
  const born = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age--;
  const text = born.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${text} (${age} years old)`;
}

const rowHTML = (label, value) =>
  `<div class="row"><span>${label}</span><b>${esc(value || "-")}</b></div>`;

// Shrinks a photo to 256px so it fits in the database
function squeezeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const image = new Image();
    reader.onload = () => { image.src = reader.result; };
    image.onload = () => {
      const scale = Math.min(256 / image.width, 256 / image.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    const fail = () => reject(new Error("Could not read that image."));
    image.onerror = fail;
    reader.onerror = fail;
    reader.readAsDataURL(file);
  });
}


/* ----- Profile page ----- */

const profileFormBefore = render.profile;   // the edit form from the earlier block

render.profile = () => {
  if (editingProfile) return profileFormBefore();
  const line = [profile.course, profile.yearLevel, profile.section ? "Section " + profile.section : ""]
    .filter(Boolean).join(" · ");

  return `
    <div class="panel">
      <div class="pf-top">
        <h3>My Profile</h3>
        <div class="actions">
          <button type="button" class="btn sm" data-act="p-photo">Change photo</button>
          <button type="button" class="btn sm ghost" data-act="p-remove">Remove photo</button>
          <button type="button" class="btn sm" data-act="p-edit">Edit profile</button>
          <button type="button" class="btn sm ghost" data-act="p-password">Change Password</button>
        </div>
      </div>
      <div class="pf-head">
        ${avatarHTML("pf-avatar")}
        <div><h2>${esc(nameOf())}</h2><p>${esc(line || "-")}</p></div>
      </div>
      <div class="pf-rows">
        ${rowHTML("Student ID", profile.studentId || me.roleId)}
        ${rowHTML("Course", profile.course)}
        ${rowHTML("Year · Section", [profile.yearLevel, profile.section].filter(Boolean).join(" · "))}
        ${rowHTML("Birthdate", birthdayText(profile.birthday))}
        ${rowHTML("Gender", profile.gender)}
        ${rowHTML("Address", profile.address)}
        ${rowHTML("Email", me.email)}
        ${rowHTML("Username", profile.username)}
        ${rowHTML("Contact number", profile.contact)}
        ${rowHTML("Emergency contact number", profile.emergencyContact)}
      </div>
    </div>`;
};


/* ----- Avatar popup (top right) ----- */

function refreshAvatars() {
  document.querySelectorAll("#profileBtn .mini-avatar").forEach((el) => el.remove());
  if (hasPhoto()) {
    $("#profileBtn").insertAdjacentHTML("afterbegin",
      `<img class="mini-avatar" src="${esc(profile.photo)}" alt="">`);
  }
}

function refreshMenu() {
  const menu = $("#profileMenu");
  const popRow = (label, value) => `<div><span>${label}</span><b>${esc(value || "-")}</b></div>`;
  menu.innerHTML = `
    <button type="button" class="menu-x" data-menu="close" aria-label="Close">&times;</button>
    ${avatarHTML("menu-avatar")}
    <h4>${esc(nameOf())}</h4>
    <p class="menu-id">${esc(profile.studentId || me.roleId)}</p>
    <div class="actions">
      <button type="button" class="btn sm" data-menu="photo">Change photo</button>
      <button type="button" class="btn sm ghost" data-menu="remove">Remove photo</button>
    </div>
    <div class="menu-rows">
      ${popRow("Course", profile.course)}
      ${popRow("Year Level", profile.yearLevel)}
      ${popRow("Section", profile.section)}
      ${popRow("Email", me.email)}
      ${popRow("Contact", profile.contact)}
    </div>
    <div class="actions">
      <button type="button" class="btn sm" data-menu="profile">My Profile</button>
      <button type="button" class="btn sm ghost" data-menu="password">Change Password</button>
    </div>
    <button type="button" class="btn sm logout-solid" data-menu="logout">Logout</button>`;
}

const startBeforeProfile = start;
start = async function () {
  await startBeforeProfile();
  refreshMenu();
  refreshAvatars();
};

function updatePhoto(value) {
  return updateDoc(doc(db, "students", me.uid), { photo: value }).then(() => {
    profile.photo = value;
    refreshMenu();
    refreshAvatars();
    $("#profileMenu").hidden = true;
    show("profile");
  });
}

async function removePhoto() {
  if (!hasPhoto()) return toast("You have no photo to remove.", "error");
  try {
    await updatePhoto("");
    toast("Photo removed");
  } catch (error) {
    toast("Could not remove the photo. Try again.", "error");
  }
}

photoPick.addEventListener("change", async () => {
  const file = photoPick.files[0];
  photoPick.value = "";
  if (!file) return;
  try {
    await updatePhoto(await squeezeImage(file));
    toast("Photo updated");
  } catch (error) {
    toast("Could not save the photo. Try again.", "error");
  }
});


/* ----- Events ----- */

$("#profileMenu").addEventListener("click", (event) => {
  const button = event.target.closest("[data-menu]");
  if (!button) return;
  const act = button.dataset.menu;
  const menu = $("#profileMenu");

  if (act === "close") menu.hidden = true;
  if (act === "photo") photoPick.click();
  if (act === "remove") removePhoto();
  if (act === "profile") { menu.hidden = true; editingProfile = false; show("profile"); }
  if (act === "password") { menu.hidden = true; show("account"); }
  if (act === "logout") logout();
});

$("#view").addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  if (button.dataset.act === "p-photo") photoPick.click();
  if (button.dataset.act === "p-remove") removePhoto();
  if (button.dataset.act === "p-password") show("account");
});
/* ---------- Home dashboard: greeting, latest announcements, Today's Classes, Upcoming Classes ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/student.js, AFTER 5_student_profile_design.js */

document.head.append(Object.assign(document.createElement("style"), {
  textContent: `
  .greet{margin:0 0 14px;padding:12px 16px;border-radius:16px;background:rgba(255,255,255,.10);color:#fff;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
  .class-row{display:grid;grid-template-columns:2fr 1.3fr 1.5fr;gap:10px;align-items:center;margin-bottom:8px;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.12);border:1.5px solid transparent;color:#fff}
  .class-row.now{border-color:rgba(255,255,255,.75)}
  .class-row .mid{text-align:center}
  .class-row .end{text-align:right;color:rgba(255,255,255,.8)}
  .now-badge{display:inline-block;margin-left:8px;padding:2px 10px;border-radius:999px;background:rgba(215,181,64,.4);font-size:.75rem}
  @media (max-width:640px){.class-row{grid-template-columns:1fr}.class-row .mid,.class-row .end{text-align:left}}
  `
}));

TITLES.home = "Dashboard";

// Add the "Home" button at the top of the menu
{
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.view = "home";
  button.textContent = "Home";
  $("#nav").prepend(button);
}


/* ----- Reading days and times from a schedule like "MWF 8:00-9:00 AM" ----- */

const DAY_IDX = { M: 1, T: 2, W: 3, H: 4, F: 5, S: 6, U: 0 };
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDays(text) {
  const match = String(text || "").trim().match(/^([A-Za-z]+)\s/);
  if (!match) return [];
  const days = match[1].replace(/th/gi, "H").toUpperCase().split("")
    .map((c) => DAY_IDX[c]).filter((d) => d !== undefined);
  return [...new Set(days)];
}

// Returns start and end as minutes after midnight, or null
function parseTimes(text) {
  const m = String(text || "").match(
    /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  const toMinutes = (h, min, ap) => {
    let hour = Number(h);
    if (ap) {
      hour %= 12;
      if (ap.toUpperCase() === "PM") hour += 12;
    }
    return hour * 60 + Number(min || 0);
  };
  let start = toMinutes(m[1], m[2], m[3] || m[6]);
  const end = toMinutes(m[4], m[5], m[6]);
  if (start >= end && !m[3]) start -= 12 * 60;   // "11:00-1:00 PM"
  return { start, end };
}


/* ----- Home page ----- */

render.home = () => {
  setTimeout(loadHome, 0);
  return '<div id="homeBox"><div class="panel"><p class="muted">Loading...</p></div></div>';
};

async function loadHome() {
  const box = $("#homeBox");
  if (!box) return;
  try {
    const [rows, annSnap] = await Promise.all([
      loadTermData(),
      getDocs(query(collection(db, "announcements"), where("audience", "in", ["all", "students"])))
    ]);

    const latest = annSnap.docs.map((d) => d.data())
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 2);

    // Start on the semester that has classes
    controls(rows);
    const inYear = rows.filter((r) => r.yearId === pick.year);
    if (!inYear.some((r) => r.sem === pick.sem)) {
      const count = {};
      inYear.forEach((r) => { count[r.sem] = (count[r.sem] || 0) + 1; });
      const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      if (best) pick.sem = best[0];
    }

    const classRow = (r, middle, isNow) => `
      <div class="class-row ${isNow ? "now" : ""}">
        <div><b>${esc(r.code)} · ${esc(r.name)}</b>${isNow ? '<span class="now-badge">now</span>' : ""}</div>
        <div class="mid">${esc(middle)}</div>
        <div class="end">${esc(r.teacher)} · ${esc(r.room)}</div>
      </div>`;

    redraw = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const today = now.getDay();
      const hour = now.getHours();
      const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      const firstName = profile.firstName || me.name.split(" ")[0];

      const list = rows
        .filter((r) => r.yearId === pick.year && r.sem === pick.sem)
        .map((r) => ({
          ...r,
          days: parseDays(r.schedule),
          t: parseTimes(r.schedule),
          time: splitSchedule(r.schedule).time
        }));

      const todays = list.filter((r) => r.days.includes(today))
        .sort((a, b) => (a.t ? a.t.start : 0) - (b.t ? b.t.start : 0));

      const upcoming = [];
      for (let offset = 0; offset < 7; offset++) {
        const day = (today + offset) % 7;
        list.filter((r) => r.days.includes(day)).forEach((r) => {
          if (offset === 0 && r.t && r.t.start <= nowMin) return;
          upcoming.push({ r, offset, day, start: r.t ? r.t.start : 0 });
        });
      }
      upcoming.sort((a, b) => a.offset - b.offset || a.start - b.start);

      const todayHTML = todays.map((r) =>
        classRow(r, r.time, r.t && nowMin >= r.t.start && nowMin < r.t.end)).join("");
      const upcomingHTML = upcoming.slice(0, 6).map((u) => {
        const label = u.offset === 0 ? "Today" : u.offset === 1 ? "Tomorrow" : DAY_SHORT[u.day];
        return classRow(u.r, `${label} · ${u.r.time}`, false);
      }).join("");

      const news = latest.length ? `
        <div class="panel">
          <h3>Latest announcements</h3>
          ${latest.map((a) => `<p style="margin:4px 0"><b>${esc(a.title)}</b> · ${esc(
            a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString("en-US",
              { month: "short", day: "numeric", year: "numeric" }) : "-")}</p>`).join("")}
          <p><button type="button" class="btn sm" data-go="announcements">See announcements</button></p>
        </div>` : "";

      box.innerHTML = `
        ${news}
        <div class="greet"><span>${hello}, ${esc(firstName)}! 👋</span>${controls(rows)}</div>
        <div class="panel">
          <div class="panel-head">
            <h3>Today's Classes</h3>
            <button type="button" class="btn sm ghost" data-go="schedule">Full schedule</button>
          </div>
          ${todayHTML || '<p class="muted">No classes today.</p>'}
        </div>
        <div class="panel">
          <h3>Upcoming Classes</h3>
          ${upcomingHTML || '<p class="muted">No upcoming classes.</p>'}
        </div>`;
    };
    redraw();
  } catch (error) {
    box.innerHTML = '<div class="panel"><p class="muted">Could not load the dashboard. Try again.</p></div>';
  }
}

// Keep the "now" badge current
setInterval(() => { if ($("#homeBox") && $("#homeBox .greet")) redraw(); }, 60000);

// "Full schedule" and "See announcements" buttons
$("#view").addEventListener("click", (event) => {
  const go = event.target.closest("[data-go]");
  if (go) show(go.dataset.go);
});

// Open on Home after logging in
const startBeforeHome = start;
start = async function () {
  await startBeforeHome();
  show("home");
};
/* ---------- One Logout only (in the profile popup) with "Are you sure?" ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/student.js, AFTER THE OTHER BLOCKS */

document.head.append(Object.assign(document.createElement("style"), {
  textContent: `
  #logoutBox{background:#0b4a2c;color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:22px 24px;max-width:340px;text-align:center}
  #logoutBox::backdrop{background:rgba(0,0,0,.55)}
  #logoutBox p{margin:0 0 16px;font-size:1.05rem}
  #logoutBox .logout-actions{display:flex;gap:10px;justify-content:center}
  `
}));

// The confirmation box
const logoutBox = document.createElement("dialog");
logoutBox.id = "logoutBox";
logoutBox.innerHTML = `
  <p>Are you sure you want to log out?</p>
  <div class="logout-actions">
    <button type="button" id="logoutNo" class="btn ghost sm">No</button>
    <button type="button" id="logoutYes" class="btn sm">Yes</button>
  </div>`;
document.body.append(logoutBox);

$("#logoutNo").addEventListener("click", () => logoutBox.close());
$("#logoutYes").addEventListener("click", () => {
  logoutBox.close();
  logout();
});

// Logout in the popup now asks first (this runs before the old direct logout)
$("#profileMenu").addEventListener("click", (event) => {
  if (!event.target.closest('[data-menu="logout"]')) return;
  event.stopPropagation();
  $("#profileMenu").hidden = true;
  logoutBox.showModal();
}, true);

// Remove the extra Logout buttons (top bar and side menu)
const startBeforeLogoutFix = start;
start = async function () {
  await startBeforeLogoutFix();
  const topButton = $("#topLogout");
  if (topButton) topButton.remove();
  const sideButton = $('#nav [data-view="logout"]');
  if (sideButton) sideButton.remove();
};
/* ---------- Profile: Guardian + Enrollment status ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/student.js, AFTER THE OTHER BLOCKS */

const profileBeforeGuardian = render.profile;

render.profile = () => {
  const html = profileBeforeGuardian();

  // Edit form: add the Guardian box above the error line
  if (editingProfile) {
    const box = `<div><label for="pf_guardian">Guardian name</label>
      <input id="pf_guardian" type="text" value="${esc(profile.guardianName || "")}"></div>`;
    return html.replace('<p id="pfError"', () => box + '<p id="pfError"');
  }

  // View: Guardian and Enrollment rows after the emergency contact
  const extra =
    `<div class="row"><span>Guardian</span><b>${esc(profile.guardianName || "-")}</b></div>` +
    '<div class="row"><span>Enrollment</span><b id="enrollVal">Checking...</b></div>';

  setTimeout(async () => {
    try {
      const rows = await loadTermData();
      const el = $("#enrollVal");
      if (el) el.textContent = rows.length ? "Enrolled" : "Not enrolled yet";
    } catch (error) {
      const el = $("#enrollVal");
      if (el) el.textContent = "-";
    }
  }, 0);

  return html.replace(
    /<span>Emergency contact number<\/span><b>[\s\S]*?<\/b><\/div>/,
    (m) => m + extra
  );
};

// Save: now includes the guardian name
saveProfile = async function (event) {
  event.preventDefault();
  const value = (id) => $("#" + id).value.trim();
  const updates = {
    course: value("pf_course"),
    yearLevel: value("pf_year"),
    section: value("pf_section"),
    username: value("pf_username"),
    birthday: value("pf_birthday"),
    gender: value("pf_gender"),
    address: value("pf_address"),
    contact: value("pf_contact"),
    emergencyContact: value("pf_emergency"),
    guardianName: value("pf_guardian")
  };
  const fail = (message) => { $("#pfError").textContent = message; };
  fail("");

  if (Object.values(updates).some((v) => !v)) return fail("Fill in all the fields.");
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(updates.username)) {
    return fail("Username: 3-20 letters, numbers, dots, or underscores.");
  }
  if (new Date(updates.birthday) >= new Date()) return fail("Birthday must be in the past.");
  if (!/^\d{11}$/.test(updates.contact)) return fail("Contact number must be exactly 11 digits.");
  if (!/^\d{11}$/.test(updates.emergencyContact)) {
    return fail("Emergency contact number must be exactly 11 digits.");
  }

  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await updateDoc(doc(db, "students", me.uid), updates);
    Object.assign(profile, updates);
    editingProfile = false;
    toast("Profile updated");
    show("profile");
  } catch (error) {
    fail("Could not save. Try again.");
    button.disabled = false;
  }
};
