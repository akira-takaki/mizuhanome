import axios, { AxiosResponse } from "axios";
import util from "util";
import dayjs from "dayjs";
import csvtojson from "csvtojson";

import { logger } from "#/boatRace";
import { Config } from "#/config";
import { TicketType } from "#/myUtil";

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
export interface SessionInfo {
  status: string;
  message: string;
  session: string | undefined;
  expiredAt: number | undefined;
  errorId: string | undefined;
}

/**
 * 認証
 */
export async function authenticate(): Promise<string | undefined> {
  logger.info("認証");
  const url = `${baseUrl}/authenticate?email=${email}&accessKey=${accessKey}`;
  let axiosResponse: AxiosResponse<SessionInfo>;
  try {
    axiosResponse = await axios.post<SessionInfo, AxiosResponse<SessionInfo>>(
      url
    );
    logger.debug(util.inspect(axiosResponse.data));
  } catch (err) {
    logger.error("認証 失敗");
    logger.debug(err);
    return undefined;
  }

  return axiosResponse.data.session;
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
export async function refresh(session: string): Promise<void> {
  logger.debug("セッションの更新");
  const url = `${baseUrl}/refresh?session=${session}`;
  try {
    const axiosResponse = await axios.post<
      RefreshResponse,
      AxiosResponse<RefreshResponse>
    >(url);
    logger.debug(util.inspect(axiosResponse.data));
  } catch (err) {
    throw new Error("セッションの更新 失敗");
  }
}

/**
 * セッションの破棄
 */
export async function destroy(session: string): Promise<void> {
  logger.info("セッションの破棄");
  const url = `${baseUrl}/destroy?session=${session}`;
  let axiosResponse: AxiosResponse;
  try {
    axiosResponse = await axios.post(url);
    logger.debug(util.inspect(axiosResponse.data));
  } catch (err) {
    logger.error("セッションの破棄 失敗");
    logger.debug(err);
  }
}

/**
 * 出走表
 */
export interface RaceCard {
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
export async function getRaceCard(
  session: string,
  today: dayjs.Dayjs
): Promise<RaceCard[] | undefined> {
  const yyyy = today.format("YYYY");
  const mm = today.format("MM");
  const url = `${baseUrl}/data/racecard/${yyyy}/${mm}?session=${session}`;
  let raceCards: RaceCard[];
  try {
    const axiosResponse: AxiosResponse = await axios.get(url);

    // CSVデータをJSONへ変換する
    raceCards = await csvtojson().fromString(axiosResponse.data);
  } catch (err) {
    logger.error("出走表 失敗");
    logger.debug(err);
    return undefined;
  }

  return raceCards;
}

/**
 * オッズ
 */
export interface Odds {
  [key: string]: string | null;
}

/**
 * オッズ取得
 */
export async function getOdds(
  session: string | undefined,
  dataid: number
): Promise<Odds | undefined> {
  if (session === undefined) {
    return undefined;
  }

  const url = `${baseUrl}/data/odds/${dataid}?session=${session}`;
  let axiosResponse: AxiosResponse;
  try {
    axiosResponse = await axios.get(url);
  } catch (err) {
    logger.error("オッズ 失敗");
    return undefined;
  }

  return axiosResponse.data.body;
}

/**
 * 直前予想トップ6
 */
export interface PredictsTop6 {
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
 * 直前予想トップ6取得
 */
export async function getPredictsTop6(
  session: string,
  dataid: number
): Promise<PredictsTop6 | undefined> {
  const url = `${baseUrl}/predicts/${dataid}/top6?session=${session}&type=2`;
  let predicts: PredictsTop6;
  try {
    const axiosResponse: AxiosResponse<PredictsTop6> = await axios.get<
      PredictsTop6,
      AxiosResponse<PredictsTop6>
    >(url);
    predicts = axiosResponse.data;
  } catch (err) {
    // 異常レスポンスのときは無視
    logger.debug("直前予想なし");
    return undefined;
  }

  return predicts;
}

/**
 * 直前予想全確率
 */
export interface PredictsAll {
  status: string;
  predict: {
    [key: string]: string;
  };
}

/**
 * 直前予想全確率取得
 */
export async function getPredictsAll(
  session: string | undefined,
  dataid: number
): Promise<PredictsAll | undefined> {
  if (session === undefined) {
    return undefined;
  }

  const url = `${baseUrl}/predicts/${dataid}?session=${session}&type=2`;
  let predicts: PredictsAll;
  try {
    const axiosResponse: AxiosResponse<PredictsAll> = await axios.get<
      PredictsAll,
      AxiosResponse<PredictsAll>
    >(url);
    predicts = axiosResponse.data;
  } catch (err) {
    // 異常レスポンスのときは無視
    logger.debug("直前予想なし");
    return undefined;
  }

  return predicts;
}

/**
 * 舟券番号、賭け金
 */
export interface TicketNumber {
  numberset: string;
  bet: number;
}

/**
 * 舟券種類
 */
export interface Ticket {
  type: TicketType;
  numbers: TicketNumber[];
}

/**
 * 自動購入リクエスト
 */
interface AutoBuyRequest {
  tickets: Ticket[];
  headline?: string | null;
  note?: string;
  price?: number;
  private?: boolean;
}

/**
 * 自動購入
 */
export async function autoBuy(
  session: string | undefined,
  dataid: number,
  tickets: Ticket[]
): Promise<void> {
  if (session === undefined) {
    logger.error("舟券購入 失敗 : session is undefined");
    return;
  }

  logger.debug("舟券購入");
  const autoBuyRequest: AutoBuyRequest = {
    tickets: tickets,
    private: true,
  };
  logger.debug("舟券 = " + util.inspect(autoBuyRequest, { depth: null }));

  // 舟券購入 処理
  const url = `${baseUrl}/autobuy/${dataid}?session=${session}`;
  let axiosResponse: AxiosResponse;
  try {
    axiosResponse = await axios.post(url, autoBuyRequest, {
      headers: { "Content-Type": "application/json" },
    });
    logger.debug(util.inspect(axiosResponse.data));
  } catch (err) {
    logger.error("舟券購入 失敗");
    logger.debug(err);
  }
}

/**
 * 結果
 */
export interface RaceResult {
  [key: string]: string | null;
}

/**
 * 結果取得
 */
export async function getRaceResult(
  session: string,
  dataid: number
): Promise<RaceResult | undefined> {
  const url = `${baseUrl}/data/raceresult/${dataid}?session=${session}`;
  let axiosResponse: AxiosResponse;
  try {
    axiosResponse = await axios.get(url);
  } catch (err) {
    return undefined;
  }
  return axiosResponse.data.body;
}
