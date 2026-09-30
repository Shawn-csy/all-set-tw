# 本機開發／正式分離

本專案的正式 Worker 可以執行在同一台 macOS／OrbStack 主機上，但正式服務不應該直接使用開發 checkout、開發 image 或 dev D1。Worker process 在本機，正式資料仍位於既有的 Cloudflare D1。

```text
開發者工作區
  └─ npm run dev:orbstack
       └─ finance-dev
            ├─ 完整 dev dependencies
            ├─ wrangler.local.toml
            └─ repository/apps/worker/.wrangler（dev D1）

git push main
  └─ GitHub Actions hosted validation
            └─ 同一台主機的 self-hosted runner（label: finance-production）
                 └─ build finance-worker-production:<commit>
                      └─ finance
                           ├─ runtime-only image
                           ├─ wrangler.production.local.toml（D1 remote binding）
                           ├─ $FINANCE_PRODUCTION_ROOT/state（本地 Queue／Wrangler state）
                           └─ Cloudflare D1（既有 production database）
```

因此，刪除開發 checkout、停止 `finance-dev`，都不會刪除正式 image、正式容器或 Cloudflare D1。正式資料不在 repository，也不在開發容器的 bind mount 裡。

## 本機正式環境

正式部署的預設資料根目錄是：

```text
~/.local/share/taiwan-fin-hub-production
```

也可以用 `FINANCE_PRODUCTION_ROOT` 指定固定路徑。部署腳本會在這個目錄建立：

- `state/`：本機 Queue 與 Wrangler local state；不存放正式 D1 資料
- `vars/.dev.vars`：正式 Worker 的 secrets 與環境變數，不進 Git
- `secrets/config_encryption_key`：從 macOS Keychain 產生的 Docker Secret
- `wrangler-config/`：正式 Wrangler 設定快取
- `docker-compose.yml` 與 `.env`：讓正式容器不依賴 repository 也能重啟

第一次部署前，先建立正式 secrets 檔。不要直接把開發檔複製成正式設定後不檢查內容：

```bash
export FINANCE_PRODUCTION_ROOT="$HOME/.local/share/taiwan-fin-hub-production"
mkdir -p "$FINANCE_PRODUCTION_ROOT/vars"
cp apps/worker/.dev.vars.example "$FINANCE_PRODUCTION_ROOT/vars/.dev.vars"
# 編輯正式的 TEAM_DOMAIN、POLICY_AUD、VAPID 與其他必要設定
npm run deploy:local-production
```

`CONFIG_ENCRYPTION_KEY` 會由 `taiwan-fin-hub/config-encryption-key` Keychain 項目讀取；也可以在執行部署時明確提供同名環境變數。

正式 image 使用 `docker/orbstack/worker.production.Dockerfile`。它在 builder stage 使用完整依賴建置 Web，runtime stage 只保留 Worker workspace 的 production dependencies、Wrangler/Workerd、Worker source 與建置後的 Web assets；Browser Rendering 透過 Worker `BROWSER` binding，不在正式 image 內安裝 Chromium 或開發用 GUI libraries，也不會把 dev container 的 `node_modules` 或 `.wrangler` 帶進正式 runtime。

正式設定中的 D1 binding 使用現有 `taiwan-fin-hub` Cloudflare D1 與 `remote = true`。正式容器啟動時只執行 remote migrations，不會建立或使用 production local D1。

部署會沿用 repository 的 `XDG_CONFIG_HOME=.wrangler-config` Wrangler OAuth 登入狀態，並把登入設定複製到獨立的 production root；不需要把 API token 放進 shell 或 Docker Compose。若 OAuth refresh token 已過期，先在 repo root 執行一次 `XDG_CONFIG_HOME=.wrangler-config npx wrangler whoami` 完成瀏覽器重新授權，再重新部署。

正式容器以 `finance` 名稱執行，固定提供 `127.0.0.1:8787`。Cloudflare Tunnel 若要對外提供 `finance.shawnup.com`，仍只需指向這個主機埠；Tunnel 不會改變正式 D1 的位置。

## Push 後部署

`.github/workflows/ci.yml` 的 `deploy-local-production` job 只有在 push 到 `main` 且 validation 通過後執行。它需要同一台正式主機註冊一個 GitHub self-hosted runner，並加上 `finance-production` label。

Runner 只需要在暫存 checkout 中執行 build/deploy；正式容器實際使用的 image、Compose 檔與 D1 state 都位於 `FINANCE_PRODUCTION_ROOT`。因此稍後清除 runner checkout 或本機開發目錄，不會影響正在執行的 `finance`。

若不使用 GitHub Actions，也可以在 repository 根目錄手動執行：

```bash
npm run deploy:local-production
```

這會 build 新 image、更新 `finance-worker-production:latest`、重建 `finance`、對既有 Cloudflare D1 套用 remote migrations，並等待 `/api/runtime` healthcheck 通過。它不會停止或重建 `finance-dev`。執行前應再次確認 [`wrangler.production.local.toml`](../apps/worker/wrangler.production.local.toml) 的 `database_id` 是正式 D1。

## 停止、重啟與清理

```bash
docker stop finance
docker start finance
curl http://127.0.0.1:8787/api/runtime
```

刪除正式容器或 production root 都不會刪除 Cloudflare D1；production root 只包含本機 Compose、Wrangler auth、Queue state 與 secrets。Cloudflare D1 的 migration／資料仍由 Cloudflare 保存，但刪除 root 前仍應保留 secrets 與重新部署所需的 auth 設定：

```bash
docker rm -f finance
# 確認已完成備份後，才刪除 $FINANCE_PRODUCTION_ROOT
```

正式 Cloudflare D1 的備份與還原應依 Cloudflare／既有 D1 backup 流程處理；`local-first-backup` 是另一種「本地 D1 為主、雲端 D1 為備份」的架構，不是目前這個 production stack 的資料層。
