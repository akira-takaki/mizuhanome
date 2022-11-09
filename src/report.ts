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
import { sendmail } from "#/sendmail";

interface JcdAndPercentAndName {
  jcd: number;
  percent: number;
  jcdName: string;
}

interface JcdAndPercentAndNameArray {
  label: string;

  jcdAndPercentAndNameArray: JcdAndPercentAndName[];

  // 舟券を購入するレース場の数 (この数までのレース場を対象とする)
  selectCount: number;
}

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

/* 賭けた回数 */
export let totalBetCount = 0;

/* 当たった回数 */
export let totalHitCount = 0;

/* はずれた回数 */
export let totalMissCount = 0;

/* 賭け金の最小値 */
export let betMin = 10000000;

/* 賭け金の最大値 */
export let betMax = 0;

/* 連続で当たったカウント */
export let continuingHitCount = 0;

/* 連続で当たったカウントの最大値 */
export let continuingHitCountMax = 0;

export const continuingHitCountMaxDistributionMap: number[] = [];
for (let i = 0; i < 50; i++) {
  continuingHitCountMaxDistributionMap[i] = 0;
}

/* 連続ではずれたカウント */
export let continuingMissCount = 0;

/* 連続ではずれたカウントの最大値 */
export let continuingMissCountMax = 0;

export const continuingMissCountMaxDistributionMap: number[] = [];
for (let i = 0; i < 50; i++) {
  continuingMissCountMaxDistributionMap[i] = 0;
}

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

    totalHitCount++;

    // 連続で当たったカウント 更新
    if (continuingMissCount === 0) {
      continuingHitCount++;
    }

    // 連続ではずれたカウントの最大値 記録
    continuingMissCountMax = Math.max(
      continuingMissCount,
      continuingMissCountMax
    );

    // 連続ではずれたカウント 記録、リセット
    continuingMissCountMaxDistributionMap[continuingMissCount] += 1;
    continuingMissCount = 0;
  } else if (isResult) {
    classSuffix = "result";
    statusStr = "結";
  } else {
    classSuffix = "miss";
    statusStr = "";

    totalMissCount++;

    // 連続で当たったカウントの最大値 記録
    continuingHitCountMax = Math.max(continuingHitCount, continuingHitCountMax);

    // 連続で当たったカウント 記録、リセット
    continuingHitCountMaxDistributionMap[continuingHitCount] += 1;
    continuingHitCount = 0;

    // 連続ではずれたカウント 更新
    continuingMissCount++;
  }
  const trStart = `
    <tr class="bet-${classSuffix}">
  `;

  if (betResult.bet > 0) {
    totalBetCount++;
    betMin = Math.min(betMin, betResult.bet);
    betMax = Math.max(betMax, betResult.bet);
  }

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
      <td class="bet">${betResult.bet > 0 ? "★" : ""}${currencyFormatter.format(
      betResult.bet
    )}</td>
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
    await sendmail("report() : エラー");
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
 * @param jcdAndPercentAndNameArray 「場所番号 と 確率の閾値」の配列 その日のレースで指定された場所番号が含まれているときに計算する
 * @return 的中率
 */
export function calcHittingRate(
  betDayResult: BetDayResult,
  type: TicketType,
  waveFrom?: number,
  waveTo?: number,
  jcdArray?: number[],
  top = 1,
  percent?: number,
  jcdAndPercentAndNameArray?: JcdAndPercentAndNameArray
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

  // その日のレースで指定された場所番号が含まれているときに計算する
  if (jcdAndPercentAndNameArray !== undefined) {
    // その日のレース場番号を抜き出す
    const todayJcdArray: number[] = Array.from(
      new Set(
        filteredBetRaceResults.map((value) =>
          parseInt(value.raceCardBody.jcd.toString())
        )
      )
    );

    // 必要な 場所番号 を抜き出す
    const requiredJcdArray: number[] =
      jcdAndPercentAndNameArray.jcdAndPercentAndNameArray.map(
        (value) => value.jcd
      );

    const selectedJcdArray: number[] = [];
    for (let i = 0; i < requiredJcdArray.length; i++) {
      for (let j = 0; j < todayJcdArray.length; j++) {
        if (requiredJcdArray[i] === todayJcdArray[j]) {
          // 今日レースをやるレース場コードの場合、
          // 選抜レース場コード配列 に追加
          selectedJcdArray.push(requiredJcdArray[i]);
          break;
        }
      }
      if (selectedJcdArray.length >= jcdAndPercentAndNameArray.selectCount) {
        // 選抜レース場コード配列 が指定数になったら、そこまで。
        break;
      }
    }

    // 「レースの賭け結果」を「必要な 場所番号」で絞り込む
    filteredBetRaceResults = filteredBetRaceResults.filter((value) =>
      selectedJcdArray.includes(parseInt(value.raceCardBody.jcd.toString()))
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

    if (jcdAndPercentAndNameArray !== undefined) {
      // 指定された 場所番号 で 確率以上 のものに絞り込む
      const jcdAndPercent: { jcd: number; percent: number } | undefined =
        jcdAndPercentAndNameArray.jcdAndPercentAndNameArray.find(
          (value) =>
            value.jcd === parseInt(betRaceResult.raceCardBody.jcd.toString())
        );
      if (jcdAndPercent !== undefined) {
        sortedBetResults = sortedBetResults.filter(
          (value) => value.percent >= jcdAndPercent.percent
        );
      }
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
      await sendmail("reportSummary() : エラー");
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

  // ========== 三連単 場所別 的中率 ========== START {
  const percentFromToArray: number[] = []; // 確率の範囲 配列
  const fromPercent = 0.001; // 確率の初期値
  for (let i = 118; i < 145; i++) {
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
  // } ========== 三連単 場所別 的中率 ========== END

  // ========== 三連単 選抜した場所 指定確率以上 的中率 ========== START {
  const jcdAndPercentAndNameArrayBet: JcdAndPercentAndNameArray = {
    label: "現在",
    jcdAndPercentAndNameArray: [
      {
        jcd: 11,
        percent: 0.135,
        jcdName: "びわこ",
      },
      {
        jcd: 10,
        percent: 0.133,
        jcdName: "三国",
      },
      {
        jcd: 20,
        percent: 0.14,
        jcdName: "若松",
      },
      {
        jcd: 13,
        percent: 0.134,
        jcdName: "尼崎",
      },
      {
        jcd: 23,
        percent: 0.124,
        jcdName: "唐津",
      },
      {
        jcd: 17,
        percent: 0.138,
        jcdName: "宮島",
      },
      {
        jcd: 19,
        percent: 0.141,
        jcdName: "下関",
      },
      {
        jcd: 15,
        percent: 0.121,
        jcdName: "丸亀",
      },
    ],
    selectCount: 3,
  };

  const jcdAndPercentAndNameArrayBet2: JcdAndPercentAndNameArray = {
    label: "的中率の平均値23%以上",
    jcdAndPercentAndNameArray: [
      {
        jcd: 2,
        percent: 0.141,
        jcdName: "戸田",
      },
      {
        jcd: 5,
        percent: 0.139,
        jcdName: "多摩川",
      },
    ],
    selectCount: 2,
  };

  const jcdAndPercentAndNameArrayArray: JcdAndPercentAndNameArray[] = [
    jcdAndPercentAndNameArrayBet,
    jcdAndPercentAndNameArrayBet2,
  ];
  const hittingRate3tPercent: (number | null)[][] = [];
  for (let i = 0; i < jcdAndPercentAndNameArrayArray.length; i++) {
    hittingRate3tPercent[i] = [];
  }
  // } ========== 三連単 選抜した場所 指定確率以上 的中率 ========== END

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

    // ========== 三連単 場所別 的中率 ========== START {
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
    // } ========== 三連単 場所別 的中率 ========== END

    // ========== 三連単 選抜した場所 指定確率以上 的中率 ========== START {
    for (let j = 0; j < jcdAndPercentAndNameArrayArray.length; j++) {
      hittingRate3tPercent[j].push(
        calcHittingRate(
          betDayResult,
          "3t",
          0,
          10,
          undefined,
          1,
          undefined,
          jcdAndPercentAndNameArrayArray[j]
        )
      );
    }
    // } ========== 三連単 選抜した場所 指定確率以上 的中率 ========== END

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

  // ========== 三連複 選抜した場所 指定確率以上 的中率 ========== START {
  const chartsPercentColors = [
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
  for (let i = 0; i < jcdAndPercentAndNameArrayArray.length; i++) {
    if (i > 0) {
      chartsPercentBody += ",";
    }
    const label = jcdAndPercentAndNameArrayArray[i].jcdAndPercentAndNameArray
      .map((value) => value.jcdName)
      .join(",");
    chartsPercentBody += `
              {
                label: '三連単的中率(${
                  jcdAndPercentAndNameArrayArray[i].label
                } ${
      jcdAndPercentAndNameArrayArray[i].selectCount
    } ${label}, wave=0-10)',
                backgroundColor: '${chartsPercentColors[i]}',
                borderColor: '${chartsPercentColors[i]}',
                data: ${JSON.stringify(hittingRate3tPercent[i])},
                fill: false,
                hidden: false
              }
    `;
  }
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
  // } ========== 三連複 選抜した場所 指定確率以上 的中率 ========== END

  // ========== 三連複 場所別 的中率 ========== START {
  const charts4TableStart = `
  <table>
  `;
  let charts4TableHead = `
    <tr>
      <th>確率絞込み↓</th>
      <th>jcd<br>jname →</th>
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

      // 空白行
      charts4TableRow += `
    <tr>
      <td colspan="26" class="space-row"></td>
    </tr>
  `;
    }

    // 「的中率が 0 の数」の行
    charts4TableRow += `
    <tr>
      <th rowspan="3">確率 ${percentFromToArray[i].toFixed(3)}以上</th>
      <th>的中率が 0 の数</th>
  `;
    for (let jcd = 1; jcd <= 24; jcd++) {
      // 的中率が 0 の数
      const zeroCount = hittingRate3tJcd[i][jcd].filter(
        (value) => value === 0
      ).length;

      charts4TableRow += `<td class="zero-count">${zeroCount}</td>`;
    }
    charts4TableRow += `
    </tr>
  `;

    // 「的中率が 0 の割合」の行
    charts4TableRow += `
    <tr>
      <th>的中率が 0 の割合(%)</th>
  `;
    for (let jcd = 1; jcd <= 24; jcd++) {
      // 的中率が 0 の数
      const zeroCount = hittingRate3tJcd[i][jcd].filter(
        (value) => value === 0
      ).length;

      // すべての数
      const allCount = hittingRate3tJcd[i][jcd].filter(
        (value) => value !== null && value >= 0
      ).length;

      // 的中率が 0 の割合
      const zeroPercent = Math.round((zeroCount / allCount) * 100);

      // 背景色の設定
      let zeroPercentClass = "zero-percent";
      if (zeroPercent <= 45) {
        zeroPercentClass += "-pickup2";
      } else if (zeroPercent >= 46 && zeroPercent <= 48) {
        zeroPercentClass += "-pickup";
      }
      charts4TableRow += `<td class="${zeroPercentClass}">${zeroPercent}%</td>`;
    }
    charts4TableRow += `
    </tr>
  `;

    // 「的中率の平均値」の行
    charts4TableRow += `
    <tr>
      <th class="average-hitting-rate-header">的中率の平均値</th>
  `;
    for (let jcd = 1; jcd <= 24; jcd++) {
      // 有効なすべての的中率
      const filteredHittingRate3tJcdArray = hittingRate3tJcd[i][jcd].filter(
        (value) => value !== null && value >= 0
      );

      // 有効なすべての的中率 の合計
      const sumHittingRate3tJcd = filteredHittingRate3tJcdArray.reduce(
        (previousValue, currentValue) => {
          if (previousValue === null) {
            previousValue = 0;
          }
          if (currentValue === null) {
            return previousValue;
          } else {
            return previousValue + currentValue;
          }
        },
        0
      );

      // 的中率の平均値
      if (sumHittingRate3tJcd !== null) {
        const averageHittingRate3tJcd = Math.round(
          sumHittingRate3tJcd / filteredHittingRate3tJcdArray.length
        );

        // 背景色の設定
        let averageHittingRateClass = "average-hitting-rate";
        if (averageHittingRate3tJcd >= 20 && averageHittingRate3tJcd <= 22) {
          averageHittingRateClass += "-pickup";
        } else if (averageHittingRate3tJcd >= 23) {
          averageHittingRateClass += "-pickup2";
        }
        charts4TableRow += `<td class="${averageHittingRateClass}">${averageHittingRate3tJcd}%</td>`;
      } else {
        charts4TableRow += `<td class="average-hitting-rate">-</td>`;
      }
    }
    charts4TableRow += `
    </tr>
  `;

    // 空白行
    charts4TableRow += `
    <tr>
      <td colspan="26" class="space-row"></td>
    </tr>
  `;
  }
  const charts4TableEnd = `
  </table>
  `;
  const charts4Table = charts4TableStart + charts4TableRow + charts4TableEnd;
  // } ========== 三連複 場所別 的中率 ========== END

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
