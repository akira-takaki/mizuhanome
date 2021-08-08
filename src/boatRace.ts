import log4js from "log4js";
import dayjs from "dayjs";
import * as util from "util";

import {
  authenticate,
  autoBuy,
  BeforeInfoBody,
  destroy,
  getBeforeInfo,
  getOdds,
  getPredictsAll,
  getRaceCardBodies,
  Odds,
  PredictsAll,
  RaceCardBody,
  refresh,
  setupApi,
  Ticket,
} from "#/api";
import {
  addBetRaceResult,
  hasNotDecision,
  initBetDayResult,
  makeBetDayResult,
  storedBetDayResultDates,
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";
import {
  generateNumbersetInfo,
  isRough,
  NumbersetInfo,
  numbersetInfoOrderByPercent,
  playerPowers,
  Power,
  raceCardBodyOrderByDeadlinegai,
  roundBet,
  sleep,
  TicketType,
} from "#/myUtil";
import { Config, readConfig, writeConfig } from "#/config";
import { report, reportSummary } from "#/report";
import { calcCocomoBet, updateCocomo } from "#/cocomo";
import { calcCocomoTopNBet, updateCocomoTopN } from "#/cocomoTopN";

log4js.configure("./config/LogConfig.json");
export const logger: log4js.Logger = log4js.getLogger("mizuhanome");

/**
 * 購入する三連単の舟券を追加する
 * 確率が一番高いものを1点賭ける
 * ココモ法
 *
 * @param yyyymmdd 当日
 * @param raceCardBody 出走表 body
 * @param beforeInfoBody 直前情報 body
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 3t 組番情報
 * @param todayJcdArray 今日レースをやるレース場コード配列
 * @param ticket 舟券
 * @param isSim
 */
export async function addTicket3t2Cocomo(
  yyyymmdd: string,
  raceCardBody: RaceCardBody,
  beforeInfoBody: BeforeInfoBody,
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  todayJcdArray: number[],
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  // 舟券を購入するレース場コード
  const jcdArray: number[] = [
    11, // びわこ 13%
    13, // 尼崎 14%
    21, // 芦屋 14%
    12, // 住之江 16%
    24, // 大村 17%
  ];
  const selectCount = 3; // 舟券を購入するレース場の数
  const selectedJcdArray: number[] = []; // 選抜レース場コード配列
  for (let i = 0; i < jcdArray.length; i++) {
    for (let j = 0; j < todayJcdArray.length; j++) {
      if (jcdArray[i] === todayJcdArray[j]) {
        // 今日レースをやるレース場コードの場合、
        // 選抜レース場コード配列 に追加
        selectedJcdArray.push(jcdArray[i]);
        break;
      }
    }
    if (selectedJcdArray.length >= selectCount) {
      // 選抜レース場コード配列 が指定数になったら、そこまで。
      break;
    }
  }

  if (!selectedJcdArray.includes(parseInt(raceCardBody.jcd.toString()))) {
    // 選抜レース場コード配列 に含まれていなければ賭けない
    return;
  }

  if (
    beforeInfoBody.wave !== null &&
    parseInt(beforeInfoBody.wave.replace("cm", "")) > 10
  ) {
    // 波の高さが 10cm より大きい場合賭けない
    return;
  }

  // 確率が大きい順にソート
  const sortedNumbersetInfos = numbersetInfos
    .sort(numbersetInfoOrderByPercent)
    .reverse();

  const numbersetInfo = sortedNumbersetInfos[0];

  // 確率の閾値
  // const percent = 0.134; // 500円, 12回, 1,892,900-
  // const percent = 0.125; // 500円, 12回, 2,468,650-
  // const percent = 0.123; // 500円, 12回, 2,124,150-
  // const percent = 0.122; // 500円, 12回, 2,561,850-
  // const percent = 0.121; // 500円, 12回, 1,983,750-
  // const percent = 0.118; // 500円, 12回, 2,102,450-
  // const percent = 0.082; // 500円, 12回, 2,631,400-
  // const percent = 0.067; // 100円, 17回, 5,296,210-
  // const percent = 0.068; // 100円, 17回, 5,777,140-
  // const percent = 0.07; // 100円, 17回, 5,790,640-
  // const percent = 0.074; // 100円, 17回, 7,363,640-
  // const percent = 0.076; // 100円, 17回, 8,929,230-
  // const percent = 0.122; // 200円, 12回, 1,024,540-
  const percent = 0.125; // 200円, 12回, 1,096,740-
  if (numbersetInfo.percent < percent) {
    // 確率の閾値より低い場合賭けない
    return;
  }

  if (numbersetInfo.odds === null || numbersetInfo.odds < 2.8) {
    // オッズが 指定倍 より低いものは、賭けない
    // ココモ法としては 2.6倍 が最低ラインだが、
    // レース前オッズは下がる可能性があるため 指定倍 で判断する。
    return;
  }

  // 賭け金
  const bet = await calcCocomoBet(
    yyyymmdd,
    parseInt(raceCardBody.dataid.toString()),
    numbersetInfo.numberset,
    "3t",
    200,
    12,
    isSim
  );
  if (bet !== null) {
    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する三連単の舟券を追加する
 * 確率が高いものからN点賭ける
 * ココモ法 TopN
 *
 * @param yyyymmdd 当日
 * @param raceCardBody 出走表 body
 * @param beforeInfoBody 直前情報 body
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 3t 組番情報
 * @param todayJcdArray 今日レースをやるレース場コード配列
 * @param ticket 舟券
 * @param isSim
 */
export async function addTicket3t2CocomoTopN(
  yyyymmdd: string,
  raceCardBody: RaceCardBody,
  beforeInfoBody: BeforeInfoBody,
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  todayJcdArray: number[],
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  // 舟券を購入するレース場コード
  const jcdArray: number[] = [
    11, // びわこ 13%
    13, // 尼崎 14%
    21, // 芦屋 14%
    12, // 住之江 16%
    24, // 大村 17%
  ];
  const selectCount = 3; // 舟券を購入するレース場の数
  const selectedJcdArray: number[] = []; // 選抜レース場コード配列
  for (let i = 0; i < jcdArray.length; i++) {
    for (let j = 0; j < todayJcdArray.length; j++) {
      if (jcdArray[i] === todayJcdArray[j]) {
        // 今日レースをやるレース場コードの場合、
        // 選抜レース場コード配列 に追加
        selectedJcdArray.push(jcdArray[i]);
        break;
      }
    }
    if (selectedJcdArray.length >= selectCount) {
      // 選抜レース場コード配列 が指定数になったら、そこまで。
      break;
    }
  }

  if (!selectedJcdArray.includes(parseInt(raceCardBody.jcd.toString()))) {
    // 選抜レース場コード配列 に含まれていなければ賭けない
    return;
  }

  if (
    beforeInfoBody.wave !== null &&
    parseInt(beforeInfoBody.wave.replace("cm", "")) > 10
  ) {
    // 波の高さが 10cm より大きい場合賭けない
    return;
  }

  // 確率が大きい順にソート
  const sortedNumbersetInfos = numbersetInfos
    .sort(numbersetInfoOrderByPercent)
    .reverse();

  const numbersetInfoTop1 = sortedNumbersetInfos[0];

  const percent = 0.125;
  if (numbersetInfoTop1.percent < percent) {
    // 確率の閾値より低い場合賭けない
    return;
  }

  if (numbersetInfoTop1.odds === null || numbersetInfoTop1.odds < 2.8) {
    // オッズが 指定倍 より低いものは、賭けない
    // ココモ法としては 2.6倍 が最低ラインだが、
    // レース前オッズは下がる可能性があるため 指定倍 で判断する。
    return;
  }

  const topN = 1;
  const sliceNumbersetInfoTopN = sortedNumbersetInfos.slice(0, topN);

  // 賭け金を計算し、舟券へ追加する
  await calcCocomoTopNBet(
    yyyymmdd,
    parseInt(raceCardBody.dataid.toString()),
    sliceNumbersetInfoTopN,
    "3t",
    200,
    12,
    4.0,
    ticket,
    isSim
  );
}

/**
 * 購入する三連単の舟券を追加する
 *
 * @param yyyymmdd 当日
 * @param raceCardBody 出走表 body
 * @param beforeInfoBody 直前情報 body
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param todayJcdArray 今日レースをやるレース場コード配列
 * @param tickets 舟券配列
 * @param isSim
 */
async function addTicket3t(
  yyyymmdd: string,
  raceCardBody: RaceCardBody,
  beforeInfoBody: BeforeInfoBody,
  powers: Power[],
  odds: Odds,
  predictsAll: PredictsAll,
  todayJcdArray: number[],
  tickets: Ticket[],
  isSim = false
): Promise<void> {
  const type: TicketType = "3t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する三連単の舟券を追加する
  await addTicket3t2CocomoTopN(
    yyyymmdd,
    raceCardBody,
    beforeInfoBody,
    powers,
    numbersetInfos,
    todayJcdArray,
    ticket,
    isSim
  );

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する三連複の舟券を追加する
 * 確率が一番高いものを1点賭ける
 * ココモ法
 *
 * @param yyyymmdd 当日
 * @param dataid データID
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 3f 組番情報
 * @param ticket 舟券
 * @param isSim
 */
export async function addTicket3f2Cocomo(
  yyyymmdd: string,
  dataid: number,
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  // 確率が大きい順にソート
  const sortedNumbersetInfos = numbersetInfos
    .sort(numbersetInfoOrderByPercent)
    .reverse();

  const numbersetInfo = sortedNumbersetInfos[0];

  // 確率の閾値
  const percent = 0.39;
  if (numbersetInfo.percent < percent) {
    // 確率の閾値より低い場合賭けない
    return;
  }

  if (numbersetInfo.odds === null || numbersetInfo.odds < 2.8) {
    // オッズが 指定倍 より低いものは、賭けない
    // ココモ法としては 2.6倍 が最低ラインだが、
    // レース前オッズは下がる可能性があるため 指定倍 で判断する。
    return;
  }

  // 賭け金
  const bet = await calcCocomoBet(
    yyyymmdd,
    dataid,
    numbersetInfo.numberset,
    "3f",
    1000,
    15,
    isSim
  );
  if (bet !== null) {
    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する三連複の舟券を追加する
 *
 * @param yyyymmdd 当日
 * @param dataid データID
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 * @param isSim
 */
async function addTicket3f(
  yyyymmdd: string,
  dataid: number,
  powers: Power[],
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[],
  isSim = false
): Promise<void> {
  const type: TicketType = "3f";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する三連複の舟券を追加する
  await addTicket3f2Cocomo(
    yyyymmdd,
    dataid,
    powers,
    numbersetInfos,
    ticket,
    isSim
  );

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する二連単の舟券を追加する
 * ココモ法
 *
 * @param yyyymmdd
 * @param dataid データID
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 2t 組番情報
 * @param ticket 舟券
 * @param isSim
 */
export async function addTicket2t2Cocomo(
  yyyymmdd: string,
  dataid: number,
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  // 確率の閾値 32%
  const percent = 0.32;

  const filteredNumbersetInfos = numbersetInfos.filter(
    (value) => value.percent >= percent
  );
  if (
    filteredNumbersetInfos.length >= 2 ||
    filteredNumbersetInfos.length <= 0
  ) {
    // 確率の閾値以上のものが複数の場合、
    // または、
    // 確率の閾値以上のものが無い場合、
    // 賭けない
    return;
  }

  const numbersetInfo = filteredNumbersetInfos[0];

  if (numbersetInfo.odds === null || numbersetInfo.odds < 3.4) {
    // オッズが 3.4倍 より低いものは、賭けない
    // ココモ法としては 2.6倍 が最低ラインだが、
    // レース前オッズは下がる可能性があるため 3.4倍 で判断する。
    return;
  }

  // 賭け金
  const bet = await calcCocomoBet(
    yyyymmdd,
    dataid,
    numbersetInfo.numberset,
    "2t",
    1000,
    15,
    isSim
  );
  if (bet !== null) {
    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連単の舟券を追加する
 *
 * @param yyyymmdd
 * @param dataid データID
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 * @param isSim
 */
async function addTicket2t(
  yyyymmdd: string,
  dataid: number,
  powers: Power[],
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[],
  isSim = false
): Promise<void> {
  const type: TicketType = "2t";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する二連単の舟券を追加する
  await addTicket2t2Cocomo(
    yyyymmdd,
    dataid,
    powers,
    numbersetInfos,
    ticket,
    isSim
  );

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * 購入する二連複の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param numbersetInfos 1レースの 2f 組番情報
 * @param ticket 舟券
 */
export function addTicket2f2(
  powers: Power[],
  numbersetInfos: NumbersetInfo[],
  ticket: Ticket
): void {
  const rough = isRough(powers);

  // 期待値が thresholdExpectedValue 以上のものに絞り込む
  const thresholdExpectedValue = 1.2;
  let filteredNumbersetInfos: NumbersetInfo[];
  if (rough.isRough && rough.numberStr !== null && rough.numberStr !== "1") {
    filteredNumbersetInfos = numbersetInfos.filter(
      (value) =>
        value.expectedValue >= thresholdExpectedValue &&
        value.numberset.includes(
          rough.numberStr === null ? "X" : rough.numberStr
        )
    );
  } else {
    filteredNumbersetInfos = numbersetInfos.filter(
      (value) =>
        value.expectedValue >= thresholdExpectedValue && value.percent > 0.2
    );
  }
  if (filteredNumbersetInfos.length <= 0) {
    return;
  }

  // 賭け金は1レースで 1000円 を基準にする。
  const defaultBet = 1000 / filteredNumbersetInfos.length;

  for (let i = 0; i < filteredNumbersetInfos.length; i++) {
    const numbersetInfo = filteredNumbersetInfos[i];

    // 賭け金
    const bet = roundBet(defaultBet);

    ticket.numbers.push({
      numberset: numbersetInfo.numberset,
      bet: bet,
    });
  }
}

/**
 * 購入する二連複の舟券を追加する
 *
 * @param powers プレイヤーのパワー配列
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券配列
 */
function addTicket2f(
  powers: Power[],
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): void {
  const type: TicketType = "2f";
  const ticket: Ticket = {
    type: type,
    numbers: [],
  };

  // 組番情報配列を生成する。
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 購入する二連複の舟券を追加する
  addTicket2f2(powers, numbersetInfos, ticket);

  if (ticket.numbers.length > 0) {
    tickets.push(ticket);
  }
}

/**
 * ボートレース
 */
export async function boatRace(): Promise<void> {
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

  let sessionIntervalId: ReturnType<typeof setInterval> | null = null;
  let betResultIntervalId: ReturnType<typeof setInterval> | null = null;
  let cocomoIntervalId: ReturnType<typeof setInterval> | null = null;
  try {
    sessionIntervalId = setInterval(async () => {
      // セッションの更新 50分ごと
      await refresh(session);
    }, 50 * 60 * 1000);

    // 出走表 (当月分)
    const raceCardBodiesForMonth = await getRaceCardBodies(session, today);
    if (raceCardBodiesForMonth === undefined) {
      return;
    }

    // 出走表を当日、今の時間より未来のものだけに絞る
    const yyyymmdd = today.format("YYYY-MM-DD");
    const hhmmss = today.format("HH:mm:ss");
    const raceCardBodiesForDay = raceCardBodiesForMonth.filter(
      (value) => value.hd === yyyymmdd
    );
    const filteredRaceCardBodies = raceCardBodiesForDay.filter(
      (value) => value.deadlinegai > hhmmss
    );

    // 出走表を時間で昇順ソートする
    const sortedRaceCardBodies = filteredRaceCardBodies.sort(
      raceCardBodyOrderByDeadlinegai
    );

    // 日単位の賭け結果 の初期化
    const betDayResult = makeBetDayResult(
      today,
      config,
      raceCardBodiesForDay.length
    );
    await initBetDayResult(today, betDayResult);

    // 設定値確認
    logger.info(util.inspect(betDayResult));

    betResultIntervalId = setInterval(async () => {
      // 日単位の賭け結果 の勝敗を更新する
      await updateBetRaceResult(today, session);
    }, 10000);

    cocomoIntervalId = setInterval(async () => {
      // ココモ法の賭け結果 の勝敗を更新する
      await updateCocomo(session, "3t");
      await updateCocomoTopN(session, "3t");
    }, 9000);

    // 今日レースをやるレース場コード
    const todayJcdArray: number[] = Array.from(
      new Set(
        sortedRaceCardBodies.map((value) => parseInt(value.jcd.toString()))
      )
    );

    // 各レースで舟券購入
    for (let i = 0; i < sortedRaceCardBodies.length; i++) {
      const raceCardBody = sortedRaceCardBodies[i];
      logger.debug(
        `dataid=${raceCardBody.dataid}, jcd=${raceCardBody.jcd}, hd=${raceCardBody.hd}, deadlinegai=${raceCardBody.deadlinegai}`
      );

      // 場外締切時刻の60秒前の時間を計算
      const deadLineGaiStr = `${raceCardBody.hd} ${raceCardBody.deadlinegai}`;
      const dateFormat = "YYYY-MM-DD HH:mm:ss";
      const deadLineGai = dayjs(deadLineGaiStr, dateFormat);
      const deadLineGaiMinus60Second = deadLineGai.add(-60, "second");

      logger.trace("場外締切時刻の60秒前まで待つ");
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
          deadLineGaiMinus60Second.isBefore(now)
        ) {
          // 場外締切時刻よりも60秒前ならば待つのをやめる
          isWait = false;
        }

        // 5秒待つ
        await sleep(5000);
      }
      if (isPass) {
        logger.trace("場外締切時刻を過ぎている");
        continue;
      }

      // 直前情報取得
      const beforeInfo = await getBeforeInfo(
        session,
        parseInt(raceCardBody.dataid.toString())
      );
      if (beforeInfo === undefined || beforeInfo.status !== "200") {
        logger.trace("直前情報取得 NG");
        continue;
      } else {
        logger.trace("直前情報取得 OK");
      }

      // オッズ取得
      const odds = await getOdds(
        session,
        parseInt(raceCardBody.dataid.toString())
      );
      if (odds === undefined) {
        logger.trace("オッズ取得 NG");
        continue;
      } else {
        logger.trace("オッズ取得 OK");
      }

      // 直前予想全確率取得
      const predictsAll = await getPredictsAll(
        session,
        parseInt(raceCardBody.dataid.toString())
      );
      if (predictsAll === undefined) {
        logger.trace("直前予想全確率取得 NG");
        continue;
      }

      // プレイヤーのパワー配列
      const powers: Power[] = playerPowers(predictsAll);

      const tickets: Ticket[] = [];

      // 購入する三連単の舟券を追加する
      await addTicket3t(
        yyyymmdd,
        raceCardBody,
        beforeInfo.body,
        powers,
        odds,
        predictsAll,
        todayJcdArray,
        tickets
      );

      // 購入する三連複の舟券を追加する
      // await addTicket3f(
      //   yyyymmdd,
      //   raceCardBody.dataid,
      //   powers,
      //   odds,
      //   predictsAll,
      //   tickets
      // );

      // 購入する二連単の舟券を追加する
      // await addTicket2t(
      //   yyyymmdd,
      //   raceCardBody.dataid,
      //   powers,
      //   odds,
      //   predictsAll,
      //   tickets
      // );

      // 購入する二連複の舟券を追加する
      // addTicket2f(powers, odds, predictsAll, tickets);

      // 日単位の賭け結果 に レースの賭け結果 を追加する
      // シミュレーション用に賭けてない組番情報も保存する
      await addBetRaceResult(
        today,
        raceCardBody,
        beforeInfo.body,
        odds,
        predictsAll,
        tickets
      );

      if (tickets.length > 0) {
        logger.debug(`tickets=${util.inspect(tickets, { depth: null })}`);

        // 舟券購入
        await autoBuy(
          session,
          parseInt(raceCardBody.dataid.toString()),
          tickets
        );
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

    // レポート作成
    await report(today);
    const isSim = false;
    const dateArray = storedBetDayResultDates(isSim);
    await reportSummary(dateArray, isSim);
  } catch (err) {
    logger.error(err);
  } finally {
    if (sessionIntervalId !== null) {
      clearInterval(sessionIntervalId);
    }

    if (betResultIntervalId !== null) {
      clearInterval(betResultIntervalId);
    }

    if (cocomoIntervalId !== null) {
      clearInterval(cocomoIntervalId);
    }

    // セッションの破棄
    await destroy(session);
  }
}
