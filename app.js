// ===============================
// 設定値
// ===============================
const PX = { w: 520, h: 220, m: { top: 22, right: 42, bottom: 30, left: 46 } };
PX.iw = PX.w - PX.m.left - PX.m.right; // inner width
PX.ih = PX.h - PX.m.top - PX.m.bottom; // inner height

const colors = {
  index: getComputedStyle(document.documentElement).getPropertyValue('--accent1').trim() || '#4aa3ff',
  yoy_q: getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#ffd166',
  yoy_e: getComputedStyle(document.documentElement).getPropertyValue('--accent3').trim() || '#ef476f',
};

const grid = d3.select('#grid');
const empty = d3.select('#empty');
const filterInput = document.querySelector('#filter');

// ===============================
// UI イベント
// ===============================
document.querySelector('#loadBtn').addEventListener('click', () => {
  const name = document.querySelector('#csvName').value.trim();
  if (!name) return;
  loadAndRender(name);
});

filterInput.addEventListener('input', () => {
  const q = filterInput.value.trim().toLowerCase();
  d3.selectAll('.card').style('display', function () {
    const item = this.getAttribute('data-item')?.toLowerCase() || '';
    return item.includes(q) ? null : 'none';
  });
  const visible = d3.selectAll('.card').filter(function () { return this.style.display !== 'none'; }).size();
  empty.style('display', visible ? 'none' : null);
});

// 初期読み込み
window.addEventListener('DOMContentLoaded', () => {
  loadAndRender(document.querySelector('#csvName').value.trim());
});

// ===============================
// 読み込み＆描画
// ===============================
async function loadAndRender(csvUrl) {
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : +v);
  const parseRow = (d) => {
    // 型整形
    const row = Object.assign({}, d);
    // date: ISO 文字列 -> Date
    row.date = new Date(d.date);
    // 数値化
    row.index = num(d.index);
    row.yoy_q_pct_chg = num(d.yoy_q_pct_chg);
    row.yoy_e_pct_chg = num(d.yoy_e_pct_chg);
    row.level_kakei = +d.level_kakei;
    row.code_cpi = +d.code_cpi;
    return row;
  };

  let data;
  try {
    const raw = await d3.csv(csvUrl, parseRow);
    // 必須列あり & 有効な日付のみ
    data = raw.filter((r) => r.item && r.date instanceof Date && !isNaN(r.date));
  } catch (e) {
    console.error(e);
    grid.html('');
    empty.style('display', null).text(`CSVの読み込みに失敗しました: ${e.message}`);
    return;
  }

  // 品目ごとにグルーピング
  const byItem = d3.group(data, (d) => d.item);

  // 並び順：level_kakei=3 を先頭 → 同グループ内で code_cpi 昇順 → さらに item 名昇順
  const rankLevel = (v) => (v === 3 ? 0 : 1);
  const items = Array.from(byItem, ([key, arr]) => ({
    item: key,
    // その品目の代表 level（最大）
    lvl: d3.max(arr, (d) => +d.level_kakei || 0),
    // その品目の代表 code_cpi（最小）
    cpi: d3.min(arr, (d) => +d.code_cpi || Number.POSITIVE_INFINITY),
  }))
    .sort(
      (a, b) =>
        rankLevel(a.lvl) - rankLevel(b.lvl) ||
        d3.ascending(a.cpi, b.cpi) ||
        d3.ascending(a.item, b.item)
    );

  // 画面初期化
  grid.html('');

  // 各品目カードを描画
  for (const { item } of items) {
    const series = byItem
      .get(item)
      .filter(
        (d) =>
          !isNaN(d.index) ||
          !isNaN(d.yoy_q_pct_chg) ||
          !isNaN(d.yoy_e_pct_chg)
      )
      .sort((a, b) => d3.ascending(a.date, b.date));

    if (series.length === 0) continue;

    const card = grid.append('div').attr('class', 'card').attr('data-item', item);
    const title = card.append('div').attr('class', 'title');
    title.append('div').text(item);

    const legend = card.append('div').attr('class', 'legend');
    legend.html(`
      <span><span class="swatch sw1"></span>YoY index</span>
      <span><span class="swatch sw2"></span>YoY 数量(%)</span>
      <!-- <span><span class="swatch sw3"></span>YoY 支出</span> -->
    `);

    const svg = card
      .append('svg')
      .attr('viewBox', `0 0 ${PX.w} ${PX.h}`)
      .attr('preserveAspectRatio', 'xMinYMin meet');

    const g = svg.append('g').attr('transform', `translate(${PX.m.left},${PX.m.top})`);

    // ===============================
    // スケール（Y軸を一本に統合）
    // ===============================
    const x = d3.scaleUtc()
      .domain(d3.extent(series, (d) => d.date))
      .range([0, PX.iw]);

    // index / yoy_q / yoy_e（必要なら）を全部まとめてレンジ計算
    const combinedVals = series
      .flatMap((d) => [d.index, d.yoy_q_pct_chg, d.yoy_e_pct_chg])
      .filter((v) => !isNaN(v));

    // 値が全く無い場合のフェイルセーフ
    let [yMin, yMax] = combinedVals.length ? d3.extent(combinedVals) : [0, 1];

    // 最小=最大のケースに微小幅を与えて可視化を安定化
    if (yMin === yMax) {
      const pad = yMin === 0 ? 1 : Math.abs(yMin) * 0.05; // 5% だけ広げる
      yMin -= pad;
      yMax += pad;
    }

    const y = d3.scaleLinear()
      .domain([yMin, yMax])
      .nice()
      .range([PX.ih, 0]);

    // 軸
    const xAxis = d3.axisBottom(x).ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat('%Y'));
    const yAxis = d3.axisLeft(y).ticks(5); // %表記は付けない

    // Xグリッド（縦罫線）
    g.append('g')
      .attr('class', 'grid xgrid')
      .attr('transform', `translate(0,${PX.ih})`)
      .call(xAxis.tickSize(-PX.ih))
      .call((g) => g.selectAll('.tick line').attr('class', 'gridline'))
      .call((g) => g.select('.domain').remove());

    // 左Y軸のみ
    g.append('g').attr('class', 'axis y left').call(yAxis);

    // 0 ライン（任意・残しておくと基準がわかりやすい）
    g.append('line')
    .attr('x1', 0)
    .attr('x2', PX.iw)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', '#ffffff')          // 白または明るい色
    .attr('stroke-width', 1.5)          // 太め
    .attr('stroke-dasharray', '6,3')    // 長めの破線で視認性アップ
    .attr('opacity', 0.9);              // やや透過で上品に

    // ラインジェネレーター（すべて同じ y を使用）
    const lineIndex = d3.line()
      .defined((d) => !isNaN(d.index))
      .x((d) => x(d.date))
      .y((d) => y(d.index));

    const lineYQ = d3.line()
      .defined((d) => !isNaN(d.yoy_q_pct_chg))
      .x((d) => x(d.date))
      .y((d) => y(d.yoy_q_pct_chg));

    const lineYE = d3.line()
      .defined((d) => !isNaN(d.yoy_e_pct_chg))
      .x((d) => x(d.date))
      .y((d) => y(d.yoy_e_pct_chg));

    // 描画
    g.append('path')
      .attr('fill', 'none')
      .attr('stroke', colors.index)
      .attr('stroke-width', 1.6)
      .attr('d', lineIndex(series));

    g.append('path')
      .attr('fill', 'none')
      .attr('stroke', colors.yoy_q)
      .attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '5,3')
      .attr('d', lineYQ(series));

    // YoY 支出線（必要なら解除）
    // g.append('path')
    //   .attr('fill', 'none')
    //   .attr('stroke', colors.yoy_e)
    //   .attr('stroke-width', 1.4)
    //   .attr('d', lineYE(series));

    // X軸（最後に前面へ）
    g.append('g')
      .attr('class', 'axis x')
      .attr('transform', `translate(0,${PX.ih})`)
      .call(xAxis);
  }

  // フィルタ適用（初期状態の可視性更新）
  filterInput.dispatchEvent(new Event('input'));
}
