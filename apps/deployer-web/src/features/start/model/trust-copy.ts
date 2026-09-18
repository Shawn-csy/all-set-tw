export const trustPoints = [
  {
    title: "資料留在你的 Cloudflare 帳戶",
    body: "銀行憑證與金融明細由你自己的 Worker／D1 處理。部署網站不收集銀行帳密。",
  },
  {
    title: "授權期間的信任邊界",
    body: "安裝過程需要 Workers、D1、Queues 與 Access 權限。這段期間部署服務在技術上可能接觸你帳戶內的 Worker 與 D1，不能宣稱絕對無法存取。",
  },
  {
    title: "目前還沒有一鍵寫入",
    body: "現在可完成 Cloudflare 授權、帳戶預檢與安裝紀錄。建立 D1／Access／Worker 的寫入步驟仍屬後續階段。",
  },
] as const;

export const requestedPermissions = [
  "列出可管理的 Cloudflare 帳戶",
  "建立與更新 Worker、靜態資源與 secrets",
  "建立 D1 並套用 migrations",
  "建立 Queue 與 consumer",
  "設定 Access 應用程式與 Email OTP",
];

export const oauthLoginPath = "/api/auth/login";
