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

// 建立一個 axios 實例，預設開啟 cookie 支援與完整偽裝
const client = axios.create({
    timeout: 30000, // 拉長到 30 秒
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    },
    // 讓 Axios 自動追蹤跳轉 (Redirects)
    maxRedirects: 5
});

// 重試機制函數
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`正在進行第 ${i + 1} 次連線嘗試...`);
            const response = await client.get(url);
            return response.data;
        } catch (error) {
            console.error(`第 ${i + 1} 次嘗試失敗: ${error.message}`);
            if (i === retries - 1) {
                throw new Error("已達最大重試次數，放棄抓取。請確認目標網站是否阻擋海外 IP。");
            }
            // 隨機等待 3~6 秒再重試
            const waitTime = Math.floor(Math.random() * 3000) + 3000;
            console.log(`等待 ${waitTime / 1000} 秒後重新嘗試...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

async function fetchETFData() {
    try {
        console.log("開始執行 00981A 資料更新任務...");

        const html = await fetchWithRetry(TARGET_URL);

        console.log("網頁抓取成功！開始解析資料...");
        const $ = cheerio.load(html);

        const dataContent = $('#DataAsset').attr('data-content');
        if (!dataContent) {
            throw new Error("找不到 id 為 DataAsset 的元素或 data-content 屬性");
        }

        const rawData = JSON.parse(dataContent);

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

        const todayMap = {};
        stockDetails.forEach(stock => {
            todayMap[stock.DetailCode] = {
                name: stock.DetailName,
                shares: stock.Share / 1000.0,
                amount: stock.Amount
            };
        });

        console.log(`成功解析 ${Object.keys(todayMap).length} 檔股票。`);

        const yesterdayFile = path.join(dataDir, 'yesterday.json');
        const diffFile = path.join(dataDir, 'daily_diff.json');

        let yesterdayMap = {};
        if (fs.existsSync(yesterdayFile)) {
            yesterdayMap = JSON.parse(fs.readFileSync(yesterdayFile, 'utf-8'));
        } else {
            console.log("找不到昨天的資料，今天將作為基準日。");
        }

        const diffResult = [];

        for (const [code, todayData] of Object.entries(todayMap)) {
            const yesterdayData = yesterdayMap[code];
            let sharesDiff = yesterdayData ? (todayData.shares - yesterdayData.shares) : todayData.shares;

            diffResult.push({
                code: code,
                name: todayData.name,
                sharesToday: todayData.shares,
                sharesDiff: sharesDiff,
                amountToday: todayData.amount
            });
        }

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

        fs.writeFileSync(diffFile, JSON.stringify(diffResult, null, 2), 'utf-8');
        console.log("差異計算完成，已儲存至 data/daily_diff.json");

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const historyFile = path.join(dataDir, `holdings_${dateStr}.json`);
        fs.writeFileSync(historyFile, JSON.stringify(todayMap, null, 2), 'utf-8');

        fs.writeFileSync(yesterdayFile, JSON.stringify(todayMap, null, 2), 'utf-8');
        console.log("今日資料已同步更新至 data/yesterday.json");

        console.log("🎉 所有更新流程執行完畢！");

    } catch (error) {
        console.error("❌ 執行發生錯誤:", error.message);
        process.exit(1);
    }
}

fetchETFData();