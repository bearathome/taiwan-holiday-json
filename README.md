# taiwan-holiday-json

台灣每年國定假日的 JSON 資料，格式為 `map[date] = "放假原因"`，依年份存放為 `2026.json`、`2025.json` 等。

## 資料來源

[政府資料開放平臺 - 中華民國政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718)

## 同步程式

同步用的程式碼放在 `sync` branch 上，使用 Node.js 撰寫，從資料來源抓取 CSV 後轉為 JSON 並更新。

## 授權

資料依據[政府資料開放授權條款第1版](https://data.gov.tw/license)提供，允許自由使用、修改及散布，使用時請標示出處為「行政院人事行政總處」。
