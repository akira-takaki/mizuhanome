import log4js from "log4js";
import cron from "node-cron";
import fs from "fs-extra";
import dayjs from "dayjs";
import * as util from "util";

import {
  authenticate,
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
import {
  addBetRaceResult,
  BetDayResult,
  hasNotDecision,
  initBetDayResult,
  makeBetDayResult,
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";
import {
  filteredTypePercent,
  pickupOdds,
  pickupPercent,
  roundBet,
  sleep,
} from "#/myUtil";
import { calc2tBet, updateStore2t } from "#/store2t";

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

  /** 二連単の賭け金のデフォルト額 */
  default2tBet: number;
}

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

/**
 * 購入する三連単の舟券を追加する
 *
 * @param betDayResult 日単位の賭け結果
 * @param odds オッズ
 * @param predictsTop6 直前予想トップ6
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket3t(
  betDayResult: BetDayResult,
  odds: Odds,
  predictsTop6: PredictsTop6,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const type = "3t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  logger.debug(
    "直前予想 三連単 トップ6 : " + util.inspect(predictsTop6.top6[type])
  );

  // 舟券の種類ごとの確率を取り出す
  // 三連単の確率降順
  const percents = filteredTypePercent(type, predictsAll);
  logger.debug(
    "直前予想 三連単 確率トップ10 : " + util.inspect(percents.slice(0, 10))
  );

  for (let i = 0; i < predictsTop6.top6[type].length; i++) {
    const numberset = predictsTop6.top6[type][i];

    const percent = pickupPercent(numberset, percents);
    const numbersetOdds = pickupOdds(type, numberset, odds);

    if (i === 0 && numbersetOdds < 5) {
      // トップ1 が オッズ 5未満ならば 三連単 を賭けない
      break;
    }

    if (percent < 0.1) {
      // 確率が 0.1未満ならば この組番 を賭けない
      continue;
    }

    if (betDayResult.assumed3t.raceDividend !== null) {
      // 賭け金
      //  = 回収率を維持するための1レースの配当金 ÷ オッズ X (1 + 確率)
      // ※レース前のオッズ が レース後に下がってしまうので -1 の補正をする。
      let numbersetOdds2 = numbersetOdds - 1;
      if (numbersetOdds2 < 1) {
        numbersetOdds2 = 1;
      }
      const bet = roundBet(
        (betDayResult.assumed3t.raceDividend / numbersetOdds2) * (1 + percent)
      );

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
 * 購入する二連単の舟券を追加する
 *
 * @param dataid データID
 * @param jcd 場所番号
 * @param default2tBet デフォルトの二連単の賭け金
 * @param odds オッズ
 * @param predictsTop6 直前予想トップ6
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
async function addTicket2t(
  dataid: number,
  jcd: number,
  default2tBet: number,
  odds: Odds,
  predictsTop6: PredictsTop6,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): Promise<void> {
  const type = "2t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  logger.debug(
    "直前予想 二連単 トップ6 : " + util.inspect(predictsTop6.top6[type])
  );

  // 舟券の種類ごとの確率を取り出す
  // 二連単の確率降順
  const percents = filteredTypePercent(type, predictsAll);

  const numberset = predictsTop6.top6[type][0];
  const numbersetOdds = pickupOdds(type, numberset, odds);
  const percent = pickupPercent(numberset, percents);
  logger.debug(
    `直前予想 二連単 トップ1 オッズ : numberset: ${numberset}, odds: ${numbersetOdds}, percent: ${percent}`
  );

  // if (numbersetOdds >= 3.6 && numbersetOdds < 20 && percent >= 0.2) {
  //   // 二連単の舟券追加
  //   const bet = await calc2tBet(dataid, jcd, numberset, default2tBet);
  //   ticket.numbers.push({
  //     numberset: numberset,
  //     bet: bet,
  //   });
  // }

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
  let store2tIntervalId: NodeJS.Timeout | null = null;
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

    store2tIntervalId = setInterval(() => {
      // 二連単で賭けた履歴 の結果を更新する
      updateStore2t(session);
    }, 9000);

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

      // 直前予想トップ6取得
      const predictsTop6 = await getPredictsTop6(session, raceCard.dataid);
      if (predictsTop6 === undefined) {
        continue;
      }
      logger.debug("player_powers=" + util.inspect(predictsTop6.player_powers));

      // 直前予想全確率取得
      const predictsAll = await getPredictsAll(session, raceCard.dataid);
      if (predictsAll === undefined) {
        continue;
      }

      const tickets: Ticket[] = [];

      // 購入する三連単の舟券を追加する
      addTicket3t(betDayResult, odds, predictsTop6, predictsAll, tickets);

      // 購入する二連単の舟券を追加する
      await addTicket2t(
        raceCard.dataid,
        raceCard.jcd,
        config.default2tBet,
        odds,
        predictsTop6,
        predictsAll,
        tickets
      );

      if (tickets.length > 0) {
        logger.debug(`tickets=${util.inspect(tickets, { depth: null })}`);

        // 日単位の賭け結果 に レースの賭け結果 を追加する
        await addBetRaceResult(
          today,
          raceCard.dataid,
          odds,
          predictsAll,
          tickets
        );

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

    if (store2tIntervalId !== null) {
      clearInterval(store2tIntervalId);
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
