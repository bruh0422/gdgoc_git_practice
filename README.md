# Welcome Developers

一個可部署到 Cloudflare Pages 的互動式成員牆。`members/` 裡的照片會變成有重力、碰撞、彈跳與拖曳效果的圓形球體。

## 功能

- 自動掃描 `members/` 及其子資料夾中的圖片
- **建置時自動縮圖與轉檔**：等比縮小至最大 400x400 並轉為 WebP 格式，節省 90% 以上頻寬
- 將所有照片裁切成相同大小的圓形球體
- 圓球總面積最多占容器的 60%，視照片數量及視窗尺寸動態調整
- 模擬重力、碰撞、彈跳、旋轉與摩擦力
- 可用滑鼠或觸控拖曳圓球
- 游標移到圓球上時，照片會變成灰階並顯示不含副檔名的檔名
- 合併到 `main` 後，自動執行圖片優化與打包，並發布至 Cloudflare Pages
- Pull Request 會檢查 `members/` 內是否只有合法圖片，通過後自動合併

## 專案結構

```text
.
├── .github/workflows/
│   └── validate-and-automerge.yml # 驗證 PR 圖片與自動合併
├── members/                     # 成員圖片放這裡（支援 JPG, PNG, GIF, WebP 等）
├── dist/                        # 打包與 WebP 優化後的輸出目錄（由 build.js 產生）
├── build.js                     # 圖片壓縮縮圖（轉 WebP）與靜態網站打包腳本
├── generate-photos.js           # 輕量本機圖片清單掃描器
├── photos.js                    # 本機測試預設檔，請勿手動編輯
├── index.html
├── script.js
├── style.css
└── package.json
```

## 新增成員照片（同學操作流程）

1. 將個人圖片放入 `members/`，也可以建立子資料夾。
2. 建立新分支並提交變更。
3. 推送分支並建立 Pull Request。
4. GitHub Actions 會驗證圖片；通過後會啟用自動合併。
5. 合併至 `main` 後，自動化腳本會將圖片等比縮小並轉成 WebP 部署至 Cloudflare Pages。

允許的格式：

```text
.jpg  .jpeg  .png  .gif  .webp  .avif
```

驗證不只檢查副檔名，也會透過 MIME type（檔案的實際內容類型）確認檔案確實是圖片，因此只把文字檔改名成 `.jpg` 仍會被拒絕。

一般 Pull Request 只允許修改 `members/` 裡的圖片。修改任何 `README.md`（包含 `members/README.md` placeholder）、HTML、CSS、JavaScript 或 workflow 都會讓 `validate-member-images` 失敗；需要維護網站程式時，管理者必須使用 Ruleset bypass 流程。

## 本機開發與建置

需要先安裝 Node.js（建議 Node 18 以上）。

### 1. 完整建置（包含 WebP 轉檔與縮圖）

```bash
npm install
npm run build
```

建置完成後，靜態網頁與壓縮後的 `.webp` 圖片會輸出至 `dist/` 目錄，可直接使用任何靜態檔案伺服器開啟 `dist/index.html` 進行預覽。

### 2. 輕量快速預覽（不轉檔）

若只想快速確認排版而不進行圖片壓縮：

```bash
node generate-photos.js
```

接著直接於瀏覽器開啟專案根目錄的 `index.html` 即可。

## Cloudflare Pages 設定（Connect to Git）

使用 Cloudflare 原生的 Git 整合模式，免設定任何 API Token 或 Secrets：

1. 前往 [Cloudflare 儀表板](https://dash.cloudflare.com/) → **Compute (Workers & Pages)** → **Create** → **Pages** → **Connect to Git**。
2. 授權並選取你的 GitHub 儲存庫（例如 `bruh0422/gdgoc_git_practice`）。
3. 建置設定填入：
   - **Framework preset**：`None`
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **Root directory**：保持空白或 `/`
4. 點擊 **Save and Deploy** 即可完成！
5. 前往專案 **Settings → Builds & deployments → Build cache** 確認已開啟 **Build cache**（預設為開啟），如此一來每次建置都會快取已壓縮的圖片，實現秒級增量建置！
6. 之後每次合併至 `main` 分支，Cloudflare 就會自動拉取最新照片、壓縮轉檔為 WebP，並秒級發布至全球 CDN！

## Ruleset 與自動合併設定

### 1. 啟用一般合併與自動合併

前往 **Settings → General → Pull Requests**，開啟：

- Allow merge commits
- Allow auto-merge

### 2. 允許 Actions 寫入

前往 **Settings → Actions → General → Workflow permissions**，選擇：

- Read and write permissions

### 3. 建立 `main` Ruleset

前往 **Settings → Rules → Rulesets → New branch ruleset**，設定：

- Ruleset name：`Protect main`
- Enforcement status：`Active`
- Target branches：Default branch
- Require a pull request before merging
- Required approvals：`0`（若需要人工審核可自行提高）
- Require status checks to pass：加入 `validate-member-images`
- Block force pushes
- Restrict deletions

第一次設定時，必須先讓 `validate-and-automerge.yml` 在 Pull Request 中執行一次，GitHub 才會在 Ruleset 選單中顯示 `validate-member-images`。

## 注意事項

- 請勿手動修改 `photos.js` 或 `dist/photos.js`，部署時會由腳本自動重新產生。
- 圖片檔名會顯示在圓球的 hover 狀態；顯示時會自動移除副檔名。
- Pull Request 草稿不會啟用自動合併，改成 Ready for review 後才會執行。
- 從 fork 建立的 Pull Request 可能因 `GITHUB_TOKEN` 權限限制而無法自動合併，但圖片驗證仍可執行。
