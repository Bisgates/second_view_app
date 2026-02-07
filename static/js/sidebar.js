import { state } from './state.js';
import { sidebarContent } from './dom.js';
import { loadChart } from './data.js';

export function renderSidebar(dates) {
  sidebarContent.innerHTML = '';
  dates.forEach(d => {
    const group = document.createElement('div');
    group.className = 'date-group';
    group.dataset.date = d;

    const header = document.createElement('div');
    header.className = 'date-header';
    header.innerHTML = `<span class="chevron">▶</span><span class="date-label">${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}</span>`;
    header.onclick = () => handleDateClick(d);
    group.appendChild(header);

    const symList = document.createElement('div');
    symList.className = 'sym-list collapsed';
    group.appendChild(symList);

    sidebarContent.appendChild(group);
  });
}

function handleDateClick(date) {
  if (state.currentDate === date) {
    const group = sidebarContent.querySelector(`.date-group[data-date="${date}"]`);
    if (group) {
      const symList = group.querySelector('.sym-list');
      const chevron = group.querySelector('.chevron');
      symList.classList.toggle('collapsed');
      chevron.classList.toggle('expanded');
    }
  } else {
    selectDate(date);
  }
}

export function selectDate(date) {
  state.currentDate = date;

  sidebarContent.querySelectorAll('.date-group').forEach(g => {
    const d = g.dataset.date;
    const header = g.querySelector('.date-header');
    const symList = g.querySelector('.sym-list');
    const chevron = g.querySelector('.chevron');
    if (d === date) {
      header.classList.add('active');
      symList.classList.remove('collapsed');
      chevron.classList.add('expanded');
    } else {
      header.classList.remove('active');
      symList.classList.add('collapsed');
      chevron.classList.remove('expanded');
    }
  });

  const symbols = state.dates[date] || [];
  renderSymbolList(date, symbols);
  if (symbols.length > 0) {
    selectSymbol(symbols[0].symbol);
  }
}

function renderSymbolList(date, symbols) {
  const group = sidebarContent.querySelector(`.date-group[data-date="${date}"]`);
  if (!group) return;
  const symList = group.querySelector('.sym-list');
  symList.innerHTML = '';
  symbols.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sym-card';
    card.dataset.symbol = s.symbol;
    const up = s.change_pct >= 0;
    card.innerHTML = `
      <div class="sym-name">${s.symbol}</div>
      <div class="sym-price">$${s.close.toFixed(2)}</div>
      <div class="sym-change ${up ? 'up' : 'down'}">${up ? '+' : ''}${s.change_pct.toFixed(2)}%</div>
    `;
    card.onclick = () => selectSymbol(s.symbol);
    symList.appendChild(card);
  });
}

function selectSymbol(symbol) {
  state.currentSymbol = symbol;
  document.querySelectorAll('.sym-card').forEach(c => {
    c.classList.toggle('active', c.dataset.symbol === symbol);
  });
  loadChart();
}
