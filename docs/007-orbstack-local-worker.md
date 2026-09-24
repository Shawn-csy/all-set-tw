# OrbStack 本地 Worker

`local-first-backup` 的本地主服務可以在 OrbStack 中執行。容器內使用 Wrangler/Workerd，D1 仍是 Wrangler 的本地 SQLite；雲端 D1 不會被本地頁面讀取。

OrbStack 容器固定使用 `linux/amd64`。Wrangler 的本地 Browser Rendering 目前會啟動 x86_64 瀏覽器；Apple Silicon 主機由 OrbStack 做架構轉譯，才能使用需要圖形瀏覽器的銀行連接器。這不會改變本地 D1，也不會改用 Cloudflare 遠端 Browser Rendering。

## 啟動

先確認 macOS Keychain 已有以下項目：

- service：`taiwan-fin-hub/config-encryption-key`
- account：目前 macOS 使用者

接著在專案根目錄執行：

```bash
npm run dev:orbstack
```

啟動器會以 detached 模式執行，完成建置並啟動健康檢查後就會結束；不需要一直保持終端機開啟。容器名稱是 `finance`，並設定為 `unless-stopped`，因此 OrbStack 啟動後會自動維持服務。

這個啟動器會：

1. 從 Keychain 讀取加密金鑰，不把金鑰放在 Compose、Dockerfile 或命令列參數。
2. 將金鑰寫入 Git 忽略的 `.wrangler-config/orbstack-secrets/config-encryption-key`（權限 600），供 detached container 的 Docker Secret 綁定使用。
3. 建立或更新 `finance` 容器。
4. 將容器的 `127.0.0.1:8787` 映射到主機的 `127.0.0.1:8787`。
5. 將本地 D1 狀態掛載在 `apps/worker/.wrangler`，因此重啟容器不會清空本地資料。

啟動器會保留上述被忽略的本地 secret 檔，因為 Docker Compose 的 detached container 在重啟時仍需要讀取綁定來源；它不會進入 Git，也不會寫入映像。若停止並移除本地環境，可手動刪除 `.wrangler-config/orbstack-secrets/`。

若要停止容器，執行 `docker stop finance`。Cloudflare Tunnel 仍使用主機端的 `127.0.0.1:8787`，因此主機上的 `cloudflared` 與 OrbStack 必須保持執行；不需要修改 `finance.shawnup.com` 的 Tunnel route。

## 驗證

```bash
curl http://127.0.0.1:8787/api/runtime
docker ps --filter name=finance
```

`/api/runtime` 應回報 `deploymentMode: "local-primary"` 與 `cloudBackup: false`。

若要重建映像，重新執行 `npm run dev:orbstack` 即可。不要把 `CONFIG_ENCRYPTION_KEY` 寫入 Dockerfile、Compose、Git 或公開 log。
