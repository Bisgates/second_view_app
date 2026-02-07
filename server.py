"""second_view – FastAPI backend for 1s stock data visualization."""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
import numpy as np
import orjson
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
DATA_DIR = ROOT_DIR / "data" / "1s"
STATIC_DIR = APP_DIR / "static"

DATE_RE = re.compile(r"^\d{8}$")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9._-]+$")

MA_PERIODS = [5, 100, 200]

# ET session boundaries (in UTC hours)
SESSION_BOUNDS = {
    "premarket": (9, 0, 14, 30),   # 04:00–09:30 ET → 09:00–14:30 UTC
    "market":    (14, 30, 21, 0),   # 09:30–16:00 ET → 14:30–21:00 UTC
    "afterhours":(21, 0, 25, 0),    # 16:00–20:00 ET → 21:00–01:00+1 UTC (25 = next day 01)
}

app = FastAPI(title="second_view", version="2.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)


class ORJSONResponse(Response):
    media_type = "application/json"

    def render(self, content) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_date(d: str) -> None:
    if not DATE_RE.match(d):
        raise HTTPException(400, "invalid date format")


def _validate_symbol(s: str) -> None:
    if not SYMBOL_RE.match(s):
        raise HTTPException(400, "invalid symbol format")


@lru_cache(maxsize=128)
def _load_csv(date: str, symbol: str) -> pd.DataFrame:
    """Load and cache a CSV file.  ~130 MB total for all files in memory."""
    _validate_date(date)
    _validate_symbol(symbol)
    csv_path = DATA_DIR / date / f"{symbol}.csv"
    if not csv_path.exists():
        raise HTTPException(404, "symbol not found")
    df = pd.read_csv(csv_path)
    df["bob"] = pd.to_datetime(df["bob"], utc=True, errors="coerce")
    df = df.dropna(subset=["bob"]).sort_values("bob").reset_index(drop=True)
    # epoch seconds for TradingView
    df["time"] = (df["bob"].astype("int64") // 1_000_000_000).astype(int)
    return df


def _list_dates() -> list[str]:
    if not DATA_DIR.exists():
        return []
    return sorted(
        [p.name for p in DATA_DIR.iterdir() if p.is_dir() and DATE_RE.match(p.name)],
        reverse=True,
    )


def _list_symbols(date: str) -> list[str]:
    _validate_date(date)
    date_dir = DATA_DIR / date
    if not date_dir.exists():
        raise HTTPException(404, "date not found")
    return sorted(p.stem for p in date_dir.glob("*.csv"))


def _filter_session(df: pd.DataFrame, session: str) -> pd.DataFrame:
    if session == "all":
        return df
    if session not in SESSION_BOUNDS:
        raise HTTPException(400, f"invalid session: {session}")
    h1, m1, h2, m2 = SESSION_BOUNDS[session]
    hour = df["bob"].dt.hour
    minute = df["bob"].dt.minute
    t = hour * 60 + minute
    start = h1 * 60 + m1
    end = h2 * 60 + m2
    if end > 24 * 60:
        # wraps past midnight (afterhours)
        mask = (t >= start) | (t < end - 24 * 60)
    else:
        mask = (t >= start) & (t < end)
    return df[mask].copy()


def _aggregate(df: pd.DataFrame, resolution: int) -> pd.DataFrame:
    """Aggregate 1s bars into N-second bars."""
    if resolution <= 1:
        return df
    # floor time to resolution
    df = df.copy()
    df["time"] = (df["time"] // resolution) * resolution
    clean_cols = (
        ["clean_open", "clean_high", "clean_low", "clean_close"]
        if "clean_open" in df.columns else []
    )

    agg = {}
    agg["open"] = ("open", "first")
    agg["high"] = ("high", "max")
    agg["low"] = ("low", "min")
    agg["close"] = ("close", "last")
    agg["volume"] = ("volume", "sum")
    agg["amount"] = ("amount", "sum")
    agg["tick_count"] = ("tick_count", "sum")
    for c in clean_cols:
        if c == "clean_open":
            agg[c] = (c, "first")
        elif c == "clean_high":
            agg[c] = (c, "max")
        elif c == "clean_low":
            agg[c] = (c, "min")
        elif c == "clean_close":
            agg[c] = (c, "last")

    grouped = df.groupby("time", sort=True).agg(**agg).reset_index()
    return _fill_time_gaps(grouped, resolution)


def _fill_time_gaps(df: pd.DataFrame, resolution: int) -> pd.DataFrame:
    """Fill missing time buckets so bars render without gaps."""
    if df.empty:
        return df
    times = df["time"].values
    if len(times) < 2:
        return df
    full_times = np.arange(times.min(), times.max() + resolution, resolution, dtype=int)
    if len(full_times) == len(times):
        return df

    df = df.set_index("time").reindex(full_times)

    def _fill_ohlc(prefix: str = "") -> None:
        c = f"{prefix}close"
        o = f"{prefix}open"
        h = f"{prefix}high"
        l = f"{prefix}low"
        if c not in df.columns:
            return
        df[c] = df[c].ffill()
        if o in df.columns:
            df[o] = df[o].fillna(df[c])
        if h in df.columns:
            df[h] = df[h].fillna(df[c])
        if l in df.columns:
            df[l] = df[l].fillna(df[c])

    _fill_ohlc("")
    if "clean_close" in df.columns:
        _fill_ohlc("clean_")

    for col in ("volume", "amount", "tick_count"):
        if col in df.columns:
            df[col] = df[col].fillna(0)

    return df.reset_index().rename(columns={"index": "time"})


def _compute_vwap(df: pd.DataFrame) -> list[dict]:
    """Cumulative VWAP = cumsum(amount) / cumsum(volume)."""
    vol = df["volume"].values.astype(float)
    amt = df["amount"].values.astype(float)
    cum_vol = np.cumsum(vol)
    cum_amt = np.cumsum(amt)
    mask = cum_vol > 0
    vwap = np.where(mask, cum_amt / cum_vol, np.nan)
    times = df["time"].values
    result = []
    for i in range(len(times)):
        if not np.isnan(vwap[i]):
            result.append({"time": int(times[i]), "value": round(float(vwap[i]), 4)})
    return result


def _compute_ma(values: np.ndarray, times: np.ndarray, period: int) -> list[dict]:
    """Simple moving average."""
    if len(values) < period:
        return []
    ma = pd.Series(values).rolling(period).mean().values
    result = []
    for i in range(period - 1, len(times)):
        if not np.isnan(ma[i]):
            result.append({"time": int(times[i]), "value": round(float(ma[i]), 4)})
    return result


def _hampel_filter(series: pd.Series, window: int, n_sigma: float = 3.0) -> pd.Series:
    if window <= 0:
        return series
    k = 1.4826  # scale factor for Gaussian distribution
    win = window * 2 + 1
    rolling_median = series.rolling(win, center=True).median()
    mad = (series - rolling_median).abs().rolling(win, center=True).median()
    threshold = n_sigma * k * mad
    outlier = (series - rolling_median).abs() > threshold
    filtered = series.copy()
    filtered[outlier & rolling_median.notna()] = rolling_median[outlier & rolling_median.notna()]
    return filtered


def _apply_spike_filter(df: pd.DataFrame, method: str, window: int) -> pd.DataFrame:
    if method != "hampel":
        return df
    df = df.copy()
    for prefix in ("", "clean_"):
        close_col = f"{prefix}close"
        if close_col not in df.columns:
            continue
        for col in (f"{prefix}open", f"{prefix}high", f"{prefix}low", close_col):
            if col in df.columns:
                df[col] = _hampel_filter(df[col].astype(float), window)
        high_col = f"{prefix}high"
        low_col = f"{prefix}low"
        open_col = f"{prefix}open"
        if high_col in df.columns and low_col in df.columns and open_col in df.columns:
            df[high_col] = df[[high_col, open_col, close_col]].max(axis=1)
            df[low_col] = df[[low_col, open_col, close_col]].min(axis=1)
    return df


def _build_volume_bars(
    times: np.ndarray, opens: np.ndarray, closes: np.ndarray, volumes: np.ndarray
) -> list[dict]:
    """Build volume bars aligned with the aggregated candle resolution."""
    result = []
    for i in range(len(times)):
        color = "#4ade80" if closes[i] >= opens[i] else "#f87171"
        result.append(
            {
                "time": int(times[i]),
                "value": float(volumes[i]),
                "color": color,
            }
        )
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


def _quick_summary(csv_path: Path) -> dict | None:
    """Read first+last line of CSV for fast summary (no full load)."""
    import csv as csv_mod
    try:
        with csv_path.open() as f:
            reader = csv_mod.reader(f)
            header = next(reader)
            first_row = next(reader, None)
            if not first_row:
                return None
        # read last line efficiently
        with csv_path.open("rb") as f:
            f.seek(0, 2)
            pos = f.tell()
            buf = b""
            while pos > 0:
                chunk = min(4096, pos)
                pos -= chunk
                f.seek(pos)
                buf = f.read(chunk) + buf
                if buf.count(b"\n") > 1:
                    break
            lines = buf.strip().split(b"\n")
            last_line = lines[-1].decode("utf-8", errors="ignore")
        last_row = next(csv_mod.reader([last_line]))
        if len(last_row) != len(header):
            return None
        h = {k: v for k, v in zip(header, first_row)}
        t = {k: v for k, v in zip(header, last_row)}
        first_close = float(h["close"])
        last_close = float(t["close"])
        pct = ((last_close - first_close) / first_close * 100) if first_close else 0
        return {
            "symbol": csv_path.stem,
            "close": round(last_close, 2),
            "change_pct": round(pct, 2),
            "volume": 0,  # skip full volume sum for speed
        }
    except Exception:
        return None


@app.get("/api/dates", response_class=ORJSONResponse)
def api_dates():
    dates = _list_dates()
    result = {}
    for date in dates:
        symbols = _list_symbols(date)
        sym_info = []
        for sym in symbols:
            csv_path = DATA_DIR / date / f"{sym}.csv"
            info = _quick_summary(csv_path)
            if info:
                sym_info.append(info)
        result[date] = sym_info
    return ORJSONResponse({"dates": result})


@app.get("/api/price/{date}/{symbol}", response_class=ORJSONResponse)
def api_price(
    date: str,
    symbol: str,
    session: str = Query("all"),
    resolution: int = Query(1, ge=1, le=60),
    use_clean: bool = Query(False),
    spike_filter: str | None = Query(None),
    spike_window: int = Query(3, ge=1, le=21),
):
    df = _load_csv(date, symbol)
    if df.empty:
        raise HTTPException(404, "no data")

    # filter session
    df = _filter_session(df, session)
    if df.empty:
        raise HTTPException(404, "no data for session")

    # spike filter on 1s data (before aggregation)
    if spike_filter:
        if spike_filter not in {"hampel"}:
            raise HTTPException(400, f"invalid spike_filter: {spike_filter}")
        df = _apply_spike_filter(df, spike_filter, spike_window)

    # aggregate
    df_agg = _aggregate(df, resolution)

    # choose price columns
    if use_clean and "clean_open" in df_agg.columns:
        o_col, h_col, l_col, c_col = "clean_open", "clean_high", "clean_low", "clean_close"
    else:
        o_col, h_col, l_col, c_col = "open", "high", "low", "close"

    times = df_agg["time"].values
    opens = df_agg[o_col].values.astype(float)
    highs = df_agg[h_col].values.astype(float)
    lows = df_agg[l_col].values.astype(float)
    closes = df_agg[c_col].values.astype(float)

    # candlestick data
    candles = []
    for i in range(len(times)):
        candles.append({
            "time": int(times[i]),
            "open": round(float(opens[i]), 4),
            "high": round(float(highs[i]), 4),
            "low": round(float(lows[i]), 4),
            "close": round(float(closes[i]), 4),
        })

    # volume aligned with candle resolution
    volumes = df_agg["volume"].values.astype(float)
    volume = _build_volume_bars(times, opens, closes, volumes)

    # VWAP (cumulative, aligned to aggregated resolution)
    vwap = _compute_vwap(df_agg)

    # MAs on close price (all periods)
    mas = {}
    for p in MA_PERIODS:
        mas[str(p)] = _compute_ma(closes, times, p)

    # Volume MA (MA20 on aggregated volume)
    vol_values = np.array([v["value"] for v in volume], dtype=float)
    vol_times = np.array([v["time"] for v in volume], dtype=int)
    volume_ma = _compute_ma(vol_values, vol_times, 20)

    # stats
    first_open = float(opens[0])
    last_close = float(closes[-1])
    change_pct = ((last_close - first_open) / first_open * 100) if first_open else 0

    high_idx = int(np.argmax(highs))
    low_idx = int(np.argmin(lows))

    stats = {
        "open": round(first_open, 4),
        "high": round(float(highs.max()), 4),
        "low": round(float(lows.min()), 4),
        "close": round(last_close, 4),
        "change": round(last_close - first_open, 4),
        "change_pct": round(change_pct, 2),
        "volume": int(df_agg["volume"].sum()),
        "data_points": len(df_agg),
        "first_time": int(times[0]),
        "last_time": int(times[-1]),
        "high_time": int(times[high_idx]),
        "low_time": int(times[low_idx]),
    }

    # market open marker (14:30 UTC = 09:30 ET)
    market_open_time = None
    for t in times:
        ts = pd.Timestamp(int(t), unit="s", tz="UTC")
        if ts.hour == 14 and ts.minute == 30:
            market_open_time = int(t)
            break
        elif ts.hour == 14 and ts.minute > 30:
            market_open_time = int(t)
            break
        elif ts.hour > 14 and market_open_time is None:
            market_open_time = int(t)
            break

    return ORJSONResponse({
        "date": date,
        "symbol": symbol,
        "session": session,
        "resolution": resolution,
        "candles": candles,
        "volume": volume,
        "vwap": vwap,
        "mas": mas,
        "volume_ma": volume_ma,
        "stats": stats,
        "market_open_time": market_open_time,
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
