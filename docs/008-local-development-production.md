# 本機開發／正式分離

本專案的正式 Worker 可以執行在同一台 macOS／OrbStack 主機上，但正式服務不應該直接使用開發 checkout、開發 image 或 dev D1。正式容器使用預先打包的單一 Worker runtime，日常資料以本機 D1 為主，Cloudflare D1 作為定期快照備份。

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
                           ├─ runtime-only image + 單一 workerd
                           ├─ wrangler.production.local.toml（本機 D1 binding）
                           ├─ $FINANCE_PRODUCTION_ROOT/state（正式本機 D1／Queue state）
                           └─ finance-d1-sync（每 30 分鐘備份至 Cloudflare D1）
```

因此，刪除開發 checkout、停止 `finance-dev`，都不會刪除正式 image、正式容器或 Cloudflare D1。正式資料不在 repository，也不在開發容器的 bind mount 裡。

## 本機正式環境

正式部署的預設資料根目錄是：

```text
~/.local/share/taiwan-fin-hub-production
```

也可以用 `FINANCE_PRODUCTION_ROOT` 指定固定路徑。部署腳本會在這個目錄建立：

- `state/`：正式本機 D1、Queue 與 Wrangler local state
- `vars/.dev.vars`：正式 Worker 的 secrets 與環境變數，不進 Git
- `secrets/config_encryption_key`：從 macOS Keychain 產生的 Docker Secret
- `wrangler-config/`：正式 Wrangler 設定快取
- `release.json`：目前 image tag、source commit 與是否含未提交修改
- `docker-compose.yml` 與 `.env`：讓正式容器不依賴 repository 也能重啟
- `state/backup-status.json`：本機到雲端 D1 備份的最近成功心跳

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

正式設定中的 D1 binding 使用本機持久化 D1。正式容器啟動時套用 local migrations，並由 `finance-d1-sync` 以獨立的低記憶體 sidecar 定期將本機完整快照同步到 `wrangler.private.toml` 指定的 Cloudflare D1；這不是雙寫，因此日常流量不會因雲端 D1 延遲而卡住。

部署會沿用 repository 的 `XDG_CONFIG_HOME=.wrangler-config` Wrangler OAuth 登入狀態，並把登入設定複製到獨立的 production root；不需要把 API token 放進 shell 或 Docker Compose。若 OAuth refresh token 已過期，先在 repo root 執行一次 `XDG_CONFIG_HOME=.wrangler-config npx wrangler whoami` 完成瀏覽器重新授權，再重新部署。

正式容器以 `finance` 名稱執行，固定提供 `127.0.0.1:8787`。Cloudflare Tunnel 若要對外提供 `finance.shawnup.com`，仍只需指向這個主機埠；Tunnel 不會改變正式 D1 的位置。

## Push 後部署

`.github/workflows/ci.yml` 的 `deploy-local-production` job 只有在 push 到 `main` 且 validation 通過後執行。它需要同一台正式主機註冊一個 GitHub self-hosted runner，並加上 `finance-production` label。

Runner 只需要在暫存 checkout 中執行 build/deploy；正式容器實際使用的 image、Compose 檔與 D1 state 都位於 `FINANCE_PRODUCTION_ROOT`。因此稍後清除 runner checkout 或本機開發目錄，不會影響正在執行的 `finance`。

若不使用 GitHub Actions，也可以在 repository 根目錄手動執行：

```bash
npm run deploy:local-production
```

這會 build 新 image、以不可變的 image tag 更新 `finance` 與 `finance-d1-sync`，並等待本機 D1 readiness、首次雲端備份與 runtime smoke test 都通過。它不會停止或重建 `finance-dev`。部署版本會記錄在 `release.json`；若工作樹未提交，檔案也會明確標記 `dirty: true`。部署前需先完成 Wrangler OAuth，並準備被 Git 忽略、指向正式 D1 的 `wrangler.private.toml`。

## 停止、重啟與清理

```bash
docker stop finance
docker start finance
curl http://127.0.0.1:8787/api/runtime
```

刪除正式容器或 production root 都不會刪除 Cloudflare D1；但 production root 內的本機 D1 是日常主資料，刪除前應先完成雲端備份並保留 secrets、Wrangler auth 與 private config：

```bash
docker rm -f finance
# 確認已完成備份後，才刪除 $FINANCE_PRODUCTION_ROOT
```

若要手動立即備份，可執行 `npm run backup:local -- --confirm`；若要以雲端快照重建正式本機 D1，使用下列指令讓流程先停止 production、還原、再重新啟動：

```bash
LOCAL_PRODUCTION_RESTORE=true \
FINANCE_PRODUCTION_ROOT="$HOME/.local/share/taiwan-fin-hub-production" \
npm run restore:local -- --confirm
```

正式 stack 的 sidecar 會每 30 分鐘自動執行一次完整本機到雲端備份；`finance-d1-sync` 只有在最近一次備份仍新鮮時才會被視為 healthy。
