import log4js from "log4js";
import cron from "node-cron";
import fs from "fs-extra";
import dayjs from "dayjs";
import * as util from "util";

import {
  authenticate,
  autoBuy,
  destroy,
  getOdds,
  getPredictsAll,
  getPredictsTop6,
  getRaceCard,
  Odds,
  PredictsAll,
  PredictsTop6,
  refresh,
  setupApi,
  Ticket,
} from "#/api";
import { sleep } from "#/sleep";
import {
  addBetRaceResult,
  BetDayResult,
  hasNotDecision,
  initBetDayResult,
  makeBetDayResult,
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";

/**
 * 設定
 */
export interface Config {
  baseUrl: string;
  email: string;
  accessKey: string;

  /** 資金 */
  capital: number;

  /** 仮定の「的中率(パーセント)」 */
  assumedHittingRate: number;

  /** 仮定の「回収金額率(パーセント)」 */
  assumedCollectRate: number;

  /** 仮定の「購入する金額率(パーセント)」 */
  assumedAmountPurchasedRate: number;

  /** 仮定の「参加するレース数率(パーセント)」 */
  assumedEntryRaceCountRate: number;
}

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

export const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
});

/**
 * オッズを取り出す
 *
 * @param type 舟券の種類
 * @param numberset 組番
 * @param odds オッズ情報
 * @return オッズ
 */
function pickupOdds(type: string, numberset: string, odds: Odds): number {
  const oddsKey: string = "odds_" + type + numberset;
  return parseFloat(odds[oddsKey]);
}

/**
 * 賭け金を100円単位にする
 *
 * @param bet 賭け金
 * @return 100円単位の賭け金
 */
function roundBet(bet: number): number {
  const r = Math.round(bet / 100) * 100;
  let i = parseInt(r.toString(), 10);
  if (i < 100) {
    i = 100;
  }
  return i;
}

/**
 * 組番と確率
 */
interface Percent {
  numberset: string;
  percent: string;
}

/**
 * 指定された舟券の種類の確率を取り出す
 *
 * @param type 舟券の種類
 * @param predictsAll 直前予想全確率
 * @return 指定された舟券の種類の確率配列
 */
function filteredTypePercent(
  type: string,
  predictsAll: PredictsAll
): Percent[] {
  return Object.keys(predictsAll.predict)
    .filter((key) => key.startsWith(type))
    .map(
      (key): Percent => ({
        numberset: key.substring(2),
        percent: predictsAll.predict[key],
      })
    )
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
}

/**
 * 指定された組番の確率を返す
 *
 * @param numberset 組番
 * @param percents 確率配列
 * @return 確率
 */
function pickupPercent(numberset: string, percents: Percent[]): number {
  for (let i = 0; i < percents.length; i++) {
    const percent = percents[i];

    if (numberset === percent.numberset) {
      return parseFloat(percent.percent);
    }
  }

  return 0;
}

/**
 * 購入する舟券を追加する
 *
 * @param betDayResult 日単位の賭け結果
 * @param odds オッズ
 * @param predictsTop6 直前予想トップ6
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket(
  betDayResult: BetDayResult,
  odds: Odds,
  predictsTop6: PredictsTop6,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const ticket: Ticket = {
    type: "3t",
    numbers: [],
  };

  // 舟券の種類ごとの確率を取り出す
  // 三連単の確率降順
  const percents = filteredTypePercent("3t", predictsAll);
  logger.debug("直前予想三連単全確率 : " + util.inspect(percents));

  for (let i = 0; i < predictsTop6.top6["3t"].length; i++) {
    const numberset = predictsTop6.top6["3t"][i];

    const percent = pickupPercent(numberset, percents);
    if (percent < 0.1) {
      // 確率が 0.1未満ならば賭けない
      continue;
    }

    const numbersetOdds = pickupOdds("3t", numberset, odds);

    if (betDayResult.assumed.raceDividend !== null) {
      // 賭け金
      //  = 回収率を維持するための1レースの配当金 ÷ オッズ
      const bet = roundBet(betDayResult.assumed.raceDividend / numbersetOdds);

      ticket.numbers.push({
        numberset: numberset,
        bet: bet,
      });
    }
  }
  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * ボートレース
 */
async function boatRace(): Promise<void> {
  const today = dayjs();

  logger.info("設定ファイルの読み込み");
  let config: Config;
  try {
    config = JSON.parse(fs.readFileSync("./config/Config.json").toString());
  } catch (err) {
    logger.error("設定ファイルの読み込み 失敗", err);
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
      if (deadLineGai.format(dateFormat) !== deadLineGaiStr) {
        logger.error(
          "日付フォーマットエラー : deadLineGaiStr=" + deadLineGaiStr
        );
        continue;
      }
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

      // 直前予想トップ6取得
      const predictsTop6 = await getPredictsTop6(session, raceCard.dataid);
      if (predictsTop6 === undefined) {
        continue;
      }
      logger.debug("直前予想トップ6 : " + util.inspect(predictsTop6));

      // 直前予想全確率取得
      const predictsAll = await getPredictsAll(session, raceCard.dataid);
      if (predictsAll === undefined) {
        continue;
      }

      const tickets: Ticket[] = [];

      // 購入する舟券を追加する
      addTicket(betDayResult, odds, predictsTop6, predictsAll, tickets);

      if (tickets.length > 0) {
        logger.debug(`tickets=${util.inspect(tickets, { depth: null })}`);

        // 日単位の賭け結果 に レースの賭け結果 を追加する
        await addBetRaceResult(today, raceCard.dataid, tickets);

        // 舟券購入
        // await autoBuy(session, raceCard.dataid, tickets);
      }
    }

    while (await hasNotDecision(today)) {
      // 日単位の賭け結果 でレース結果が決定してないものがあるあいだ待つ
      await sleep(10000);
    }

    // 日単位の賭け結果 の集計
    await tabulateBetDayResult(today);
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

async function main(): Promise<void> {
  logger.info("起動");

  // 毎日 08:30 に実行
  cron.schedule(
    "0 30 8 * * *",
    async () => {
      await boatRace();
    },
    { timezone: "Asia/Tokyo" }
  );

  // 08:30を過ぎて起動されたら処理を始める
  const startDayjs = dayjs().set("hour", 8).set("minute", 30).set("second", 0);
  const nowDayjs = dayjs();
  if (nowDayjs.isAfter(startDayjs)) {
    logger.info("08:30を過ぎたため実行");
    await boatRace();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
