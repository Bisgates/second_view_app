# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SecondView (second_view) — a web app for visualizing 1-second resolution stock market data. FastAPI backend serves CSV data as JSON; single-page frontend renders interactive charts using TradingView's lightweight-charts library.

## Running the App

```bash
# Start the server (default: http://127.0.0.1:8000)
python server.py

# Or via uvicorn directly
uvicorn server:app --host 127.0.0.1 --port 8000
```

No build step. No package manager config. Dependencies: `fastapi`, `uvicorn`, `pandas`, `numpy`, `orjson`.

## Architecture

- **`server.py`**: FastAPI app with GZip middleware, `orjson` serialization, `lru_cache` on CSV loading, session filtering (premarket/market/afterhours), time-resolution aggregation (1s–60s), cumulative VWAP computation, moving averages (MA5/100/200). Single endpoint `/api/price/{date}/{symbol}` returns all chart data.

### Data Layout

CSV files live at `../data/1s/{YYYYMMDD}/{SYMBOL}.csv` (relative to `webapp/`). Each CSV has columns: `bob` (timestamp), `open`, `high`, `low`, `close`, `clean_open`, `clean_high`, `clean_low`, `clean_close`, `volume`, `amount`, `vwap`, `tick_count`. The `clean_*` columns are adjusted prices.

### Frontend

All frontend code is in `static/` — a single-file SPA:

- **`index.html`**: Contains all HTML, CSS, and JS inline. Uses lightweight-charts v4.1.0 from CDN. Features: date pills, symbol strip with change%, candlestick/line chart toggle, resolution selector (1s/5s/10s/1m), session filter (All/Pre/Mkt/Ext), VWAP/MA/Clean price toggles, crosshair legends, range-selection on time axis, keyboard shortcuts (arrow keys for symbol nav, L/C/F/V/M).

### Session Boundaries (UTC)

- Premarket: 09:00–14:30 (ET 04:00–09:30)
- Market: 14:30–21:00 (ET 09:30–16:00)
- After-hours: 21:00–01:00+1 (ET 16:00–20:00)

### API (server.py)

- `GET /api/dates` — returns all dates with per-symbol summary (quick first/last line read)
- `GET /api/price/{date}/{symbol}?session=&resolution=&use_clean=` — returns candles, volume bars, cumulative VWAP, MAs, volume MA, stats, market-open marker
