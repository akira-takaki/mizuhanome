import fs from "fs-extra";
import dayjs from "dayjs";

import {
  addBetRaceResult,
  DATE_FORMAT,
  initBetDayResult,
  makeBetDayResult,
  makeFileName,
  tabulateBetDayResult,
  updateBetRaceResult,
} from "#/betResult";
import { Config, readConfig } from "#/config";
import {
  authenticate,
  destroy,
  getBeforeInfo,
  getOdds,
  getPredictsAll,
  getRaceCardBodies,
  refresh,
  setupApi,
  Ticket,
} from "#/api";
import { raceCardBodyOrderByDeadlinegai } from "#/myUtil";
import { logger } from "#/boatRace";

/**
 * 指定日の「日単位の賭け結果」を作る
 * ファイルが存在する場合は作らない
 *
 * @param config
 * @param session
 * @param date 指定日
 */
async function buildBetDayResultOfDay(
  config: Config,
  session: string,
  date: dayjs.Dayjs
): Promise<void> {
  console.info(date.format(DATE_FORMAT));

  // ファイルの存在チェック
  const isSim = false;
  const fileName = makeFileName(date, isSim);
  if (fs.existsSync(fileName)) {
    return;
  }

  // 月指定 出走表 取得
  const raceCardBodiesForMonth = await getRaceCardBodies(session, date);
  if (raceCardBodiesForMonth === undefined) {
    return;
  }

  // 出走表を指定日のものだけに絞る
  const yyyymmdd = date.format("YYYY-MM-DD");
  const raceCardBodiesForDay = raceCardBodiesForMonth.filter(
    (value) => value.hd === yyyymmdd
  );

  // 出走表を時間で昇順ソートする
  const sortedRaceCardBodies = raceCardBodiesForDay.sort(
    raceCardBodyOrderByDeadlinegai
  );

  // 日単位の賭け結果 の初期化
  const betDayResult = makeBetDayResult(
    date,
    config,
    raceCardBodiesForDay.length
  );
  await initBetDayResult(date, betDayResult);

  for (let i = 0; i < sortedRaceCardBodies.length; i++) {
    const raceCardBody = sortedRaceCardBodies[i];

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

    const tickets: Ticket[] = [];

    // 日単位の賭け結果 に レースの賭け結果 を追加する
    await addBetRaceResult(
      date,
      raceCardBody,
      beforeInfo.body,
      odds,
      predictsAll,
      tickets
    );
  }

  // 日単位の賭け結果 の勝敗を更新する
  await updateBetRaceResult(date, session);

  // 日単位の賭け結果 の集計
  await tabulateBetDayResult(date);
}

/**
 * ファイルが無い分の「日単位の賭け結果」を作る
 */
async function buildBetDayResult(): Promise<void> {
  console.info("設定ファイルの読み込み");
  let config: Config;
  try {
    config = await readConfig();
  } catch (err) {
    console.error("設定ファイルの読み込み 失敗");
    console.error(err);
    return;
  }

  // 後で作ったものなので資金は 0 にしておく
  config.capital = 0;

  setupApi(config);

  // 認証
  const session = await authenticate();
  if (session === undefined) {
    console.error("session is undefined");
    return;
  }
  let sessionIntervalId: ReturnType<typeof setInterval> | null = null;

  try {
    sessionIntervalId = setInterval(async () => {
      // セッションの更新 50分ごと
      await refresh(session);
    }, 50 * 60 * 1000);

    // 開始日 (今日)
    const startDate: dayjs.Dayjs = dayjs(
      dayjs().format(DATE_FORMAT),
      DATE_FORMAT
    );

    // 終了日
    const endDate: dayjs.Dayjs = dayjs("2021/01/13", DATE_FORMAT);

    // 開始日から終了日まで繰り返し
    let date: dayjs.Dayjs = startDate;
    while (date.isSame(endDate, "day") || date.isAfter(endDate)) {
      // 指定日の「日単位の賭け結果」を作る
      // ファイルが存在する場合は作らない
      await buildBetDayResultOfDay(config, session, date);

      date = date.subtract(1, "day");
    }
  } finally {
    if (sessionIntervalId !== null) {
      clearInterval(sessionIntervalId);
    }

    // セッションの破棄
    await destroy(session);
  }
}

buildBetDayResult().catch((err) => {
  console.error(err);
  process.exit(1);
});
