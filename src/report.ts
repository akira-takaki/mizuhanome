import fs from "fs-extra";
import dayjs from "dayjs";
import {
  BetDayResult,
  BetRaceResult,
  BetResult,
  betResultOrderByTypeAndExpectedValue,
  Parameter,
  readBetDayResult,
} from "#/betResult";
import {
  currencyFormatter,
  decimalFormatter,
  percentFormatter,
  playerPowersFromBetRaceResult,
  Power,
  TicketType,
} from "#/myUtil";
import { logger } from "#/boatRace";
import path from "path";

const DIR = "./report";
const PREFIX = "betDayResult";
const SUFFIX = "html";
const DATE_FORMAT = "YYYYMMDD";

/**
 * ファイル名を作って返す
 *
 * @param date 日付
 * @param isSim シミュレーションかどうか
 */
function makeFileName(date: dayjs.Dayjs, isSim: boolean): string {
  const dateStr = date.format(DATE_FORMAT);
  if (isSim) {
    return path.join(DIR, `${PREFIX}_${dateStr}_sim.${SUFFIX}`);
  } else {
    return path.join(DIR, `${PREFIX}_${dateStr}.${SUFFIX}`);
  }
}

/**
 * まとめファイル名を作って返す
 *
 * @param isSim シミュレーションかどうか
 */
function makeSummaryFileName(isSim: boolean): string {
  if (isSim) {
    return path.join(DIR, `${PREFIX}_sim.${SUFFIX}`);
  } else {
    return path.join(DIR, `${PREFIX}.${SUFFIX}`);
  }
}

/**
 * パラメータ表 ヘッダー 作成
 */
function createParameterTableHtmlHeader(): string {
  return `
    <tr class="parameter-header">
      <th class="type-header">舟券種類</th>
      <th class="date-header">日付</th>
      <th class="entryRaceCountRate-header">参加レース率</th>
      <th class="entryRaceCount-header">参加レース数</th>
      <th class="hittingRate-header">的中率</th>
      <th class="amountPurchased-header">購入金額</th>
      <th class="collect-header">回収金額</th>
      <th class="collectRate-header">回収率</th>
      <th class="amountPurchasedRate-header">購入金額率</th>
    </tr>
  `;
}

/**
 * パラメータ表 行 作成
 *
 * @param type
 * @param date
 * @param parameter
 */
function createParameterTableHtmlRow(
  type: string,
  date: string,
  parameter: Parameter
): string {
  const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];
  return `
      <tr class="parameter">
        <td class="type-${type}">${type}</td>
        <td class="date-row">${date}(${
    weekdayNames[dayjs(date, "YYYY/MM/DD").day()]
  })</td>
        <td class="entryRaceCountRate">${
          parameter.entryRaceCountRate !== null
            ? percentFormatter.format(parameter.entryRaceCountRate)
            : ""
        }</td>
        <td class="entryRaceCount">${
          parameter.entryRaceCount !== null ? parameter.entryRaceCount : ""
        }</td>
        <td class="hittingRate">${
          parameter.hittingRate !== null
            ? percentFormatter.format(parameter.hittingRate)
            : ""
        }</td>
        <td class="amountPurchased">${
          parameter.amountPurchased !== null
            ? currencyFormatter.format(parameter.amountPurchased)
            : ""
        }</td>
        <td class="collect">${
          parameter.collect !== null
            ? currencyFormatter.format(parameter.collect)
            : ""
        }</td>
        <td class="collectRate">${
          parameter.collectRate !== null
            ? percentFormatter.format(parameter.collectRate)
            : ""
        }</td>
        <td class="amountPurchasedRate">${
          parameter.amountPurchasedRate !== null
            ? percentFormatter.format(parameter.amountPurchasedRate)
            : ""
        }</td>
      </tr>
      `;
}

function createParameterTableHtml(betDayResult: BetDayResult): string {
  const tableHeader = createParameterTableHtmlHeader();

  let tableRow = "";
  tableRow += createParameterTableHtmlRow(
    "3t仮定",
    betDayResult.date,
    betDayResult.assumed3t
  );
  tableRow += createParameterTableHtmlRow(
    "3t",
    betDayResult.date,
    betDayResult.actual3t
  );
  tableRow += createParameterTableHtmlRow(
    "3f",
    betDayResult.date,
    betDayResult.actual3f
  );
  tableRow += createParameterTableHtmlRow(
    "2t",
    betDayResult.date,
    betDayResult.actual2t
  );
  tableRow += createParameterTableHtmlRow(
    "2f",
    betDayResult.date,
    betDayResult.actual2f
  );

  return `<table class="parameter">` + tableHeader + tableRow + `</table>`;
}

/**
 * 舟券種類別 パラメータ表 作成
 *
 * @param type
 * @param betDayResults
 */
function createTypeParameterTableHtml(
  type: TicketType,
  betDayResults: BetDayResult[]
): string {
  const tableHeader = createParameterTableHtmlHeader();

  let tableRow = "";
  for (let i = 0; i < betDayResults.length; i++) {
    const betDayResult = betDayResults[i];

    if (type === "3t") {
      tableRow += createParameterTableHtmlRow(
        "3t",
        betDayResult.date,
        betDayResult.actual3t
      );
    } else if (type === "3f") {
      tableRow += createParameterTableHtmlRow(
        "3f",
        betDayResult.date,
        betDayResult.actual3f
      );
    } else if (type === "2t") {
      tableRow += createParameterTableHtmlRow(
        "2t",
        betDayResult.date,
        betDayResult.actual2t
      );
    } else if (type === "2f") {
      tableRow += createParameterTableHtmlRow(
        "2f",
        betDayResult.date,
        betDayResult.actual2f
      );
    }
  }

  return `<table class="parameter">` + tableHeader + tableRow + `</table>`;
}

function createBetRaceResultTableHtmlHeader(): string {
  return `
    <tr class="race-header">
      <th class="type-header">舟券種類</th>
      <th class="numberset-header">組番</th>
      <th class="percent-header">確率</th>
      <th class="preOdds-header">レース前オッズ</th>
      <th class="expectedValue-header">期待値</th>
      <th class="bet-header">賭け金</th>
      <th class="preDividend-header">予想配当金</th>
      <th class="odds-header">オッズ</th>
      <th class="dividend-header">配当金</th>
      <th class="difference-header">差額</th>
    </tr>
  `;
}

function createBetRaceResultTableHtmlRow(
  betResult: BetResult,
  rowspan: number | null,
  difference: number | null
): string {
  const isHit = betResult.odds !== null && betResult.bet !== betResult.dividend;
  const isResult = betResult.odds !== null;

  let classSuffix: string;
  let statusStr: string;
  if (isHit) {
    classSuffix = "hit";
    statusStr = "当";
  } else if (isResult) {
    classSuffix = "result";
    statusStr = "結";
  } else {
    classSuffix = "miss";
    statusStr = "";
  }
  const trStart = `
    <tr class="bet-${classSuffix}">
  `;

  let td = "";
  td =
    td +
    `
      <td class="type-${betResult.type}">
        ${betResult.type}
        ${statusStr}
      </td>
      <td class="numberset">${betResult.numberset}</td>
      <td class="percent">${percentFormatter.format(betResult.percent)}</td>
      <td class="preOdds">${
        betResult.preOdds !== null
          ? decimalFormatter.format(betResult.preOdds)
          : ""
      }</td>
      <td class="expectedValue">${decimalFormatter.format(
        betResult.expectedValue
      )}</td>
      <td class="bet">${currencyFormatter.format(betResult.bet)}</td>
      <td class="preDividend">${currencyFormatter.format(
        betResult.preDividend
      )}</td>
      <td class="odds">${
        betResult.odds !== null ? decimalFormatter.format(betResult.odds) : ""
      }</td>
      <td class="dividend">${
        betResult.dividend !== null
          ? currencyFormatter.format(betResult.dividend)
          : ""
      }</td>
    `;

  if (rowspan !== null && difference !== null) {
    const plus = difference >= 0 ? "plus" : "minus";
    td =
      td +
      `
      <td class="difference-${plus}" rowspan="${rowspan}">${currencyFormatter.format(
        difference
      )}</td>
      `;
  }

  const trEnd = `
    </tr>
  `;

  return trStart + td + trEnd;
}

function createBetRaceResultTableHtmlType(
  betResults: BetResult[],
  difference: number
): string {
  let tableRow = "";

  for (let i = 0; i < betResults.length; i++) {
    const betResult = betResults[i];

    if (i === 0) {
      tableRow =
        tableRow +
        createBetRaceResultTableHtmlRow(
          betResult,
          betResults.length,
          difference
        );
    } else {
      tableRow =
        tableRow + createBetRaceResultTableHtmlRow(betResult, null, null);
    }
  }

  return tableRow;
}

function createBetRaceResultTableHtml(betRaceResult: BetRaceResult): string {
  const tableStart = `
    <table class="race">
  `;

  const tableHeader = createBetRaceResultTableHtmlHeader();

  // 賭け金が 0 のものは除外
  // ただし、レース結果(oddsが設定されているもの)は残す
  const filteredBetResults = betRaceResult.betResults
    .filter((value) => value.bet > 0 || (value.odds !== null && value.odds > 1))
    .sort(betResultOrderByTypeAndExpectedValue);

  let tableRow = "";
  let prevType = "";
  let typeBetResults: BetResult[] = [];
  let typeBet = 0;
  let typeDividend = 0;
  for (let i = 0; i < filteredBetResults.length; i++) {
    const betResult = filteredBetResults[i];

    if (i === 0) {
      prevType = betResult.type;
    }

    if (prevType !== betResult.type) {
      // ブレイク処理
      tableRow =
        tableRow +
        createBetRaceResultTableHtmlType(
          typeBetResults,
          typeDividend - typeBet
        );

      // 初期化
      typeBetResults = [];
      typeBet = 0;
      typeDividend = 0;
    }

    typeBetResults.push(betResult);
    typeBet = typeBet + betResult.bet;
    if (betResult.dividend !== null) {
      typeDividend = typeDividend + betResult.dividend;
    }
    prevType = betResult.type;
  }
  if (typeBetResults.length > 0) {
    // ブレイク処理
    tableRow =
      tableRow +
      createBetRaceResultTableHtmlType(typeBetResults, typeDividend - typeBet);
  }

  const tableEnd = `
    </table>
    `;

  return tableStart + tableHeader + tableRow + tableEnd;
}

function createSummaryTableHtmlHeader(): string {
  return `
    <tr class="summary-header">
      <th class="date-header">日付</th>
      <th class="capital-header">資金</th>
      <th class="nextCapital-header">次回の資金</th>
      <th class="raceCount-header">レース数</th>
      <th class="amountPurchasedAll-header">購入金額</th>
      <th class="collectAll-header">回収金額</th>
      <th class="collectRateAll-header">回収率</th>
      <th class="differenceAll-header">差額</th>
    </tr>
  `;
}

/**
 * 日別のまとめ行
 *
 * @param betDayResult
 */
function createSummaryTableHtmlRow(betDayResult: BetDayResult): string {
  const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const plus =
    betDayResult.differenceAll !== null && betDayResult.differenceAll >= 0
      ? "plus"
      : "minus";
  return `
    <tr class="summary-row">
      <td class="date-row">${betDayResult.date}(${
    weekdayNames[dayjs(betDayResult.date, betDayResult.dateFormat).day()]
  })</td>
      <td class="capital-row">${currencyFormatter.format(
        betDayResult.capital
      )}</td>
      <td class="nextCapital-row">${
        betDayResult.nextCapital !== null
          ? currencyFormatter.format(betDayResult.nextCapital)
          : ""
      }</td>
      <td class="raceCount-row">${betDayResult.raceCount}</td>
      <td class="amountPurchasedAll-row">${
        betDayResult.amountPurchasedAll !== null
          ? currencyFormatter.format(betDayResult.amountPurchasedAll)
          : ""
      }</td>
      <td class="collectAll-row">${
        betDayResult.collectAll !== null
          ? currencyFormatter.format(betDayResult.collectAll)
          : ""
      }</td>
      <td class="collectRateAll-row">${
        betDayResult.collectRateAll !== null
          ? percentFormatter.format(betDayResult.collectRateAll)
          : ""
      }</td>
      <td class="differenceAll-row-${plus}">${
    betDayResult.differenceAll !== null
      ? currencyFormatter.format(betDayResult.differenceAll)
      : ""
  }</td>
    </tr>
  `;
}

function createPlayerPowerTableHtml(powers: Power[]): string {
  const tableStart = `
    <table class="powers">
  `;

  const tableHeader = `
      <tr>
        <th>舟番</th>
        <th>パワー</th>
      </tr>
  `;

  let tableRow = "";
  for (let i = 0; i < powers.length; i++) {
    tableRow =
      tableRow +
      `
      <tr>
        <td class="number-row">${powers[i].numberStr}</td>
        <td class="power-row">${decimalFormatter.format(powers[i].power)}</td>
      </tr>
    `;
  }

  const tableEnd = `
    </table>
    `;

  return tableStart + tableHeader + tableRow + tableEnd;
}

/**
 * 賭け結果 レポート作成
 *
 * @param date
 * @param isSim シミュレーションかどうか
 */
export async function report(date: dayjs.Dayjs, isSim = false): Promise<void> {
  let betDayResult: BetDayResult;
  try {
    betDayResult = readBetDayResult(date, isSim);
  } catch (err) {
    logger.error(err);
    return;
  }

  const isSimStr = isSim ? "(シミュレーション)" : "";

  const htmlStart = `
  <!DOCTYPE html>
  <html lang="ja">
    <head>
      <title>レポート ${betDayResult.date}${isSimStr}</title>
      <link rel="stylesheet" href="report.css">
    </head>
    <body>
  `;

  const htmlHeader = `
    <header>
    ${isSimStr}<br>
      <table>
        ${createSummaryTableHtmlHeader()}
        ${createSummaryTableHtmlRow(betDayResult)}
      </table>
    </header>
  `;

  // パラメータ HTML
  const htmlParameters = createParameterTableHtml(betDayResult);

  // レースの賭け結果 HTML
  let htmlTable = "";
  for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
    const betRaceResult = betDayResult.betRaceResults[i];

    const powers = playerPowersFromBetRaceResult(betRaceResult);
    htmlTable = htmlTable + createPlayerPowerTableHtml(powers);

    htmlTable = htmlTable + createBetRaceResultTableHtml(betRaceResult);
  }

  const htmlEnd = `
    </body>
  </html>
  `;

  const html = htmlStart + htmlHeader + htmlParameters + htmlTable + htmlEnd;

  fs.mkdirpSync(DIR);
  const fileName = makeFileName(date, isSim);
  fs.writeFileSync(fileName, html);
}

/**
 * 賭け結果 まとめレポート作成
 *
 * @param dateArray
 * @param isSim
 */
export async function reportSummary(
  dateArray: dayjs.Dayjs[],
  isSim = false
): Promise<void> {
  const isSimStr = isSim ? "(シミュレーション)" : "";

  const betDayResults: BetDayResult[] = [];
  for (let i = 0; i < dateArray.length; i++) {
    const date = dateArray[i];

    let betDayResult: BetDayResult;
    try {
      betDayResult = readBetDayResult(date, isSim);
    } catch (err) {
      logger.error(err);
      return;
    }
    betDayResults.push(betDayResult);
  }

  // グラフのデータ ラベル
  const labels: string[] = [];

  // グラフのデータ 差額
  const differenceAll: number[] = [];

  // グラフのデータ 資金
  const capital: number[] = [];

  const htmlStart = `
  <!DOCTYPE html>
  <html lang="ja">
    <head>
      <title>まとめレポート${isSimStr}</title>
      <link rel="stylesheet" href="report.css">
    </head>
    <body>
    ${isSimStr}<br>
    <canvas id="charts1"></canvas>
  `;

  let htmlSummaryTable = `
    <table class="summary">
  `;
  htmlSummaryTable = htmlSummaryTable + createSummaryTableHtmlHeader();
  for (let i = 0; i < betDayResults.length; i++) {
    const betDayResult = betDayResults[i];

    // グラフのデータ作成 ラベル
    labels.push(betDayResult.date);

    // グラフのデータ作成 差額
    differenceAll.push(
      betDayResult.differenceAll !== null ? betDayResult.differenceAll : 0
    );

    // グラフのデータ作成 資金
    capital.push(betDayResult.capital);

    // 日別のまとめ行
    htmlSummaryTable += createSummaryTableHtmlRow(betDayResult);
  }
  htmlSummaryTable += `
    </table>
  `;

  // グラフのデータ 的中率 三連単
  const hittingRate3t: number[] = [];

  // 舟券種類別
  let htmlParameterTable = "";
  const types: TicketType[] = ["3t", "3f", "2t", "2f"];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];

    // グラフのデータ作成 的中率 三連単
    // 確率が1番高い組番の的中率
    if (type === "3t") {
      for (let j = 0; j < betDayResults.length; j++) {
        const betDayResult = betDayResults[j];

        // 1日のレース数
        const raceCount = betDayResult.betRaceResults.length;

        // 1日の的中数
        let hitting = 0;

        for (let k = 0; k < betDayResult.betRaceResults.length; k++) {
          // 1レースごとの処理
          const betRaceResult = betDayResult.betRaceResults[k];

          // 1レースのすべての組番を確率が高い順にソート
          const sortedBetResults = betRaceResult.betResults
            .sort((e1, e2) => {
              if (e1.percent > e2.percent) {
                return 1;
              } else if (e1.percent < e2.percent) {
                return -1;
              } else {
                return 0;
              }
            })
            .reverse();

          if (sortedBetResults[0].odds !== null) {
            // 確率が1番高い組番にオッズが設定されていたら的中したってこと
            hitting++;
          }
        }

        // 1日の的中率を計算
        const hittingRate = hitting / raceCount;

        // グラフのデータとして加工
        hittingRate3t.push(hittingRate * 100);
      }
    }

    htmlParameterTable += createTypeParameterTableHtml(type, betDayResults);
  }

  const htmlEnd = `
      <script src="../node_modules/chart.js/dist/Chart.js"></script>
      <script>
        var ctx1 = document.getElementById("charts1");
        var myChart1 = new Chart(ctx1, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
              {
                yAxisID: "y-money",
                label: '差額',
                backgroundColor: 'blue',
                borderColor: 'blue',
                data: ${JSON.stringify(differenceAll)},
                fill: false
              },
              {
                yAxisID: "y-money",
                label: '資金',
                backgroundColor: 'lightgreen',
                borderColor: 'lightgreen',
                data: ${JSON.stringify(capital)},
                fill: true
              },
              {
                yAxisID: "y-percent",
                label: '三連単的中率',
                backgroundColor: 'red',
                borderColor: 'red',
                data: ${JSON.stringify(hittingRate3t)},
                fill: false
              }
            ]
          },
          options: {
            scales: {
              yAxes: [{
                id: "y-money",
                position: "left"
              }, {
                id: "y-percent",
                position: "right",
                ticks: {
                  min: -10,
                  max: 100,
                  stepSize: 10
                }
              }]
            }
          }
        });
      </script>
    </body>
  </html>
  `;

  const html = htmlStart + htmlSummaryTable + htmlParameterTable + htmlEnd;

  fs.mkdirpSync(DIR);
  const fileName = makeSummaryFileName(isSim);
  fs.writeFileSync(fileName, html);
}
