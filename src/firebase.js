// Firebase 設定與初始化
// ⚠️ 把下面的 firebaseConfig 換成你自己 Firebase 主控台給的那一段
// （跟你 firebase-demo 範例用的是同一個專案就好，直接複製過來）
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAFEXS-I5XZz8FgO-0mnCqdYwliTwwcBM4",
  authDomain: "my-demo-2ac06.firebaseapp.com",
  projectId: "my-demo-2ac06",
  storageBucket: "my-demo-2ac06.firebasestorage.app",
  messagingSenderId: "886656155238",
  appId: "1:886656155238:web:a684f300c6320015c777a7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export const login = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);
export const watchAuth = (cb) => onAuthStateChanged(auth, cb);

// 每類資料存成一份文件：users/{uid}/ledger/{key}
// 讀：回傳該類的 value（沒有就回 fallback）
export async function cloudLoad(uid, key, fallback) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "ledger", key));
    return snap.exists() ? snap.data().value : fallback;
  } catch (e) {
    console.error("雲端讀取失敗", key, e);
    return fallback;
  }
}
// 寫：把該類的 value 整份寫回
export async function cloudSave(uid, key, value) {
  try {
    await setDoc(doc(db, "users", uid, "ledger", key), { value, updatedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    console.error("雲端儲存失敗", key, e);
    return false;
  }
}
