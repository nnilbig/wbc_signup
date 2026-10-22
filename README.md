# WHONEXT B.C.

臨打報名頁。前端放 GitHub Pages，後端是 Google Apps Script（GAS）＋ Google 試算表。

```
GitHub Pages（index.html）
   │  fetch：GET 讀場次、POST 報名／取消
   ▼
GAS /exec（程式碼.gs，只回 JSON）
   ▼
Google 試算表：「場次」「報名」
```

## 第一次部署

**1. 後端（GAS）**

1. 試算表 → 擴充功能 → Apps Script，`程式碼.gs` 整份換成本 repo 的 `程式碼.gs`
2. 專案裡如果有 `index` HTML 檔，可以刪掉（後端已不再輸出網頁）
3. 函式選單選 `test` → 執行 → 授權
4. 部署 → 新增部署作業 → 網頁應用程式；執行身分「我」、存取「所有人」
5. 複製 `/exec` 網址

**2. 前端（GitHub Pages）**

1. `index.html` 裡的 `API` 換成剛剛的 `/exec` 網址
2. GitHub 新增 repo（Public），上傳 `index.html`
3. repo → Settings → Pages → Source 選「Deploy from a branch」，Branch 選 `main`、資料夾 `/ (root)` → Save
4. 一兩分鐘後網址會出現在同一頁：`https://<帳號>.github.io/<repo名稱>/`

**3. 分享**

網址後面加 `?openExternalBrowser=1`，貼到 LINE 群組記事本。

## 之後修改

| 改了什麼 | 怎麼更新 |
| --- | --- |
| `index.html` | 上傳覆蓋 GitHub 上的檔案，約 1 分鐘生效 |
| `程式碼.gs` | 存檔 → 部署 → 管理部署作業 → 編輯 → 版本「新版本」→ 部署（`/exec` 網址不變） |

不要按「新增部署作業」，會產生新的 `/exec` 網址，前端就要跟著改。

## API

| 方法 | 內容 | 回傳 `data` |
| --- | --- | --- |
| `GET /exec` | — | 開放中的場次陣列 |
| `POST /exec` | `{"action":"signUp","sid":"S001","name":"nn"}` | `{ msg, sessions }` |
| `POST /exec` | `{"action":"cancel","sid":"S001","name":"nn"}` | `{ msg, sessions }` |

回應一律是 `{ ok: true, data }` 或 `{ ok: false, error }`。POST 的 `Content-Type` 要用 `text/plain`，不能用 `application/json`：後者會觸發 CORS 預檢，而 GAS 不處理預檢。
