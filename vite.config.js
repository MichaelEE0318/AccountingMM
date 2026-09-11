import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ⚠️ 重要：把下面的 "ledger" 改成你的 GitHub repo 名稱
// 例如 repo 網址是 github.com/yourname/my-money，就改成 "my-money"
// 如果用 Cloudflare Pages / Vercel，改成 "" （空字串）即可
const REPO_NAME = "AccountingMM";

const base = REPO_NAME ? `/${REPO_NAME}/` : "/";

export default defineConfig({
  plugins: [react()],
  base,
});
