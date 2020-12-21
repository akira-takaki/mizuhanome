import log4js from "log4js";
import cron from "node-cron";
import fs from "fs-extra";
import axios, { AxiosResponse } from "axios";
import dayjs from "dayjs";
import * as util from "util";

import { calc2tBet, updateStore2t } from "#/store2t";
import {
  authenticate,
  AuthenticateResponse,
  getRacecard,
  RacecardResponse,
  refresh,
  setupApi,
} from "#/api";
import { sleepFunc } from "#/sleep";

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
  default2tBet: number;
}

/**
 * 直前予想レスポンス
 */
interface PredictsResponse {
  status: string;
  dataid: string;
  // eslint-disable-next-line camelcase
  player_powers: number[];
  top6: {
    "3t": string[];
    "3f": string[];
    "2t": string[];
    "2f": string[];
  };
}

/**
 * オッズ
 */
interface Odds {
  [key: string]: string;
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

/**
 * 舟券番号、賭け金
 */
interface TicketNumber {
  numberset: string;
  bet: number;
}

/**
 * 舟券種類
 */
interface Ticket {
  type: string;
  numbers: TicketNumber[];
}

/**
 * 自動購入
 */
interface AutobuyRequest {
  tickets: Ticket[];
  headline?: string | null;
  note?: string;
  price?: number;
  private?: boolean;
}

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

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
  const expectedValueArray: ExpectedValue[] = [];

  for (let i = 0; i < top6.length; i++) {
    const numberset: string = top6[i];

    // numberset の「予想の強さ」を集計する
    let power = 0;
    for (let j = 0; j < numberset.length; j++) {
      const index: number = parseInt(numberset.substring(j, j + 1), 10) - 1;
      power = power + playerPowers[index];
    }

    // numberset のオッズを取り出す
    const numbersetOdds: number = pickupOdds(type, numberset, odds);

    // 期待値を計算する
    expectedValueArray.push({
      type: type,
      numberset: numberset,
      expectedValue: (power / 300) * numbersetOdds,
      power: power,
      odds: numbersetOdds,
      rank: i + 1,
    });
  }

  return expectedValueArray;
}

/**
 * 賭け金を100円単位にする
 */
function round(bet: number): number {
  const r: number = Math.round(bet / 100) * 100;
  let i: number = parseInt(r.toString(), 10);
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

  const bet: number = totalBet / expectedValues.length;

  // 券種でソートする
  const sortedExpectedValues: ExpectedValue[] = expectedValues.sort(
    (e1, e2) => {
      if (e1.type > e2.type) {
        return 1;
      } else if (e1.type < e2.type) {
        return -1;
      } else {
        return 0;
      }
    }
  );

  let prevType = "";
  let group: ExpectedValue[] = [];
  const tickets: Ticket[] = [];
  for (let i = 0; i < sortedExpectedValues.length; i++) {
    const expectedValue: ExpectedValue = sortedExpectedValues[i];

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

async function autobuy(): Promise<void> {
  logger.info("設定ファイルの読み込み");
  let config: Config;
  try {
    config = JSON.parse(fs.readFileSync("./config/Config.json").toString());
  } catch (err) {
    logger.error("設定ファイルの読み込み 失敗", err);
    return;
  }

  setupApi(config);

  const baseUrl = config.baseUrl;

  // 認証
  const authenticateResponse:
    | AuthenticateResponse
    | undefined = await authenticate();
  if (authenticateResponse === undefined) {
    return;
  }
  if (authenticateResponse.session === undefined) {
    logger.error("session is undefined");
    return;
  }
  const session: string = authenticateResponse.session;
  if (authenticateResponse.expiredAt === undefined) {
    logger.error("expiredAt is undefined");
    return;
  }
  let sessionExpiredDayjs: dayjs.Dayjs = dayjs.unix(
    authenticateResponse.expiredAt / 1000
  );
  logger.debug(
    "session expired at " + sessionExpiredDayjs.format("YYYY/MM/DD HH:mm:ss")
  );
  let sessionExpiredMinusOneMinute: dayjs.Dayjs = sessionExpiredDayjs.add(
    -1,
    "minute"
  );

  let intervalId: NodeJS.Timeout | null = null;
  try {
    intervalId = setInterval(() => {
      updateStore2t(session);
    }, 10000);

    // 出走表
    const todayDayjs: dayjs.Dayjs = dayjs();
    const racecardArray: RacecardResponse[] | undefined = await getRacecard(
      session,
      todayDayjs
    );
    if (racecardArray === undefined) {
      return;
    }

    // 出走表を当日、今の時間より未来のものだけに絞る
    const yyyymmdd: string = todayDayjs.format("YYYY-MM-DD");
    const hhmmss: string = todayDayjs.format("HH:mm:ss");
    const filteredRacecardForDayArray: RacecardResponse[] = racecardArray.filter(
      (value) => value.hd === yyyymmdd
    );
    const filteredRacecardArray: RacecardResponse[] = filteredRacecardForDayArray.filter(
      (value) => value.deadlinegai > hhmmss
    );

    // 出走表を時間で昇順ソートする
    const sortedRacecardArray: RacecardResponse[] = filteredRacecardArray.sort(
      (e1, e2) => {
        const key1: string = e1.hd + " " + e1.deadlinegai;
        const key2: string = e2.hd + " " + e2.deadlinegai;
        if (key1 > key2) {
          return 1;
        } else if (key1 < key2) {
          return -1;
        } else {
          return 0;
        }
      }
    );

    // 設定値確認
    const capital: number = config.capital;
    logger.info("資金 : " + capital + "円");
    const capitalForDay: number = parseInt(
      ((capital / 100) * config.rate).toString(),
      10
    );
    logger.info("本日の資金 : " + capitalForDay + "円");
    const capitalForOne: number = parseInt(
      (capitalForDay / filteredRacecardForDayArray.length).toString(),
      10
    );
    logger.info("1回分の資金 : " + capitalForOne + "円");
    const thresholdRank: number = config.thresholdRank;
    logger.info("ランクの閾値=" + thresholdRank);
    const thresholdExpectedValue: number = config.thresholdExpectedValue;
    logger.info("期待値の閾値=" + thresholdExpectedValue);
    const default2tBet: number = config.default2tBet;
    logger.info("二連単の初期賭け金=" + default2tBet);

    // 各レースで舟券購入
    for (let i = 0; i < sortedRacecardArray.length; i++) {
      const racecard: RacecardResponse = sortedRacecardArray[i];
      logger.debug(
        "title : " +
          racecard.jname +
          "_" +
          racecard.ktitle +
          "_R" +
          racecard.rno.toString()
      );
      logger.debug(
        `dataid=${racecard.dataid}, jcd=${racecard.jcd}, hd=${racecard.hd}, deadlinegai=${racecard.deadlinegai}`
      );

      const deadlinegaiStr: string = racecard.hd + " " + racecard.deadlinegai;
      const dateFormat = "YYYY-MM-DD HH:mm:ss";
      const deadlinegaiDayjs: dayjs.Dayjs = dayjs(deadlinegaiStr, dateFormat);
      if (deadlinegaiDayjs.format(dateFormat) !== deadlinegaiStr) {
        logger.error(
          "日付フォーマットエラー : deadlinegaiStr=" + deadlinegaiStr
        );
        continue;
      }
      const deadlinegaiMinusOneMinute: dayjs.Dayjs = deadlinegaiDayjs.add(
        -1,
        "minute"
      );

      logger.trace("場外締切時刻の1分前まで待つ");
      let isPass = false;
      let isWait = true;
      while (isWait) {
        const nowDayjs: dayjs.Dayjs = dayjs();

        if (sessionExpiredMinusOneMinute.isBefore(nowDayjs)) {
          // セッションの期限1分前を過ぎたらセッションを更新
          const expiredAt: number | undefined = await refresh(session);
          if (expiredAt !== undefined) {
            // セッションの期限を更新
            sessionExpiredDayjs = dayjs.unix(expiredAt / 1000);
            logger.debug(
              "session expired at " +
                sessionExpiredDayjs.format("YYYY/MM/DD HH:mm:ss")
            );
            sessionExpiredMinusOneMinute = sessionExpiredDayjs.add(
              -1,
              "minute"
            );
          }
        }

        if (deadlinegaiDayjs.isBefore(nowDayjs)) {
          // 場外締切時刻を過ぎていたら処理をパス
          isPass = true;
          isWait = false;
          continue;
        } else if (
          deadlinegaiDayjs.isAfter(nowDayjs) &&
          deadlinegaiMinusOneMinute.isBefore(nowDayjs)
        ) {
          // 場外締切時刻よりも1分前ならば待つのをやめる
          isWait = false;
        }

        // 5秒待つ
        await sleepFunc(5000);
      }
      if (isPass) {
        logger.trace("場外締切時刻を過ぎている");
        continue;
      }

      // オッズ
      const oddsUrl = `${baseUrl}/data/odds/${racecard.dataid}?session=${session}`;
      let oddsAxiosResponse: AxiosResponse;
      try {
        oddsAxiosResponse = await axios.get(oddsUrl);
      } catch (err) {
        logger.error("オッズ 失敗", err);
        continue;
      }
      const odds: Odds = oddsAxiosResponse.data.body;

      // 直前予想
      const predictsType2Url = `${baseUrl}/predicts/${racecard.dataid}/top6?session=${session}&type=2`;
      let predictsResponse: PredictsResponse;
      try {
        const predictsAxiosResponse: AxiosResponse<PredictsResponse> = await axios.get<PredictsResponse>(
          predictsType2Url
        );
        predictsResponse = predictsAxiosResponse.data;
      } catch (err) {
        // 異常レスポンスのときは無視
        logger.debug("直前予想なし");
        continue;
      }
      logger.debug("直前予想 : " + util.inspect(predictsResponse));

      let tickets: Ticket[] = [];

      // 三連単の期待値を計算
      const expectedValueArray3t: ExpectedValue[] = calcExpectedValue(
        predictsResponse.player_powers,
        "3t",
        predictsResponse.top6["3t"],
        odds
      );
      logger.debug(
        "expectedValueArray3t=" +
          util.inspect(expectedValueArray3t, { depth: null })
      );

      // 閾値を決めて、条件に合ったものだけ取り出す。
      // 条件に合うものが無ければ舟券を購入しないこともある。
      let matchCount = 0;
      for (let j = 0; j < expectedValueArray3t.length; j++) {
        const each: ExpectedValue = expectedValueArray3t[j];
        if (each.expectedValue >= thresholdExpectedValue) {
          matchCount++;
        } else {
          break;
        }
      }
      if (matchCount >= thresholdRank) {
        // 少なくとも、ランク1位から (thresholdRank)位までが期待値を超えている場合
        // 期待値から券を作る
        // 1つのレースでの当たる確率を上げるため三連単の上位4点を買う
        tickets = tickets.concat(
          makeTicket(capitalForOne, expectedValueArray3t.slice(0, 4))
        );
      }

      // 二連単 1点 追加 (ココモ法)
      const numberset2t: string = predictsResponse.top6["2t"][0];
      const odds2t: number = pickupOdds("2t", numberset2t, odds);
      if (odds2t >= 2.6) {
        // オッズが 2.6倍以上ならば購入
        logger.debug(`numberset2t=${numberset2t}, odds2t=${odds2t}`);
        const bet2t: number = await calc2tBet(
          racecard.dataid,
          racecard.jcd,
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
        logger.debug("舟券購入");
        const autobuyRequest: AutobuyRequest = {
          tickets: tickets,
          private: true,
        };
        logger.debug("舟券 = " + util.inspect(autobuyRequest, { depth: null }));

        // 舟券購入 処理
        const autobuyUrl = `${baseUrl}/autobuy/${racecard.dataid}?session=${session}`;
        let autobuyAxiosResponse: AxiosResponse;
        try {
          autobuyAxiosResponse = await axios.post(autobuyUrl, autobuyRequest, {
            headers: { "Content-Type": "application/json" },
          });
          logger.debug(util.inspect(autobuyAxiosResponse.data));
        } catch (err) {
          logger.error("舟券購入 失敗", err);
        }
      }
    }
  } finally {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }

    // セッションの破棄
    logger.info("セッションの破棄");
    const sessionDestroyUrl = `${baseUrl}/destroy?session=${session}`;
    let destroyAxiosResponse: AxiosResponse;
    try {
      destroyAxiosResponse = await axios.post(sessionDestroyUrl);
      logger.debug(util.inspect(destroyAxiosResponse.data));
    } catch (err) {
      logger.error("セッションの破棄 失敗", err);
    }
  }
}

async function main(): Promise<void> {
  logger.info("起動");

  // 毎日 08:30 に実行
  cron.schedule(
    "0 30 8 * * *",
    async () => {
      await autobuy();
    },
    { timezone: "Asia/Tokyo" }
  );

  // 08:30を過ぎて起動されたら処理を始める
  const startDayjs: dayjs.Dayjs = dayjs()
    .set("hour", 8)
    .set("minute", 30)
    .set("second", 0);
  const nowDayjs: dayjs.Dayjs = dayjs();
  if (nowDayjs.isAfter(startDayjs)) {
    logger.info("08:30を過ぎたため実行");
    await autobuy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
