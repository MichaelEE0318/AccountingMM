// 收件匣：iPhone 捷徑在背景把刷卡交易丟進 users/{uid}/inbox，網頁打開時搬進明細
// 這支檔案只用 firebase.js 匯出的 db，不需要改你的 firebaseConfig
import { collection, doc, onSnapshot, deleteDoc } from "firebase/firestore";
import { db } from "./firebase";

// 即時監聽收件匣；回傳取消監聽的函式
export function watchInbox(uid, onItems, onError) {
  return onSnapshot(
    collection(db, "users", uid, "inbox"),
    (snap) => onItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export const removeInbox = (uid, id) => deleteDoc(doc(db, "users", uid, "inbox", id));

// 捷徑要 POST 的網址（Firestore REST API 新增文件）
export function inboxEndpoint(uid) {
  const { projectId, apiKey } = db.app.options;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/inbox?key=${apiKey}`;
}
