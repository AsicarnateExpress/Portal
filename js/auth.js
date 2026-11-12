/* auth.js - Login, registration, and password reset */

import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  deleteUser,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ---------- 1. Settings ---------- */

const $ = (selector) => document.querySelector(selector);

function field(id, label, type = "text", options = {}) {
  return { id, label, type, ...options };
}

const GENDERS = ["Female", "Male", "Prefer not to say"];
const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

const FIELDS = {
  student: [
    field("studentId", "Student ID"),
    field("firstName", "First name"),
    field("lastName", "Last name"),
    field("middleName", "Middle name", "text", { optional: true }),
    field("username", "Username"),
    field("email", "Email address", "email"),
    field("birthday", "Birthday", "date"),
    field("gender", "Gender", "select", { options: GENDERS }),
    field("course", "Course / Program"),
    field("yearLevel", "Year level", "select", { options: YEAR_LEVELS }),
    field("section", "Section"),
    field("password", "Password", "password"),
    field("confirm", "Confirm password", "password"),
    field("photo", "Profile picture", "file", { optional: true, full: true })
  ],
  faculty: [
    field("facultyId", "Faculty ID"),
    field("firstName", "First name"),
    field("lastName", "Last name"),
    field("email", "Email address", "email"),
    field("department", "Department"),
    field("position", "Position"),
    field("contact", "Contact number", "tel"),
    field("password", "Password", "password"),
    field("confirm", "Confirm password", "password"),
    field("photo", "Profile picture", "file", { optional: true, full: true })
  ],
  admin: [
    field("adminId", "Admin ID"),
    field("fullName", "Full name"),
    field("username", "Username"),
    field("email", "Email address", "email"),
    field("department", "Department"),
    field("inviteCode", "Invitation code", "text", { full: true }),
    field("password", "Password", "password"),
    field("confirm", "Confirm password", "password")
  ]
};

const ID_FIELD = { student: "studentId", faculty: "facultyId", admin: "adminId" };
const COLLECTION = { student: "students", faculty: "faculty", admin: "admins" };
const DASHBOARD = { student: "student.html", faculty: "faculty.html", admin: "admin.html" };
const SKIP_IN_PROFILE = ["password", "confirm", "photo", "inviteCode", "email"];

let role = "student";
let mode = "login";
let photoData = null;

/* ---------- 2. Screen ---------- */

function showNotice(message, type = "error") {
  const box = $("#notice");
  box.textContent = message;
  box.className = "notice show " + type;
  if (message) box.scrollIntoView({ block: "nearest" });
}

function clearNotice() {
  $("#notice").className = "notice";
}

function fieldHTML(x) {
  let input;

  if (x.type === "select") {
    const options = x.options.map((o) => `<option>${o}</option>`).join("");
    input = `<select id="${x.id}" name="${x.id}"><option value="">Select...</option>${options}</select>`;
  } else if (x.type === "password") {
    const autocomplete = x.id === "password" && mode === "login" ? "current-password" : "new-password";
    input = `<div class="pw"><input id="${x.id}" name="${x.id}" type="password" autocomplete="${autocomplete}"><button type="button" data-toggle="${x.id}">Show</button></div>`;
  } else if (x.type === "file") {
    input = `<input id="${x.id}" name="${x.id}" type="file" accept="image/*">`;
  } else {
    const autocomplete = x.type === "email" ? 'autocomplete="email"' : "";
    input = `<input id="${x.id}" name="${x.id}" type="${x.type}" ${autocomplete}>`;
  }

  const wide = x.full ? "full" : "";
  const optionalText = x.optional ? " (optional)" : "";

  return `<div class="field ${wide}" data-field="${x.id}"><label for="${x.id}">${x.label}${optionalText}</label>${input}<span class="err"></span></div>`;
}

function render() {
  clearNotice();
  photoData = null;

  document.querySelectorAll("#roleTabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.role === role);
  });
  document.querySelectorAll("#modeTabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === mode);
  });

  let html = "";

  if (mode === "register") {
    const hint = role === "admin"
      ? "Administrator accounts need a valid, unused invitation code from an existing administrator."
      : "New accounts are activated after email verification and administrator approval.";

    html = `
      <div class="grid">${FIELDS[role].map(fieldHTML).join("")}</div>
      <p class="notice show success" style="margin-top:14px">${hint}</p>
      <button class="btn block" type="submit">Create account</button>`;
  } else if (mode === "forgot") {
    html = `
      <div class="grid">${fieldHTML(field("email", "Email address", "email", { full: true }))}</div>
      <button class="btn block" type="submit" style="margin-top:14px">Send reset link</button>
      <div class="row"><a data-go="login">Back to log in</a></div>`;
  } else {
    const roleName = role === "admin" ? "administrator" : role;
    html = `
      <div class="grid">
        ${fieldHTML(field("email", "Email address", "email", { full: true }))}
        ${fieldHTML(field("password", "Password", "password", { full: true }))}
      </div>
      <div class="row">
        <label><input type="checkbox" id="remember"> Keep me signed in</label>
        <a data-go="forgot">Forgot password?</a>
      </div>
      <button class="btn block" type="submit">Log in as ${roleName}</button>`;
  }

  $("#authForm").innerHTML = html;
}

/* ---------- 3. Validation ---------- */

function collectFormData() {
  const data = {};
  new FormData($("#authForm")).forEach((value, key) => {
    if (typeof value === "string") data[key] = value.trim();
  });
  data.remember = $("#remember")?.checked;
  return data;
}

function validate(data, fields) {
  const errors = {};

  for (const x of fields) {
    const value = data[x.id] || "";

    if (x.type === "file") continue;

    if (!value && !x.optional) {
      errors[x.id] = "This field is required.";
      continue;
    }
    if (!value) continue;

    if (x.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[x.id] = "Enter a valid email address.";
    }

    const isIdField = ["studentId", "facultyId", "adminId"].includes(x.id);
    if (isIdField && !/^[A-Za-z0-9-]{4,20}$/.test(value)) {
      errors[x.id] = "Use 4-20 letters, numbers, or dashes.";
    }

    if (x.id === "username" && !/^[A-Za-z0-9_.]{3,20}$/.test(value)) {
      errors[x.id] = "Use 3-20 letters, numbers, dots, or underscores.";
    }

    if (x.id === "contact" && !/^[0-9+\-\s]{7,15}$/.test(value)) {
      errors[x.id] = "Enter a valid contact number.";
    }

    if (x.id === "birthday" && new Date(value) >= new Date()) {
      errors[x.id] = "Birthday must be in the past.";
    }

    if (x.id === "inviteCode" && !/^[A-Za-z0-9_-]{6,40}$/.test(value)) {
      errors[x.id] = "Invitation code format is invalid.";
    }

    const strongEnough = value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
    if (x.id === "password" && mode === "register" && !strongEnough) {
      errors[x.id] = "Use at least 8 characters with a letter and a number.";
    }
  }

  if (mode === "register" && data.password !== data.confirm) {
    errors.confirm = "Passwords do not match.";
  }

  return errors;
}

function showErrors(errors) {
  document.querySelectorAll(".field").forEach((el) => {
    const message = errors[el.dataset.field];
    el.classList.toggle("bad", Boolean(message));
    el.querySelector(".err").textContent = message || "";
  });

  const firstBadField = Object.keys(errors)[0];
  if (firstBadField) document.getElementById(firstBadField)?.focus();

  return !firstBadField;
}

/* ---------- 4. Profile picture ---------- */

function compressImage(file) {
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

/* ---------- 5. Register ---------- */

async function register(data) {
  const email = data.email.toLowerCase();
  const roleId = data[ID_FIELD[role]].toUpperCase();
  const fullName = role === "admin" ? data.fullName : `${data.firstName} ${data.lastName}`;

  const credential = await createUserWithEmailAndPassword(auth, email, data.password);
  const uid = credential.user.uid;

  try {
    const batch = writeBatch(db);

    const account = {
      role,
      status: role === "admin" ? "active" : "pending",
      email,
      roleId,
      name: fullName,
      createdAt: serverTimestamp()
    };
    if (role === "admin") account.inviteCode = data.inviteCode;

    const profile = {
      uid,
      email,
      [ID_FIELD[role]]: roleId,
      createdAt: serverTimestamp()
    };
    for (const x of FIELDS[role]) {
      const skip = SKIP_IN_PROFILE.includes(x.id) || x.id === ID_FIELD[role];
      if (!skip) profile[x.id] = data[x.id] || "";
    }
    if (photoData) profile.photo = photoData;

    batch.set(doc(db, "users", uid), account);
    batch.set(doc(db, COLLECTION[role], uid), profile);
    batch.set(doc(db, "idIndex", `${role}_${roleId}`), { uid });

    if (role === "admin") {
      batch.update(doc(db, "adminInvites", data.inviteCode), { used: true, usedBy: uid });
    }

    batch.set(doc(collection(db, "auditLogs")), {
      actorUid: uid,
      action: "register",
      role,
      at: serverTimestamp()
    });

    await batch.commit();
  } catch (error) {
    await deleteUser(credential.user).catch(() => {});
    throw error;
  }

  await sendEmailVerification(credential.user).catch(() => {});
  await signOut(auth);
}

/* ---------- 6. Log in ---------- */

async function login(data) {
  await setPersistence(
    auth,
    data.remember ? browserLocalPersistence : browserSessionPersistence
  );

  const credential = await signInWithEmailAndPassword(auth, data.email, data.password);

  const reject = async (message) => {
    await signOut(auth);
    throw new Error(message);
  };

  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user).catch(() => {});
    return reject("Verify your email first. We sent a new link to your inbox.");
  }

  const snapshot = await getDoc(doc(db, "users", credential.user.uid));
  if (!snapshot.exists() || snapshot.data().role !== role) {
    return reject(`This account is not a ${role} account. Choose the correct tab above.`);
  }

  const status = snapshot.data().status;
  if (status === "pending") {
    return reject("Your account is waiting for administrator approval.");
  }
  if (status === "rejected") {
    return reject("Your registration was not approved. Contact the registrar.");
  }
  if (status !== "active") {
    return reject("This account is deactivated. Contact an administrator.");
  }

  await updateDoc(doc(db, "users", credential.user.uid), {
    lastLogin: serverTimestamp()
  }).catch(() => {});
  location.href = DASHBOARD[role];
}

/* ---------- 7. Error messages ---------- */

const ERROR_MESSAGES = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Choose a stronger password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Network problem. Check your connection.",
  "permission-denied":
    "Registration failed. The ID may already be registered, or the invitation code is invalid, used, or expired."
};

/* ---------- 8. Events ---------- */

$("#roleTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  role = button.dataset.role;
  render();
});

$("#modeTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  mode = button.dataset.mode;
  render();
});

$("#authForm").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    const input = document.getElementById(toggle.dataset.toggle);
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    toggle.textContent = hidden ? "Hide" : "Show";
  }

  const link = event.target.closest("[data-go]");
  if (link) {
    mode = link.dataset.go;
    render();
  }
});

$("#authForm").addEventListener("change", async (event) => {
  if (event.target.id !== "photo") return;

  const file = event.target.files[0];
  photoData = null;
  if (!file) return;

  try {
    photoData = await compressImage(file);
  } catch (error) {
    showNotice(error.message);
    event.target.value = "";
  }
});

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();

  const data = collectFormData();

  let fieldsToCheck;
  if (mode === "register") {
    fieldsToCheck = FIELDS[role];
  } else if (mode === "forgot") {
    fieldsToCheck = [field("email", "", "email")];
  } else {
    fieldsToCheck = [field("email", "", "email"), field("password", "", "password")];
  }

  if (!showErrors(validate(data, fieldsToCheck))) return;

  const button = event.target.querySelector("button[type=submit]");
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Please wait...';

  try {
    if (mode === "register") {
      await register(data);
      mode = "login";
      render();
      showNotice(
        "Account created. Verify your email using the link we sent, then wait for approval before logging in.",
        "success"
      );
      return;
    }

    if (mode === "forgot") {
      await sendPasswordResetEmail(auth, data.email).catch(() => {});
      showNotice("If an account exists for that email, a reset link is on its way.", "success");
    } else {
      await login(data);
    }
  } catch (error) {
    showNotice(ERROR_MESSAGES[error.code] || error.message || "Something went wrong. Try again.");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }
});

/* ---------- 9. Start ---------- */

render();
/* ---------- Registration rules update ---------- */

const STRONG_PASSWORD = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const ID_FORMAT = { faculty: /^FAC-\d{4}$/, admin: /^ADM-\d{4}$/ };
const ID_EXAMPLE = { faculty: "FAC-0001", admin: "ADM-0001" };
const ID_INPUT = { student: "studentId", faculty: "facultyId", admin: "adminId" };

const RULES = [
  ["At least 8 characters", (v) => v.length >= 8],
  ["One uppercase letter", (v) => /[A-Z]/.test(v)],
  ["One number", (v) => /\d/.test(v)],
  ["One special character", (v) => /[^A-Za-z0-9]/.test(v)]
];

document.head.append(Object.assign(document.createElement("style"), {
  textContent:
    "#pwRules{grid-column:1/-1;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;background:var(--gray)}" +
    "#pwRules b{display:block;margin-bottom:6px;color:var(--forest)}" +
    "#pwRules ul{margin:0;padding:0}" +
    "#pwRules li{list-style:none;margin:3px 0;color:var(--muted);font-size:.9rem}" +
    "#pwRules li::before{content:'\\25CB  '}" +
    "#pwRules li.ok{color:var(--emerald);font-weight:600}" +
    "#pwRules li.ok::before{content:'\\2713  '}"
}));

// Turns each requirement green when it is met
function updateRules() {
  const input = document.getElementById("password");
  const list = document.getElementById("pwRules");
  if (!input || !list) return;
  list.querySelectorAll("li").forEach((li, i) =>
    li.classList.toggle("ok", RULES[i][1](input.value))
  );
}

// Redraw: add the checklist, the 11-digit contact box, and ID hints
const baseRender = render;
render = function () {
  baseRender();
  if (mode !== "register") return;

  const password = document.querySelector('[data-field="password"]');
  document.querySelector('[data-field="confirm"]')?.classList.add("full");
  if (password) {
    password.classList.add("full");
    const box = document.createElement("div");
    box.id = "pwRules";
    box.innerHTML = "<b>Password requirements</b><ul>" +
      RULES.map(([text]) => `<li>${text}</li>`).join("") + "</ul>";
    password.after(box);
  }

  const contact = document.getElementById("contact");
  if (contact) {
    contact.setAttribute("inputmode", "numeric");
    contact.maxLength = 11;
    contact.placeholder = "09123456789";
  }

  const idBox = document.getElementById(ID_INPUT[role]);
  if (idBox && ID_EXAMPLE[role]) idBox.placeholder = ID_EXAMPLE[role];
};

// Checks on submit
const baseValidate = validate;
validate = function (data, fields) {
  const errors = baseValidate(data, fields);
  if (mode !== "register") return errors;

  const email = data.email || "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = "Enter a valid email address. It must include @.";
  }

  const password = data.password || "";
  if (password && !STRONG_PASSWORD.test(password)) {
    errors.password = "Password must meet all the requirements.";
  }

  if (data.contact && !/^\d{11}$/.test(data.contact)) {
    errors.contact = "Contact number must be exactly 11 digits.";
  }

  const idKey = ID_INPUT[role];
  if (ID_FORMAT[role] && data[idKey] &&
      !ID_FORMAT[role].test(data[idKey].toUpperCase())) {
    errors[idKey] = `Use the format ${ID_EXAMPLE[role]}.`;
  }
  return errors;
};

// Live typing: digits only in the contact box, and the password checklist
document.getElementById("authForm").addEventListener("input", (event) => {
  if (event.target.id === "contact") {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 11);
    /* ---------- Professor's enhancements: address, contacts, password match ---------- */
/* PASTE THIS AT THE VERY BOTTOM OF js/auth.js */

// New student fields: address, student contact, emergency contact
{
  const list = FIELDS.student;
  const at = list.findIndex((f) => f.id === "section") + 1;
  list.splice(at, 0,
    field("address", "Address", "text", { full: true }),
    field("contact", "Contact number", "tel"),
    field("emergencyContact", "Emergency contact number", "tel")
  );
}

// Both number boxes: digits only, 11 digits
const renderBeforeContacts = render;
render = function () {
  renderBeforeContacts();
  if (mode !== "register") return;
  ["contact", "emergencyContact"].forEach((id) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.setAttribute("inputmode", "numeric");
    box.maxLength = 11;
    box.placeholder = "09123456789";
  });
};

// Emergency contact must be exactly 11 digits
const validateBeforeContacts = validate;
validate = function (data, fields) {
  const errors = validateBeforeContacts(data, fields);
  if (mode === "register" && data.emergencyContact && !/^\d{11}$/.test(data.emergencyContact)) {
    errors.emergencyContact = "Emergency contact number must be exactly 11 digits.";
  }
  return errors;
};

// Live "password match" message under Confirm password
function checkPasswordMatch() {
  if (mode !== "register") return;
  const password = document.getElementById("password");
  const confirm = document.getElementById("confirm");
  const wrap = document.querySelector('[data-field="confirm"]');
  if (!password || !confirm || !wrap) return;

  const message = wrap.querySelector(".err");
  if (!confirm.value) {
    wrap.classList.remove("bad");
    message.textContent = "";
    return;
  }
  const same = password.value === confirm.value;
  wrap.classList.toggle("bad", !same);
  message.textContent = same ? "Passwords match." : "Passwords do not match.";
}

document.getElementById("authForm").addEventListener("input", (event) => {
  if (event.target.id === "emergencyContact") {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 11);
  }
  if (event.target.id === "password" || event.target.id === "confirm") checkPasswordMatch();
});

  }
  if (event.target.id === "password") updateRules();
});
