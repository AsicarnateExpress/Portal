import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDepMaKN9zbCUc1FP_NfuZEt_X8ZTRymSw",
  authDomain: "st-gabriel-portal.firebaseapp.com",
  projectId: "st-gabriel-portal",
  appId: "1:723183994649:web:c60c7603196e02bca16788"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

