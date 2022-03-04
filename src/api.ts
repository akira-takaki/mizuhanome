import axios, { AxiosResponse } from "axios";
import util from "util";
import dayjs from "dayjs";
import csvtojson from "csvtojson";

import { logger } from "#/boatRace";
import { Config } from "#/config";
import { TicketType } from "#/myUtil";
import { sendmail } from "#/sendmail";

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
    await sendmail("認証 失敗");
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
    await sendmail("セッションの破棄 失敗");
  }
}

/**
 * 出走表
 */
export interface RaceCard {
  status: string;

  body: RaceCardBody;
}

/**
 * 出走表 body
 */
export interface RaceCardBody {
  /** データID */
  dataid: number | string;

  /** 日付 年(4桁)-月(2桁)-日(2桁) */
  hd: string;

  /** 場所番号。1から24 */
  jcd: number | string;

  /** R番号 */
  rno: number;

  /** 節の何日目か */
  // nj: string;

  /** 節の開始日 年(4桁)-月(2桁)-日(2桁) */
  kfrom: string;

  /** 節の予定終了日 年(4桁)-月(2桁)-日(2桁) */
  kto: string;

  /** 場所の名前 */
  // jname: string;

  /** その大会のグレード */
  // tbgradename: string | undefined;

  /** 大会名 */
  // ktitle: string;

  /** ナイターレースフラグ */
  nightflag: number;

  /** レースグレード */
  gradeicon: string;

  /** レースタイトル */
  // rtitle: string;

  /** 侵入固定フラグ */
  koteiflag: number;

  /** レース距離 */
  distance: number;

  /** 安定板フラグ */
  anteibanflag: number;

  /** 場外締切時刻 00:00:00 */
  deadline: string;

  /** 場外締切時刻 00:00:00 */
  deadlinegai: string;
}

/**
 * APIで読み込んだ値の必要なものだけをセットし直す
 */
function renewRaceCardBody(raceCardBody: RaceCardBody): RaceCardBody {
  return {
    dataid: raceCardBody.dataid,
    hd: raceCardBody.hd,
    jcd: raceCardBody.jcd,
    rno: raceCardBody.rno,
    // nj: raceCardBody.nj,
    kfrom: raceCardBody.kfrom,
    kto: raceCardBody.kto,
    // jname: raceCardBody.jname,
    // tbgradename: raceCardBody.tbgradename,
    // ktitle: raceCardBody.ktitle,
    nightflag: raceCardBody.nightflag,
    gradeicon: raceCardBody.gradeicon,
    // rtitle: raceCardBody.rtitle,
    koteiflag: raceCardBody.koteiflag,
    distance: raceCardBody.distance,
    anteibanflag: raceCardBody.anteibanflag,
    deadline: raceCardBody.deadline,
    deadlinegai: raceCardBody.deadlinegai,
  };
}

/**
 * レース指定 出走表 取得
 */
export async function getRaceCard(
  session: string,
  dataid: number
): Promise<RaceCard | undefined> {
  const url = `${baseUrl}/data/racecard/${dataid}?session=${session}`;
  let raceCard: RaceCard;
  try {
    const axiosResponse: AxiosResponse<RaceCard> = await axios.get<
      RaceCard,
      AxiosResponse<RaceCard>
    >(url);
    raceCard = axiosResponse.data;
  } catch (err) {
    logger.error("出走表 失敗");
    logger.debug(err);
    await sendmail("出走表 失敗");
    return undefined;
  }

  return {
    status: raceCard.status,
    body: renewRaceCardBody(raceCard.body),
  };
}

/**
 * 月指定 出走表 取得
 */
export async function getRaceCardBodies(
  session: string,
  today: dayjs.Dayjs
): Promise<RaceCardBody[] | undefined> {
  const yyyy = today.format("YYYY");
  const mm = today.format("MM");
  const url = `${baseUrl}/data/racecard/${yyyy}/${mm}?session=${session}`;
  let raceCards: RaceCardBody[];
  try {
    const axiosResponse: AxiosResponse = await axios.get(url);

    // CSVデータをJSONへ変換する
    raceCards = await csvtojson().fromString(axiosResponse.data);
  } catch (err) {
    logger.error("出走表 失敗");
    logger.debug(err);
    await sendmail("出走表 失敗");
    return undefined;
  }

  return raceCards.map((value) => renewRaceCardBody(value));
}

/**
 * 直前情報
 */
export interface BeforeInfo {
  status: string;

  body: BeforeInfoBody;
}

/**
 * 直前情報 body
 */
export interface BeforeInfoBody {
  /** データID */
  dataid: number;

  /** いつ時点のデータか */
  // measuretime: string;

  /** 天気 */
  // weather: string;

  /** 波の高さ */
  wave: string | null;

  /** 風速 */
  wind: string;

  /** 気温 */
  // temp: string;

  /** 水温 */
  // water: string;

  /** 風向。00~16まで17パターン */
  // winddirec: string;
}

/**
 * APIで読み込んだ値の必要なものだけをセットし直す
 */
function renewBeforeInfoBody(beforeInfoBody: BeforeInfoBody): BeforeInfoBody {
  return {
    dataid: beforeInfoBody.dataid,
    // measuretime: beforeInfoBody.measuretime,
    // weather: beforeInfoBody.weather,
    wave: beforeInfoBody.wave,
    wind: beforeInfoBody.wind,
    // temp: beforeInfoBody.temp,
    // water: beforeInfoBody.water,
    // winddirec: beforeInfoBody.winddirec,
  };
}

/**
 * 直前情報
 */
export async function getBeforeInfo(
  session: string | undefined,
  dataid: number
): Promise<BeforeInfo | undefined> {
  if (session === undefined) {
    return undefined;
  }

  const url = `${baseUrl}/data/beforeinfo/${dataid}?session=${session}`;
  let beforeInfo: BeforeInfo;
  try {
    const axiosResponse: AxiosResponse<BeforeInfo> = await axios.get<
      BeforeInfo,
      AxiosResponse<BeforeInfo>
    >(url);
    beforeInfo = axiosResponse.data;
  } catch (err) {
    logger.error("直前情報 失敗");
    logger.debug(err);
    // メールは送信しない
    return undefined;
  }

  return {
    status: beforeInfo.status,
    body: renewBeforeInfoBody(beforeInfo.body),
  };
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
    // メールは送信しない
    return undefined;
  }

  return axiosResponse.data.body;
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
 * 自動購入レスポンス
 */
interface AutoBuyResponse {
  status: number;
  message: string;
  dataid: number;
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
    await sendmail("舟券購入 失敗 : session is undefined");
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
  let axiosResponse: AxiosResponse<AutoBuyResponse>;
  try {
    axiosResponse = await axios.post<
      AutoBuyResponse,
      AxiosResponse<AutoBuyResponse>
    >(url, autoBuyRequest, {
      headers: { "Content-Type": "application/json" },
    });
    logger.debug(util.inspect(axiosResponse.data));
  } catch (err) {
    logger.error("舟券購入API 失敗");
    logger.debug(err);
    await sendmail("舟券購入API 失敗");
    return;
  }

  const autoBuyResponse: AutoBuyResponse = axiosResponse.data;
  if (autoBuyResponse.status === -1) {
    logger.error("舟券購入 失敗");
    await sendmail("舟券購入 失敗");
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
