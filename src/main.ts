import log4js from "log4js";
import cron from "node-cron";
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
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";
import { generateNumbersetInfo, roundBet, sleep, TicketType } from "#/myUtil";
import { Config, readConfig, writeConfig } from "#/config";

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

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

  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);
  logger.debug(
    "直前予想 三連単 期待値トップ15 : " +
      util.inspect(numbersetInfos.slice(0, 15), { depth: null })
  );

  // 期待値が 1 以上のものに絞り込む
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= 1
  );

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = numbersetInfos[i];

    if (betDayResult.assumed3t.raceDividend !== null) {
      // 賭け金
      //  = 回収率を維持するための1レースの配当金 ÷ オッズ X (1 + 確率)
      // ※レース前のオッズ が レース後に下がってしまうので -1 の補正をする。
      let numbersetOdds2 = numbersetInfo.odds - 1;
      if (numbersetOdds2 < 1) {
        numbersetOdds2 = 1;
      }
      const bet = roundBet(
        (betDayResult.assumed3t.raceDividend / numbersetOdds2) *
          (1 + numbersetInfo.percent)
      );

      ticket.numbers.push({
        numberset: numbersetInfo.numberset,
        bet: bet,
      });
    }
  }
  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
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

  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);
  logger.debug(
    "直前予想 三連複 期待値トップ15 : " +
      util.inspect(numbersetInfos.slice(0, 15), { depth: null })
  );

  // 期待値が 1 以上のものに絞り込む
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= 1
  );

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    filteredNumbersetInfos.length === 0
      ? 0
      : 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = numbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * (1 + numbersetInfo.percent));

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
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

  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);
  logger.debug(
    "直前予想 二連単 期待値トップ15 : " +
      util.inspect(numbersetInfos.slice(0, 15), { depth: null })
  );

  // 期待値が 1 以上のものに絞り込む
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= 1
  );

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    filteredNumbersetInfos.length === 0
      ? 0
      : 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = numbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * (1 + numbersetInfo.percent));

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
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

  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);
  logger.debug(
    "直前予想 二連複 期待値トップ15 : " +
      util.inspect(numbersetInfos.slice(0, 15), { depth: null })
  );

  // 期待値が 1 以上のものに絞り込む
  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.expectedValue >= 1
  );

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet =
    filteredNumbersetInfos.length === 0
      ? 0
      : 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = numbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet * (1 + numbersetInfo.percent));

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
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
    const tabulatedBetDayResult = await tabulateBetDayResult(today);

    // 次回の資金を設定へ反映
    if (tabulatedBetDayResult.nextCapital !== null) {
      config.capital = tabulatedBetDayResult.nextCapital;
      await writeConfig(config);
    }
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
