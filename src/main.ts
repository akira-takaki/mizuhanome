import log4js from "log4js";
import cron from "node-cron";
import fs from "fs-extra";
import axios, { AxiosResponse } from "axios";
import dayjs from "dayjs";
import csvtojson from "csvtojson";
import * as util from "util";

/**
 * 設定
 */
interface Config {
  baseUrl: string;
  email: string;
  accessKey: string;
  capital: number;
  rate: number;
  thresholdRank: number;
  thresholdExpectedValue: number;
}

/**
 * 認証レスポンス
 */
interface AuthenticateResponse {
  status: string;
  message: string;
  session: string | undefined;
  expiredAt: number | undefined;
  errorId: string | undefined;
}

/**
 * セッションの更新レスポンス
 */
interface RefreshResponse {
  status: string;
  expiredAt: number | undefined;
}

/**
 * 出走表レスポンス
 */
interface RacecardResponse {
  /** データID */
  dataid: number;

  /** 日付。年(4桁)-月(2桁)-日(2桁)。 */
  hd: string;

  /** R番号 */
  rno: number;

  /** 場所の名前 */
  jname: string;

  /** 大会名 */
  ktitle: string;

  /** 場外締切時刻 */
  deadlinegai: string;
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
const logger: log4js.Logger = log4js.getLogger("mizuhanome");

/**
 * スリープ
 *
 * @param millisecond
 */
async function sleepFunc(millisecond: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millisecond));
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
    const oddsKey: string = "odds_" + type + numberset;
    const numbersetOdds: number = parseFloat(odds[oddsKey]);

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

  const baseUrl = config.baseUrl;
  const email = config.email;
  const accessKey = config.accessKey;

  // 認証
  logger.info("認証");
  const authenticateUrl = `${baseUrl}/authenticate?email=${email}&accessKey=${accessKey}`;
  let authenticateAxiosResponse: AxiosResponse<AuthenticateResponse>;
  try {
    authenticateAxiosResponse = await axios.post<AuthenticateResponse>(
      authenticateUrl
    );
    logger.debug(util.inspect(authenticateAxiosResponse.data));
  } catch (err) {
    logger.error("認証 失敗", err);
    return;
  }
  if (authenticateAxiosResponse.data.session === undefined) {
    logger.error("session is undefined");
    return;
  }
  const session: string = authenticateAxiosResponse.data.session;
  if (authenticateAxiosResponse.data.expiredAt === undefined) {
    logger.error("expiredAt is undefined");
    return;
  }
  let sessionExpiredDayjs: dayjs.Dayjs = dayjs.unix(
    authenticateAxiosResponse.data.expiredAt / 1000
  );
  logger.debug(
    "session expired at " + sessionExpiredDayjs.format("YYYY/MM/DD HH:mm:ss")
  );
  let sessionExpiredMinusOneMinute: dayjs.Dayjs = sessionExpiredDayjs.add(
    -1,
    "minute"
  );

  try {
    // 出走表
    const todayDayjs: dayjs.Dayjs = dayjs();
    const yyyy: string = todayDayjs.format("YYYY");
    const mm: string = todayDayjs.format("MM");
    const racecardUrl = `${baseUrl}/data/racecard/${yyyy}/${mm}?session=${session}`;
    let racecardArray: RacecardResponse[];
    try {
      const racecardAxiosResponse: AxiosResponse = await axios.get(racecardUrl);

      // CSVデータをJSONへ変換する
      racecardArray = await csvtojson().fromString(racecardAxiosResponse.data);
    } catch (err) {
      logger.error("出走表 失敗", err);
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
        `dataid=${racecard.dataid}, hd=${racecard.hd}, deadlinegai=${racecard.deadlinegai}`
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
          logger.debug("セッションの更新");
          const sessionRefreshUrl = `${baseUrl}/refresh?session=${session}`;
          let refreshAxiosResponse: AxiosResponse<RefreshResponse>;
          try {
            refreshAxiosResponse = await axios.post<RefreshResponse>(
              sessionRefreshUrl
            );
            logger.debug(util.inspect(refreshAxiosResponse.data));
            if (refreshAxiosResponse.data.expiredAt !== undefined) {
              // セッションの期限を更新
              sessionExpiredDayjs = dayjs.unix(
                refreshAxiosResponse.data.expiredAt / 1000
              );
              logger.debug(
                "session expired at " +
                  sessionExpiredDayjs.format("YYYY/MM/DD HH:mm:ss")
              );
              sessionExpiredMinusOneMinute = sessionExpiredDayjs.add(
                -1,
                "minute"
              );
            }
          } catch (err) {
            logger.error("セッションの更新 失敗", err);
            return;
          }
        }

        if (deadlinegaiDayjs.isBefore(nowDayjs)) {
          // 場外締切時刻を過ぎていたら処理をパス
          isPass = true;
          isWait = false;
          logger.trace("待つのをやめる " + nowDayjs.format(dateFormat));
          continue;
        } else if (
          deadlinegaiDayjs.isAfter(nowDayjs) &&
          deadlinegaiMinusOneMinute.isBefore(nowDayjs)
        ) {
          // 場外締切時刻よりも1分前ならば待つのをやめる
          isWait = false;
          logger.trace("待つのをやめる " + nowDayjs.format(dateFormat));
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

      // 三連単の期待値を計算
      const expectedValueArray3t: ExpectedValue[] = calcExpectedValue(
        predictsResponse.player_powers,
        "3t",
        predictsResponse.top6["3t"],
        odds
      );

      // 三連単の期待値を降順ソートする
      const sortedExpectedValueArray3: ExpectedValue[] = expectedValueArray3t
        .sort((e1, e2) => {
          if (e1.expectedValue > e2.expectedValue) {
            return 1;
          } else if (e1.expectedValue < e2.expectedValue) {
            return -1;
          } else {
            return 0;
          }
        })
        .reverse();
      logger.debug(
        "sortedExpectedValueArray3=" +
          util.inspect(sortedExpectedValueArray3, { depth: null })
      );

      // 閾値を決めて、条件に合ったものだけ取り出す。
      // 条件に合うものが無ければ舟券を購入しないこともある。
      const filteredExpectedValue: ExpectedValue[] = sortedExpectedValueArray3.filter(
        (each) =>
          each.rank <= thresholdRank &&
          each.expectedValue >= thresholdExpectedValue
      );

      // 舟券購入
      // 1つのレースでの当たる確率を上げるため三連単を4点買う
      if (filteredExpectedValue.length >= 4) {
        // 券を作る
        const tickets: Ticket[] = makeTicket(
          capitalForOne,
          filteredExpectedValue
        );

        logger.debug("舟券購入");
        const autobuyRequest: AutobuyRequest = {
          tickets: tickets,
          private: true,
        };
        logger.debug("舟券 = " + util.inspect(autobuyRequest, { depth: null }));

        // 舟券購入 処理
        const autobuyUrl = `${baseUrl}/autobuy/${predictsResponse.dataid}?session=${session}`;
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
