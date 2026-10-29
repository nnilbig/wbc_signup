# WHONEXT B.C.

臨打報名頁（PWA）。前端放 GitHub Pages，後端是 Google Apps Script（GAS）＋ Google 試算表，推播用 Firebase Cloud Messaging。

```
手機主畫面：WHONEXT 圖示（全螢幕開啟）
   │
GitHub Pages：index.html／app.js／style.css／config.js／manifest／firebase-messaging-sw.js
   │  fetch：GET 讀場次、POST 報名／取消／開關通知
   ▼
GAS /exec（程式碼.gs，只回 JSON）──► 試算表：「場次」「報名」「推播」
   │  遞補、選單「通知新場次」
   ▼
Firebase Cloud Messaging（HTTP v1）──► 球友手機跳通知
```

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html`／`style.css`／`app.js` | 頁面；測試版、正式版完全相同 |
| `config.js` | 環境設定：API 網址、Firebase、VAPID 公鑰、環境名稱 |
| `manifest.webmanifest` | 主畫面名稱、圖示、全螢幕 |
| `firebase-messaging-sw.js` | 背景接收推播、點通知開啟頁面 |
| `icons/`、`apple-touch-icon.png` | 主畫面圖示 |
| `env/dev/` | 測試版的 `config.js`、`manifest.webmanifest`（覆蓋根目錄同名檔） |
| `程式碼.gs`／`appsscript.json` | GAS 後端與權限設定 |

根目錄是**正式版**（`firebase: null` 時不顯示通知功能，跟現在一樣）。

## 測試環境（開發期間正式版完全不動）

**1. 試算表與 GAS**

1. 正式版試算表「建立副本」→ 命名 `WHONEXT B.C. 預約平台【測試】`；清空「報名」第 2 列以下，「場次」改成測試日期（名額 2、候補 2）
2. 副本 → 擴充功能 → Apps Script：
   - `程式碼.gs` 換成本 repo 的版本
   - 專案設定 → 勾選「在編輯器中顯示 appsscript.json」→ 內容換成本 repo 的 `appsscript.json`
3. 部署 → 新增部署作業 → 網頁應用程式；執行身分「我」、存取「所有人」→ 複製 `/exec` 網址
4. 瀏覽器開 `…/exec?action=sessions`，看到 JSON 即可

**2. Firebase**（與試算表同一個 Google 帳號）

1. [Firebase 主控台](https://console.firebase.google.com/) 新增專案 `whonext-bc-dev`（Analytics 可關）
2. 專案設定 → 一般 → 新增「網頁應用程式」→ 複製 `firebaseConfig`
3. 專案設定 → Cloud Messaging → 網路設定 → 網路推播憑證 →「產生金鑰組」→ 複製公鑰
4. 專案設定 → 一般 → 記下**專案編號**（一串數字）

**3. GAS 連上 Firebase**

1. [Google Cloud 主控台](https://console.cloud.google.com/) 切到 `whonext-bc-dev` 專案 → API 和服務 → OAuth 同意畫面：使用者類型「外部」，填 App 名稱與 Email；**發布狀態按「發布應用程式」改為正式版**（留在「測試中」的話，授權 7 天就失效，API 會壞）
2. Apps Script → 專案設定 → Google Cloud Platform (GCP) 專案 →「變更專案」→ 填專案編號
3. 專案設定 → 指令碼屬性 → 新增 `FCM_PROJECT_ID` = `whonext-bc-dev`
4. 編輯器選 `test` → 執行 → 重新授權（會出現「Google 尚未驗證這個應用程式」→ 進階 → 前往）
5. 部署 → 管理部署作業 → 編輯 → 版本「新版本」→ 部署

**4. 前端**

1. GitHub 新增 repo `whonext-bc-dev`（Public）
2. 上傳本 repo 根目錄所有檔案（`env/`、`程式碼.gs`、`appsscript.json` 除外）
3. 再用 `env/dev/config.js`、`env/dev/manifest.webmanifest` 覆蓋同名檔；`config.js` 填入：
   - `api`：步驟 1 的 `/exec` 網址
   - `firebase`：步驟 2 的 `firebaseConfig` 整段
   - `vapidKey`：步驟 2 的公鑰
4. Settings → Pages → Deploy from a branch → `main`、`/ (root)`
5. 網址：`https://nnilbig.github.io/whonext-bc-dev/`，頁首有黃色 TEST

## 試算表選單「WHONEXT」

重新整理試算表後出現在上方選單列。

| 項目 | 用法 |
| --- | --- |
| 通知新場次 | 在「場次」點選某一列 → 執行 → 確認後推播給所有開啟通知的裝置：「11/3 20:00-22:00 開放報名，剩 15 位」 |
| 發送測試通知 | 確認後推播「推播測試成功」給所有開啟通知的裝置 |

「推播」工作表會在第一次有人開啟通知時自動建立。

## 驗證清單（測試版）

1. `…/exec?action=sessions` 與不帶參數的 `…/exec` 都回 JSON
2. 報名、排候補、額滿、重複報名、取消、遞補結果與正式版一致
3. iPhone Safari 開啟：顯示「加到主畫面」引導卡，不顯示通知按鈕；從主畫面開啟：沒有引導卡、沒有網址列，名稱 WHONEXT DEV
4. Android Chrome：可安裝、全螢幕
5. 「開啟通知」→ 允許 →「通知已開啟」（不用填名字），「推播」工作表多一列
6. 選單「發送測試通知」→ 手機鎖定時也收到
7. A、B 正取，C 候補；取消 A → 所有開啟通知的裝置收到「10/31 20:00-22:00：C 已遞補」，管理者信件寫「推播：已通知 N 支裝置」
8. 「通知新場次」→ 所有開啟通知的裝置都收到；點通知開啟預約頁
9. 刪掉主畫面圖示後再發送 →「推播」工作表該列變「失效」
10. 整個過程正式版試算表與 `/exec` 沒有變動

## 上線（切換正式版）

正式版網址不變（`https://nnilbig.github.io/wbc_signup/`），LINE 記事本的連結不用換。

1. Firebase 新增正式專案 `whonext-bc`，照「測試環境」步驟 2、3 設定（指令碼屬性 `FCM_PROJECT_ID` = `whonext-bc`）
2. 正式版 `程式碼.gs`、`appsscript.json` 換成新版 → 管理部署作業 → 新版本（`/exec` 不變；舊前端不帶參數的 GET 仍可用）
3. 本 repo 根目錄 `config.js` 填入正式版 `firebase`、`vapidKey` → push
4. LINE 記事本附上 `ios-guide.png`（iPhone 加到主畫面教學）

**回滾**：GAS 管理部署作業 → 編輯 → 版本選回上一版；前端 `git revert` 後 push。「推播」工作表不影響舊版，不用刪。

## 之後修改

| 改了什麼 | 怎麼更新 |
| --- | --- |
| 前端檔案 | 上傳覆蓋 GitHub 上的檔案，約 1 分鐘生效 |
| `程式碼.gs` | 存檔 → 部署 → 管理部署作業 → 編輯 → 版本「新版本」→ 部署（`/exec` 網址不變） |

不要按「新增部署作業」，會產生新的 `/exec` 網址，前端就要跟著改。

## API

| 方法 | 內容 | 回傳 `data` |
| --- | --- | --- |
| `GET /exec?action=sessions` | 不帶 `action` 也一樣 | 開放中的場次陣列 |
| `POST /exec` | `{"action":"signUp","sid":"S001","name":"nn"}` | `{ msg, sessions }` |
| `POST /exec` | `{"action":"cancel","sid":"S001","name":"nn"}` | `{ msg, sessions }`；遞補時推播給所有開啟通知的裝置 |
| `POST /exec` | `{"action":"subscribe","token":"…","oldToken":"…","platform":"ios"}`（`oldToken` 選填：token 換新時更新原列） | `{ msg }` |
| `POST /exec` | `{"action":"unsubscribe","token":"…"}` | `{ msg }` |

回應一律是 `{ ok: true, data }` 或 `{ ok: false, error }`。POST 的 `Content-Type` 要用 `text/plain`，不能用 `application/json`：後者會觸發 CORS 預檢，而 GAS 不處理預檢。

「推播」工作表：A 建立時間｜B 姓名（不使用，保留欄位）｜C 裝置 token｜D 平台（ios／android／desktop）｜E 狀態（有效／失效）｜F 最後更新。同一個 token 再登記時更新原列。
