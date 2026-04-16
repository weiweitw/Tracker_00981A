const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const URL = 'https://www.ezmoney.com.tw/ETF/Fund/Info?fundCode=49YTW';
const DATA_DIR = path.join(__dirname, 'data');
const YESTERDAY_FILE = path.join(DATA_DIR, 'yesterday.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'daily_diff.json');

// 取得台灣時區的 YYYYMMDD 日期字串
function getTaipeiDateString() {
    const options = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('zh-TW', options);
    const parts = formatter.formatToParts(new Date());
    let year = '', month = '', day = '';
    parts.forEach(p => {
        if (p.type === 'year') year = p.value;
        if (p.type === 'month') month = p.value;
        if (p.type === 'day') day = p.value;
    });
    return `${year}${month}${day}`;
}

async function updateData() {
    try {
        console.log("開始抓取網頁...");
        const response = await fetch(URL);
        const html = await response.text();

        const $ = cheerio.load(html);
        const jsonString = $('#DataAsset').attr('data-content');

        if (!jsonString) {
            throw new Error("找不到資料來源，請確認統一投信的網頁結構是否改變！");
        }

        const rawData = JSON.parse(jsonString);
        let stockDetails = [];

        for (const item of rawData) {
            if (item.AssetCode === 'ST' && item.Details) {
                stockDetails = item.Details;
                break;
            }
        }

        if (stockDetails.length === 0) {
            throw new Error("找不到股票(ST)的持股明細！");
        }

        console.log(`成功抓取今日 ${stockDetails.length} 檔成分股！`);

        const todayMap = {};
        stockDetails.forEach(stock => {
            todayMap[stock.DetailCode] = {
                name: stock.DetailName,
                shares: stock.Share / 1000,
                amount: stock.Amount
            };
        });

        let yesterdayMap = {};
        if (fs.existsSync(YESTERDAY_FILE)) {
            yesterdayMap = JSON.parse(fs.readFileSync(YESTERDAY_FILE, 'utf-8'));
        }

        const diffResults = [];
        for (const code in todayMap) {
            const current = todayMap[code];
            const yesterday = yesterdayMap[code] || { shares: 0, amount: 0 };

            const diffShares = current.shares - yesterday.shares;

            let diffAmountText = '-';
            if (diffShares > 0) {
                diffAmountText = '加碼';
            } else if (diffShares < 0) {
                diffAmountText = '減碼';
            } else if (yesterday.shares === 0 && current.shares > 0) {
                diffAmountText = '🌟 新增持股';
            }

            diffResults.push({
                code: code,
                name: current.name,
                currentShares: Math.round(current.shares),
                diffShares: Math.round(diffShares),
                diffAmountText: diffAmountText
            });
        }

        diffResults.sort((a, b) => b.diffShares - a.diffShares);

        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

        // 1. 儲存前端顯示用的差異比較檔
        const outputData = {
            updateDate: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
            holdings: diffResults
        };
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2));

        // 2. 儲存供明天比對用的 yesterday.json
        fs.writeFileSync(YESTERDAY_FILE, JSON.stringify(todayMap, null, 2));

        // 3. 儲存每日歷史紀錄檔 (例如: holdings_20260416.json)
        const dateString = getTaipeiDateString();
        const dailyHistoryFile = path.join(DATA_DIR, `holdings_${dateString}.json`);
        fs.writeFileSync(dailyHistoryFile, JSON.stringify(todayMap, null, 2));

        console.log(`資料計算完成，已生成歷史紀錄檔：holdings_${dateString}.json`);

    } catch (error) {
        console.error("執行失敗:", error);
    }
}

updateData();