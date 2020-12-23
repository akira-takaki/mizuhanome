import log4js from "log4js";
import cron from "node-cron";
import fs from "fs-extra";
import dayjs from "dayjs";
import * as util from "util";

import { calc2tBet, updateStore2t } from "#/store2t";
import {
  authenticate,
  autoBuy,
  destroy,
  getOdds,
  getPredicts,
  getRaceCard,
  Odds,
  refresh,
  setupApi,
  Ticket,
  TicketNumber,
} from "#/api";
import { sleep } from "#/sleep";

/**
 * 設定
 */
export interface Config {
  baseUrl: string;
  email: string;
  accessKey: string;
  capital: number;
  rate: number;
  thresholdRank: number;
  thresholdExpectedValue: number;
  thresholdOdds2t: number;
  default2tBet: number;
}

/**
 * 期待値
 */
interface ExpectedValue {
  type: string;
  numberset: string;
  expectedValue: number;
  power: number;
  odds: number;
  rank: number;
}

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

export const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
});

/**
 * オッズを取り出す
 */
function pickupOdds(type: string, numberset: string, odds: Odds): number {
  const oddsKey: string = "odds_" + type + numberset;
  return parseFloat(odds[oddsKey]);
}

/**
 * 期待値を計算する
 */
function calcExpectedValue(
  playerPowers: number[],
  type: string,
  top6: string[],
  odds: Odds
): ExpectedValue[] {
  const expectedValues: ExpectedValue[] = [];

  for (let i = 0; i < top6.length; i++) {
    const numberset = top6[i];

    // numberset の「予想の強さ」を集計する
    let power = 0;
    for (let j = 0; j < numberset.length; j++) {
      const index = parseInt(numberset.substring(j, j + 1), 10) - 1;
      power = power + playerPowers[index];
    }

    // numberset のオッズを取り出す
    const numbersetOdds = pickupOdds(type, numberset, odds);

    // 期待値を計算する
    expectedValues.push({
      type: type,
      numberset: numberset,
      expectedValue: (power / 300) * numbersetOdds,
      power: power,
      odds: numbersetOdds,
      rank: i + 1,
    });
  }

  return expectedValues;
}

/**
 * 賭け金を100円単位にする
 */
function round(bet: number): number {
  const r = Math.round(bet / 100) * 100;
  let i = parseInt(r.toString(), 10);
  if (i < 100) {
    i = 100;
  }
  return i;
}

/**
 * 券を作る
 */
function makeTicket(
  totalBet: number,
  expectedValues: ExpectedValue[]
): Ticket[] {
  if (expectedValues.length <= 0) {
    return [];
  }

  const bet = totalBet / expectedValues.length;

  // 券種でソートする
  const sortedExpectedValues = expectedValues.sort((e1, e2) => {
    if (e1.type > e2.type) {
      return 1;
    } else if (e1.type < e2.type) {
      return -1;
    } else {
      return 0;
    }
  });

  let prevType = "";
  let group: ExpectedValue[] = [];
  const tickets: Ticket[] = [];
  for (let i = 0; i < sortedExpectedValues.length; i++) {
    const expectedValue = sortedExpectedValues[i];

    if (i === 0) {
      prevType = expectedValue.type;
    }

    if (prevType !== expectedValue.type) {
      // ブレイク処理
      const ticketNumbers: TicketNumber[] = [];
      for (let j = 0; j < group.length; j++) {
        ticketNumbers.push({
          numberset: group[j].numberset,
          bet: round(bet * (1 + (6 - group[j].rank) / 10)),
        });
      }
      tickets.push({
        type: prevType,
        numbers: ticketNumbers,
      });

      // 初期化
      group = [];
    }

    group.push(expectedValue);
    prevType = expectedValue.type;
  }
  if (group.length > 0) {
    // ブレイク処理
    const ticketNumbers: TicketNumber[] = [];
    for (let j = 0; j < group.length; j++) {
      ticketNumbers.push({
        numberset: group[j].numberset,
        bet: round(bet * (1 + (6 - group[j].rank) / 10)),
      });
    }
    tickets.push({
      type: prevType,
      numbers: ticketNumbers,
    });
  }

  return tickets;
}

/**
 * ボートレース
 */
async function boatRace(): Promise<void> {
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
  const sessionInfo = await authenticate();
  if (sessionInfo === undefined) {
    return;
  }
  if (sessionInfo.session === undefined) {
    logger.error("session is undefined");
    return;
  }
  const session = sessionInfo.session;
  if (sessionInfo.expiredAt === undefined) {
    logger.error("expiredAt is undefined");
    return;
  }
  let sessionExpiredDayjs = dayjs.unix(sessionInfo.expiredAt / 1000);
  let sessionExpiredMinusOneMinute = sessionExpiredDayjs.add(-1, "minute");

  let intervalId: NodeJS.Timeout | null = null;
  try {
    intervalId = setInterval(() => {
      // 定期的に「二連単で賭けた履歴」の結果を更新する
      updateStore2t(session);
    }, 10000);

    // 出走表
    const todayDayjs = dayjs();
    const raceCards = await getRaceCard(session, todayDayjs);
    if (raceCards === undefined) {
      return;
    }

    // 出走表を当日、今の時間より未来のものだけに絞る
    const yyyymmdd = todayDayjs.format("YYYY-MM-DD");
    const hhmmss = todayDayjs.format("HH:mm:ss");
    const raceCardsForDay = raceCards.filter((value) => value.hd === yyyymmdd);
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

    // 設定値確認
    const capital = config.capital;
    logger.info(`資金 : ${currencyFormatter.format(capital)}`);
    const capitalForDay = parseInt(
      ((capital / 100) * config.rate).toString(),
      10
    );
    logger.info(`本日の資金 : ${currencyFormatter.format(capitalForDay)}`);
    const capitalForOne = parseInt(
      (capitalForDay / raceCardsForDay.length).toString(),
      10
    );
    logger.info(`1回分の資金 : ${currencyFormatter.format(capitalForOne)}`);
    const thresholdRank = config.thresholdRank;
    logger.info(`三連単のランクの閾値=${thresholdRank}`);
    const thresholdExpectedValue = config.thresholdExpectedValue;
    logger.info(`三連単の期待値の閾値=${thresholdExpectedValue}`);
    const thresholdOdds2t = config.thresholdOdds2t;
    logger.info(`二連単のオッズ閾値=${thresholdOdds2t}`);
    const default2tBet = config.default2tBet;
    logger.info(`二連単の初期賭け金=${currencyFormatter.format(default2tBet)}`);

    // 各レースで舟券購入
    for (let i = 0; i < sortedRaceCards.length; i++) {
      const raceCard = sortedRaceCards[i];
      logger.debug(
        `title : ${raceCard.jname}_${raceCard.ktitle}_R${raceCard.rno}`
      );
      logger.debug(
        `dataid=${raceCard.dataid}, jcd=${raceCard.jcd}, hd=${raceCard.hd}, deadlinegai=${raceCard.deadlinegai}`
      );

      const deadLineGaiStr = `${raceCard.hd} ${raceCard.deadlinegai}`;
      const dateFormat = "YYYY-MM-DD HH:mm:ss";
      const deadLineGaiDayjs = dayjs(deadLineGaiStr, dateFormat);
      if (deadLineGaiDayjs.format(dateFormat) !== deadLineGaiStr) {
        logger.error(
          "日付フォーマットエラー : deadLineGaiStr=" + deadLineGaiStr
        );
        continue;
      }
      const deadLineGaiMinusOneMinute = deadLineGaiDayjs.add(-1, "minute");

      logger.trace("場外締切時刻の1分前まで待つ");
      let isPass = false;
      let isWait = true;
      while (isWait) {
        const nowDayjs = dayjs();

        if (sessionExpiredMinusOneMinute.isBefore(nowDayjs)) {
          // セッションの期限1分前を過ぎたらセッションを更新
          const expiredAt = await refresh(session);
          if (expiredAt !== undefined) {
            // セッションの期限を更新
            sessionExpiredDayjs = dayjs.unix(expiredAt / 1000);
            sessionExpiredMinusOneMinute = sessionExpiredDayjs.add(
              -1,
              "minute"
            );
          }
        }

        if (deadLineGaiDayjs.isBefore(nowDayjs)) {
          // 場外締切時刻を過ぎていたら処理をパス
          isPass = true;
          isWait = false;
          continue;
        } else if (
          deadLineGaiDayjs.isAfter(nowDayjs) &&
          deadLineGaiMinusOneMinute.isBefore(nowDayjs)
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

      // 直前予想取得
      const predicts = await getPredicts(session, raceCard.dataid);
      if (predicts === undefined) {
        continue;
      }
      logger.debug("直前予想 : " + util.inspect(predicts));

      let tickets: Ticket[] = [];

      // 三連単の期待値を計算
      const expectedValues3t = calcExpectedValue(
        predicts.player_powers,
        "3t",
        predicts.top6["3t"],
        odds
      );
      logger.debug(
        "expectedValues3t=" + util.inspect(expectedValues3t, { depth: null })
      );

      // 閾値を決めて、条件に合ったものだけ取り出す。
      // 条件に合うものが無ければ舟券を購入しないこともある。
      // ランク1位から (thresholdRank)位までを抽出
      const expectedValues3tSelect = expectedValues3t.slice(0, thresholdRank);
      let matchCount = 0;
      for (let j = 0; j < expectedValues3tSelect.length; j++) {
        const each = expectedValues3tSelect[j];
        if (each.expectedValue >= thresholdExpectedValue) {
          matchCount++;
        }
      }
      if (matchCount >= 3) {
        // ランク1位から (thresholdRank)位までで期待値を超えているものが3つ以上ある場合
        // 期待値から券を作る
        tickets = tickets.concat(
          makeTicket(capitalForOne, expectedValues3tSelect)
        );
      }

      // 二連単 1点 追加 (ココモ法)
      const numberset2t = predicts.top6["2t"][0];
      const odds2t = pickupOdds("2t", numberset2t, odds);
      if (odds2t >= thresholdOdds2t) {
        // オッズが (thresholdOdds2t)倍以上ならば購入
        logger.debug(`numberset2t: ${numberset2t}, odds2t: ${odds2t}`);
        const bet2t = await calc2tBet(
          raceCard.dataid,
          raceCard.jcd,
          numberset2t,
          default2tBet
        );
        tickets.push({
          type: "2t",
          numbers: [
            {
              numberset: numberset2t,
              bet: bet2t,
            },
          ],
        });
      }

      // 舟券購入
      if (tickets.length > 0) {
        await autoBuy(session, raceCard.dataid, tickets);
      }
    }
  } finally {
    if (intervalId !== null) {
      clearInterval(intervalId);
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
