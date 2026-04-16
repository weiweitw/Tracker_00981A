const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 設定資料夾路徑
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const TARGET_URL = 'https://www.ezmoney.com.tw/ETF/Information/00981A';

// 建立一個帶有重試機制與完整瀏覽器偽裝的抓取函數
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`正在進行第 ${i + 1} 次連線嘗試...`);
            const response = await axios.get(url, {
                headers: {
                    // 全套瀏覽器偽裝，降低被防火牆阻擋的機率
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'max-age=0',
                    'Upgrade-Insecure-Requests': '1',
                    'Connection': 'keep-alive'
                },
                timeout: 30000 // 增加超時限制到 30 秒
            });
            return response.data; // 成功就直接回傳 HTML
        } catch (error) {
            console.error(`第 ${i + 1} 次嘗試失敗: ${error.message}`);
            if (i === retries - 1) {
                throw new Error("已達最大重試次數，放棄抓取。");
            }
            // 每次失敗後等待 5 秒再試
            console.log("等待 5 秒後重新嘗試...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function fetchETFData() {
    try {
        console.log("開始執行 00981A 資料更新任務...");

        // 呼叫我們剛剛寫好的強化版抓取函數
        const html = await fetchWithRetry(TARGET_URL);

        console.log("網頁抓取成功！開始解析資料...");
        const $ = cheerio.load(html);

        // 取得隱藏的 JSON 資料
        const dataContent = $('#DataAsset').attr('data-content');
        if (!dataContent) {
            throw new Error("找不到 id 為 DataAsset 的元素或 data-content 屬性");
        }

        const rawData = JSON.parse(dataContent);

        // 尋找股票 (ST) 的詳細清單
        let stockDetails = [];
        for (const item of rawData) {
            if (item.AssetCode === 'ST' && item.Details) {
                stockDetails = item.Details;
                break;
            }
        }

        if (stockDetails.length === 0) {
            throw new Error("在資料中找不到股票(ST)的持股明細");
        }

        // 整理今天的持股資料
        const todayMap = {};
        stockDetails.forEach(stock => {
            todayMap[stock.DetailCode] = {
                name: stock.DetailName,
                shares: stock.Share / 1000.0, // 將股數轉換為「張」
                amount: stock.Amount
            };
        });

        console.log(`成功解析 ${Object.keys(todayMap).length} 檔股票。`);

        // 設定檔案路徑
        const yesterdayFile = path.join(dataDir, 'yesterday.json');
        const diffFile = path.join(dataDir, 'daily_diff.json');

        // 讀取昨天的資料（如果存在的話）
        let yesterdayMap = {};
        if (fs.existsSync(yesterdayFile)) {
            yesterdayMap = JSON.parse(fs.readFileSync(yesterdayFile, 'utf-8'));
        } else {
            console.log("找不到昨天的資料，今天將作為基準日。");
        }

        const diffResult = [];

        // 比較今天和昨天的資料
        for (const [code, todayData] of Object.entries(todayMap)) {
            const yesterdayData = yesterdayMap[code];
            let sharesDiff = 0;

            if (yesterdayData) {
                sharesDiff = todayData.shares - yesterdayData.shares;
            } else {
                sharesDiff = todayData.shares; // 昨天沒有，今天是新增的
            }

            diffResult.push({
                code: code,
                name: todayData.name,
                sharesToday: todayData.shares,
                sharesDiff: sharesDiff,
                amountToday: todayData.amount
            });
        }

        // 檢查昨天有，但今天被清空的持股 (完全賣出)
        for (const [code, yesterdayData] of Object.entries(yesterdayMap)) {
            if (!todayMap[code]) {
                diffResult.push({
                    code: code,
                    name: yesterdayData.name,
                    sharesToday: 0,
                    sharesDiff: -yesterdayData.shares,
                    amountToday: 0
                });
            }
        }

        // 寫入差異結果檔案
        fs.writeFileSync(diffFile, JSON.stringify(diffResult, null, 2), 'utf-8');
        console.log("差異計算完成，已儲存至 data/daily_diff.json");

        // 儲存今天的完整歷史紀錄
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const historyFile = path.join(dataDir, `holdings_${dateStr}.json`);
        fs.writeFileSync(historyFile, JSON.stringify(todayMap, null, 2), 'utf-8');

        // 將今天的資料覆蓋為 yesterday.json，供明天使用
        fs.writeFileSync(yesterdayFile, JSON.stringify(todayMap, null, 2), 'utf-8');
        console.log("今日資料已同步更新至 data/yesterday.json");

        console.log("🎉 所有更新流程執行完畢！");

    } catch (error) {
        console.error("❌ 執行發生錯誤:", error.message);
        process.exit(1);
    }
}

fetchETFData();