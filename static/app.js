const state = {
  date: null,
  symbol: null,
  candles: [],
  volume: [],
  vwap: [],
  rows: [],
  summarySymbols: [],
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  vwapSeries: null,
  tooltip: null,
};

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "2-digit",
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function formatAmount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return numberFormatter.format(value);
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return numberFormatter.format(value);
}

function formatTime(epochSeconds) {
  if (!epochSeconds) return "--";
  return etFormatter.format(new Date(epochSeconds * 1000));
}

function formatDay(epochSeconds) {
  if (!epochSeconds) return "--";
  return dayFormatter.format(new Date(epochSeconds * 1000));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || "Request failed");
  }
  return res.json();
}

function setActiveRangeButton(value) {
  document.querySelectorAll(".range-buttons button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === value);
  });
}

function initChart() {
  const chartContainer = document.getElementById("chart");
  const tooltip = document.getElementById("tooltip");
  state.tooltip = tooltip;

  const chart = LightweightCharts.createChart(chartContainer, {
    layout: {
      background: { color: "#121826" },
      textColor: "#e5e7eb",
    },
    grid: {
      vertLines: { color: "rgba(148, 163, 184, 0.15)" },
      horzLines: { color: "rgba(148, 163, 184, 0.15)" },
    },
    rightPriceScale: {
      borderColor: "#1f2937",
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: true,
      borderColor: "#1f2937",
    },
    crosshair: {
      mode: 1,
    },
  });

  const candleSeries = chart.addCandlestickSeries({
    upColor: "#22c55e",
    downColor: "#ef4444",
    borderUpColor: "#22c55e",
    borderDownColor: "#ef4444",
    wickUpColor: "#22c55e",
    wickDownColor: "#ef4444",
  });

  const volumeSeries = chart.addHistogramSeries({
    priceScaleId: "",
    priceFormat: { type: "volume" },
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  const vwapSeries = chart.addLineSeries({
    color: "#f59e0b",
    lineWidth: 2,
  });

  chart.subscribeCrosshairMove((param) => {
    if (!param.time || !param.seriesData.size) {
      tooltip.classList.add("hidden");
      return;
    }
    const price = param.seriesData.get(candleSeries);
    const volume = param.seriesData.get(volumeSeries);
    const vwap = param.seriesData.get(vwapSeries);
    const time = param.time;
    const lines = [
      `时间: ${formatTime(time)} (${formatDay(time)})`,
      `O: ${formatPrice(price.open)}  H: ${formatPrice(price.high)}`,
      `L: ${formatPrice(price.low)}  C: ${formatPrice(price.close)}`,
      `成交量: ${formatAmount(volume ? volume.value : null)}`,
      `VWAP: ${formatPrice(vwap ? vwap.value : null)}`,
    ];
    tooltip.innerHTML = lines.join("<br/>");
    tooltip.classList.remove("hidden");
  });

  state.chart = chart;
  state.candleSeries = candleSeries;
  state.volumeSeries = volumeSeries;
  state.vwapSeries = vwapSeries;

  window.addEventListener("resize", () => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
  });
}

function updateStats(payload) {
  const stats = payload.stats;
  const last = payload.last;
  const change = ((stats.close - stats.open) / stats.open) * 100;
  const range = `${formatPrice(stats.low)} - ${formatPrice(stats.high)}`;

  document.getElementById("statLast").textContent = formatPrice(last.close);
  const changeEl = document.getElementById("statChange");
  changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  changeEl.style.color = change >= 0 ? "#22c55e" : "#ef4444";
  document.getElementById("statRange").textContent = range;
  document.getElementById("statVolume").textContent = formatAmount(stats.volume_sum);
  document.getElementById("statAmount").textContent = formatAmount(stats.amount_sum);
  document.getElementById("statVwap").textContent = formatPrice(stats.vwap);
}

function updateTable(payload) {
  const tbody = document.querySelector("#ticksTable tbody");
  tbody.innerHTML = "";
  const rows = [...payload.rows].reverse();
  for (const row of rows) {
    const tr = document.createElement("tr");
    const values = [
      formatTime(row.time),
      formatPrice(row.open),
      formatPrice(row.high),
      formatPrice(row.low),
      formatPrice(row.close),
      formatAmount(row.volume),
      formatAmount(row.amount),
      formatPrice(row.vwap),
      formatAmount(row.tick_count),
    ];
    values.forEach((val) => {
      const td = document.createElement("td");
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function applyChartData(payload) {
  state.candles = payload.candles;
  state.volume = payload.volume;
  state.vwap = payload.vwap;
  state.rows = payload.rows;

  state.candleSeries.setData(state.candles);
  const volumeData = state.volume.map((item) => ({
    time: item.time,
    value: item.volume,
    color: item.close >= item.open ? "rgba(34, 197, 94, 0.75)" : "rgba(239, 68, 68, 0.75)",
  }));
  state.volumeSeries.setData(volumeData);
  state.vwapSeries.setData(
    state.vwap.map((item) => ({ time: item.time, value: item.vwap }))
  );

  updateStats(payload);
  updateTable(payload);

  const last = payload.last;
  document.getElementById("symbolTitle").textContent = `${payload.symbol}`;
  document.getElementById(
    "symbolSubtitle"
  ).textContent = `最后更新: ${formatDay(last.time)} ${formatTime(last.time)} (ET)`;
  document.getElementById(
    "currentBar"
  ).textContent = `当前秒 O:${formatPrice(last.open)} H:${formatPrice(
    last.high
  )} L:${formatPrice(last.low)} C:${formatPrice(
    last.close
  )} · Vol ${formatAmount(last.volume)} · Amt ${formatAmount(last.amount)}`;
  document.getElementById(
    "tableSubtitle"
  ).textContent = `${payload.symbol} · ${payload.date} · 共 ${payload.stats.count.toLocaleString()} 秒`;

  setActiveRangeButton("full");
  state.chart.timeScale().fitContent();
}

async function loadSymbolData(symbol) {
  if (!state.date) return;
  const tail = document.getElementById("tailSelect").value;
  const payload = await fetchJSON(
    `/api/data?date=${state.date}&symbol=${symbol}&tail=${tail}`
  );
  state.symbol = symbol;
  applyChartData(payload);
}

function renderSymbolList(symbols) {
  const list = document.getElementById("symbolList");
  list.innerHTML = "";
  const search = document.getElementById("symbolSearch").value.toLowerCase();

  symbols
    .filter((item) => item.symbol.toLowerCase().includes(search))
    .forEach((item) => {
      const card = document.createElement("div");
      card.className = "symbol-card";
      if (item.symbol === state.symbol) card.classList.add("active");
      const baseOpen = Number.isFinite(item.open) ? item.open : null;
      const latestClose = Number.isFinite(item.close) ? item.close : null;
      const change = baseOpen !== null && latestClose !== null ? latestClose - baseOpen : 0;
      const changePct =
        baseOpen !== null && baseOpen !== 0 && latestClose !== null ? (change / baseOpen) * 100 : 0;
      card.innerHTML = `
        <div class="symbol-row">
          <div class="symbol-name">${item.symbol}</div>
          <div class="symbol-price ${change >= 0 ? "up" : "down"}">${formatPrice(
            latestClose
          )}</div>
        </div>
        <div class="symbol-meta">最新: ${formatTime(item.time)} · ${changePct >= 0 ? "+" : ""}${changePct.toFixed(
        2
      )}% · Vol ${formatAmount(item.volume)}</div>
      `;
      card.addEventListener("click", () => {
        document
          .querySelectorAll(".symbol-card")
          .forEach((node) => node.classList.remove("active"));
        card.classList.add("active");
        loadSymbolData(item.symbol).catch(console.error);
      });
      list.appendChild(card);
    });
}

async function refreshSymbols() {
  if (!state.date) return;
  const summary = await fetchJSON(`/api/summary?date=${state.date}`);
  state.summarySymbols = summary.symbols;
  renderSymbolList(state.summarySymbols);
  if (!state.symbol && summary.symbols.length > 0) {
    await loadSymbolData(summary.symbols[0].symbol);
  }
}

async function initDates() {
  const data = await fetchJSON("/api/dates");
  const select = document.getElementById("dateSelect");
  select.innerHTML = "";
  data.dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    select.appendChild(option);
  });
  if (data.dates.length > 0) {
    state.date = data.dates[0];
    select.value = state.date;
  }
}

function initRangeButtons() {
  document.querySelectorAll(".range-buttons button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = btn.dataset.range;
      if (!state.candles.length) return;
      const lastTime = state.candles[state.candles.length - 1].time;
      if (range === "fit") {
        state.chart.timeScale().fitContent();
        setActiveRangeButton("fit");
        return;
      }
      if (range === "full") {
        state.chart.timeScale().fitContent();
        setActiveRangeButton("full");
        return;
      }
      const seconds = Number(range);
      state.chart.timeScale().setVisibleRange({
        from: lastTime - seconds,
        to: lastTime,
      });
      setActiveRangeButton(range);
    });
  });
}

function bindControls() {
  document.getElementById("dateSelect").addEventListener("change", async (e) => {
    state.date = e.target.value;
    state.symbol = null;
    await refreshSymbols();
  });

  document.getElementById("tailSelect").addEventListener("change", () => {
    if (state.symbol) {
      loadSymbolData(state.symbol).catch(console.error);
    }
  });

  document.getElementById("refreshBtn").addEventListener("click", () => {
    refreshSymbols().catch(console.error);
  });

  document.getElementById("symbolSearch").addEventListener("input", () => {
    renderSymbolList(state.summarySymbols);
  });
}

async function bootstrap() {
  initChart();
  initRangeButtons();
  bindControls();
  await initDates();
  await refreshSymbols();
}

bootstrap().catch((error) => {
  console.error(error);
  document.getElementById("symbolTitle").textContent =
    "加载失败，请检查数据目录与服务。";
});
