from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
DATA_DIR = ROOT_DIR / "data" / "1s"
STATIC_DIR = APP_DIR / "static"

DATE_RE = re.compile(r"^\d{8}$")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9._-]+$")

app = FastAPI(title="1s Stock Viz", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=500, detail="index.html not found")
    return FileResponse(index_path)


def _validate_date(date_str: str) -> None:
    if not DATE_RE.match(date_str):
        raise HTTPException(status_code=400, detail="invalid date format")


def _validate_symbol(symbol: str) -> None:
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail="invalid symbol format")


def _date_dir(date_str: str) -> Path:
    _validate_date(date_str)
    date_dir = DATA_DIR / date_str
    if not date_dir.exists() or not date_dir.is_dir():
        raise HTTPException(status_code=404, detail="date not found")
    return date_dir


def _symbol_path(date_str: str, symbol: str) -> Path:
    _validate_symbol(symbol)
    csv_path = _date_dir(date_str) / f"{symbol}.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="symbol not found")
    return csv_path


def _list_dates() -> List[str]:
    if not DATA_DIR.exists():
        return []
    dates = [p.name for p in DATA_DIR.iterdir() if p.is_dir() and DATE_RE.match(p.name)]
    return sorted(dates, reverse=True)


def _list_symbols(date_str: str) -> List[str]:
    date_dir = _date_dir(date_str)
    symbols = [p.stem for p in date_dir.glob("*.csv")]
    return sorted(symbols)


def _read_header(path: Path) -> List[str]:
    with path.open(newline="") as f:
        reader = csv.reader(f)
        return next(reader)


def _read_last_nonempty_line(path: Path) -> Optional[str]:
    with path.open("rb") as f:
        f.seek(0, 2)
        end = f.tell()
        if end == 0:
            return None
        chunk_size = 4096
        buffer = b""
        pos = end
        while pos > 0:
            read_size = min(chunk_size, pos)
            pos -= read_size
            f.seek(pos)
            chunk = f.read(read_size)
            buffer = chunk + buffer
            if b"\n" in chunk:
                lines = buffer.splitlines()
                for line in reversed(lines):
                    if line.strip():
                        return line.decode("utf-8", errors="ignore")
        if buffer.strip():
            return buffer.decode("utf-8", errors="ignore")
    return None


def _row_from_last_line(path: Path) -> Optional[Dict[str, str]]:
    header = _read_header(path)
    last_line = _read_last_nonempty_line(path)
    if not last_line:
        return None
    row = next(csv.reader([last_line]))
    if len(row) != len(header):
        return None
    return dict(zip(header, row))


def _first_row(path: Path) -> Optional[Dict[str, str]]:
    with path.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            return None
        for row in reader:
            if row and len(row) == len(header):
                return dict(zip(header, row))
    return None


def _safe_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _parse_epoch_seconds(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    ts = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(ts):
        return None
    return int(ts.timestamp())


def _fallback_last_row(path: Path) -> Optional[Dict[str, str]]:
    try:
        df = pd.read_csv(path)
    except Exception:
        return None
    if df.empty:
        return None
    row = df.tail(1).iloc[0].to_dict()
    return {k: "" if pd.isna(v) else str(v) for k, v in row.items()}


def _last_row(path: Path) -> Optional[Dict[str, str]]:
    row = _row_from_last_line(path)
    if row is not None:
        return row
    return _fallback_last_row(path)


def _row_float(row: Dict[str, str], preferred: str, fallback: str) -> Optional[float]:
    if preferred in row and row.get(preferred) not in ("", None):
        value = _safe_float(row.get(preferred))
        if value is not None:
            return value
    return _safe_float(row.get(fallback))


@app.get("/api/dates")
def api_dates():
    return {"dates": _list_dates()}


@app.get("/api/symbols")
def api_symbols(date: str = Query(...)):
    return {"symbols": _list_symbols(date)}


@app.get("/api/summary")
def api_summary(date: str = Query(...)):
    symbols = _list_symbols(date)
    payload = []
    for symbol in symbols:
        csv_path = _symbol_path(date, symbol)
        last_row = _last_row(csv_path)
        if not last_row:
            continue
        first_row = _first_row(csv_path)
        open_value = None
        close_value = None
        if first_row:
            open_value = _row_float(first_row, "clean_open", "open")
        if last_row:
            close_value = _row_float(last_row, "clean_close", "close")
        payload.append(
            {
                "symbol": symbol,
                "time": _parse_epoch_seconds(last_row.get("bob")),
                "close": close_value,
                "open": open_value,
                "volume": _safe_float(last_row.get("volume")),
                "amount": _safe_float(last_row.get("amount")),
                "vwap": _safe_float(last_row.get("vwap")),
                "tick_count": _safe_float(last_row.get("tick_count")),
            }
        )
    return {"date": date, "symbols": payload}


@app.get("/api/data")
def api_data(
    date: str = Query(...),
    symbol: str = Query(...),
    tail: int = Query(600, ge=60, le=5000),
):
    csv_path = _symbol_path(date, symbol)
    usecols = [
        "open",
        "high",
        "low",
        "close",
        "clean_open",
        "clean_high",
        "clean_low",
        "clean_close",
        "volume",
        "amount",
        "vwap",
        "tick_count",
        "bob",
    ]
    df = pd.read_csv(csv_path, usecols=lambda c: c in usecols)
    if df.empty:
        raise HTTPException(status_code=404, detail="no data")

    df["bob"] = pd.to_datetime(df["bob"], utc=True, errors="coerce")
    df = df.dropna(subset=["bob"])
    df["time"] = (df["bob"].astype("int64") // 1_000_000_000).astype(int)

    df = df.sort_values("time")

    for col in ["amount", "vwap", "tick_count", "volume"]:
        if col not in df.columns:
            df[col] = pd.NA

    open_col = "clean_open" if "clean_open" in df.columns else "open"
    high_col = "clean_high" if "clean_high" in df.columns else "high"
    low_col = "clean_low" if "clean_low" in df.columns else "low"
    close_col = "clean_close" if "clean_close" in df.columns else "close"

    df["open"] = pd.to_numeric(df[open_col], errors="coerce")
    df["high"] = pd.to_numeric(df[high_col], errors="coerce")
    df["low"] = pd.to_numeric(df[low_col], errors="coerce")
    df["close"] = pd.to_numeric(df[close_col], errors="coerce")

    df = df.dropna(subset=["open", "high", "low", "close"])
    if df.empty:
        raise HTTPException(status_code=404, detail="no data")

    candles = df[["time", "open", "high", "low", "close"]].to_dict("records")
    volume_df = df[["time", "volume", "open", "close"]].copy()
    volume_df = volume_df.fillna(0)
    volume = (
        volume_df.astype({"volume": float, "open": float, "close": float}).to_dict("records")
    )
    vwap = df[["time", "vwap"]].dropna().astype({"vwap": float}).to_dict("records")

    last = df.tail(1).iloc[0]
    def safe_last(value: object) -> Optional[float]:
        return None if pd.isna(value) else float(value)

    stats = {
        "count": int(len(df)),
        "open": float(df.iloc[0]["open"]),
        "close": float(df.iloc[-1]["close"]),
        "high": float(df["high"].max()),
        "low": float(df["low"].min()),
        "volume_sum": float(df["volume"].sum()),
        "amount_sum": float(df["amount"].sum()) if "amount" in df else None,
        "vwap": float(df["amount"].sum() / df["volume"].sum()) if df["volume"].sum() > 0 else None,
    }

    tail_df = df.tail(tail)
    tail_df = tail_df[
        ["time", "open", "high", "low", "close", "volume", "amount", "vwap", "tick_count"]
    ].where(pd.notnull(tail_df), None)
    rows = tail_df.to_dict("records")

    return {
        "date": date,
        "symbol": symbol,
        "candles": candles,
        "volume": volume,
        "vwap": vwap,
        "last": {
            "time": int(last["time"]),
            "open": float(last["open"]),
            "high": float(last["high"]),
            "low": float(last["low"]),
            "close": float(last["close"]),
            "volume": safe_last(last["volume"]),
            "amount": safe_last(last["amount"]),
            "vwap": safe_last(last["vwap"]),
            "tick_count": safe_last(last["tick_count"]),
        },
        "stats": stats,
        "rows": rows,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
