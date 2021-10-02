import fs from "fs-extra";
import path from "path";
import dayjs from "dayjs";

import {
  BetDayResult,
  BetRaceResult,
  BetResult,
  betResultOrderByTypeAndPercent,
  FILE_NAME_DATE_FORMAT,
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

const DIR = "./report";
const PREFIX = "betDayResult";
const SUFFIX = "html";

const jnames: string[] = [];
jnames[1] = "桐生";
jnames[2] = "戸田";
jnames[3] = "江戸川";
jnames[4] = "平和島";
jnames[5] = "多摩川";
jnames[6] = "浜名湖";
jnames[7] = "蒲郡";
jnames[8] = "常滑";
jnames[9] = "津";
jnames[10] = "三国";
jnames[11] = "びわこ";
jnames[12] = "住之江";
jnames[13] = "尼崎";
jnames[14] = "鳴門";
jnames[15] = "丸亀";
jnames[16] = "児島";
jnames[17] = "宮島";
jnames[18] = "徳山";
jnames[19] = "下関";
jnames[20] = "若松";
jnames[21] = "芦屋";
jnames[22] = "福岡";
jnames[23] = "唐津";
jnames[24] = "大村";

/* 連続ではずれたカウント */
export let missCount = 0;

/* 連続ではずれたカウントの最大値 */
export let missCountMax = 0;

/**
 * ファイル名を作って返す
 *
 * @param date 日付
 * @param isSim シミュレーションかどうか
 */
function makeFileName(date: dayjs.Dayjs, isSim: boolean): string {
  const dateStr = date.format(FILE_NAME_DATE_FORMAT);
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
    missCountMax = Math.max(missCount, missCountMax);
    missCount = 0;
  } else if (isResult) {
    classSuffix = "result";
    statusStr = "結";
  } else {
    classSuffix = "miss";
    statusStr = "";
    missCount++;
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
    .sort(betResultOrderByTypeAndPercent);

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

    htmlTable =
      htmlTable +
      betRaceResult.raceCardBody.jcd.toString() +
      " : " +
      jnames[parseInt(betRaceResult.raceCardBody.jcd.toString())];

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
 * 指定された 舟券種類 と 場所番号 の1日の的中率を計算
 * 場所番号が指定されなかった場合、すべての場所番号の1日の的中率を計算
 *
 * @param betDayResult 1日分のレースの賭け結果
 * @param type 舟券種類
 * @param waveFrom 波の高さ(From)
 * @param waveTo 波の高さ(To)
 * @param jcdArray 場所番号(オプション)
 * @param top 上位何番目までを含めるか
 * @param percent 確率の閾値
 * @return 的中率
 */
export function calcHittingRate(
  betDayResult: BetDayResult,
  type: TicketType,
  waveFrom?: number,
  waveTo?: number,
  jcdArray?: number[],
  top = 1,
  percent?: number
): number | null {
  let filteredBetRaceResults = betDayResult.betRaceResults;

  // 波の高さ で絞り込み
  if (waveFrom !== undefined && waveTo !== undefined) {
    filteredBetRaceResults = filteredBetRaceResults.filter((value) => {
      if (value.beforeInfoBody.wave === null) {
        return false;
      } else {
        const wave = parseInt(value.beforeInfoBody.wave.replace("cm", ""));
        return wave >= waveFrom && wave < waveTo;
      }
    });
  }

  // 場所番号 で絞り込み
  if (jcdArray !== undefined) {
    filteredBetRaceResults = filteredBetRaceResults.filter((value) =>
      jcdArray.includes(parseInt(value.raceCardBody.jcd.toString()))
    );
  }

  if (filteredBetRaceResults.length <= 0) {
    // 該当するレースが無かった場合
    return null;
  }

  // レース数
  let raceCount = 0;

  // 1日の的中数
  let hitting = 0;

  for (let i = 0; i < filteredBetRaceResults.length; i++) {
    // 1レースごとの処理
    const betRaceResult = filteredBetRaceResults[i];

    // 1レースのすべての組番を確率が高い順にソート
    let sortedBetResults = betRaceResult.betResults
      .filter((value) => value.type === type)
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

    if (percent !== undefined) {
      // 指定された確率以上のものに絞り込む
      sortedBetResults = sortedBetResults.filter(
        (value) => value.percent >= percent
      );
    }

    if (sortedBetResults.length <= 0) {
      // 絞り込んだ結果、組番がなければカウントしない
      continue;
    }

    raceCount++;

    const targetCount = Math.min(top, sortedBetResults.length);
    for (let j = 0; j < targetCount; j++) {
      if (sortedBetResults[j].odds !== null) {
        // 組番にオッズが設定されていたら的中したってこと
        hitting++;
        break;
      }
    }
  }

  // 1日の的中率を計算
  const hittingRate = hitting / raceCount;

  return hittingRate * 100;
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

  // グラフのデータ 的中率
  const hittingRate3tArray: (number | null)[] = [];
  const hittingRate3fArray: (number | null)[] = [];
  const hittingRate2tArray: (number | null)[] = [];
  const hittingRate2fArray: (number | null)[] = [];
  const hittingRate3tWave1Array: (number | null)[] = [];
  const hittingRate3tWave2Array: (number | null)[] = [];

  // ========== 三連単 場所別 的中率 ========== START
  const percentFromToArray: number[] = []; // 確率の範囲 配列
  const fromPercent = 0.001; // 確率の初期値
  for (let i = 0; i < 150; i++) {
    const percent = fromPercent + 0.001 * i;
    percentFromToArray.push(parseFloat(percent.toFixed(3)));
  }
  const hittingRate3tJcd: (number | null)[][][] = [];
  for (let i = 0; i < percentFromToArray.length; i++) {
    hittingRate3tJcd[i] = [];
    for (let jcd = 1; jcd <= 24; jcd++) {
      hittingRate3tJcd[i][jcd] = [];
    }
  }
  // ========== 三連単 場所別 的中率 ========== END

  const hittingRate3tJcdComposite: (number | null)[] = [];
  const hittingRate3tTopN: (number | null)[][] = [];
  for (let i = 1; i <= 20; i++) {
    hittingRate3tTopN[i] = [];
  }

  // 三連単 選抜した場所 合成 指定確率以上 的中率
  const hittingRate3tPercent: (number | null)[][] = [];
  const percentArray: number[] = [];
  const percentArraySize = 10;
  for (let i = 1; i <= percentArraySize; i++) {
    hittingRate3tPercent[i] = [];
    percentArray[i] = 0.01 * i + 0.08;
  }

  const htmlStart = `
  <!DOCTYPE html>
  <html lang="ja">
    <head>
      <title>まとめレポート${isSimStr}</title>
      <link rel="stylesheet" href="report.css">
    </head>
    <body>
    ${isSimStr}<br>
    <canvas id="charts1" height="160"></canvas>
    <canvas id="charts2" height="80"></canvas>
    <canvas id="charts3" height="80"></canvas>
    <canvas id="chartsTopN" height="80"></canvas>
    <canvas id="chartsPercent" height="80"></canvas>
  `;

  let amountPurchasedAllMax = 0;
  let htmlSummaryTable = `
    <table class="summary">
  `;
  htmlSummaryTable = htmlSummaryTable + createSummaryTableHtmlHeader();
  for (let i = 0; i < betDayResults.length; i++) {
    const betDayResult = betDayResults[i];

    // 購入金額の最大値
    if (betDayResult.amountPurchasedAll !== null) {
      amountPurchasedAllMax = Math.max(
        amountPurchasedAllMax,
        betDayResult.amountPurchasedAll
      );
    }

    // グラフのデータ作成 ラベル
    labels.push(betDayResult.date);

    // グラフのデータ作成 差額
    differenceAll.push(
      betDayResult.differenceAll !== null ? betDayResult.differenceAll : 0
    );

    // グラフのデータ作成 資金
    capital.push(betDayResult.capital);

    // ===== グラフのデータ作成 的中率 =====
    // 舟券種類別 的中率
    hittingRate3tArray.push(calcHittingRate(betDayResult, "3t"));
    hittingRate3fArray.push(calcHittingRate(betDayResult, "3f"));
    hittingRate2tArray.push(calcHittingRate(betDayResult, "2t"));
    hittingRate2fArray.push(calcHittingRate(betDayResult, "2f"));

    // 三連単 波の高さ別 的中率
    hittingRate3tWave1Array.push(calcHittingRate(betDayResult, "3t", 0, 11));
    hittingRate3tWave2Array.push(calcHittingRate(betDayResult, "3t", 11, 99));

    // ========== 三連単 場所別 的中率 ========== START
    for (let j = 0; j < percentFromToArray.length; j++) {
      for (let jcd = 1; jcd <= 24; jcd++) {
        hittingRate3tJcd[j][jcd].push(
          calcHittingRate(
            betDayResult,
            "3t",
            undefined,
            undefined,
            [jcd],
            1,
            percentFromToArray[j]
          )
        );
      }
    }
    // ========== 三連単 場所別 的中率 ========== END

    // 三連単 選抜した場所 合成 的中率
    hittingRate3tJcdComposite.push(
      calcHittingRate(betDayResult, "3t", 0, 11, [11, 12, 13, 21, 24])
    );

    // 三連単 選抜した場所 合成 トップN 的中率
    for (let j = 1; j <= 20; j++) {
      hittingRate3tTopN[j].push(
        calcHittingRate(
          betDayResult,
          "3t",
          undefined,
          undefined,
          [11, 12, 13, 21, 24],
          j
        )
      );
    }

    // 三連単 選抜した場所 合成 指定確率以上 的中率
    for (let j = 1; j <= percentArraySize; j++) {
      hittingRate3tPercent[j].push(
        calcHittingRate(
          betDayResult,
          "3t",
          0,
          11,
          [11, 12, 13, 21, 24],
          1,
          percentArray[j]
        )
      );
    }

    // 日別のまとめ行
    htmlSummaryTable += createSummaryTableHtmlRow(betDayResult);
  }
  htmlSummaryTable += `
    </table>
  `;
  htmlSummaryTable += `
    購入金額の最大値 : ${currencyFormatter.format(amountPurchasedAllMax)}<br/>
  `;

  // 舟券種類別
  let htmlParameterTable = "";
  const types: TicketType[] = ["3t", "3f", "2t", "2f"];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    htmlParameterTable += createTypeParameterTableHtml(type, betDayResults);
  }

  const chartsTopNColors = [
    "",
    "#ff3300",
    "#99cc00",
    "#33ff66",
    "#006699",
    "#6633cc",
    "#ff66cc",
    "#cc3300",
    "#ccff33",
    "#009933",
    "#3399cc",
    "#9966ff",
    "#ff0099",
    "#ff6633",
    "#669900",
    "#33cc66",
    "#66ccff",
    "#6600ff",
    "#660033",
    "#993300",
    "#99cc33",
  ];
  const chartsTopNHead = `
        var ctxTopN = document.getElementById("chartsTopN");
        var myChartTopN = new Chart(ctxTopN, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
  `;
  let chartsTopNBody = ``;
  for (let i = 1; i <= 20; i++) {
    if (i > 1) {
      chartsTopNBody += ",";
    }
    chartsTopNBody += `
              {
                label: '三連単的中率(Top${i}, jcd=11,12,13,21,24)',
                backgroundColor: '${chartsTopNColors[i]}',
                borderColor: '${chartsTopNColors[i]}',
                data: ${JSON.stringify(hittingRate3tTopN[i])},
                fill: false,
                hidden: true
              }
    `;
  }
  const chartsTopNTail = `
            ]
          },
          options: {
            scales: {
              y: {
                min: 0,
                max: 100
              }
            }
          }
        });
  `;
  const chartsTopN = chartsTopNHead + chartsTopNBody + chartsTopNTail;

  const chartsPercentColors = [
    "",
    "#ff3300",
    "#99cc00",
    "#33ff66",
    "#006699",
    "#6633cc",
    "#ff66cc",
    "#cc3300",
    "#ccff33",
    "#009933",
    "#3399cc",
    "#9966ff",
    "#ff0099",
    "#ff6633",
    "#669900",
    "#33cc66",
    "#66ccff",
    "#6600ff",
    "#660033",
    "#993300",
    "#99cc33",
  ];
  const chartsPercentHead = `
        var ctxPercent = document.getElementById("chartsPercent");
        var myChartPercent = new Chart(ctxPercent, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
  `;
  let chartsPercentBody = ``;
  for (let i = 1; i <= percentArraySize; i++) {
    if (i > 1) {
      chartsPercentBody += ",";
    }
    chartsPercentBody += `
              {
                label: '三連単的中率(percent>=${
                  percentArray[i]
                }, jcd=11,12,13,21,24, wave=0-10)',
                backgroundColor: '${chartsPercentColors[i]}',
                borderColor: '${chartsPercentColors[i]}',
                data: ${JSON.stringify(hittingRate3tPercent[i])},
                fill: false,
                hidden: true
              }
    `;
  }
  chartsPercentBody += `
              , {
                label: '三連単的中率(jcd=11,12,13,21,24, wave=0-10)',
                backgroundColor: 'blue',
                borderColor: 'blue',
                data: ${JSON.stringify(hittingRate3tJcdComposite)},
                fill: false
              }
    `;
  const chartsPercentTail = `
            ]
          },
          options: {
            scales: {
              y: {
                min: 0,
                max: 100
              }
            }
          }
        });
  `;
  const chartsPercent =
    chartsPercentHead + chartsPercentBody + chartsPercentTail;

  // ========== 三連単 場所別 的中率 ========== START
  const charts4TableStart = `
  <table>
  `;
  let charts4TableHead = `
    <tr>
      <th>jcd<br>jname</th>
  `;
  for (let jcd = 1; jcd <= 24; jcd++) {
    charts4TableHead += `<th>${jcd}<br>${jnames[jcd]}</th>`;
  }
  charts4TableHead += `
    </tr>
  `;

  let charts4TableRow = "";
  for (let i = 0; i < percentFromToArray.length; i++) {
    if (i % 10 === 0) {
      charts4TableRow += charts4TableHead;
    }

    charts4TableRow += `
    <tr>
      <th rowspan="2">確率 ${percentFromToArray[i].toFixed(
        3
      )}以上<br>的中率が 0 の数<br>0 の割合(%)</th>
  `;
    for (let jcd = 1; jcd <= 24; jcd++) {
      const zeroCount = hittingRate3tJcd[i][jcd].filter(
        (value) => value === 0
      ).length;
      charts4TableRow += `<td class="zero-count">${zeroCount}</td>`;
    }
    charts4TableRow += `
    </tr>
    <tr>
  `;
    for (let jcd = 1; jcd <= 24; jcd++) {
      const zeroCount = hittingRate3tJcd[i][jcd].filter(
        (value) => value === 0
      ).length;
      const allCount = hittingRate3tJcd[i][jcd].filter(
        (value) => value !== null && value >= 0
      ).length;
      const zeroPercent = Math.round((zeroCount / allCount) * 100);
      let zeroPercentClass = "zero-percent";
      if (zeroPercent <= 55) {
        zeroPercentClass += "-pickup";
      }
      charts4TableRow += `<td class="${zeroPercentClass}">${zeroPercent}%</td>`;
    }
    charts4TableRow += `
    </tr>
  `;
  }
  const charts4TableEnd = `
  </table>
  `;
  const charts4Table = charts4TableStart + charts4TableRow + charts4TableEnd;
  // ========== 三連単 場所別 的中率 ========== END

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
                label: '差額',
                backgroundColor: 'blue',
                borderColor: 'blue',
                data: ${JSON.stringify(differenceAll)},
                fill: false
              },
              {
                label: '資金',
                backgroundColor: 'lightgreen',
                borderColor: 'lightgreen',
                data: ${JSON.stringify(capital)},
                fill: true
              }
            ]
          }
        });

        var ctx2 = document.getElementById("charts2");
        var myChart2 = new Chart(ctx2, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
              {
                label: '三連単的中率',
                backgroundColor: 'red',
                borderColor: 'red',
                data: ${JSON.stringify(hittingRate3tArray)},
                fill: false
              },
              {
                label: '三連複的中率',
                backgroundColor: 'green',
                borderColor: 'green',
                data: ${JSON.stringify(hittingRate3fArray)},
                fill: false
              },
              {
                label: '二連単的中率',
                backgroundColor: 'blue',
                borderColor: 'blue',
                data: ${JSON.stringify(hittingRate2tArray)},
                fill: false
              },
              {
                label: '二連複的中率',
                backgroundColor: 'orange',
                borderColor: 'orange',
                data: ${JSON.stringify(hittingRate2fArray)},
                fill: false
              }
            ]
          },
          options: {
            scales: {
              y: {
                min : 0,
                max : 100
              }
            }
          }
        });

        var ctx3 = document.getElementById("charts3");
        var myChart3 = new Chart(ctx3, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
              {
                label: '三連単的中率',
                backgroundColor: 'green',
                borderColor: 'green',
                data: ${JSON.stringify(hittingRate3tArray)},
                fill: false
              },
              {
                label: '三連単 波0-10 的中率',
                backgroundColor: 'mediumseagreen',
                borderColor: 'mediumseagreen',
                data: ${JSON.stringify(hittingRate3tWave1Array)},
                fill: false
              },
              {
                label: '三連単 波11- 的中率',
                backgroundColor: 'aquamarine',
                borderColor: 'aquamarine',
                data: ${JSON.stringify(hittingRate3tWave2Array)},
                fill: false
              }
            ]
          },
          options: {
            scales: {
              y: {
                min: 0,
                max: 100
              }
            }
          }
        });
        
        ${chartsTopN}

        ${chartsPercent}

      </script>
    </body>
  </html>
  `;

  const html =
    htmlStart + charts4Table + htmlSummaryTable + htmlParameterTable + htmlEnd;

  fs.mkdirpSync(DIR);
  const fileName = makeSummaryFileName(isSim);
  fs.writeFileSync(fileName, html);
}
