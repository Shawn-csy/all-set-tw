# 地端優先與雲端備份

`local-first-backup` 是與線上部署不同的部署模式：地端 Worker 與地端 D1 是日常使用的主環境，雲端 D1 只保存備份，不負責銀行、電子發票或其他連接器同步。

## 架構

```text
瀏覽器
  ↓ cloudflared Tunnel
地端 Worker（local-primary）
  ↓
地端 D1（唯一可寫入來源）
  ↓ 定期完整快照
雲端 D1（cloud-backup）
```

地端連線中斷時，地端 Worker 仍可使用已存在的資料。雲端備份不是即時網站 fallback；地端主機故障時，才用雲端 D1 還原資料或另外部署暫時的雲端服務。

## 建立地端環境

先建立不納入版本控制的本地設定：

```bash
cp apps/worker/wrangler.local.toml.example apps/worker/wrangler.local.toml
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm install
npm run db:migrate:local -w @taiwan-fin-hub/worker
```

`wrangler.local.toml` 使用本地模擬 D1，並將 `DEPLOYMENT_MODE` 設為 `local-primary`。不要在這個檔案使用正式 D1 的 `database_id` 或 `remote = true`。

若要以目前雲端資料作為地端初始資料，先執行一次還原：

```bash
npm run restore:local -- --confirm
```

這會以雲端 D1 快照覆蓋地端 D1；若地端已有尚未備份的資料，請不要執行此指令。

啟動地端 Worker：

```bash
npm run dev
```

再將本地 Worker 的連接埠透過 `cloudflared tunnel` 暴露出去。Tunnel 只負責 HTTP 流量，不會替 D1 做備份或同步。

## 上傳雲端備份

執行備份前，確認：

- `wrangler.private.toml` 指向正確的雲端 D1。
- 雲端 Worker 使用 `DEPLOYMENT_MODE = "cloud-backup"`。
- 本地 D1 已完成 migration。
- 目前沒有另一個 Worker／排程同時寫入同一個雲端 D1。

手動備份：

```bash
npm run backup:local -- --confirm
```

備份工具會先從本地 D1 匯出資料，再清除雲端備份 D1 的應用資料表並匯入快照；`d1_migrations` 等 Wrangler metadata 不會被刪除。完整快照包含加密後的連接器設定，因此仍應保護 Cloudflare 帳號、D1 與本地檔案權限。

若要定期備份：

```bash
LOCAL_BACKUP_INTERVAL_MINUTES=30 npm run backup:watch
```

備份工具需要 Wrangler 已登入，並使用被忽略的 `wrangler.private.toml`。它不會把 SQL 快照留在 repository；暫存檔在執行完畢後刪除。

## 成本與取捨

日常頁面讀取與同步讀寫都發生在本地 D1，不會產生 Cloudflare D1 的雲端讀寫量。雲端成本主要來自備份上傳；完整快照會把所有資料重新寫入雲端，因此不應設定過短的備份間隔。

目前這個分支先採用容易驗證與還原的完整快照。若資料量或備份頻率增加，下一步應改成以變更序號／增量檔案備份，避免每次清空並重寫整個雲端 D1。

## 與線上版本的差異

| 項目           | 線上版本          | `local-first-backup` |
| -------------- | ----------------- | -------------------- |
| 日常部署       | Cloudflare Worker | 本地 Worker + Tunnel |
| 主資料庫       | 雲端 D1           | 地端 D1              |
| 雲端 D1 角色   | 可寫入主資料      | 備份副本             |
| 銀行／發票同步 | 雲端執行          | 地端執行             |
| 離線可用性     | 依雲端連線        | 可讀取本地資料       |
| 雲端故障復原   | 直接使用 Worker   | 從雲端備份還原       |
