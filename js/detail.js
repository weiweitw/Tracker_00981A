document.addEventListener('DOMContentLoaded', () => {
    // 1. 解析網址參數，取得股票代號
    const urlParams = new URLSearchParams(window.location.search);
    const stockCode = urlParams.get('code');

    if (!stockCode) {
        document.getElementById('stockTitle').textContent = '未指定股票代號，請從總表點擊進入';
        return;
    }

    // 2. 準備 ECharts 畫布
    const chartDom = document.getElementById('trendChart');
    const myChart = echarts.init(chartDom);
    myChart.showLoading();

    // 3. 讀取我們剛才做好的 time_series.json
    fetch('data/time_series.json')
        .then(res => {
            if (!res.ok) throw new Error('無法讀取 time_series.json');
            return res.json();
        })
        .then(data => {
            const stockData = data[stockCode];

            if (!stockData || !stockData.history || stockData.history.length === 0) {
                myChart.hideLoading();
                document.getElementById('stockTitle').textContent = `找不到 ${stockCode} 的歷史資料`;
                return;
            }

            document.getElementById('stockTitle').textContent = `${stockData.name} (${stockCode}) 歷史部位與價格趨勢`;

            // 4. 解析 JSON 資料，把資料拆成 X 軸(日期) 與兩個 Y 軸(張數、價格) 的陣列
            const dates = [];
            const shares = [];
            const prices = [];

            // 確保資料是按照日期排序的
            stockData.history.sort((a, b) => new Date(a.date) - new Date(b.date));

            stockData.history.forEach(item => {
                dates.push(item.date);
                shares.push(item.shares);
                prices.push(item.price);
            });

            // 5. 設定 ECharts 的配置 (包含十字準星與雙 Y 軸)
            const option = {
                tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                        type: 'cross', // 十字準星指示器！
                        crossStyle: {
                            color: '#999'
                        }
                    }
                },
                legend: {
                    data: ['變動張數', '均價(元/股)'],
                    top: 10
                },
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    containLabel: true
                },
                xAxis: [
                    {
                        type: 'category',
                        data: dates,
                        axisPointer: {
                            type: 'shadow'
                        }
                    }
                ],
                // 設定雙 Y 軸
                yAxis: [
                    {
                        type: 'value',
                        name: '變動張數',
                        scale: true, // 不強制從 0 開始，更能看出波動
                        axisLabel: {
                            formatter: '{value} 張'
                        }
                    },
                    {
                        type: 'value',
                        name: '價格',
                        scale: true,
                        axisLabel: {
                            formatter: '{value} 元'
                        },
                        // 把價格軸放在右邊
                        position: 'right'
                    }
                ],
                series: [
                    {
                        name: '變動張數',
                        type: 'bar', // 用柱狀圖表示張數
                        data: shares,
                        itemStyle: { color: '#0056b3' }
                    },
                    {
                        name: '均價(元/股)',
                        type: 'line', // 用折線圖表示價格
                        yAxisIndex: 1, // 對應右邊的第二個 Y 軸
                        data: prices,
                        itemStyle: { color: '#d9534f' },
                        smooth: true
                    }
                ]
            };

            myChart.hideLoading();
            myChart.setOption(option);
        })
        .catch(err => {
            console.error(err);
            myChart.hideLoading();
            document.getElementById('stockTitle').innerHTML = '<span style="color:red">資料讀取失敗，請確認檔案路徑或重新整理</span>';
        });

    // 視窗縮放時重新調整圖表大小
    window.addEventListener('resize', () => {
        myChart.resize();
    });
});