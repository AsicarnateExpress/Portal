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
