<p align="center">
  <img src="apps/web/public/icon-512x512.png" alt="不用記帳 Logo" width="160">
</p>

# 不用記帳

**ALL SET — 自動同步銀行、信用卡、投資與電子發票的自架個人財務整合工具。**

## 與上游原版的主要差異

本版本以[上游專案](https://github.com/kevchentw/taiwan-fin-hub)為基礎，除了原有的銀行、信用卡、投資與電子發票同步外，主要增加與調整以下內容：

- **地端優先與雲端備份：** 本地 Worker + 本地 D1 作為日常主環境，支援完整快照備份至 Cloudflare D1，以及從雲端快照還原；雲端 Worker 預設為唯讀，不執行同步與排程。
- **更完整的財務分析：** 新增支出分析、購買品項、週期性支出、現金流分類與發票配對，並改善資產轉移、現金提款與現金支付的計算方式。
- **投資與現金資產管理：** 支援現金錢包、手動資產、股票報價、投資交易整理、持倉成本與未實現損益分析。
- **AI 財務資料匯出：** 可依日期範圍匯出經過去識別化的財務 JSON，提供 ChatGPT 或其他 AI 分析消費、現金流、持倉與投資交易。
- **容器化部署與開發環境：** 增加容器化 Worker、開發／正式環境分離、Cloudflare Tunnel 與 Access 的部署說明，並補強瀏覽器連接器在本機執行時的安全與穩定性。

**可免費自架：** `main` 以地端優先與雲端備份為主要部署模式：本地 Worker + 本地 D1 負責日常使用，Cloudflare D1 保存備份。Cloudflare Worker 仍可透過 [Cloudflare Workers Free Plan](https://developers.cloudflare.com/workers/platform/pricing/) 部署，但公開 `wrangler.toml` 預設為唯讀的 `cloud-backup` 模式。

## 目前介面

以下畫面使用匿名 Demo 資料，取自目前版本。

| 桌面版總覽                                                                                                                         | 手機版總覽                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a href="images/screenshots/01-dashboard.png"><img src="images/screenshots/01-dashboard.png" alt="桌面版總覽畫面" width="720"></a> | <a href="images/screenshots/02-overview-mobile.png"><img src="images/screenshots/02-overview-mobile.png" alt="手機版總覽畫面" width="260"></a> |

| 資產清冊                                                                                                       | 活動分析                                                                                                           | 設定與資料來源                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| <a href="images/screenshots/03-assets.png"><img src="images/screenshots/03-assets.png" alt="資產清冊畫面"></a> | <a href="images/screenshots/04-activity.png"><img src="images/screenshots/04-activity.png" alt="活動分析畫面"></a> | <a href="images/screenshots/05-settings.png"><img src="images/screenshots/05-settings.png" alt="設定與資料來源畫面"></a> |

## 支援資料來源

| 資料來源     | 支援內容                                                                                              | 登入與驗證                   |
| ------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 電子發票載具 | 載具發票與品項明細                                                                                    | App 登入                     |
| 集保 e 存摺  | 交割帳戶餘額與明細（[支援銀行](https://epassbook.tdcc.com.tw/zh/g1.aspx)）、股票、ETF、基金持倉與交易 | App 登入；首次可能需要 OTP   |
| 玉山銀行     | 存款帳戶、餘額與交易；信用卡帳單與刷卡交易                                                            | 網銀登入                     |
| 國泰世華銀行 | 存款帳戶、餘額與交易；信用卡帳單與刷卡交易                                                            | 網銀登入；額外驗證需人工處理 |
| 永豐行動銀行 | 信用卡總覽、近期帳單與未出帳消費                                                                      | 網銀登入；AI 自動辨識驗證碼  |
| 台新銀行     | 信用卡額度、帳單、已入帳與即時授權消費                                                                | 網銀登入；AI 自動辨識驗證碼  |
| 中國信託銀行 | 存款帳戶、餘額與交易；信用卡帳單、已入帳、未出帳與即時消費明細                                        | App 登入                     |
| 新光銀行     | 臺外幣帳戶、餘額、交易明細與信用卡帳單                                                                | App 登入                     |
| 華南銀行     | 存款帳戶與餘額；信用卡帳單與刷卡明細                                                                  | 網銀登入；AI 自動辨識驗證碼  |
| 王道銀行     | 活存、定存、餘額與交易                                                                                | App 登入；AI 自動辨識驗證碼  |
| 第一銀行     | 存款帳戶、餘額與交易明細；信用卡帳單與刷卡明細                                                        | 網銀登入；AI 自動辨識驗證碼  |

## 使用限制

- 可在「設定 → AI 匯出」選擇起訖日期，下載最多 367 天的 JSON，交給 ChatGPT 或其他 AI 分析消費、現金流、目前持倉與投資交易；也可直接讀取 `GET /api/ai/financial-context?from=YYYY-MM-DD&to=YYYY-MM-DD`。匯出會保留原始幣別並排除完整帳號、券商帳號與 raw payload。投資決策理由若未在資料中保存，JSON 會標示為資料限制，不會自行捏造。
- 投資持倉可在「資產 → 投資」為同步持倉補上每股成本，並在「投資收益」查看已有成本持倉的未實現損益。若交易來源缺少成交金額或完整歷史，頁面會列出買賣／贖回事件，但不會將收回本金當成獲利，也不會宣稱已算出整體歷史報酬率。
- 連接器依賴外部網頁、App API 與回應格式；資料來源改版後可能需要更新才能恢復同步。
- 系統不會繞過圖形驗證碼、OTP、裝置驗證等互動式安全機制；需要人工處理時會停止同步並顯示提示。
- 部分銀行自動登入可能中斷你正在使用的官方 App 或網銀工作階段。
- 資料更新時間與完整性取決於外部服務，不應視為銀行、券商或財政部的即時正式對帳資料。

## 雲端部署與備份

本專案使用的 Workers、D1、Queues、Workers AI 與 Browser Run 均提供免費額度。各項免費額度並非無限；超過服務限制時，相關功能可能暫停至額度重置。日常資料寫入與銀行／發票同步應由地端 Worker 執行，Cloudflare Worker 只讀取雲端備份。

**需要：** [Cloudflare 帳號](https://dash.cloudflare.com/signup)、[GitHub 帳號](https://github.com/signup)

### 步驟一：部署唯讀雲端 Worker（選用）

若需要在雲端檢查備份資料，請先將本專案放到你自己的 GitHub repository，再從 Cloudflare Dashboard 的 **Deploy to Cloudflare** 流程選擇該 repository。Cloudflare 會自動建立 D1 Database，並部署預設的唯讀 `cloud-backup` Worker。部署時請使用你自己的 GitHub 帳號、repository、Worker 名稱與網域，不要直接沿用其他部署的設定。

Cloudflare Builds 會在 build 階段自動檢查並建立排程同步所需的 Queue；正式部署腳本也會再次檢查。既有安裝更新到使用 Queue 的版本時不需要手動建立資源。

首次使用時，依畫面透過 **Git account → New Github Connection → Install & Authorize** 授權 Cloudflare 存取 GitHub。

部署頁會先預填 Access 相關欄位；首次部署只需將 `CONFIG_ENCRYPTION_KEY` 改成自己產生的隨機金鑰，`TEAM_DOMAIN` 與 `POLICY_AUD` 會在步驟二設定。

<img src="images/deploy-setup.png" alt="Cloudflare 部署設定" width="450">

`CONFIG_ENCRYPTION_KEY` 是系統加密連接器設定時必須使用的金鑰，可用下列指令產生：

```bash
openssl rand -hex 32
```

使用一鍵部署時只需填入一次，部署後由 Cloudflare 保存；日常使用與後續自動更新不需要重新輸入。沒有另外記下金鑰不會影響現有部署，但若日後要重建 Worker、搬移環境或沿用既有 D1，就必須使用相同金鑰，否則需要重新設定所有連接器。若重視災難復原，建議將它保存在密碼管理器；無論是否另外保存，都不要在既有部署中任意更換或刪除。

填寫完成後點擊 **Deploy**。

### 步驟二：啟用登入保護

1. 前往 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**，選擇剛建立的 Worker
2. 確認 `workers.dev` 沒有啟用，正式入口只保留你自己的自訂網域，例如 `finance.example.com`
3. 在該自訂網域的 Access Application 上啟用 Cloudflare Access，將存取模式設為 **Restricted**

<img src="images/deploy-domains-restricted.png" alt="啟用 Cloudflare Access" width="700">

切換後，Cloudflare 會顯示以下資訊：

- **Audience (aud)**：填入 Worker Secret `POLICY_AUD`
- **JWKs URL**：取出前面的網域作為 `TEAM_DOMAIN`，例如 `https://yourteam.cloudflareaccess.com`

前往 **Settings → Variables and secrets** 設定這兩個 Secret。

<img src="images/deploy-secrets.png" alt="設定 Cloudflare Access Secrets" width="700">

### 步驟三：確認雲端備份部署

1. 開啟雲端 Worker 的網址，確認會先要求 Cloudflare Access 登入
2. 登入後確認可以讀取已上傳的雲端備份資料
3. 連接器設定、資料寫入與同步請改在下方的地端 Worker 執行；雲端 `cloud-backup` Worker 會拒絕寫入、排程同步與 Queue 消費

### 步驟四：調整登入方式與有效期限（選用）

Cloudflare Access 可能預設使用 Email OTP，登入狀態通常會在 24 小時後過期。以下設定可改用 Cloudflare 帳號登入，並將登入期限延長至一個月。

#### 使用 Cloudflare 帳號登入

1. 前往 **Zero Trust → Integrations → Identity providers**，確認已有 **Cloudflare**；若沒有，點選 **Add new identity provider → Cloudflare**
2. 啟用 **Restrict to account members** 並儲存，避免非此 Cloudflare 帳號成員登入
3. 前往 **Zero Trust → Access controls → Applications → 你的 Access Application → Authentication**，將登入方式設為 **Cloudflare**
4. 若只使用此登入方式，可啟用 **Apply instant authentication**，略過登入方式選擇頁

新建立的 Zero Trust organization 通常已預設啟用 Cloudflare identity provider，不需要另外新增。

#### 將登入期限延長至一個月

1. 在你的 Access Application 中，將 **Session Duration** 設為 **1 month**
2. 前往 **Zero Trust → Access controls → Access settings**，將 **Global session duration** 設為 **1 month**
3. 若 Access Policy 另外設定了 Session Duration，也要改為一個月，否則會以較短的期限為準

更多 Queue、Access、自動更新原理與故障排查請參考[進階部署與更新](docs/005-deployment.md)。

## 自動更新

Cloudflare 的 Deploy to Cloudflare 流程目前不會將 `.github/workflows` 複製到新 repository，因此首次部署可以正常使用，但需要完成下方的一次性設定才會啟用版本更新。

### 一次性啟用更新功能

不需要修改程式碼，可直接在 GitHub 網頁完成：

1. 在你的部署 repository 開啟 [`deploy/github/sync-upstream.yml`](deploy/github/sync-upstream.yml)，點擊 **Raw** 並複製完整內容
2. 回到 repository 首頁，選擇 **Add file → Create new file**
3. 將檔名設為 `.github/workflows/sync-upstream.yml`，貼上剛才複製的內容並 commit 至 `main`
4. 前往 **Settings → Actions → General → Workflow permissions**，確認已允許 GitHub Actions 讀寫 repository 內容

若已將 repository clone 至本機，也可以執行：

```bash
mkdir -p .github/workflows
cp deploy/github/sync-upstream.yml .github/workflows/sync-upstream.yml
git add .github/workflows/sync-upstream.yml
git commit -m "啟用版本自動更新"
git push
```

完成一次性設定後，可以前往部署 repository 的 **Actions → Sync Latest Version → Run workflow**，點擊 **Run workflow** 立即更新。workflow 也會在每天台灣時間 **04:15** 自動執行。

每次執行會取得最新版本、進行安全三方合併，並由 Cloudflare Workers Builds 重新部署。若你修改過程式碼並與上游發生衝突，workflow 會停止且不會推送；請從 Actions 紀錄查看衝突並手動處理。首次同步、備份 branch 與舊版 workflow 的排查方式請參考[進階部署與更新](docs/005-deployment.md)。

## 本機開發

建立不納入版本控制的私人設定；`wrangler.local.toml` 使用本地模擬 D1，請不要填入正式 D1 的 `database_id`，並在 `.dev.vars` 設定自己的 `CONFIG_ENCRYPTION_KEY`：

```bash
cp apps/worker/wrangler.local.toml.example apps/worker/wrangler.local.toml
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm install
npx wrangler login
npm run db:migrate:local -w @taiwan-fin-hub/worker
npm run dev
```

範例設定的 D1 使用本地模擬資源，Workers AI 使用 Cloudflare remote binding；請勿在 dev 設定中指向正式資料庫。`wrangler login` 也供雲端備份與 Workers AI remote binding 使用。常用驗證指令：

```bash
npm run format:check
npm run typecheck
npm run verify:web
npm run test:backend
npm run build
```

本機 relay、資料庫遷移與既有 D1 部署方式請參考[進階部署與更新](docs/005-deployment.md)。

### 互動 Demo

根網址現在是公開入口，會分流到正式登入或 Demo。要在本機啟動一份可操作、但完全不碰既有本地 D1 的 Demo：

```bash
npx wrangler login
npm run demo
```

啟動後開啟 `http://127.0.0.1:8787/`，選擇「瀏覽互動 Demo」即可。Demo 使用獨立的 `.wrangler-demo` 持久化目錄與 `packages/db/seeds/demo.sql`，每次啟動都會重建示範資料；`DEMO_MODE` 會停用登入需求與所有寫入、同步操作。要直接操作假 D1 工作區可使用 `http://127.0.0.1:8787/#/demo/overview`；正式主程式仍使用 `http://127.0.0.1:8787/#/overview`。

### 使用容器化環境執行

macOS 的本機容器環境分成開發與正式兩個 stack。開發容器使用完整工具鏈與 local dev D1，正式容器使用 runtime-only image 並連線既有的 Cloudflare D1：

```bash
npm run dev:orbstack
```

這會啟動開發 stack，預設提供 `127.0.0.1:8788`；若啟用本機正式 stack，請依你的 production root、port 與 Tunnel hostname 設定執行。push 到 `main` 後，GitHub Actions 可在你設定的 self-hosted runner 上建置並更新正式容器。完整說明請參考[容器化本機 Worker](docs/007-orbstack-local-worker.md)與[本機開發／正式分離](docs/008-local-development-production.md)。

## 地端優先與雲端備份

若要讓地端資料庫成為日常主資料、再定期備份到雲端 D1，直接使用 `main` 的地端優先設定即可，不需要切換 branch。地端 Worker 負責頁面、銀行／發票同步與所有寫入；雲端 Worker 設為唯讀備份模式，不會啟動排程或 Queue 同步。

```bash
cp apps/worker/wrangler.local.toml.example apps/worker/wrangler.local.toml
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm install
npm run db:migrate:local -w @taiwan-fin-hub/worker
npm run dev
```

備份前請準備被 Git 忽略的 `wrangler.private.toml`，確認它指向雲端 D1；再執行 `npm run backup:local -- --confirm`。若要以雲端快照重建本地 D1，執行 `npm run restore:local -- --confirm`。完整的 Tunnel、Access、備份排程與還原注意事項請參考[地端優先與雲端備份](docs/006-local-first-backup.md)。

## 技術架構

前端使用 Svelte 5、TypeScript、Tailwind CSS 4 與 shadcn-svelte。

後端執行於 Cloudflare Workers，以 Hono 提供 API，並整合 D1、Access、Browser Run、Workers AI、Cron Triggers 與 Queues。

專案以 npm workspaces 管理 Web、Worker、共用型別、資料庫與連接器套件。

前後端與共用套件皆使用 TypeScript 7 型別檢查；Svelte 前端透過 `svelte-check --tsgo` 執行，並保留工具所需的 TypeScript 6 相依。

詳細設計請參考[後端架構](docs/002-backend-architecture.md)、[前端架構](docs/003-frontend-architecture.md)與[連接器開發](docs/004-connector-development.md)。

## 安全機制

- Cloudflare Access 是一般模式的登入閘道；Worker 會驗證 JWT 的簽章、issuer、audience 與有效期限。
- 連接器帳密以 `CONFIG_ENCRYPTION_KEY` 衍生的金鑰進行 AES-GCM 加密，D1 只儲存密文。
- 目前不支援金鑰輪替；若刪除或更換 Cloudflare 中的金鑰，必須重新設定所有連接器。

## 免責聲明

本程式僅供個人研究與自用，未與臺灣集中保管結算所、財政部、金融監督管理委員會、各銀行或任何金融機構合作，亦未獲前述機構授權或背書。本程式所呈現之資料以您自行提供之憑證取得，作者不保證資料之即時性、正確性與完整性，亦不對因使用本程式所產生之任何直接或間接損失負責。請勿將本程式用於任何商業用途。

## 致謝

本專案以 [kevchentw/taiwan-fin-hub](https://github.com/kevchentw/taiwan-fin-hub) 為基礎發展而來。特別感謝上游專案的原作者與所有貢獻者，提供穩固的架構、連接器實作與持續累積的開源成果。

## License

本專案採用 [MIT License](LICENSE)，並保留原專案的著作權與授權聲明。
