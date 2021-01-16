import fs from "fs-extra";
import dayjs from "dayjs";
import {
  BetDayResult,
  BetRaceResult,
  Parameter,
  readBetDayResult,
} from "#/betResult";
import {
  currencyFormatter,
  decimalFormatter,
  percentFormatter,
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

function createParameterHtmlHeader(): string {
  return `
    <tr class="parameter-header">
      <th class="type-header">舟券種類</th>
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

function createParameterHtmlRow(type: string, parameter: Parameter): string {
  return `
      <tr class="parameter">
        <td class="type-${type}">${type}</td>
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

function createParameterHtml(betDayResult: BetDayResult): string {
  const tableHeader = createParameterHtmlHeader();

  let tableRow = "";
  tableRow =
    tableRow + createParameterHtmlRow("3t仮定", betDayResult.assumed3t);
  tableRow = tableRow + createParameterHtmlRow("3t", betDayResult.actual3t);
  tableRow = tableRow + createParameterHtmlRow("3f", betDayResult.actual3f);
  tableRow = tableRow + createParameterHtmlRow("2t", betDayResult.actual2t);
  tableRow = tableRow + createParameterHtmlRow("2f", betDayResult.actual2f);

  return `<table class="parameter">` + tableHeader + tableRow + `</table>`;
}

function createBetRaceResult(betRaceResult: BetRaceResult): string {
  const tableHeader = `
    <table class="race">
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
      </tr>
    `;

  let tableRow = "";
  for (let j = 0; j < betRaceResult.betResults.length; j++) {
    const betResult = betRaceResult.betResults[j];

    if (betResult.bet === 0) {
      // 賭け金が無いものは除外
      continue;
    }

    const isHit =
      betResult.odds !== null && betResult.bet !== betResult.dividend;

    tableRow =
      tableRow +
      `
      <tr class="bet-${isHit ? "hit" : "miss"}">
        <td class="type-${betResult.type}">
          ${betResult.type}
          ${isHit ? "当" : ""}
        </td>
        <td class="numberset">${betResult.numberset}</td>
        <td class="percent">${percentFormatter.format(betResult.percent)}</td>
        <td class="preOdds">${decimalFormatter.format(betResult.preOdds)}</td>
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
      </tr>
      `;
  }

  const tableFooter = `
    </table>
    `;

  return tableHeader + tableRow + tableFooter;
}

function createSummaryTableHtmlHeader(): string {
  return `
    <tr class="summary-header">
      <th class="date-header">日付</th>
      <th class="capital-header">資金</thcl>
      <th class="raceCount-header">レース数</th>
      <th class="collectRateAll-header">回収率</th>
      <th class="amountPurchasedAll-header">購入金額</th>
      <th class="collectAll-header">回収金額</th>
      <th class="differenceAll-header">差額</th>
      <th class="nextCapital-header">次回の資金</th>
    </tr>
  `;
}

function createSummaryTableHtmlRow(betDayResult: BetDayResult): string {
  return `
    <tr class="summary-row">
      <td class="date-row">${betDayResult.date}</td>
      <td class="capital-row">${currencyFormatter.format(
        betDayResult.capital
      )}</td>
      <td class="raceCount-row">${betDayResult.raceCount}</td>
      <td class="collectRateAll-row">${
        betDayResult.collectRateAll !== null
          ? percentFormatter.format(betDayResult.collectRateAll)
          : ""
      }</td>
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
      <td class="differenceAll-row">${
        betDayResult.differenceAll !== null
          ? currencyFormatter.format(betDayResult.differenceAll)
          : ""
      }</td>
      <td class="nextCapital-row">${
        betDayResult.nextCapital !== null
          ? currencyFormatter.format(betDayResult.nextCapital)
          : ""
      }</td>
    </tr>
  `;
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
  const htmlParameters = createParameterHtml(betDayResult);

  // レースの賭け結果 HTML
  let htmlTable = "";
  for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
    const betRaceResult = betDayResult.betRaceResults[i];

    htmlTable = htmlTable + createBetRaceResult(betRaceResult);
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

  const htmlStart = `
  <!DOCTYPE html>
  <html lang="ja">
    <head>
      <title>まとめレポート${isSimStr}</title>
      <link rel="stylesheet" href="report.css">
    </head>
    <body>
    ${isSimStr}<br>
  `;

  let htmlTable = `
    <table class="summary">
  `;
  htmlTable = htmlTable + createSummaryTableHtmlHeader();
  for (let i = 0; i < dateArray.length; i++) {
    const date = dateArray[i];

    let betDayResult: BetDayResult;
    try {
      betDayResult = readBetDayResult(date, isSim);
    } catch (err) {
      logger.error(err);
      return;
    }

    htmlTable = htmlTable + createSummaryTableHtmlRow(betDayResult);
  }
  htmlTable =
    htmlTable +
    `
    </table>
  `;

  const htmlEnd = `
    </body>
  </html>
  `;

  const html = htmlStart + htmlTable + htmlEnd;

  fs.mkdirpSync(DIR);
  const fileName = makeSummaryFileName(isSim);
  fs.writeFileSync(fileName, html);
}
