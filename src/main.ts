import log4js from "log4js";
import cron from "node-cron";
import fs from "fs-extra";
import axios, { AxiosResponse } from "axios";
import dayjs from "dayjs";
import csvtojson from "csvtojson";
import * as util from "util";

interface Config {
  baseUrl: string;
  email: string;
  accessKey: string;
  capital: number;
  rate: number;
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
  const authenticateUrl: string =
    baseUrl + "/authenticate" + "?email=" + email + "&accessKey=" + accessKey;
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
    const racecardUrl: string =
      baseUrl + "/data/racecard/" + yyyy + "/" + mm + "?session=" + session;
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

    // 各レースで舟券購入
    const capital = config.capital;
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
    for (let i = 0; i < sortedRacecardArray.length; i++) {
      const racecard: RacecardResponse = sortedRacecardArray[i];
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
          logger.info("セッションの更新");
          const sessionRefreshUrl: string =
            baseUrl + "/refresh" + "?session=" + session;
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

      // 直前予想
      const predictsType2Url: string =
        baseUrl +
        "/predicts/" +
        racecard.dataid +
        "/top6" +
        "?session=" +
        session +
        "&type=2";
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

      // ===== 舟券選定 =====
      // 出走選手の「予想の強さ」を降順にソート
      const sortedPlayerPowers: number[] = predictsResponse.player_powers
        .sort()
        .reverse();
      logger.debug("sortedPlayerPowers = " + util.inspect(sortedPlayerPowers));
      const diffPoint = 3;
      let ticket: Ticket | undefined = undefined;
      const diffPoint3t = sortedPlayerPowers[2] - sortedPlayerPowers[3];
      const diffPoint2t = sortedPlayerPowers[1] - sortedPlayerPowers[2];
      if (diffPoint3t > diffPoint) {
        // 「予想の強さ」3位 と 4位 の差が diffPoint より大きければ
        // 三連単
        const bet: number = parseInt(
          (
            Math.round((capitalForOne * (1 + diffPoint3t / 10)) / 100) * 100
          ).toString(),
          10
        );
        const ticketNumber: TicketNumber = {
          numberset: predictsResponse.top6["3t"][0],
          bet: bet,
        };
        ticket = {
          type: "3t",
          numbers: [ticketNumber],
        };
      } else if (diffPoint2t > diffPoint) {
        // 「予想の強さ」2位 と 3位 の差が diffPoint より大きければ
        // 二連単
        const bet: number = parseInt(
          (
            Math.round((capitalForOne * (1 + diffPoint2t / 10)) / 100) * 100
          ).toString(),
          10
        );
        const ticketNumber: TicketNumber = {
          numberset: predictsResponse.top6["2t"][0],
          bet: bet,
        };
        ticket = {
          type: "2t",
          numbers: [ticketNumber],
        };
      } else {
        ticket = undefined;
      }

      // 舟券購入
      if (ticket !== undefined) {
        logger.info("舟券購入");
        const autobuyRequest: AutobuyRequest = {
          tickets: [ticket],
          private: true,
        };
        logger.debug("舟券 = " + util.inspect(autobuyRequest, { depth: null }));

        // 舟券購入 処理
        const autobuyUrl: string =
          baseUrl +
          "/autobuy/" +
          predictsResponse.dataid +
          "?session=" +
          session;
        let autobuyAxiosResponse: AxiosResponse;
        try {
          autobuyAxiosResponse = await axios.post(autobuyUrl, autobuyRequest, {
            headers: { "Content-Type": "application/json" },
          });
          logger.info(util.inspect(autobuyAxiosResponse.data));
        } catch (err) {
          logger.error("舟券購入 失敗", err);
        }
      }
    }
  } finally {
    // セッションの破棄
    logger.info("セッションの破棄");
    const sessionDestroyUrl: string =
      baseUrl + "/destroy" + "?session=" + session;
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

  // 毎日 08:00 に実行
  cron.schedule(
    "0 0 8 * * *",
    async () => {
      await autobuy();
    },
    { timezone: "Asia/Tokyo" }
  );

  // 08:00を過ぎて起動されたら処理を始める
  const startDayjs: dayjs.Dayjs = dayjs()
    .set("hour", 8)
    .set("minute", 0)
    .set("second", 0);
  const nowDayjs: dayjs.Dayjs = dayjs();
  if (nowDayjs.isAfter(startDayjs)) {
    logger.info("08:00を過ぎたため実行");
    await autobuy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
