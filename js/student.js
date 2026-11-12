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


/* ----- Grade rules: NO rounding. Decimals are cut off (86.66 -> 86) ----- */

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
