# OrbStack 本地 Worker

`local-first-backup` 的本地主服務可以在 OrbStack 中執行。容器內使用 Wrangler/Workerd，D1 仍是 Wrangler 的本地 SQLite；雲端 D1 不會被本地頁面讀取。

## 啟動

先確認 macOS Keychain 已有以下項目：

- service：`taiwan-fin-hub/config-encryption-key`
- account：目前 macOS 使用者

接著在專案根目錄執行：

```bash
npm run dev:orbstack
```

這個啟動器會：

1. 從 Keychain 讀取加密金鑰，不把金鑰放在 Compose、Dockerfile 或命令列參數。
2. 建立暫時的 Docker Secret。
3. 建立或更新 `taiwan-fin-hub-local-worker` 容器。
4. 將容器的 `127.0.0.1:8787` 映射到主機的 `127.0.0.1:8787`。
5. 將本地 D1 狀態掛載在 `apps/worker/.wrangler`，因此重啟容器不會清空本地資料。
6. 結束時清除暫時 Secret。

按 `Ctrl-C` 停止。Cloudflare Tunnel 仍使用主機端的 `127.0.0.1:8787`，因此不需要修改 `finance.shawnup.com` 的 Tunnel route。

## 驗證

```bash
curl http://127.0.0.1:8787/api/runtime
docker ps --filter name=taiwan-fin-hub-local-worker
```

`/api/runtime` 應回報 `deploymentMode: "local-primary"` 與 `cloudBackup: false`。

若要重建映像，重新執行 `npm run dev:orbstack` 即可。不要把 `CONFIG_ENCRYPTION_KEY` 寫入 Dockerfile、Compose、Git 或公開 log。
