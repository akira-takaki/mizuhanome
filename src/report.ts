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

const DIR = "./report";
const PREFIX = `${DIR}/betDayResult`;
const SUFFIX = `html`;
const DATE_FORMAT = "YYYYMMDD";

/**
 * ファイル名を作って返す
 *
 * @param date 日付
 */
function makeFileName(date: dayjs.Dayjs): string {
  const dateStr = date.format(DATE_FORMAT);
  return `${PREFIX}_${dateStr}.${SUFFIX}`;
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
  const tableHeader = `
    <table class="parameter">
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

  let tableRow = "";
  tableRow =
    tableRow + createParameterHtmlRow("3t仮定", betDayResult.assumed3t);
  tableRow = tableRow + createParameterHtmlRow("3t", betDayResult.actual3t);
  tableRow = tableRow + createParameterHtmlRow("3f", betDayResult.actual3f);
  tableRow = tableRow + createParameterHtmlRow("2t", betDayResult.actual2t);
  tableRow = tableRow + createParameterHtmlRow("2f", betDayResult.actual2f);

  const tableFooter = `
    </table>
    `;

  return tableHeader + tableRow + tableFooter;
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

/**
 * 賭け結果 レポート作成
 *
 * @param date
 */
export async function report(date: dayjs.Dayjs): Promise<void> {
  let betDayResult: BetDayResult;
  try {
    betDayResult = readBetDayResult(date);
  } catch (err) {
    logger.error(err);
    return;
  }

  const htmlStart = `
  <!DOCTYPE html>
  <html lang="ja">
    <head>
      <title>レポート ${betDayResult.date}</title>
      <link rel="stylesheet" href="report.css">
    </head>
    <body>
  `;

  const htmlHeader = `
  <header>
  日付 : ${betDayResult.date}<br>
  資金 : ${currencyFormatter.format(betDayResult.capital)}<br>
  レース数 : ${betDayResult.raceCount}<br>
  回収率 : ${
    betDayResult.collectRateAll !== null
      ? percentFormatter.format(betDayResult.collectRateAll)
      : ""
  }<br>
  購入金額 : ${
    betDayResult.amountPurchasedAll !== null
      ? currencyFormatter.format(betDayResult.amountPurchasedAll)
      : ""
  }<br>
  回収金額 : ${
    betDayResult.collectAll !== null
      ? currencyFormatter.format(betDayResult.collectAll)
      : ""
  }<br>
  差額 : ${
    betDayResult.differenceAll !== null
      ? currencyFormatter.format(betDayResult.differenceAll)
      : ""
  }<br>
  </header>`;

  // パラメータ HTML
  const htmlParameters = createParameterHtml(betDayResult);

  let htmlTable = "";

  for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
    const betRaceResult = betDayResult.betRaceResults[i];

    // レースの賭け結果 HTML
    htmlTable = htmlTable + createBetRaceResult(betRaceResult);
  }

  const htmlEnd = `
    </body>
  </html>
  `;

  const html = htmlStart + htmlHeader + htmlParameters + htmlTable + htmlEnd;

  fs.mkdirpSync(DIR);
  const fileName = makeFileName(date);
  fs.writeFileSync(fileName, html);
}
