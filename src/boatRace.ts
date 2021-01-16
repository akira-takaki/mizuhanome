import log4js from "log4js";
import dayjs from "dayjs";
import * as util from "util";

import {
  authenticate,
  destroy,
  getOdds,
  getPredictsAll,
  getRaceCard,
  Odds,
  PredictsAll,
  refresh,
  setupApi,
  Ticket,
} from "#/api";
import {
  addBetRaceResult,
  BetDayResult,
  hasNotDecision,
  initBetDayResult,
  makeBetDayResult,
  storedBetDayResultDates,
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";
import {
  generateNumbersetInfo,
  NumbersetInfo,
  numbersetInfoOrderByPercent,
  roundBet,
  sleep,
  TicketType,
} from "#/myUtil";
import { Config, readConfig, writeConfig } from "#/config";
import { report, reportSummary } from "#/report";

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

/**
 * 購入する三連単の舟券を追加する
 * 確率のトップ4 を賭ける。
 * ただし、期待値が 1.2 を超えるものが 2個以上 のときのみ賭ける。
 *
 * @param betDayResult 日単位の賭け結果
 * @param numbersetInfos 1レースの 3t 組番情報
 * @param ticket 舟券
 */
export function addTicket3t2A(
  betDayResult: BetDayResult,
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  if (
    betDayResult.assumed3t.amountPurchasedRate === null ||
    betDayResult.assumed3t.entryRaceCountRate === null
  ) {
    return;
  }

  // 確率が高いトップN
  numbersetInfos.sort(numbersetInfoOrderByPercent).reverse();
  const topN = 4;
  const topNumbersetInfos = numbersetInfos.slice(0, topN);

  // 確率が高いトップN の中で 期待値が thresholdExpectedValue 以上のものの数
  const thresholdExpectedValue = 1.2;
  const countOfOverExpectedValue = topNumbersetInfos.filter(
    (value) => value.expectedValue >= thresholdExpectedValue
  ).length;

  // 期待値が thresholdExpectedValue 以上のものが 2個未満 のときは
  // このレースを賭けない
  if (countOfOverExpectedValue < 2) {
    return;
  }

  for (let i = 0; i < topNumbersetInfos.length; i++) {
    const numbersetInfo = topNumbersetInfos[i];

    // 賭け金
    // 三連単の賭け金を計算
    const bet = roundBet(
      ((betDayResult.capital * betDayResult.assumed3t.amountPurchasedRate) /
        (betDayResult.raceCount * betDayResult.assumed3t.entryRaceCountRate) /
        topNumbersetInfos.length) *
        numbersetInfo.expectedValue
    );

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する三連単の舟券を追加する
 * 期待値が 1.4以上 かつ 2.0以下 のものを賭ける。
 *
 * @param betDayResult 日単位の賭け結果
 * @param numbersetInfos 1レースの 3t 組番情報
 * @param ticket 舟券
 */
export function addTicket3t2B(
  betDayResult: BetDayResult,
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  if (
    betDayResult.assumed3t.amountPurchasedRate === null ||
    betDayResult.assumed3t.entryRaceCountRate === null
  ) {
    return;
  }

  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= 1.4 && value.expectedValue <= 2.0
  );

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = filteredNumbersetInfos[i];

    // 賭け金
    // 三連単の賭け金を計算
    const bet = roundBet(
      ((betDayResult.capital * betDayResult.assumed3t.amountPurchasedRate) /
        (betDayResult.raceCount * betDayResult.assumed3t.entryRaceCountRate) /
        filteredNumbersetInfos.length) *
        numbersetInfo.expectedValue
    );

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する三連単の舟券を追加する
 *
 * @param betDayResult 日単位の賭け結果
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket3t(
  betDayResult: BetDayResult,
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const type: TicketType = "3t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する三連単の舟券を追加する
  addTicket3t2B(betDayResult, numbersetInfos, ticket);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する三連複の舟券を追加する
 *
 * @param numbersetInfos 1レースの 3f 組番情報
 * @param ticket 舟券
 */
export function addTicket3f2(
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  // 期待値が thresholdExpectedValue 以上のものに絞り込む
  const thresholdExpectedValue = 1.2;
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= thresholdExpectedValue
  );

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    filteredNumbersetInfos.length === 0
      ? 0
      : 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = filteredNumbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * numbersetInfo.expectedValue);

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する三連複の舟券を追加する
 *
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket3f(
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const type: TicketType = "3f";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する三連複の舟券を追加する
  addTicket3f2(numbersetInfos, ticket);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する二連単の舟券を追加する
 * 確率のトップ4 を賭ける。
 * ただし、期待値が 1.2 を超えるものが 2個以上 のときのみ賭ける。
 *
 * @param numbersetInfos 1レースの 2t 組番情報
 * @param ticket 舟券
 */
export function addTicket2t2A(
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  // 確率が高いトップN
  numbersetInfos.sort(numbersetInfoOrderByPercent).reverse();
  const topN = 4;
  const topNumbersetInfos = numbersetInfos.slice(0, topN);

  // 確率が高いトップN の中で 期待値が thresholdExpectedValue 以上のものの数
  const thresholdExpectedValue = 1.2;
  const countOfOverExpectedValue = topNumbersetInfos.filter(
    (value) => value.expectedValue >= thresholdExpectedValue
  ).length;

  // 期待値が thresholdExpectedValue 以上のものが 2個未満 のときは
  // このレースを賭けない
  if (countOfOverExpectedValue < 2) {
    return;
  }

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    topNumbersetInfos.length === 0 ? 0 : 1000 / topNumbersetInfos.length;

  for (let i = 0; i < topNumbersetInfos.length; i++) {
    const numbersetInfo = topNumbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * numbersetInfo.expectedValue);

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連単の舟券を追加する
 * 期待値が 1.4以上 かつ 2.0以下 のものを賭ける。
 *
 * @param numbersetInfos 1レースの 2t 組番情報
 * @param ticket 舟券
 */
export function addTicket2t2B(
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= 1.4 && value.expectedValue <= 2.0
  );

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    filteredNumbersetInfos.length === 0
      ? 0
      : 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = filteredNumbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * numbersetInfo.expectedValue);

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連単の舟券を追加する
 *
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket2t(
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const type: TicketType = "2t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する二連単の舟券を追加する
  addTicket2t2B(numbersetInfos, ticket);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する二連複の舟券を追加する
 *
 * @param numbersetInfos 1レースの 2f 組番情報
 * @param ticket 舟券
 */
export function addTicket2f2(
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  // 期待値が thresholdExpectedValue 以上のものに絞り込む
  const thresholdExpectedValue = 1.2;
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= thresholdExpectedValue
  );

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    filteredNumbersetInfos.length === 0
      ? 0
      : 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = filteredNumbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * numbersetInfo.expectedValue);

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連複の舟券を追加する
 *
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket2f(
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const type: TicketType = "2f";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する二連複の舟券を追加する
  addTicket2f2(numbersetInfos, ticket);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * ボートレース
 */
export async function boatRace(): Promise<void> {
  const today = dayjs();

  logger.info("設定ファイルの読み込み");
  let config: Config;
  try {
    config = await readConfig();
  } catch (err) {
    logger.error("設定ファイルの読み込み 失敗");
    logger.debug(err);
    return;
  }

  setupApi(config);

  // 認証
  const session = await authenticate();
  if (session === undefined) {
    logger.error("session is undefined");
    return;
  }

  let sessionIntervalId: NodeJS.Timeout | null = null;
  let betResultIntervalId: NodeJS.Timeout | null = null;
  try {
    sessionIntervalId = setInterval(() => {
      // セッションの更新 50分ごと
      refresh(session);
    }, 50 * 60 * 1000);

    // 出走表 (当月分)
    const raceCardsForMonth = await getRaceCard(session, today);
    if (raceCardsForMonth === undefined) {
      return;
    }

    // 出走表を当日、今の時間より未来のものだけに絞る
    const yyyymmdd = today.format("YYYY-MM-DD");
    const hhmmss = today.format("HH:mm:ss");
    const raceCardsForDay = raceCardsForMonth.filter(
      (value) => value.hd === yyyymmdd
    );
    const filteredRaceCards = raceCardsForDay.filter(
      (value) => value.deadlinegai > hhmmss
    );

    // 出走表を時間で昇順ソートする
    const sortedRaceCards = filteredRaceCards.sort((e1, e2) => {
      const key1: string = e1.hd + " " + e1.deadlinegai;
      const key2: string = e2.hd + " " + e2.deadlinegai;
      if (key1 > key2) {
        return 1;
      } else if (key1 < key2) {
        return -1;
      } else {
        return 0;
      }
    });

    // 日単位の賭け結果 の初期化
    const betDayResult = makeBetDayResult(
      today,
      config,
      raceCardsForDay.length
    );
    await initBetDayResult(today, betDayResult);

    // 設定値確認
    logger.info(util.inspect(betDayResult));

    betResultIntervalId = setInterval(() => {
      // 日単位の賭け結果 の勝敗を更新する
      updateBetRaceResult(today, session);
    }, 10000);

    // 各レースで舟券購入
    for (let i = 0; i < sortedRaceCards.length; i++) {
      const raceCard = sortedRaceCards[i];
      logger.debug(
        `title : ${raceCard.jname}_${raceCard.ktitle}_R${raceCard.rno}`
      );
      logger.debug(
        `dataid=${raceCard.dataid}, jcd=${raceCard.jcd}, hd=${raceCard.hd}, deadlinegai=${raceCard.deadlinegai}`
      );

      // 場外締切時刻の1分前の時間を計算
      const deadLineGaiStr = `${raceCard.hd} ${raceCard.deadlinegai}`;
      const dateFormat = "YYYY-MM-DD HH:mm:ss";
      const deadLineGai = dayjs(deadLineGaiStr, dateFormat);
      const deadLineGaiMinusOneMinute = deadLineGai.add(-1, "minute");

      logger.trace("場外締切時刻の1分前まで待つ");
      let isPass = false;
      let isWait = true;
      while (isWait) {
        const now = dayjs();

        if (deadLineGai.isBefore(now)) {
          // 場外締切時刻を過ぎていたら処理をパス
          isPass = true;
          isWait = false;
          continue;
        } else if (
          deadLineGai.isAfter(now) &&
          deadLineGaiMinusOneMinute.isBefore(now)
        ) {
          // 場外締切時刻よりも1分前ならば待つのをやめる
          isWait = false;
        }

        // 5秒待つ
        await sleep(5000);
      }
      if (isPass) {
        logger.trace("場外締切時刻を過ぎている");
        continue;
      }

      // オッズ取得
      const odds = await getOdds(session, raceCard.dataid);
      if (odds === undefined) {
        continue;
      }

      // 直前予想全確率取得
      const predictsAll = await getPredictsAll(session, raceCard.dataid);
      if (predictsAll === undefined) {
        continue;
      }

      const tickets: Ticket[] = [];

      // 購入する三連単の舟券を追加する
      addTicket3t(betDayResult, odds, predictsAll, tickets);

      // 購入する三連複の舟券を追加する
      addTicket3f(odds, predictsAll, tickets);

      // 購入する二連単の舟券を追加する
      addTicket2t(odds, predictsAll, tickets);

      // 購入する二連複の舟券を追加する
      addTicket2f(odds, predictsAll, tickets);

      // 日単位の賭け結果 に レースの賭け結果 を追加する
      // シミュレーション用に賭けてない組番情報も保存する
      await addBetRaceResult(
        today,
        raceCard.dataid,
        odds,
        predictsAll,
        tickets
      );

      if (tickets.length > 0) {
        logger.debug(`tickets=${util.inspect(tickets, { depth: null })}`);

        // 舟券購入
        // await autoBuy(session, raceCard.dataid, tickets);
      }
    }

    while (await hasNotDecision(today)) {
      // 日単位の賭け結果 でレース結果が決定してないものがあるあいだ待つ
      await sleep(10000);
    }

    // 日単位の賭け結果 の集計
    const tabulatedBetDayResult = await tabulateBetDayResult(today);

    // 次回の資金を設定へ反映
    if (tabulatedBetDayResult.nextCapital !== null) {
      config.capital = tabulatedBetDayResult.nextCapital;
      await writeConfig(config);
    }

    // レポート作成
    await report(today);
    const isSim = false;
    const dateArray = storedBetDayResultDates(isSim);
    await reportSummary(dateArray, isSim);
  } catch (err) {
    logger.error(err);
  } finally {
    if (sessionIntervalId !== null) {
      clearInterval(sessionIntervalId);
    }

    if (betResultIntervalId !== null) {
      clearInterval(betResultIntervalId);
    }

    // セッションの破棄
    await destroy(session);
  }
}
