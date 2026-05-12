document.addEventListener('DOMContentLoaded', () => {
    // 1. 解析網址參數
    const urlParams = new URLSearchParams(window.location.search);
    const currentETF = urlParams.get('etf') || '00981A';
    const stockCode = urlParams.get('code');

    // 🌟 返回按鈕帶上當前 ETF 參數，避免跳回首頁時迷路
    const backBtn = document.querySelector('.back-btn');
    if (backBtn) {
        backBtn.href = `index.html?etf=${currentETF}`;
    }

    if (!stockCode) {
        document.getElementById('stockTitle').textContent = '未指定明細代號，請從總表點擊進入';
        return;
    }

    // 2. 準備 ECharts 畫布
    const chartDom = document.getElementById('trendChart');
    const myChart = echarts.init(chartDom);
    myChart.showLoading();

    // 3. 🌟 動態讀取對應 ETF 資料夾下的 time_series.json
    fetch(`data/${currentETF}/time_series.json`)
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

            // 4. 解析 JSON
            const dates = [];
            const shares = [];
            const prices = [];

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
                        type: 'cross',
                        crossStyle: { color: '#999' }
                    }
                },
                legend: {
                    data: ['買賣張數', '均價(元/股)'],
                    top: 10
                },
                grid: {
                    left: '3%', right: '4%', bottom: '3%', containLabel: true
                },
                xAxis: [
                    {
                        type: 'category',
                        data: dates,
                        axisPointer: { type: 'shadow' }
                    }
                ],
                yAxis: [
                    {
                        type: 'value',
                        name: '買賣張數',
                        scale: true,
                        axisLabel: { formatter: '{value} 張' }
                    },
                    {
                        type: 'value',
                        name: '價格',
                        scale: true,
                        axisLabel: { formatter: '{value} 元' },
                        position: 'right',
                        splitLine: { show: false }
                    }
                ],
                series: [
                    {
                        name: '買賣張數',
                        type: 'bar',
                        data: shares,
                        itemStyle: {
                            color: function (params) {
                                // 張數大於 0 顯示藍色(買進)，小於 0 顯示綠色(賣出)
                                return params.value > 0 ? '#0056b3' : '#5cb85c';
                            },
                            borderRadius: [4, 4, 0, 0]
                        }
                    },
                    {
                        name: '均價(元/股)',
                        type: 'line',
                        yAxisIndex: 1,
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
            document.getElementById('stockTitle').innerHTML = `<span style="color:red">資料讀取失敗，請確認 data/${currentETF}/time_series.json 是否存在</span>`;
        });

    window.addEventListener('resize', () => {
        myChart.resize();
    });
});