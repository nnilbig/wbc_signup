// 環境設定：測試版與正式版只有這個檔案和 manifest.webmanifest 不同
var CONFIG = {
  env: 'prod', // 'dev' 時標題旁顯示 TEST
  appName: 'WHONEXT', // iPhone 主畫面的名稱，與 manifest 的 short_name 相同

  // GAS 部署後的 /exec 網址（部署 → 管理部署作業 → 網頁應用程式網址）
  api: 'https://script.google.com/macros/s/AKfycbwDQOxRFRnl2c3oWy-tWP_ULhjGom4FU2NQnp2zpf3_xBYrVp-Myy2NuTjcJh_zgQoz/exec',

  // Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → firebaseConfig；null = 不提供通知
  firebase: {
    apiKey: 'AIzaSyBcZu0JXHdg-Cxq_eHhvsH5UwYaJSghlSE',
    authDomain: 'whonext-bc-signup.firebaseapp.com',
    projectId: 'whonext-bc-signup',
    storageBucket: 'whonext-bc-signup.firebasestorage.app',
    messagingSenderId: '385230487745',
    appId: '1:385230487745:web:bcbf9da0d58698ca739440'
  },

  // Firebase 主控台 → 專案設定 → Cloud Messaging → 網路推播憑證 → 金鑰組（公鑰）
  vapidKey: 'BMnZ6bdLFV9hLAHbVsLa3VTYortQb1QbtRjl0YHrcJn9SDQ0CUUsGeoRFT3I1hr73usg6Q47GqWxvM3bqSbogPo'
};
