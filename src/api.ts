import { logger, Config } from "#/main";
import axios, { AxiosResponse } from "axios";
import util from "util";
import dayjs from "dayjs";
import csvtojson from "csvtojson";

let baseUrl: string;
let email: string;
let accessKey: string;

export function setupApi(config: Config): void {
  baseUrl = config.baseUrl;
  email = config.email;
  accessKey = config.accessKey;
}

/**
 * 認証レスポンス
 */
export interface AuthenticateResponse {
  status: string;
  message: string;
  session: string | undefined;
  expiredAt: number | undefined;
  errorId: string | undefined;
}

/**
 * 認証
 */
export async function authenticate(): Promise<
  AuthenticateResponse | undefined
> {
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
    return undefined;
  }

  return authenticateAxiosResponse.data;
}

/**
 * セッションの更新レスポンス
 */
interface RefreshResponse {
  status: string;
  expiredAt: number | undefined;
}

/**
 * セッションの更新
 */
export async function refresh(session: string): Promise<number | undefined> {
  logger.debug("セッションの更新");
  const sessionRefreshUrl = `${baseUrl}/refresh?session=${session}`;
  let refreshAxiosResponse: AxiosResponse<RefreshResponse>;
  try {
    refreshAxiosResponse = await axios.post<RefreshResponse>(sessionRefreshUrl);
    logger.debug(util.inspect(refreshAxiosResponse.data));
  } catch (err) {
    logger.error("セッションの更新 失敗", err);
    return undefined;
  }

  return refreshAxiosResponse.data.expiredAt;
}

/**
 * 出走表レスポンス
 */
export interface RacecardResponse {
  /** データID */
  dataid: number;

  /** 日付。年(4桁)-月(2桁)-日(2桁)。 */
  hd: string;

  /** 場所番号。1から24 */
  jcd: number;

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
 * 出走表
 */
export async function getRacecard(
  session: string,
  todayDayjs: dayjs.Dayjs
): Promise<RacecardResponse[] | undefined> {
  const yyyy: string = todayDayjs.format("YYYY");
  const mm: string = todayDayjs.format("MM");
  const racecardUrl = `${baseUrl}/data/racecard/${yyyy}/${mm}?session=${session}`;
  let racecardResponses: RacecardResponse[];
  try {
    const racecardAxiosResponse: AxiosResponse = await axios.get(racecardUrl);

    // CSVデータをJSONへ変換する
    racecardResponses = await csvtojson().fromString(
      racecardAxiosResponse.data
    );
  } catch (err) {
    logger.error("出走表 失敗", err);
    return undefined;
  }

  return racecardResponses;
}

/**
 * 結果
 */
export interface Raceresult {
  [key: string]: string | null;
}

export async function getRaceresult(
  session: string,
  dataid: number
): Promise<Raceresult | undefined> {
  const raceresultUrl = `${baseUrl}/data/raceresult/${dataid}?session=${session}`;
  let raceresultAxiosResponse: AxiosResponse;
  try {
    raceresultAxiosResponse = await axios.get(raceresultUrl);
  } catch (err) {
    return undefined;
  }
  return raceresultAxiosResponse.data.body;
}
