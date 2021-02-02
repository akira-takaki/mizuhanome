import log4js from "log4js";
import dayjs from "dayjs";
import * as util from "util";

import {
  authenticate,
  autoBuy,
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
  hasNotDecision,
  initBetDayResult,
  makeBetDayResult,
  storedBetDayResultDates,
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";
import {
  generateNumbersetInfo,
  isRough,
  NumbersetInfo,
  numbersetInfoOrderByPercent,
  playerPowers,
  Power,
  roundBet,
  sleep,
  TicketType,
} from "#/myUtil";
import { Config, readConfig, writeConfig } from "#/config";
import { report, reportSummary } from "#/report";
import { calcCocomoBet } from "#/cocomo";

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

/**
 * 購入する三連単の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 3t 組番情報
 * @param ticket 舟券
 */
export function addTicket3t2(
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  for (let i = 0; i < powers.length; i++) {
    if (powers[i].numberStr === "1" && powers[i].power >= 70) {
      // 1号艇がパワー70以上ならばこのレースに賭けない
      return;
    }
  }

  // 期待値が thresholdExpectedValue 以上のものに絞り込む
  const thresholdExpectedValue = 1.4;
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= thresholdExpectedValue
  );
  if (filteredNumbersetInfos.length <= 0) {
    return;
  }

  const defaultBet = 100;

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
 * 購入する三連単の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket3t(
  powers: Power[],
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
  addTicket3t2(powers, numbersetInfos, ticket);
  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する三連複の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 3f 組番情報
 * @param ticket 舟券
 */
export function addTicket3f2(
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  for (let i = 0; i < powers.length; i++) {
    if (powers[i].numberStr === "1" && powers[i].power >= 70) {
      // 1号艇がパワー70以上ならばこのレースに賭けない
      return;
    }
  }

  // 期待値が thresholdExpectedValue 以上のものに絞り込む
  const thresholdExpectedValue = 1.5;
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= thresholdExpectedValue
  );
  if (filteredNumbersetInfos.length <= 0) {
    return;
  }

  const defaultBet = 100;

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
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket3f(
  powers: Power[],
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
  addTicket3f2(powers, numbersetInfos, ticket);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する二連単の舟券を追加する
 *
 * @param dataid データID
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 2t 組番情報
 * @param ticket 舟券
 * @param isSim
 */
export async function addTicket2t2(
  dataid: number,
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  const sortedNumbersetInfos = numbersetInfos
    .sort(numbersetInfoOrderByPercent)
    .reverse();

  const numbersetInfo = sortedNumbersetInfos[0];

  if (numbersetInfo.odds === null || numbersetInfo.odds < 2.9) {
    return;
  }

  if (numbersetInfo.percent < 0.15) {
    return;
  }

  const topNumberStr = numbersetInfo.numberset.substring(0, 1);
  for (let i = 0; i < powers.length; i++) {
    if (powers[i].numberStr === topNumberStr && powers[i].power < 70) {
      return;
    }
  }

  // 賭け金
  const defaultBet = 100;
  const bet = await calcCocomoBet(
    dataid,
    numbersetInfo.numberset,
    defaultBet,
    isSim
  );
  if (bet !== null) {
    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連単の舟券を追加する
 *
 * @param dataid データID
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 * @param isSim
 */
function addTicket2t(
  dataid: number,
  powers: Power[],
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[],
  isSim = false
): void {
  const type: TicketType = "2t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する二連単の舟券を追加する
  addTicket2t2(dataid, powers, numbersetInfos, ticket, isSim);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する二連複の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 2f 組番情報
 * @param ticket 舟券
 */
export function addTicket2f2(
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  const rough = isRough(powers);

  // 期待値が thresholdExpectedValue 以上のものに絞り込む
  const thresholdExpectedValue = 1.2;
  let filteredNumbersetInfos: NumbersetInfo[];
  if (rough.isRough && rough.numberStr !== null && rough.numberStr !== "1") {
    filteredNumbersetInfos = numbersetInfos.filter(
      (value) =>
        value.expectedValue >= thresholdExpectedValue &&
        value.numberset.includes(
          rough.numberStr === null ? "X" : rough.numberStr
        )
    );
  } else {
    filteredNumbersetInfos = numbersetInfos.filter(
      (value) =>
        value.expectedValue >= thresholdExpectedValue && value.percent > 0.2
    );
  }
  if (filteredNumbersetInfos.length <= 0) {
    return;
  }

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet = 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = filteredNumbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet);

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連複の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket2f(
  powers: Power[],
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
  addTicket2f2(powers, numbersetInfos, ticket);

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

      // プレイヤーのパワー配列
      const powers: Power[] = playerPowers(predictsAll);

      const tickets: Ticket[] = [];

      // 購入する三連単の舟券を追加する
      addTicket3t(powers, odds, predictsAll, tickets);

      // 購入する三連複の舟券を追加する
      // addTicket3f(powers, odds, predictsAll, tickets);

      // 購入する二連単の舟券を追加する
      // await addTicket2t(raceCard.dataid, powers, odds, predictsAll, tickets);

      // 購入する二連複の舟券を追加する
      // addTicket2f(powers, odds, predictsAll, tickets);

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
        await autoBuy(session, raceCard.dataid, tickets);
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
