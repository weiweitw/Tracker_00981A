import os
import json
import time
import random
from datetime import datetime
import requests
from bs4 import BeautifulSoup
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 設定資料夾路徑
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

TARGET_URL = 'https://www.ezmoney.com.tw/ETF/Fund/Info?fundCode=49YTW'

def fetch_with_retry(url, retries=3):
    # 完整的瀏覽器偽裝標頭
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
    }

    # 使用 Session 可以自動處理 Cookies，更像真人瀏覽器
    session = requests.Session()

    for i in range(retries):
        try:
            print(f"正在進行第 {i + 1} 次連線嘗試...")
            # timeout 設為 30 秒
            response = session.get(url, headers=headers, timeout=30, verify=False)
            response.raise_for_status()  # 如果不是 200 OK 會拋出例外
            return response.text
        except requests.RequestException as e:
            print(f"第 {i + 1} 次嘗試失敗: {e}")
            if i == retries - 1:
                raise Exception("已達最大重試次數，放棄抓取。請確認目標網站是否阻擋海外 IP。")
            
            # 隨機等待 3~6 秒再重試
            wait_time = random.randint(3, 6)
            print(f"等待 {wait_time} 秒後重新嘗試...")
            time.sleep(wait_time)

def fetch_etf_data():
    try:
        print("開始執行 00981A 資料更新任務 (Python版)...")
        html = fetch_with_retry(TARGET_URL)
        print("網頁抓取成功！開始解析資料...")

        # 解析 HTML
        soup = BeautifulSoup(html, 'html.parser')
        data_asset = soup.find(id='DataAsset')

        if not data_asset or not data_asset.has_attr('data-content'):
            raise Exception("找不到 id 為 DataAsset 的元素或 data-content 屬性")

        # 讀取隱藏的 JSON 資料
        raw_data = json.loads(data_asset['data-content'])

        # --- 【安全讀取 EditDate】 ---
        edit_date_raw = ""
        # 確保 raw_data 是個列表，且裡面有東西
        if isinstance(raw_data, list) and len(raw_data) > 0:
            first_item = raw_data[0]
            # 確保第一筆資料是字典，才能用 get
            if isinstance(first_item, dict):
                edit_date_raw = first_item.get('EditDate', '')
        
        if not edit_date_raw:
            # 如果拿不到 EditDate，就用今天的日期作為備案，避免程式死掉
            print("警告：無法從網頁取得 EditDate，改用系統當下日期。")
            update_date = datetime.now().strftime('%Y-%m-%d')
        else:
            update_date = edit_date_raw.split('T')[0] if 'T' in edit_date_raw else edit_date_raw

        diff_file = os.path.join(DATA_DIR, 'daily_diff.json')

        # 檢查是否需要更新
        if os.path.exists(diff_file):
            with open(diff_file, 'r', encoding='utf-8') as f:
                try:
                    old_diff = json.load(f)
                    if isinstance(old_diff, dict) and old_diff.get('updateDate') == update_date:
                        print(f"最新資料日期 ({update_date}) 與上次相同，為股市休市或尚未更新。")
                        print("任務結束，跳過檔案覆寫。")
                        return 
                except json.JSONDecodeError:
                    pass 

        print(f"發現新資料日期：{update_date}，準備進行更新...")

        # --- 【安全尋找股票明細】 ---
        stock_details = []
        if isinstance(raw_data, list):
            for item in raw_data:
                # 必須確保 item 是字典，才能用 get
                if isinstance(item, dict) and item.get('AssetCode') == 'ST' and item.get('Details'):
                    stock_details = item['Details']
                    break

        if not stock_details:
            raise Exception("在資料中找不到股票(ST)的持股明細")

        # 整理今天的持股資料
        today_map = {}
        # 確保 stock_details 是一個列表
        if isinstance(stock_details, list):
            for stock in stock_details:
                # 確保迴圈裡的 stock 是一個字典
                if isinstance(stock, dict):
                    code = stock.get('DetailCode')
                    if code: # 有代號才處理
                        today_map[code] = {
                            'name': stock.get('DetailName'),
                            'shares': stock.get('Share', 0) / 1000.0,
                            'amount': stock.get('Amount', 0)
                        }

        print(f"成功解析 {len(today_map)} 檔股票。")

        yesterday_file = os.path.join(DATA_DIR, 'yesterday.json')

        # 讀取昨天的資料
        yesterday_map = {}
        if os.path.exists(yesterday_file):
            with open(yesterday_file, 'r', encoding='utf-8') as f:
                yesterday_map = json.load(f)
        else:
            print("找不到昨天的資料，今天將作為基準日。")

        diff_result = []

        # 比較今天和昨天的資料
        for code, today_data in today_map.items():
            yesterday_data = yesterday_map.get(code)
            if yesterday_data:
                shares_diff = today_data['shares'] - yesterday_data['shares']
            else:
                shares_diff = today_data['shares'] # 昨天沒有，今天是新增的

            diff_result.append({
                'code': code,
                'name': today_data['name'],
                'sharesToday': today_data['shares'],
                'sharesDiff': shares_diff,
                'amountToday': today_data['amount']
            })

        # 檢查昨天有，但今天被清空的持股 (完全賣出)
        for code, yesterday_data in yesterday_map.items():
            if code not in today_map:
                diff_result.append({
                    'code': code,
                    'name': yesterday_data['name'],
                    'sharesToday': 0,
                    'sharesDiff': -yesterday_data['shares'],
                    'amountToday': 0
                })

        # 【關鍵修改】包裝成帶有 updateDate 的新格式
        final_output = {
            "updateDate": update_date,
            "holdings": diff_result
        }

        # 寫入差異結果檔案
        with open(diff_file, 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, indent=2)
        print("差異計算完成，已儲存至 data/daily_diff.json")

        # 儲存今天的完整歷史紀錄
        # 這裡改用 update_date 命名檔案，會比系統當下時間更準確
        history_date_str = update_date.replace('-', '') 
        history_file = os.path.join(DATA_DIR, f'holdings_{history_date_str}.json')
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(today_map, f, ensure_ascii=False, indent=2)

        # 將今天的資料覆蓋為 yesterday.json，供明天使用
        with open(yesterday_file, 'w', encoding='utf-8') as f:
            json.dump(today_map, f, ensure_ascii=False, indent=2)
        print("今日資料已同步更新至 data/yesterday.json")

        print("🎉 所有更新流程執行完畢！")

    except Exception as e:
        print(f"❌ 執行發生錯誤: {e}")
        exit(1)

if __name__ == '__main__':
    fetch_etf_data()