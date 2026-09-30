# OrbStack 本機開發 Worker

OrbStack 的本機開發環境與正式環境是兩個獨立的 Compose stack：

| 用途 | 容器          | 主機連接埠       | 狀態資料                                | image                         |
| ---- | ------------- | ---------------- | --------------------------------------- | ----------------------------- |
| 開發 | `finance-dev` | `127.0.0.1:8788` | repository 內的 `apps/worker/.wrangler` | 完整 dev toolchain            |
| 正式 | `finance`     | `127.0.0.1:8787` | repository 外的 production root         | runtime-only production image |

本文件只描述開發 stack；正式部署與資料保存請看[本機開發／正式分離](008-local-development-production.md)。

## 啟動開發環境

先確認 macOS Keychain 已有以下項目：

- service：`taiwan-fin-hub/config-encryption-key`
- account：目前 macOS 使用者

接著在專案根目錄執行：

```bash
npm run dev:orbstack
```

啟動器會使用 `docker-compose.dev.yml` 建立或更新 `finance-dev`，並在 detached 模式等待健康檢查完成。開發 Worker 使用 `wrangler.local.toml`、開發用本地 D1，以及 repository 內的 `.wrangler` 狀態目錄。

Apple Silicon 主機上的容器固定使用 `linux/amd64`，因為本地 Browser Rendering 的銀行連接器需要 x86_64 瀏覽器。OrbStack VM 不提供 Chrome 可用的 SUID/user-namespace sandbox，因此開發容器設定 `CI=true`，讓本地瀏覽器以 `--no-sandbox` 啟動。

開發容器只綁定主機 `127.0.0.1:8788`，不應該由正式 Tunnel 指向它。正式流量仍指向 `127.0.0.1:8787` 的 `finance` 容器。

## 常用操作

```bash
curl http://127.0.0.1:8788/api/runtime
docker ps --filter name=finance-dev
docker stop finance-dev
docker start finance-dev
```

如果要連容器與開發狀態一起清除：

```bash
docker rm -f finance-dev
rm -rf apps/worker/.wrangler .wrangler-config/orbstack-secrets
```

這些操作只會影響開發環境，不會刪除正式容器 `finance` 或 production root。

不要直接執行 `docker compose up`，因為 `npm run dev:orbstack` 會先從 macOS Keychain 準備 Docker Secret。不要把 `CONFIG_ENCRYPTION_KEY` 寫入 Dockerfile、Compose、Git 或公開 log。
